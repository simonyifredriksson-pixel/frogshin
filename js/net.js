/**
 * Multiplayer networking.
 *
 * Transport is real WebRTC peer-to-peer (via PeerJS, which supplies only the
 * signalling broker — game traffic never touches a server). Topology is a
 * star: whoever creates the room is the host, every other player holds a
 * single DataConnection to them, and the host relays. A star was chosen over
 * a full mesh because it needs one connection per player instead of N², and
 * because a single relay gives every client the same ordering of events.
 *
 * Authority model:
 *   - Each client is authoritative over its OWN position and health.
 *   - Attackers send `hit` REQUESTS; the victim applies the damage to itself
 *     and its next state broadcast carries the result.
 * That keeps combat latency-free for the attacker while making it impossible
 * for one client to directly write another's health.
 */

import { CFG, BUILD } from './config.js?v=v55';
import { roomCode as makeRoomCode } from './util.js?v=v55';

export const NetRole = { OFFLINE: 'offline', HOST: 'host', CLIENT: 'client' };

/**
 * ICE configuration — how two browsers find a path to each other.
 *
 * STUN alone only tells each peer its own public address so they can attempt
 * a direct connection ("hole punching"). That works on most home routers and
 * fails on most school and corporate networks, which use symmetric NAT and
 * block the UDP involved. The symptom is very specific: home-to-school
 * connects, school-to-school never does.
 *
 * TURN fixes that by relaying the traffic through a public server. The
 * 443/TCP entry matters most — to a firewall it is indistinguishable from
 * ordinary HTTPS, so it survives networks that drop everything else.
 *
 * These are the Open Relay Project's free public credentials. Free TURN is
 * rate-limited and carries no uptime guarantee, so STUN is listed first and
 * the relay is only used when a direct route genuinely cannot be found.
 */
const ICE_CONFIG = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    {
      urls: 'turn:openrelay.metered.ca:80',
      username: 'openrelayproject',
      credential: 'openrelayproject',
    },
    {
      urls: 'turn:openrelay.metered.ca:443',
      username: 'openrelayproject',
      credential: 'openrelayproject',
    },
    {
      // Most firewall-tolerant of the lot: TURN over TCP on the HTTPS port.
      urls: 'turn:openrelay.metered.ca:443?transport=tcp',
      username: 'openrelayproject',
      credential: 'openrelayproject',
    },
  ],
  // Gather a few candidates up front so connecting is not slowed by having
  // to discover a relay path from scratch.
  iceCandidatePoolSize: 4,
};

/** Options handed to every PeerJS Peer we create. */
function peerOptions() {
  return { debug: 0, config: ICE_CONFIG };
}

/**
 * Who we are, independently of the network.
 *
 * A PeerJS id belongs to a *connection*, not to a person: dial the host twice
 * and you are two ids, so the host counts you twice and everybody watches a
 * duplicate of you trail one interpDelay behind. This tag is minted once per
 * page load and travels with every connection attempt, so the host can tell
 * "a new player" from "the same player again" and replace the old slot
 * instead of adding one.
 */
const CLIENT_UID = (() => {
  try {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  } catch (e) { /* fall through */ }
  return 'u' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
})();

export class Network {
  constructor() {
    this.role = NetRole.OFFLINE;
    this.peer = null;
    this.selfId = null;
    this.room = null;
    this.connections = new Map();   // peerId -> DataConnection (host: all clients)
    this.hostConn = null;           // client: the single connection to the host
    this.profiles = new Map();      // peerId -> { name, color, kills, deaths }
    this.connected = false;
    this.lastError = null;

    // Callbacks assigned by the game.
    this.onJoin = null;
    this.onLeave = null;
    this.onState = null;
    this.onEvent = null;
    this.onHit = null;
    this.onStatus = null;
    this.onVersionMismatch = null;   // (theirBuild, name) => void
    this.onReady = null;
    this.onFail = null;

    this._sendAccum = 0;
    this._destroyed = false;
    this._opened = false;           // 'open' is handled once per Peer, see host()/join()
    this.uid = CLIENT_UID;          // who we are across connections, see above
    this._brokerTimer = null;       // "the matchmaker never answered" guard
    this._quick = null;             // in-flight Quick Play attempt, see quickPlay()
  }

