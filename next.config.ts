import type { NextConfig } from 'next'

export const securityHeaders = [
  { key: 'Content-Security-Policy', value: "base-uri 'self'; frame-ancestors 'none'; object-src 'none'; form-action 'self'" },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=()' },
  { key: 'Referrer-Policy', value: 'no-referrer' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
]

const nextConfig: NextConfig = {
  // standalone: production Docker image copies .next/standalone instead of
  // the full node_modules tree — Next traces the runtime dependency subset.
  //
  // NOTE for local dev in this repo's parallel-worktree setup: Next may warn
  // about "multiple lockfiles" and infer the workspace root one level up
  // (this worktree's node_modules is a symlink into the parent checkout,
  // which has its own package-lock.json), nesting server.js under
  // .next/standalone/<relative-path>/ instead of the root. Pinning
  // `outputFileTracingRoot` to silence it was tried and reverted — Turbopack
  // then refuses to follow that same symlink because it points outside the
  // pinned root ("Symlink node_modules is invalid, it points out of the
  // filesystem root"). This only happens in this sandboxed dev arrangement:
  // the actual Docker build below does a real `npm ci` inside the image with
  // no sibling lockfile, so Next finds /app as root on its own and emits the
  // flat .next/standalone/server.js the Dockerfile expects — verified in the
  // task-13 build transcript.
  output: 'standalone',
  poweredByHeader: false,
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }]
  },
}

export default nextConfig
