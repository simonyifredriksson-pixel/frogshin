/**
 * Pixel-art icons.
 *
 * The UI used emoji, which render in each platform's own house style and
 * broke the game's look. These are hand-plotted SVG rectangles on a small
 * integer grid with shape-rendering:crispEdges, so they stay hard-edged
 * pixels at any size and match the rest of the art.
 *
 * Every icon is a single source of truth injected by the HUD, rather than
 * being pasted into the markup in several places.
 */

/** Health: a classic pixel heart with a highlight. */
const HEART = `
<svg viewBox="0 0 13 11" shape-rendering="crispEdges" aria-hidden="true">
  <g fill="#7a1220">
    <rect x="2" y="0" width="4" height="1"/><rect x="7" y="0" width="4" height="1"/>
    <rect x="1" y="1" width="1" height="4"/><rect x="11" y="1" width="1" height="4"/>
    <rect x="0" y="2" width="1" height="3"/><rect x="12" y="2" width="1" height="3"/>
    <rect x="1" y="5" width="1" height="1"/><rect x="11" y="5" width="1" height="1"/>
    <rect x="2" y="6" width="1" height="1"/><rect x="10" y="6" width="1" height="1"/>
    <rect x="3" y="7" width="1" height="1"/><rect x="9" y="7" width="1" height="1"/>
    <rect x="4" y="8" width="1" height="1"/><rect x="8" y="8" width="1" height="1"/>
    <rect x="5" y="9" width="1" height="1"/><rect x="7" y="9" width="1" height="1"/>
    <rect x="6" y="10" width="1" height="1"/>
  </g>
  <g fill="#e33d4e">
    <rect x="2" y="1" width="4" height="1"/><rect x="7" y="1" width="4" height="1"/>
    <rect x="1" y="2" width="11" height="3"/>
    <rect x="2" y="5" width="9" height="1"/>
    <rect x="3" y="6" width="7" height="1"/>
    <rect x="4" y="7" width="5" height="1"/>
    <rect x="5" y="8" width="3" height="1"/>
    <rect x="6" y="9" width="1" height="1"/>
  </g>
  <g fill="#ff9aa4">
    <rect x="2" y="2" width="2" height="1"/><rect x="2" y="3" width="1" height="1"/>
  </g>
</svg>`;

/** Stamina: a lightning bolt. */
const BOLT = `
<svg viewBox="0 0 9 13" shape-rendering="crispEdges" aria-hidden="true">
  <g fill="#7a5a08">
    <rect x="3" y="0" width="5" height="1"/>
    <rect x="2" y="1" width="1" height="1"/><rect x="7" y="1" width="1" height="1"/>
    <rect x="1" y="2" width="1" height="1"/>
    <rect x="0" y="3" width="1" height="3"/>
    <rect x="8" y="5" width="1" height="1"/>
    <rect x="1" y="12" width="3" height="1"/>
  </g>
  <g fill="#ffd54a">
    <rect x="3" y="1" width="4" height="1"/>
    <rect x="2" y="2" width="4" height="1"/>
    <rect x="1" y="3" width="4" height="1"/>
    <rect x="1" y="4" width="7" height="1"/>
    <rect x="1" y="5" width="7" height="1"/>
    <rect x="3" y="6" width="5" height="1"/>
    <rect x="2" y="7" width="5" height="1"/>
    <rect x="2" y="8" width="4" height="1"/>
    <rect x="1" y="9" width="4" height="1"/>
    <rect x="1" y="10" width="3" height="1"/>
    <rect x="1" y="11" width="3" height="1"/>
  </g>
  <g fill="#fff2b0">
    <rect x="3" y="2" width="1" height="2"/>
  </g>
</svg>`;

/** Froglets: a coin stamped with a frog. */
const COIN = `
<svg viewBox="0 0 12 12" shape-rendering="crispEdges" aria-hidden="true">
  <g fill="#7a5a08">
    <rect x="4" y="0" width="4" height="1"/><rect x="4" y="11" width="4" height="1"/>
    <rect x="2" y="1" width="2" height="1"/><rect x="8" y="1" width="2" height="1"/>
    <rect x="2" y="10" width="2" height="1"/><rect x="8" y="10" width="2" height="1"/>
    <rect x="1" y="2" width="1" height="2"/><rect x="10" y="2" width="1" height="2"/>
    <rect x="0" y="4" width="1" height="4"/><rect x="11" y="4" width="1" height="4"/>
    <rect x="1" y="8" width="1" height="2"/><rect x="10" y="8" width="1" height="2"/>
  </g>
  <g fill="#f0c243">
    <rect x="4" y="1" width="4" height="1"/>
    <rect x="2" y="2" width="8" height="2"/>
    <rect x="1" y="4" width="10" height="4"/>
    <rect x="2" y="8" width="8" height="2"/>
    <rect x="4" y="10" width="4" height="1"/>
  </g>
  <g fill="#fff0a8">
    <rect x="3" y="2" width="2" height="1"/><rect x="2" y="3" width="1" height="2"/>
  </g>
  <g fill="#3f7a2a">
    <rect x="4" y="4" width="1" height="1"/><rect x="7" y="4" width="1" height="1"/>
    <rect x="3" y="5" width="6" height="2"/>
    <rect x="4" y="7" width="4" height="1"/>
  </g>
  <g fill="#0d1a08">
    <rect x="4" y="5" width="1" height="1"/><rect x="7" y="5" width="1" height="1"/>
  </g>
</svg>`;

