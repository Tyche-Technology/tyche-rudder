// Pure pathname -> nav-key mapping, kept out of the 'use client' layout file
// so it's a real testable branch, not a component render — see design doc
// §7 on aria-current: a wrong guess is a false accessibility statement,
// worse than none.
import type { ShellPage } from './shell'

const NAV_SEGMENTS: Record<string, Exclude<ShellPage, null>> = {
  inbox: 'inbox',
  board: 'board',
  roadmap: 'roadmap',
  requests: 'requests',
  products: 'products',
  crew: 'crew',
}

// A segment outside the five nav pages (e.g. Task 7's /issues/[id]) maps to
// null, not a guessed nav key.
export function pageFromPathname(pathname: string): ShellPage {
  const segment = pathname.split('/')[1] ?? ''
  return NAV_SEGMENTS[segment] ?? null
}
