/**
 * ROADS AND RIVERS — the two things that make a big map feel like a country.
 *
 * Both are polylines, and both CHANGE THE GROUND rather than being painted on
 * top of it. That is the whole idea here: a road you can see but not walk is
 * scenery, and a river that is only a blue stripe is wallpaper.
 *
 *   RIVERS carve. Each one holds a bed height and cuts the terrain down to it,
 *          never up — so a river runs down a valley and pools in a basin, and
 *          never builds a ridge across a lake.
 *   ROADS  grade. Each one holds a bed height too, but blends the terrain
 *          toward it in both directions — so a road cuts through a hill and
 *          embanks across a dip, exactly as a real one does.
 *
 * ── why the roads are graded and not just coloured ────────────────────────
 * The realm is five thousand units across and the story sends you from one
 * end of it to the other. Terrain generated from noise does not care whether
 * the route between two towns is climbable, and the character controller
 * refuses anything past a 0.46 slope. Grading the road bed means every road
 * in the world is walkable BY CONSTRUCTION: the bed is smoothed until no
 * segment of it exceeds `MAX_GRADE`, and the terrain is then pulled onto it.
 *
 * It is also what carries the Sunderway. That region is two plateaus with a
 * two-hundred-unit chasm between them, and the road across it becomes a
 * causeway — the only way north, holding itself up.
 *
 * ── why the bed heights are computed from a BASE height function ──────────
 * The node heights have to come from the ground, and the ground is what this
 * file is about to change. So `Network` is handed the terrain WITHOUT roads
 * or rivers in it, samples that once at build time, and caches it. There is
 * no recursion and no ordering surprise.
 */

import { clamp, smoothstep, lerp } from './util.js?v=v122';
import { REALM_HALF } from './regions.js?v=v122';

/** Steepest a graded road may be, as a rise over run. */
const MAX_GRADE = 0.26;

/**
 * The road network.
 *
 * Every entry connects places that exist in the region table, and the order
 * of the list is roughly the order the story walks them. `pts` may carry a
 * third number on a node, which pins that node's height instead of taking it
 * from the terrain — used where the terrain is a hole the road has to cross.
 */
export const ROADS = [
  {
    id: 'kingsroad', name: 'THE KING’S ROAD',
    pts: [[300, 1790], [240, 1560], [170, 1330], [150, 1120], [150, 930],
      [40, 740], [-170, 550]],
  },
  {
    id: 'meadway', name: 'THE MEAD WAY',
    pts: [[300, 1790], [10, 1740], [-330, 1700], [-660, 1620], [-980, 1560]],
  },
  {
    id: 'woodroad', name: 'THE WOOD ROAD',
    pts: [[300, 1790], [620, 1700], [880, 1560], [1080, 1400]],
  },
  {
    id: 'cuttersway', name: 'THE CUTTER’S WAY',
    pts: [[-170, 550], [280, 620], [740, 700], [1140, 760], [1520, 780]],
  },
  {
    id: 'glassroad', name: 'THE GLASS ROAD',
    pts: [[-170, 550], [-520, 620], [-880, 700], [-1240, 760]],
  },
  {
    id: 'saltroad', name: 'THE SALT ROAD',
    pts: [[-1240, 760], [-1400, 500], [-1540, 260], [-1620, 40]],
  },
  {
    id: 'dustroad', name: 'THE DUST ROAD',
    pts: [[1520, 780], [1620, 560], [1690, 430], [1750, 320]],
  },
  {
    id: 'choirroad', name: 'THE CHOIR ROAD',
    pts: [[-170, 550], [140, 340], [420, 140], [700, -20]],
  },
  {
    id: 'boneroad', name: 'THE BONE PATH',
    pts: [[-170, 550], [-380, 260], [-580, -20], [-680, -300], [-520, -560],
      [-280, -880]],
  },
  {
    id: 'lakeroad', name: 'THE LAKE ROAD',
    pts: [[700, -20], [900, -80], [1140, -140]],
  },
  {
    id: 'ashroad', name: 'THE ASH ROAD',
    pts: [[700, -20], [1000, -260], [1240, -520], [1400, -760], [1560, -980],
      [1740, -1220]],
  },
  {
    id: 'moonroad', name: 'THE MOON ROAD',
    pts: [[700, -20], [560, -380], [400, -700], [180, -1000]],
  },
  {
    id: 'hollowroad', name: 'THE HOLLOW ROAD',
    pts: [[180, -1000], [460, -1140], [680, -1280], [860, -1400]],
  },
  {
    id: 'coldroad', name: 'THE COLD ROAD',
    pts: [[-680, -300], [-1000, -460], [-1300, -620], [-1560, -840],
      [-1400, -1080], [-1140, -1320]],
  },
  {
    id: 'rimeroad', name: 'THE RIME ROAD',
    pts: [[-1140, -1320], [-1420, -1500], [-1640, -1660], [-1780, -1800]],
  },
  {
    id: 'lumenroad', name: 'THE LUMEN ROAD',
    pts: [[-1140, -1320], [-680, -1420], [-180, -1500]],
  },
  {
    /**
     * The causeway.
     *
     * The four middle nodes are PINNED to the plateau height. Left to the
     * terrain they would sit at the bottom of a two-hundred-unit chasm and
     * the road would dive into it; grading alone would then drag the whole
     * plateau down to meet them. Pinning them makes the crossing what it is
     * meant to be: a bridge of raised ground, with nothing under it.
     */
    id: 'sunderroad', name: 'THE SUNDERWAY',
    pts: [[860, -1400], [640, -1520], [430, -1640, 205], [420, -1720, 205],
      [420, -1840, 205], [400, -1920, 205], [200, -1900], [0, -1810]],
  },
];