/** A ninja frog head — used on the loading screen and the click prompt. */
const FROG = `
<svg viewBox="0 0 16 14" shape-rendering="crispEdges" aria-hidden="true">
  <g fill="#1c3d14">
    <rect x="2" y="1" width="3" height="1"/><rect x="11" y="1" width="3" height="1"/>
    <rect x="1" y="2" width="1" height="2"/><rect x="14" y="2" width="1" height="2"/>
    <rect x="0" y="4" width="1" height="6"/><rect x="15" y="4" width="1" height="6"/>
    <rect x="1" y="10" width="1" height="2"/><rect x="14" y="10" width="1" height="2"/>
    <rect x="2" y="12" width="12" height="1"/>
  </g>
  <g fill="#5aa832">
    <rect x="2" y="2" width="3" height="2"/><rect x="11" y="2" width="3" height="2"/>
    <rect x="1" y="4" width="14" height="6"/>
    <rect x="2" y="10" width="12" height="2"/>
  </g>
  <g fill="#fefbe8">
    <rect x="3" y="3" width="2" height="2"/><rect x="11" y="3" width="2" height="2"/>
  </g>
  <g fill="#12121a">
    <rect x="4" y="4" width="1" height="1"/><rect x="11" y="4" width="1" height="1"/>
  </g>
  <g fill="#24242e">
    <rect x="1" y="6" width="14" height="2"/>
  </g>
  <g fill="#c0392b">
    <rect x="1" y="5" width="14" height="1"/>
  </g>
  <g fill="#1c3d14">
    <rect x="4" y="10" width="8" height="1"/>
  </g>
</svg>`;

/** Kill feed: crossed blade for a kill. */
const BLADE = `
<svg viewBox="0 0 11 11" shape-rendering="crispEdges" aria-hidden="true">
  <g fill="#dfe7f0">
    <rect x="8" y="1" width="2" height="1"/><rect x="7" y="2" width="2" height="1"/>
    <rect x="6" y="3" width="2" height="1"/><rect x="5" y="4" width="2" height="1"/>
    <rect x="4" y="5" width="2" height="1"/><rect x="3" y="6" width="2" height="1"/>
  </g>
  <g fill="#c9a227">
    <rect x="2" y="7" width="3" height="1"/><rect x="1" y="8" width="3" height="1"/>
  </g>
  <g fill="#22242b">
    <rect x="0" y="9" width="3" height="2"/>
  </g>
</svg>`;

/** Kill feed: skull, for a death with no killer. */
const SKULL = `
<svg viewBox="0 0 11 11" shape-rendering="crispEdges" aria-hidden="true">
  <g fill="#e8e2d4">
    <rect x="2" y="1" width="7" height="1"/>
    <rect x="1" y="2" width="9" height="5"/>
    <rect x="2" y="7" width="7" height="1"/>
    <rect x="3" y="8" width="5" height="2"/>
  </g>
  <g fill="#1a1a20">
    <rect x="2" y="3" width="2" height="2"/><rect x="7" y="3" width="2" height="2"/>
    <rect x="5" y="5" width="1" height="1"/>
    <rect x="4" y="8" width="1" height="2"/><rect x="6" y="8" width="1" height="2"/>
  </g>
</svg>`;

/** Alert eye for the guard suspicion meter. */
const EYE = `
<svg viewBox="0 0 14 9" shape-rendering="crispEdges" aria-hidden="true">
  <g fill="#ffd76b">
    <rect x="4" y="0" width="6" height="1"/>
    <rect x="2" y="1" width="2" height="1"/><rect x="10" y="1" width="2" height="1"/>
    <rect x="1" y="2" width="1" height="1"/><rect x="12" y="2" width="1" height="1"/>
    <rect x="0" y="3" width="1" height="3"/><rect x="13" y="3" width="1" height="3"/>
    <rect x="1" y="6" width="1" height="1"/><rect x="12" y="6" width="1" height="1"/>
    <rect x="2" y="7" width="2" height="1"/><rect x="10" y="7" width="2" height="1"/>
    <rect x="4" y="8" width="6" height="1"/>
  </g>
  <g fill="#1a1a20">
    <rect x="5" y="2" width="4" height="5"/>
  </g>
  <g fill="#ffffff">
    <rect x="5" y="2" width="1" height="1"/>
  </g>
</svg>`;

export const PX = { HEART, BOLT, COIN, FROG, BLADE, SKULL, EYE };

/**
 * Fill an element with a pixel icon.
 * Safe to call on ids that do not exist in a given screen.
 */
export function setIcon(id, svg) {
  const el = document.getElementById(id);
  if (el) el.innerHTML = svg;
}
