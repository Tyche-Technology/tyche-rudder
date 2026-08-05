import { readFileSync } from 'node:fs'
const css = readFileSync(new URL('./rudder.css', import.meta.url), 'utf8')
// pull the two theme blocks straight from the stylesheet so the table cannot go stale
const block = (re) => { const m = css.match(re); const o = new Map(); for (const [, k, v] of m[1].matchAll(/--([\w-]+):\s*(#[0-9a-f]{6})/gi)) o.set(k, v.toLowerCase()); return o }
const L = block(/:root \{([\s\S]*?)\n\}/)
const D = block(/:root\[data-theme='dark'\] \{([\s\S]*?)\n\}/)

const lin = c => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4 }
const lum = h => { const n = parseInt(h.slice(1), 16); return 0.2126 * lin(n >> 16 & 255) + 0.7152 * lin(n >> 8 & 255) + 0.0722 * lin(n & 255) }
const R = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05) }

// Exit non-zero if any pair drops below WCAG AA (4.5:1) so this can gate CI.
const rows = [
  ['ink / surface', 'ink', 'surface'], ['ink-2 / surface', 'ink-2', 'surface'],
  ['muted / surface', 'muted', 'surface'], ['muted / canvas', 'muted', 'canvas'],
  ['faint / surface', 'faint', 'surface'], ['faint / canvas', 'faint', 'canvas'],
  ['faint / sunken', 'faint', 'sunken'], ['faint / sky-1', 'faint', 'sky-1'],
  ['ink / sky-1', 'ink', 'sky-1'],
  ['muted / sea-1', 'muted', 'sea-1'],
  ['st-rejected-fg / sky-1', 'st-rejected-fg', 'sky-1'],
  ['accent-ink / surface', 'accent-ink', 'surface'],
  ['on-accent / accent', 'on-accent', 'accent'],
  ['focus / surface', 'focus', 'surface'],
  ['surface / ink  (primary btn)', 'surface', 'ink'],
  ['st-inbox-fg / surface', 'st-inbox-fg', 'surface'],
  ['st-backlog-fg / bg', 'st-backlog-fg', 'st-backlog-bg'],
  ['st-progress-fg / bg', 'st-progress-fg', 'st-progress-bg'],
  ['st-done-fg / bg', 'st-done-fg', 'st-done-bg'],
  ['st-rejected-fg / bg', 'st-rejected-fg', 'st-rejected-bg'],
  ['st-hold-fg / bg', 'st-hold-fg', 'st-hold-bg'],
]
let worst = [Infinity, '']
console.log('| pair | light | dark |')
console.log('|---|---|---|')
for (const [label, fg, bg] of rows) {
  const l = R(L.get(fg), L.get(bg)), d = R(D.get(fg), D.get(bg))
  for (const [v, t] of [[l, 'light'], [d, 'dark']]) if (v < worst[0]) worst = [v, `${label} (${t})`]
  const f = v => `${v.toFixed(2)}:1 ${v >= 4.5 ? 'AA' : v >= 3 ? 'AA-large only' : 'FAIL'}`
  console.log(`| \`${label}\` | ${f(l)} | ${f(d)} |`)
}
console.log(`\nworst = ${worst[0].toFixed(2)}:1 (${worst[1]})`)
console.log(`tokens parsed: light=${L.size} dark=${D.size}`)

if (worst[0] < 4.5) { console.error(`\nFAIL: ${worst[1]} is below AA`); process.exit(1) }