/**
 * The rivers.
 *
 * All four run to the southern sea, because the sea is where the player woke
 * up and a river you can follow downhill is the oldest direction-giver there
 * is. `depth` is how far below the graded bed the channel is cut — deep
 * enough to swim in, shallow enough to wade out of.
 */
export const RIVERS = [
  {
    /**
     * The river runs WEST of the King's Road and west of the starting
     * village. Its first route put the mouth straight through Croakhollow,
     * which carved the village square seven units under water — a river that
     * drowns the place the player wakes up in.
     */
    id: 'longcroak', name: 'THE LONG CROAK', depth: 16, w0: 24, w1: 64,
    pts: [[-1500, -1500], [-1240, -1120], [-980, -760], [-760, -380],
      [-520, 60], [-300, 380], [-140, 620], [-100, 700], [-50, 1000],
      [20, 1350], [100, 1700], [140, 2010]],
  },
  {
    id: 'emberrun', name: 'THE EMBERRUN', depth: 12, w0: 16, w1: 46,
    pts: [[1940, -1020], [1740, -820], [1520, -620], [1400, -440],
      [1320, -320]],
  },
  {
    id: 'whisperflow', name: 'THE WHISPER', depth: 12, w0: 18, w1: 50,
    pts: [[-800, -120], [-880, 200], [-960, 620], [-1000, 1040],
      [-1000, 1480]],
  },
  {
    id: 'giltrun', name: 'THE GILT', depth: 10, w0: 14, w1: 40,
    pts: [[820, -80], [1100, 20], [1400, 110], [1720, 210]],
  },
];

/**
 * Road corridor widths: full effect inside w0, none past w1.
 *
 * The shoulder is wide because it is where the cutting and the embankment
 * live. At 34 the bank beside a road cut into a mountainside came out at
 * nine and a half units of rise per metre — a wall you cannot get back over
 * if you step off the road. Spreading the same bank over a third again as
 * much ground makes it a slope you can scramble.
 */
const ROAD_W0 = 11;
const ROAD_W1 = 46;

/** Two road nodes closer than this are the same junction. */
const JUNCTION = 6;

/** Broadphase cell. Every segment is filed into the cells it can reach. */
const CELL = 128;

export class Network {
  /**
   * @param baseHeight  (x, z) => height, WITHOUT roads or rivers in it
   */
  constructor(baseHeight) {
    this.baseHeight = baseHeight;
    this.segments = [];
    this.grid = new Map();
    this.roadNodes = new Map();     // id -> [{x, z, y}] after grading
    this.riverNodes = new Map();
    this._built = false;
  }

  // ------------------------------------------------------------------ build

