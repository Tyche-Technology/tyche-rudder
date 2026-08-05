// Pixel art, copied rect-for-rect from design/index.html and design/shell.js
// (design doc §5): viewBox is the grid, width/height is an integer multiple
// of it, class="px" keeps edges crisp. Decorative only — every status this
// app cares about is already spoken in text elsewhere, so all sprites are
// aria-hidden. Group class names (lh__light, by__top, ...) are left in place
// even though nothing in this file uses them: the roadmap timeline (Task 9)
// targets them from rudder.css (.tl__port--dest .lh__light, etc.) via a
// wrapper class it applies around these components.

export function BrandMark() {
  return (
    <svg className="brand__mark px" width="22" height="24" viewBox="0 0 11 12" aria-hidden="true">
      <g fill="currentColor">
        <rect x="2" y="0" width="2" height="12" />
        <rect x="4" y="3" width="1" height="6" />
        <rect x="5" y="4" width="1" height="5" />
        <rect x="6" y="5" width="1" height="4" />
        <rect x="7" y="6" width="1" height="3" />
        <rect x="8" y="7" width="1" height="2" />
      </g>
    </svg>
  )
}

// 17x14 grid, 4x — the ship: hull + wake, half-opacity aft sail
export function Ship() {
  return (
    <svg className="px" width="68" height="56" viewBox="0 0 17 14" aria-hidden="true">
      <g fill="var(--accent)">
        <rect x="9" y="1" width="1" height="1" /><rect x="9" y="2" width="2" height="1" />
        <rect x="9" y="3" width="3" height="1" /><rect x="9" y="4" width="4" height="1" />
        <rect x="9" y="5" width="4" height="1" /><rect x="9" y="6" width="5" height="1" />
        <rect x="9" y="7" width="6" height="1" /><rect x="9" y="8" width="6" height="1" />
      </g>
      <g fill="var(--accent)" opacity=".5">
        <rect x="7" y="4" width="1" height="1" /><rect x="6" y="5" width="2" height="1" />
        <rect x="5" y="6" width="3" height="1" /><rect x="4" y="7" width="4" height="1" />
        <rect x="4" y="8" width="4" height="1" />
      </g>
      <g fill="currentColor">
        <rect x="8" y="0" width="1" height="10" />
        <rect x="2" y="10" width="14" height="1" />
        <rect x="3" y="11" width="12" height="1" />
        <rect x="4" y="12" width="10" height="1" />
      </g>
    </svg>
  )
}

// 15x16 grid, 4x — THE lighthouse: end of the visible route (design §4, §5).
// At most one on screen; .lh__light/.lh__beam blink via .tl__port--dest.
export function Lighthouse() {
  return (
    <svg className="px" width="60" height="64" viewBox="0 0 15 16" aria-hidden="true">
      <g className="lh__light" fill="currentColor">
        <rect x="6" y="1" width="3" height="1" />
        <rect x="6" y="2" width="3" height="3" />
      </g>
      <g className="lh__beam" fill="currentColor">
        <rect x="0" y="3" width="2" height="1" /><rect x="13" y="3" width="2" height="1" />
      </g>
      <g className="lh__tower" fill="currentColor" opacity=".55">
        <rect x="5" y="5" width="5" height="1" />
        <rect x="6" y="6" width="3" height="3" />
        <rect x="5" y="9" width="5" height="3" />
        <rect x="4" y="12" width="7" height="1" />
      </g>
      <g fill="var(--land)">
        <rect x="3" y="13" width="9" height="1" />
        <rect x="1" y="14" width="13" height="1" />
        <rect x="0" y="15" width="15" height="1" />
      </g>
    </svg>
  )
}

// 11x9 grid, 3x — channel buoy, afloat. .by__top lights up (blinks) for the
// nearest future deadline via .tl__port--next.
export function Buoy() {
  return (
    <svg className="px" width="33" height="27" viewBox="0 0 11 9" aria-hidden="true">
      <g className="by__top" fill="currentColor">
        <rect x="4" y="0" width="3" height="2" />
      </g>
      <g fill="currentColor">
        <rect x="5" y="2" width="1" height="3" />
        <rect x="3" y="5" width="5" height="1" />
        <rect x="2" y="6" width="7" height="2" />
        <rect x="3" y="8" width="5" height="1" />
      </g>
    </svg>
  )
}

// 11x11 grid, 3x — danger buoy (two topmarks): a hazard the ship sailed past
export function DangerBuoy() {
  return (
    <svg className="px" width="33" height="33" viewBox="0 0 11 11" aria-hidden="true">
      <g fill="currentColor">
        <rect x="4" y="0" width="3" height="2" />
        <rect x="5" y="2" width="1" height="1" />
        <rect x="4" y="3" width="3" height="2" />
        <rect x="5" y="5" width="1" height="2" />
        <rect x="3" y="7" width="5" height="1" />
        <rect x="2" y="8" width="7" height="2" />
        <rect x="3" y="10" width="5" height="1" />
      </g>
    </svg>
  )
}

// 13x10 grid, 3x — visited-port flag: a milestone already reached
export function FlagPort() {
  return (
    <svg className="px" width="39" height="30" viewBox="0 0 13 10" aria-hidden="true">
      <g fill="currentColor">
        <rect x="6" y="0" width="1" height="7" />
        <rect x="7" y="0" width="4" height="1" /><rect x="7" y="1" width="4" height="1" />
        <rect x="7" y="2" width="3" height="1" />
      </g>
      <g fill="var(--land)">
        <rect x="4" y="7" width="5" height="1" />
        <rect x="2" y="8" width="9" height="1" />
        <rect x="0" y="9" width="13" height="1" />
      </g>
    </svg>
  )
}

// 9x9 grid, 4x — day sun. Swapped by theme, not recoloured (design §5.3): a
// recoloured disc still read as a pale sun in dark theme.
export function Sun() {
  return (
    <svg className="horizon__sun horizon__sun--day px" width="36" height="36" viewBox="0 0 9 9" aria-hidden="true">
      <g fill="currentColor">
        <rect x="3" y="0" width="3" height="1" /><rect x="2" y="1" width="5" height="1" />
        <rect x="1" y="2" width="7" height="2" /><rect x="0" y="4" width="9" height="1" />
        <rect x="1" y="5" width="7" height="2" /><rect x="2" y="7" width="5" height="1" />
        <rect x="3" y="8" width="3" height="1" />
      </g>
    </svg>
  )
}

// 9x9 grid, 4x — night crescent (see Sun)
export function Moon() {
  return (
    <svg className="horizon__sun horizon__sun--night px" width="36" height="36" viewBox="0 0 9 9" aria-hidden="true">
      <g fill="currentColor">
        <rect x="3" y="0" width="3" height="1" /><rect x="4" y="1" width="3" height="1" />
        <rect x="5" y="2" width="3" height="1" /><rect x="5" y="3" width="3" height="1" />
        <rect x="6" y="4" width="3" height="1" /><rect x="5" y="5" width="3" height="1" />
        <rect x="5" y="6" width="3" height="1" /><rect x="4" y="7" width="3" height="1" />
        <rect x="3" y="8" width="3" height="1" />
      </g>
    </svg>
  )
}