  get isHost() { return this.role === NetRole.HOST; }
  get isOnline() { return this.role !== NetRole.OFFLINE; }
  get playerCount() { return 1 + this.profiles.size; }

  _status(msg) {
    this.status = msg;
    if (this.onStatus) this.onStatus(msg);
  }

  static get available() { return typeof window !== 'undefined' && !!window.Peer; }

  /**
   * Fail if the matchmaking server never answers.
   *
   * PeerJS gives no callback at all when its signalling socket cannot be
   * opened: no 'open', and frequently no 'error' either. Without this the
   * game sits on "Creating room…" or "Connecting…" for ever, which is what
   * a blocked school or office network looks like from the inside — and to
   * the player it looks like the button did nothing.
   */
  _armBroker(msg) {
    this._clearBroker();
    this._brokerTimer = setTimeout(() => {
      this._brokerTimer = null;
      if (this._opened || this.connected) return;
      this._fail(msg);
    }, CFG.net.brokerTimeout * 1000);
  }

  _clearBroker() {
    if (this._brokerTimer) { clearTimeout(this._brokerTimer); this._brokerTimer = null; }
  }

  /** The advice that actually helps when signalling is blocked. */
  get _blockedAdvice() {
    return 'Could not reach the matchmaking server. School and office '
      + 'networks usually block it. A phone hotspot normally works — or use '
      + 'ARENA PRACTICE to play offline.';
  }

  /**
   * QUICK PLAY.
   *
   * One public room that everybody tries to claim, so nobody has to type a
   * code. Whoever gets there first hosts; everyone else is told the id is
   * taken and joins them instead.
   *
   * The awkward case is a room that EXISTS but is empty — a host who closed
   * the tab can leave their id registered on the broker for a while. The
   * claim then fails, the join then fails, and the old code gave up there,
   * which is a large part of why this button was unreliable. So a failed
   * join gets one more attempt at hosting: by then the dead registration has
   * usually expired and the room is ours.
   */
  quickPlay(profile, code) {
    const room = (code || CFG.net.publicRoom).toUpperCase();
    this._quick = { profile, room, phase: 'host', retried: false };
    this.host(profile, room);
  }

  // ------------------------------------------------------------------ setup

  /** Single-player fallback. Explicitly offline — nothing is faked. */
  startSolo(profile) {
    this._resetSession();
    this.role = NetRole.OFFLINE;
    this.selfId = 'local';
    this.profile = profile;
    this.connected = false;
    this._status('Offline — solo practice');
    if (this.onReady) this.onReady({ role: this.role, room: null });
  }

  /**
   * Create a room and wait for others.
   * @param profile { name, color }
   * @param code    optional fixed room code
   */
  host(profile, code) {
    if (!Network.available) return this._fail('Networking library failed to load.');
    this._resetSession();
    this.profile = profile;
    this.room = (code || makeRoomCode()).toUpperCase();
    this.role = NetRole.HOST;
    this._status(`Creating room ${this.room}…`);

    this.peer = new window.Peer(CFG.net.prefix + this.room, peerOptions());
    this._armBroker(this._blockedAdvice);

    this.peer.on('open', (id) => {
      // ONCE. `peer.reconnect()` fires 'open' again, and re-running this
      // would reassign selfId mid-session — after which our own state
      // packets arrive at everyone else under an id they have never seen,
      // and they build a second copy of us out of them.
      if (this._opened) { this._status(`Room ${this.room} — signalling back`); return; }
      this._opened = true;
      this._clearBroker();
      this._quick = null;                  // Quick Play got what it wanted
      this.selfId = id;
      this.connected = true;
      this._status(`Room ${this.room} — waiting for players`);
      if (this.onReady) this.onReady({ role: this.role, room: this.room });
    });

    this.peer.on('connection', (conn) => this._acceptClient(conn));

    this.peer.on('error', (err) => {
      if (err.type === 'unavailable-id') {
        // Only meaningful while we are still trying to CLAIM the code. Once
        // we own the room, this same error means the broker is still holding
        // our own previous session after a reconnect — and tearing the room
        // down to "join ourselves" would strand every client while keeping
        // their stale roster entries, which is where phantom players and
        // inflated lobby counts came from.
        if (this._opened) { this._status(`Room ${this.room} — signalling back`); return; }
        // Somebody already hosts this code — join them instead.
        this._status('Room already exists — joining instead…');
        this._clearBroker();
        this._cleanupPeer();
        if (this._quick) this._quick.phase = 'join';
        this.join(profile, this.room);
        return;
      }
      this._peerError(err);
    });

    this.peer.on('disconnected', () => {
      this._status('Signalling dropped — reconnecting…');
      if (!this._destroyed && this.peer) { try { this.peer.reconnect(); } catch (e) { /* noop */ } }
    });
  }