  /** Labelled build steps, so the loader can show progress. */
  buildTasks() {
    return [
      ['Cutting the rivers', () => {
        const lines = RIVERS.map((l) => this._prepare(l, 'river'));
        for (const L of lines) { this._smooth(L); this._grade(L); this._downhill(L); }
        this._emit(lines);
      }],
      ['Laying the roads', () => {
        const lines = ROADS.map((l) => this._prepare(l, 'road'));
        for (const L of lines) this._smooth(L);
        /**
         * Grade, then make the JUNCTIONS agree, then grade again.
         *
         * Sixteen roads meet at nine shared nodes. Graded independently, each
         * road settles its end of a junction against its own neighbours, so
         * the same point ends up eighty-two units up one road and a hundred
         * and forty up another. Averaging alone is not enough: the average
         * has to be fed back in and the roads re-graded against it, or the
         * segment leading into the junction becomes the cliff instead.
         *
         * Measured before this loop: a 288% grade on the Cold Road and 168%
         * on the Bone Path, both exactly at a junction. Three rounds brings
         * every road in the world under the grading limit.
         */
        for (let round = 0; round < 4; round++) {
          for (const L of lines) this._grade(L);
          this._reconcile(lines);
        }
        for (const L of lines) this._grade(L);
        this._emit(lines);
        this._index();
        this._built = true;
      }],
    ];
  }

