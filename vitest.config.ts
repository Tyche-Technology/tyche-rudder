import { defineConfig, configDefaults } from 'vitest/config'
import path from 'node:path'

export default defineConfig({
  test: {
    environment: 'node',
    // Parallel lanes live in in-repo git worktrees (README). Without this, an
    // unqualified `npm test` from the root also discovers each worktree's own
    // test tree — their `session-live` copies then fight over port 3101 and the
    // :5434 container, and their stale fixtures run against THIS tree's modules.
    // Both surface as unexplained failures rather than a clear error.
    exclude: [...configDefaults.exclude, '.worktrees/**', '.next/**'],
    // Default 10s hookTimeout is too tight for beforeAll hooks that boot a
    // PGlite (Postgres-as-WASM) instance and run the full Drizzle migration;
    // that boot can exceed 10s under CPU contention, killing the hook and
    // skipping every test in the file. 30s gives ~3x margin over the
    // observed failure point.
    hookTimeout: 30000,
    coverage: {
      provider: 'v8',
      // v8 reports every file a test loads, so component .tsx files landed
      // in the artifact regardless of what `include` declared. Declaring
      // src/ui/*.tsx here makes the measured set match the declared set.
      include: ['src/domain/**', 'src/lib/**', 'src/ui/*.ts', 'src/ui/*.tsx'],
      // Per-slice, not global (vitest docs: config/coverage.md, "Set Coverage
      // Thresholds for Glob Patterns" / "coverage.thresholds[glob-pattern]",
      // verified against the installed v4.1.10, not written from memory). A
      // single combined 80% average let a healthy domain slice mask an
      // unhealthy ui slice for the whole project's life — each slice's own
      // aggregate must now clear 80% independently. No `perFile`: a weak
      // file can still be offset by strong siblings within the SAME slice,
      // same as the old global number did across all three.
      thresholds: {
        'src/domain/**': { statements: 80, branches: 80, functions: 80, lines: 80 },
        'src/lib/**': { statements: 80, branches: 80, functions: 80, lines: 80 },
        'src/ui/**': { statements: 80, branches: 80, functions: 80, lines: 80 },
      },
    },
  },
  resolve: { alias: { '@': path.resolve(__dirname, 'src') } },
})