  /** Join an existing room by code. */
  join(profile, code) {
    if (!Network.available) return this._fail('Networking library failed to load.');
    if (!code) return this._fail('Enter a room code first.');
    this._resetSession();
    this.profile = profile;
    this.room = code.toUpperCase();
    this.role = NetRole.CLIENT;
    this._status(`Connecting to room ${this.room}…`);

    this.peer = new window.Peer(undefined, peerOptions());
    this._armBroker(this._blockedAdvice);

    this.peer.on('open', (id) => {
      // ONCE — see the matching guard in host(). A signalling drop makes
      // PeerJS call reconnect(), which fires 'open' with a BRAND NEW random
      // id (we asked for `undefined`). Without this guard we would dial the
      // host a second time under that new id: the host accepts it as a
      // whole new player, so everyone gets a duplicate of us that mirrors
      // our movement one interpDelay behind. The existing data channel
      // survives a broker hiccup on its own, so there is nothing to redo.
      if (this._opened) { this._status(`Connected to room ${this.room}`); return; }
      this._opened = true;
      this._clearBroker();
      this.selfId = id;
      const conn = this.peer.connect(CFG.net.prefix + this.room, {
        reliable: true,
        serialization: 'json',
        metadata: { name: profile.name, color: profile.color, uid: this.uid },
      });
      this.hostConn = conn;

      // Two different failures look identical from here, so they are timed
      // separately. Reaching the broker but never opening the data channel
      // means the room exists and the NETWORK is blocking the link — the
      // usual story on school and office Wi-Fi.
      this._reachedBroker = false;
      const timeout = setTimeout(() => {
        if (this.connected) return;
        this._fail(this._reachedBroker
          ? `Found room "${this.room}", but this network is blocking the ` +
            'connection. School and office Wi-Fi often does. Try a phone ' +
            'hotspot or a home network.'
          : `No room "${this.room}" is open right now.`);
      }, 20000);   // TURN relaying can take noticeably longer than a direct link

      conn.on('open', () => {
        clearTimeout(timeout);
        this._quick = null;                // Quick Play landed in a real room
        this.connected = true;
        this._send(conn, { m: 'hello', name: profile.name, color: profile.color, uid: this.uid, v: BUILD });
        this._status(`Connected to room ${this.room}`);
        if (this.onReady) this.onReady({ role: this.role, room: this.room });
      });
      conn.on('data', (d) => this._onClientData(d));
      conn.on('close', () => {
        clearTimeout(timeout);
        this._status('Host closed the room.');
        this._hostLost();
      });
      conn.on('error', () => { /* surfaced by peer.on('error') */ });

      // ICE reaching "checking" proves the host was found and we are now
      // negotiating a route — so a later timeout is a blocked path, not a
      // missing room.
      if (conn.peerConnection) this._watchIce(conn);
      else setTimeout(() => { if (conn.peerConnection) this._watchIce(conn); }, 400);
    });

    this.peer.on('error', (err) => {
      if (err.type === 'peer-unavailable') {
        this._fail(`No room "${this.room}" is open right now.`);
        return;
      }
      this._peerError(err);
    });
  }

  /**
   * Watch ICE negotiation so a failure can be reported precisely.
   * Purely diagnostic — it never changes the connection itself.
   */
  _watchIce(conn) {
    const pc = conn.peerConnection;
    if (!pc || this._iceWatched) return;
    this._iceWatched = true;
    pc.addEventListener('iceconnectionstatechange', () => {
      const st = pc.iceConnectionState;
      if (st === 'checking') this._reachedBroker = true;
      if (st === 'connected' || st === 'completed') this._reachedBroker = true;
      if (st === 'failed' && !this.connected) {
        this._fail('This network is blocking the peer-to-peer connection. ' +
          'School and office Wi-Fi usually does — try a phone hotspot.');
      }
      console.log('[frogshin] ice:', st);
    });
  }