  /** Node positions and starting heights for one polyline. */
  _prepare(line, kind) {
    const pts = line.pts;
    const n = pts.length;
    const y = new Float64Array(n);
    const pinned = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      if (pts[i].length > 2) { y[i] = pts[i][2]; pinned[i] = 1; }
      else y[i] = this.baseHeight(pts[i][0], pts[i][1]);
    }
    const len = new Float64Array(Math.max(1, n - 1));
    for (let i = 0; i < n - 1; i++) {
      len[i] = Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]);
    }
    return { line, kind, pts, n, y, pinned, len };
  }

  /**
   * A little smoothing, so a single noisy sample does not put a bump in the
   * middle of an otherwise level road.
   */
  _smooth(L) {
    for (let pass = 0; pass < 3; pass++) {
      for (let i = 1; i < L.n - 1; i++) {
        if (L.pinned[i]) continue;
        L.y[i] = (L.y[i - 1] + L.y[i] * 2 + L.y[i + 1]) * 0.25;
      }
    }
  }

  /**
   * Relax the node heights until no segment is steeper than the limit.
   *
   * The relaxation moves both ends of an offending segment toward each other,
   * which is what turns a cliff into a cutting on one side and an embankment
   * on the other. Pinned nodes do not move, so the whole correction goes to
   * the other end.
   */
  _grade(L) {
    const maxG = L.kind === 'river' ? MAX_GRADE * 1.6 : MAX_GRADE;
    for (let pass = 0; pass < 200; pass++) {
      let worst = 0;
      for (let i = 0; i < L.n - 1; i++) {
        const lim = maxG * L.len[i];
        const d = L.y[i + 1] - L.y[i];
        const over = Math.abs(d) - lim;
        if (over <= 0.005) continue;
        worst = Math.max(worst, over);
        const s = Math.sign(d);
        const aFree = !L.pinned[i], bFree = !L.pinned[i + 1];
        if (aFree && bFree) { L.y[i] += over * 0.5 * s; L.y[i + 1] -= over * 0.5 * s; }
        else if (aFree) L.y[i] += over * s;
        else if (bFree) L.y[i + 1] -= over * s;
      }
      if (worst < 0.005) break;
    }
  }

  /**
   * Every node that several roads share gets one height: the mean of what
   * they each graded it to, pinned so the next grading round works around it
   * rather than pulling it apart again.
   */
  _reconcile(lines) {
    const groups = new Map();
    for (const L of lines) {
      for (let i = 0; i < L.n; i++) {
        const kx = Math.round(L.pts[i][0] / JUNCTION);
        const kz = Math.round(L.pts[i][1] / JUNCTION);
        const k = kx * 100003 + kz;
        let g = groups.get(k);
        if (!g) { g = []; groups.set(k, g); }
        g.push({ L, i });
      }
    }
    for (const [, g] of groups) {
      if (g.length < 2) continue;
      let sum = 0, fixed = null;
      for (const { L, i } of g) {
        sum += L.y[i];
        if (L.pinned[i]) fixed = L.y[i];
      }
      // An explicitly pinned node wins outright — it was pinned because the
      // terrain there is a hole the road has to cross.
      const h = fixed === null ? sum / g.length : fixed;
      for (const { L, i } of g) { L.y[i] = h; L.pinned[i] = 1; }
    }
  }

  /**
   * A river only ever runs DOWNHILL.
   *
   * Grading alone can leave a graded river climbing a little, which reads as
   * water running up a hill. One sweep from the source clamps each node to at
   * most its predecessor's height, and the channel is cut from that.
   */
  _downhill(L) {
    for (let i = 1; i < L.n; i++) if (L.y[i] > L.y[i - 1]) L.y[i] = L.y[i - 1];
  }

  /** Turn graded polylines into segments and remember their nodes. */
  _emit(lines) {
    for (const L of lines) {
      const nodes = [];
      for (let i = 0; i < L.n; i++) {
        nodes.push({ x: L.pts[i][0], z: L.pts[i][1], y: L.y[i] });
      }
      (L.kind === 'river' ? this.riverNodes : this.roadNodes).set(L.line.id, nodes);

      const w0 = L.kind === 'river' ? (L.line.w0 || 18) : ROAD_W0;
      const w1 = L.kind === 'river' ? (L.line.w1 || 50) : ROAD_W1;
      for (let i = 0; i < L.n - 1; i++) {
        if (L.len[i] < 1e-3) continue;
        this.segments.push({
          kind: L.kind,
          id: L.line.id,
          ax: L.pts[i][0], az: L.pts[i][1], ay: L.y[i],
          bx: L.pts[i + 1][0], bz: L.pts[i + 1][1], by: L.y[i + 1],
          len: L.len[i],
          w0, w1,
          depth: L.kind === 'river' ? (L.line.depth || 12) : 0,
        });
      }
    }
  }

  /** File every segment into the grid cells it can reach. */
  _index() {
    this.grid.clear();
    for (let s = 0; s < this.segments.length; s++) {
      const g = this.segments[s];
      const pad = g.w1 + 2;
      const x0 = Math.floor((Math.min(g.ax, g.bx) - pad + REALM_HALF) / CELL);
      const x1 = Math.floor((Math.max(g.ax, g.bx) + pad + REALM_HALF) / CELL);
      const z0 = Math.floor((Math.min(g.az, g.bz) - pad + REALM_HALF) / CELL);
      const z1 = Math.floor((Math.max(g.az, g.bz) + pad + REALM_HALF) / CELL);
      for (let ix = x0; ix <= x1; ix++) {
        for (let iz = z0; iz <= z1; iz++) {
          const k = ix * 4096 + iz;
          let arr = this.grid.get(k);
          if (!arr) { arr = []; this.grid.set(k, arr); }
          arr.push(g);
        }
      }
    }
  }

  /** The segments that could possibly matter at a point. */
  _near(x, z) {
    const ix = Math.floor((x + REALM_HALF) / CELL);
    const iz = Math.floor((z + REALM_HALF) / CELL);
    return this.grid.get(ix * 4096 + iz);
  }

  // ------------------------------------------------------------- the ground

  /**
   * Apply the network to a base height.
   *
   * Rivers first, then roads: a road crossing a river fills the channel into
   * a ford, which is exactly what a crossing looks like and where the bridges
   * in the region table are placed.
   */
  carve(x, z, h) {
    if (!this._built) return h;
    const list = this._near(x, z);
    if (!list) return h;

    /**
     * Overlapping lines are AVERAGED, not applied one after another.
     *
     * Sixteen roads meeting at four junctions means several segments claim
     * the same ground, and each has its own graded bed — the same junction is
     * 82 units up one road and 96 up another, because the two were graded
     * against different neighbours. Applying them in sequence means the last
     * one wins, and the boundary where it stops winning is a step: measured,
     * the Bone Path had a three-hundred-per-cent grade on it, which is a
     * cliff across the road.
     *
     * A weight-averaged bed is continuous instead. As one road's influence
     * falls to nothing its contribution to the average falls with it, so a
     * junction is a smooth saddle between the two roads rather than a wall
     * between them.
     */
    let rw = 0, rb = 0;
    for (let i = 0; i < list.length; i++) {
      const g = list[i];
      if (g.kind !== 'river') continue;
      const k = this._weight(g, x, z);
      if (k <= 0) continue;
      rw += k;
      rb += k * (this._bed(g, x, z) - g.depth);
    }
    // Rivers only ever cut DOWN: a channel must not build a dam across the
    // lake it runs into.
    if (rw > 0) {
      const bed = rb / rw;
      if (bed < h) h = lerp(h, bed, Math.min(1, rw));
    }

    let ow = 0, ob = 0;
    for (let i = 0; i < list.length; i++) {
      const g = list[i];
      if (g.kind !== 'road') continue;
      const k = this._weight(g, x, z);
      if (k <= 0) continue;
      ow += k;
      ob += k * this._bed(g, x, z);
    }
    // Roads grade both ways: a cutting through a hill, an embankment over a
    // dip, and a causeway over a chasm.
    if (ow > 0) h = lerp(h, ob / ow, Math.min(1, ow));
    return h;
  }

  /** Where along the segment we are, and the bed height there. */
  _bed(g, x, z) {
    const dx = g.bx - g.ax, dz = g.bz - g.az;
    const t = clamp(((x - g.ax) * dx + (z - g.az) * dz) / (g.len * g.len), 0, 1);
    return lerp(g.ay, g.by, t);
  }

  /** 1 inside the corridor, 0 outside it, smooth between. */
  _weight(g, x, z) {
    const dx = g.bx - g.ax, dz = g.bz - g.az;
    const t = clamp(((x - g.ax) * dx + (z - g.az) * dz) / (g.len * g.len), 0, 1);
    const px = g.ax + dx * t, pz = g.az + dz * t;
    const d = Math.hypot(x - px, z - pz);
    if (d >= g.w1) return 0;
    if (d <= g.w0) return 1;
    return 1 - smoothstep((d - g.w0) / (g.w1 - g.w0));
  }

  /** How much of a point is road surface, for colouring. 0..1. */
  roadAt(x, z) {
    if (!this._built) return 0;
    const list = this._near(x, z);
    if (!list) return 0;
    let best = 0;
    for (let i = 0; i < list.length; i++) {
      if (list[i].kind !== 'road') continue;
      const d = this._surface(list[i], x, z);
      if (d > best) best = d;
    }
    return best;
  }

  /** How much of a point is river channel, for colouring. 0..1. */
  riverAt(x, z) {
    if (!this._built) return 0;
    const list = this._near(x, z);
    if (!list) return 0;
    let best = 0;
    for (let i = 0; i < list.length; i++) {
      if (list[i].kind !== 'river') continue;
      const d = this._surface(list[i], x, z);
      if (d > best) best = d;
    }
    return best;
  }

  /**
   * The visible surface is narrower than the corridor.
   *
   * The corridor is how far the grading reaches — the cuttings and the
   * shoulders. The SURFACE is the part that is actually paved or actually
   * wet, and painting the whole corridor would give every road a thirty-unit
   * verge of the same colour as the road.
   */
  _surface(g, x, z) {
    const dx = g.bx - g.ax, dz = g.bz - g.az;
    const t = clamp(((x - g.ax) * dx + (z - g.az) * dz) / (g.len * g.len), 0, 1);
    const px = g.ax + dx * t, pz = g.az + dz * t;
    const d = Math.hypot(x - px, z - pz);
    const edge = g.w0 * (g.kind === 'river' ? 1.15 : 1.0);
    if (d >= edge) return 0;
    return 1 - smoothstep(clamp(d / edge, 0, 1)) * 0.85;
  }

  /**
   * Somewhere on a named road, as a fraction along it.
   *
   * Used to put signposts, travellers and ambushes on the road rather than
   * beside it, and by the map screen to draw the network.
   */
  along(id, t) {
    const nodes = this.roadNodes.get(id) || this.riverNodes.get(id);
    if (!nodes || nodes.length < 2) return null;
    const f = clamp(t, 0, 1) * (nodes.length - 1);
    const i = Math.min(nodes.length - 2, Math.floor(f));
    const k = f - i;
    return {
      x: lerp(nodes[i].x, nodes[i + 1].x, k),
      z: lerp(nodes[i].z, nodes[i + 1].z, k),
      y: lerp(nodes[i].y, nodes[i + 1].y, k),
    };
  }

  /** The steepest graded segment anywhere, as a rise over run. Diagnostic. */
  worstGrade() {
    let worst = 0, which = null;
    for (const g of this.segments) {
      const grade = Math.abs(g.by - g.ay) / g.len;
      if (grade > worst) { worst = grade; which = g.id; }
    }
    return { grade: worst, id: which };
  }
}
