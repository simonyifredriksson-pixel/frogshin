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

import { CFG, BUILD } from './config.js?v=v11';
import { roomCode as makeRoomCode } from './util.js?v=v11';

export const NetRole = { OFFLINE: 'offline', HOST: 'host', CLIENT: 'client' };

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
  }

  get isHost() { return this.role === NetRole.HOST; }
  get isOnline() { return this.role !== NetRole.OFFLINE; }
  get playerCount() { return 1 + this.profiles.size; }

  _status(msg) {
    this.status = msg;
    if (this.onStatus) this.onStatus(msg);
  }

  static get available() { return typeof window !== 'undefined' && !!window.Peer; }

  // ------------------------------------------------------------------ setup

  /** Single-player fallback. Explicitly offline — nothing is faked. */
  startSolo(profile) {
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
    this.profile = profile;
    this.room = (code || makeRoomCode()).toUpperCase();
    this.role = NetRole.HOST;
    this._status(`Creating room ${this.room}…`);

    this.peer = new window.Peer(CFG.net.prefix + this.room, { debug: 0 });

    this.peer.on('open', (id) => {
      this.selfId = id;
      this.connected = true;
      this._status(`Room ${this.room} — waiting for players`);
      if (this.onReady) this.onReady({ role: this.role, room: this.room });
    });

    this.peer.on('connection', (conn) => this._acceptClient(conn));

    this.peer.on('error', (err) => {
      if (err.type === 'unavailable-id') {
        // Somebody already hosts this code — join them instead.
        this._status('Room already exists — joining instead…');
        this._cleanupPeer();
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
    this.profile = profile;
    this.room = code.toUpperCase();
    this.role = NetRole.CLIENT;
    this._status(`Connecting to room ${this.room}…`);

    this.peer = new window.Peer(undefined, { debug: 0 });

    this.peer.on('open', (id) => {
      this.selfId = id;
      const conn = this.peer.connect(CFG.net.prefix + this.room, {
        reliable: true,
        serialization: 'json',
        metadata: { name: profile.name, color: profile.color },
      });
      this.hostConn = conn;

      // If the host never answers, surface a real error instead of hanging.
      const timeout = setTimeout(() => {
        if (!this.connected) this._fail(`No room "${this.room}" is open right now.`);
      }, 12000);

      conn.on('open', () => {
        clearTimeout(timeout);
        this.connected = true;
        this._send(conn, { m: 'hello', name: profile.name, color: profile.color, v: BUILD });
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
    });

    this.peer.on('error', (err) => {
      if (err.type === 'peer-unavailable') {
        this._fail(`No room "${this.room}" is open right now.`);
        return;
      }
      this._peerError(err);
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
    this.lastError = msg;
    this._status(msg);
    if (this.onFail) this.onFail(msg);
  }

  // ----------------------------------------------------------- host plumbing

  _acceptClient(conn) {
    conn.on('open', () => {
      this.connections.set(conn.peer, conn);
      const meta = conn.metadata || {};
      const prof = {
        name: (meta.name || 'Frog').slice(0, 14),
        color: meta.color || 0x6cc24a,
        kills: 0, deaths: 0,
      };
      this.profiles.set(conn.peer, prof);

      // Tell the newcomer about everyone already here (including the host).
      const roster = [{ id: this.selfId, name: this.profile.name, color: this.profile.color }];
      for (const [id, p] of this.profiles) {
        if (id !== conn.peer) roster.push({ id, name: p.name, color: p.color });
      }
      this._send(conn, { m: 'welcome', you: conn.peer, roster, room: this.room, v: BUILD });

      // Tell everyone else about the newcomer.
      this._broadcast({ m: 'join', id: conn.peer, name: prof.name, color: prof.color }, conn.peer);

      if (this.onJoin) this.onJoin(conn.peer, prof);
      this._status(`Room ${this.room} — ${this.playerCount} frogs`);
    });

    conn.on('data', (d) => this._onHostData(conn, d));
    conn.on('close', () => this._dropClient(conn.peer));
    conn.on('error', () => this._dropClient(conn.peer));
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

  _cleanupPeer() {
    if (this.peer) {
      try { this.peer.removeAllListeners(); } catch (e) { /* noop */ }
      try { this.peer.destroy(); } catch (e) { /* noop */ }
    }
    this.peer = null;
  }

  disconnect() {
    this._destroyed = true;
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