  _peerError(err) {
    const type = err && err.type ? err.type : 'unknown';
    let msg;
    switch (type) {
      case 'browser-incompatible': msg = 'This browser does not support WebRTC.'; break;
      case 'network': msg = 'Network error reaching the signalling server.'; break;
      case 'server-error': msg = 'Signalling server unavailable. Try again shortly.'; break;
      case 'socket-error':
      case 'socket-closed': msg = 'Lost connection to the signalling server.'; break;
      default: msg = `Connection error (${type}).`;
    }
    this._fail(msg);
  }

  _fail(msg) {
    this._clearBroker();

    // Quick Play gets one more go at HOSTING.
    //
    // Reaching here from the join leg means the broker said the room was
    // taken and then nobody answered — which is what an abandoned room looks
    // like: a host who closed their tab leaves the id registered for a while
    // after there is anybody behind it. By now it has usually lapsed, so
    // claiming it ourselves is the right move rather than telling the player
    // the room is both taken and empty.
    const q = this._quick;
    if (q && q.phase === 'join' && !q.retried) {
      q.retried = true;
      q.phase = 'host';
      this._status('That room was empty — starting a new one…');
      this._cleanupPeer();
      this.host(q.profile, q.room);
      return;
    }
    this._quick = null;

    this.lastError = msg;
    this._status(msg);
    if (this.onFail) this.onFail(msg);
  }

  // ----------------------------------------------------------- host plumbing

  _acceptClient(conn) {
    conn.on('open', () => {
      // A peer we already hold has redialled (renegotiation, or a client that
      // survived a broker hiccup). Swap the socket, but do NOT announce a
      // second join — that is what breeds duplicate players.
      const dupe = this.connections.get(conn.peer);
      if (dupe && dupe !== conn) {
        this.connections.set(conn.peer, conn);
        try { dupe.close(); } catch (e) { /* noop */ }
        this._send(conn, {
          m: 'welcome', you: conn.peer, room: this.room, v: BUILD,
          roster: this._roster(conn.peer),
        });
        return;
      }
      if (conn.peer === this.selfId) { try { conn.close(); } catch (e) { /* noop */ } return; }

      const meta = conn.metadata || {};

      // Someone already in the room has dialled in on a fresh peer id — a
      // reload, a rejoin, or a link that healed onto a new connection. They
      // are one person, so retire the slot they used to hold before handing
      // them a new one. Skipping this is what left a second copy of them in
      // the roster, fed by their live packets and therefore following them
      // around one interpDelay behind.
      this._retireOldSlot(meta.uid, conn.peer);

      this.connections.set(conn.peer, conn);
      const prof = {
        name: (meta.name || 'Frog').slice(0, 14),
        color: meta.color || 0x6cc24a,
        uid: meta.uid || null,
        kills: 0, deaths: 0,
      };
      this.profiles.set(conn.peer, prof);

      // Tell the newcomer about everyone already here (including the host).
      this._send(conn, {
        m: 'welcome', you: conn.peer, room: this.room, v: BUILD,
        roster: this._roster(conn.peer),
      });

      // Tell everyone else about the newcomer.
      this._broadcast({ m: 'join', id: conn.peer, name: prof.name, color: prof.color }, conn.peer);

      if (this.onJoin) this.onJoin(conn.peer, prof);
      this._status(`Room ${this.room} — ${this.playerCount} frogs`);
    });

    conn.on('data', (d) => this._onHostData(conn, d));
    // Only the socket we are actually using speaks for the player. A stale
    // duplicate closing must not evict whoever is live on that id.
    const bye = () => { if (this.connections.get(conn.peer) === conn) this._dropClient(conn.peer); };
    conn.on('close', bye);
    conn.on('error', bye);
  }

