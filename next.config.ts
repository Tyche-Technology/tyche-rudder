import type { NextConfig } from 'next'

export const securityHeaders = [
  { key: 'Content-Security-Policy', value: "base-uri 'self'; frame-ancestors 'none'; object-src 'none'; form-action 'self'" },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=()' },
  { key: 'Referrer-Policy', value: 'no-referrer' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
]

const attachmentTraceExcludes = [
  './.github/**/*',
  './design/**/*',
  './deploy/**/*',
  './docs/**/*',
  './drizzle/**/*',
  './scripts/**/*',
  './src/**/*',
  './tests/**/*',
  './*.md',
  './Dockerfile',
  './docker-compose.yml',
  './drizzle.config.ts',
  './next.config.ts',
  './package-lock.json',
  './playwright.config.ts',
  './tsconfig.json',
  './vitest.config.ts',
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
  // The development-only filesystem object store makes Next's tracer treat
  // both attachment routes as if they might read the whole project tree.
  // Runtime code is already bundled; migrations and incident scripts are
  // copied explicitly by Dockerfile, so these source/test files are not
  // runtime dependencies.
  outputFileTracingExcludes: {
    '/api/v1/attachments/*': attachmentTraceExcludes,
    '/api/v1/issues/*/attachments': attachmentTraceExcludes,
  },
  poweredByHeader: false,
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }]
  },
}

export default nextConfig