  /**
   * Host: one person owns one slot. Remove any roster entry that carries the
   * same client tag as `keepId` so a rejoin replaces the old entry instead of
   * sitting beside it as a duplicate.
   */
  _retireOldSlot(uid, keepId) {
    if (!uid) return;
    for (const [oldId, p] of Array.from(this.profiles)) {
      if (oldId === keepId || p.uid !== uid) continue;
      const old = this.connections.get(oldId);
      if (old) { try { old.close(); } catch (e) { /* noop */ } }
      this._dropClient(oldId);
    }
  }

  /** Everyone in the room except `exceptId`, host first. */
  _roster(exceptId) {
    const roster = [{ id: this.selfId, name: this.profile.name, color: this.profile.color }];
    for (const [id, p] of this.profiles) {
      if (id !== exceptId) roster.push({ id, name: p.name, color: p.color });
    }
    return roster;
  }

  _dropClient(id) {
    if (!this.connections.has(id) && !this.profiles.has(id)) return;
    this.connections.delete(id);
    this.profiles.delete(id);
    this._broadcast({ m: 'leave', id });
    if (this.onLeave) this.onLeave(id);
    this._status(`Room ${this.room} — ${this.playerCount} frogs`);
  }

  /** Host: messages from a client. Relay + local delivery. */
  _onHostData(conn, d) {
    if (!d || !d.m) return;
    const from = conn.peer;

    switch (d.m) {
      case 'hello': {
        const prof = this.profiles.get(from);
        if (prof) {
          prof.name = (d.name || prof.name).slice(0, 14);
          prof.color = d.color || prof.color;
          prof.build = d.v || 'older';
          // Metadata is the normal carrier for the client tag; this is the
          // fallback for a link that arrived without it.
          if (d.uid && !prof.uid) { prof.uid = d.uid; this._retireOldSlot(d.uid, from); }
        }
        // A build mismatch does not stop play, but it must be visible —
        // silently disagreeing about the rules is far more confusing.
        if ((d.v || 'older') !== BUILD && this.onVersionMismatch) {
          this.onVersionMismatch(d.v || 'older', prof ? prof.name : 'A player');
        }
        break;
      }
      case 'state':
        // Stamp the sender so relayed packets stay attributable.
        d.id = from;
        if (this.onState) this.onState(from, d.s);
        this._broadcast(d, from);
        break;
      case 'event':
        d.id = from;
        if (this.onEvent) this.onEvent(from, d.e);
        this._broadcast(d, from);
        break;
      case 'hit':
        d.from = from;
        if (d.to === this.selfId) {
          if (this.onHit) this.onHit(d);
        } else {
          const target = this.connections.get(d.to);
          if (target) this._send(target, d);
        }
        break;
      default:
        break;
    }
  }

  /** Client: messages from the host. */
  _onClientData(d) {
    if (!d || !d.m) return;
    // We are never one of our own remotes. `welcome` has always filtered the
    // roster; every other id-carrying message needs the same rule, or a stale
    // entry on the host's side is enough to spawn a copy of us.
    if (d.id && d.id === this.selfId && d.m !== 'hit') return;
    switch (d.m) {
      case 'welcome':
        if ((d.v || 'older') !== BUILD && this.onVersionMismatch) {
          this.onVersionMismatch(d.v || 'older', 'The host');
        }
        for (const p of d.roster) {
          if (p.id === this.selfId) continue;
          this.profiles.set(p.id, { name: p.name, color: p.color, kills: 0, deaths: 0 });
          if (this.onJoin) this.onJoin(p.id, this.profiles.get(p.id));
        }
        this._status(`Room ${this.room} — ${this.playerCount} frogs`);
        break;
      case 'join':
        this.profiles.set(d.id, { name: d.name, color: d.color, kills: 0, deaths: 0 });
        if (this.onJoin) this.onJoin(d.id, this.profiles.get(d.id));
        this._status(`Room ${this.room} — ${this.playerCount} frogs`);
        break;
      case 'leave':
        this.profiles.delete(d.id);
        if (this.onLeave) this.onLeave(d.id);
        this._status(`Room ${this.room} — ${this.playerCount} frogs`);
        break;
      case 'state':
        if (this.onState) this.onState(d.id, d.s);
        break;
      case 'event':
        if (this.onEvent) this.onEvent(d.id, d.e);
        break;
      case 'hit':
        if (d.to === this.selfId && this.onHit) this.onHit(d);
        break;
      default:
        break;
    }
  }

  _hostLost() {
    this.connected = false;
    for (const id of Array.from(this.profiles.keys())) {
      if (this.onLeave) this.onLeave(id);
    }
    this.profiles.clear();
    this.role = NetRole.OFFLINE;
  }

  // -------------------------------------------------------------- transport

  _send(conn, obj) {
    try {
      if (conn && conn.open) conn.send(obj);
    } catch (e) { /* a dying connection is handled by its close handler */ }
  }

  _broadcast(obj, exceptId) {
    for (const [id, conn] of this.connections) {
      if (id === exceptId) continue;
      this._send(conn, obj);
    }
  }

  /** Rate-limited state broadcast. Call every frame; it throttles internally. */
  tickState(dt, getState) {
    if (!this.isOnline || !this.connected) return;
    this._sendAccum += dt;
    const interval = 1 / CFG.net.sendRate;
    if (this._sendAccum < interval) return;
    this._sendAccum = 0;

    const s = getState();
    if (this.isHost) {
      this._broadcast({ m: 'state', id: this.selfId, s });
    } else if (this.hostConn) {
      this._send(this.hostConn, { m: 'state', s });
    }
  }

  /** Reliable one-shot action (dash, attack, death, ...). */
  sendEvent(ev) {
    if (!this.isOnline || !this.connected) return;
    if (this.isHost) this._broadcast({ m: 'event', id: this.selfId, e: ev });
    else this._send(this.hostConn, { m: 'event', e: ev });
  }

  /** Request damage on another player. The victim decides if it lands. */
  sendHit(toId, dmg, kx, ky, kz, combo) {
    if (!this.isOnline || !this.connected) return;
    const msg = { m: 'hit', to: toId, dmg, kx, ky, kz, c: combo, from: this.selfId };
    if (this.isHost) {
      const conn = this.connections.get(toId);
      if (conn) this._send(conn, msg);
    } else {
      this._send(this.hostConn, msg);
    }
  }

  nameOf(id) {
    const p = this.profiles.get(id);
    return p ? p.name : 'Someone';
  }

  // --------------------------------------------------------------- teardown

  /**
   * Wipe every trace of a previous session before starting another one.
   *
   * `host()` and `join()` used to leave `connections` and `profiles` intact,
   * so a room you had already been in kept contributing players to the next
   * one — frogs nobody could see standing in a lobby count that was too high.
   */
  _resetSession() {
    // Listeners go first. A `close` landing a tick later would otherwise run
    // _hostLost() or _dropClient() against the session we are just starting.
    const shut = (conn) => {
      if (!conn) return;
      try { conn.removeAllListeners(); } catch (e) { /* noop */ }
      try { conn.close(); } catch (e) { /* noop */ }
    };
    for (const conn of this.connections.values()) shut(conn);
    this.connections.clear();
    shut(this.hostConn);
    this.hostConn = null;
    for (const id of Array.from(this.profiles.keys())) {
      if (this.onLeave) this.onLeave(id);
    }
    this.profiles.clear();
    this.connected = false;
    this._iceWatched = false;
    this._sendAccum = 0;
    // An orphaned Peer keeps its data channels open, so a second attempt from
    // this tab would hold two live links to the same room at once.
    this._cleanupPeer();
  }

  _cleanupPeer() {
    if (this.peer) {
      try { this.peer.removeAllListeners(); } catch (e) { /* noop */ }
      try { this.peer.destroy(); } catch (e) { /* noop */ }
    }
    this.peer = null;
    this._opened = false;   // the next Peer gets its own single 'open'
    this._clearBroker();
  }

  disconnect() {
    this._destroyed = true;
    this._quick = null;      // abandon any Quick Play retry in flight
    for (const conn of this.connections.values()) {
      try { conn.close(); } catch (e) { /* noop */ }
    }
    this.connections.clear();
    if (this.hostConn) { try { this.hostConn.close(); } catch (e) { /* noop */ } }
    this.hostConn = null;
    this.profiles.clear();
    this._cleanupPeer();
    this.role = NetRole.OFFLINE;
    this.connected = false;
    this._destroyed = false;
  }
}
