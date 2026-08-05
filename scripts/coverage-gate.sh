#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

# vitest.config.ts scopes coverage to src/domain/**, src/lib/**, src/ui/*.ts
# and src/ui/*.tsx. If any glob ever stops matching a file (renamed dir,
# moved package, etc), v8 reports "Unknown" for that slice and the 80%
# thresholds pass while measuring nothing. Fail loudly instead of letting
# that pass silently.
domain_count=$(find src/domain -name '*.ts' 2>/dev/null | wc -l | tr -d ' ')
lib_count=$(find src/lib -name '*.ts' 2>/dev/null | wc -l | tr -d ' ')
# src/ui/*.ts and src/ui/*.tsx (not -maxdepth-less **): the pure modules
# (types, api, labels) AND the .tsx components alongside them — both are
# official include globs now, so both need their own guard.
ui_ts_count=$(find src/ui -maxdepth 1 -name '*.ts' 2>/dev/null | wc -l | tr -d ' ')
ui_tsx_count=$(find src/ui -maxdepth 1 -name '*.tsx' 2>/dev/null | wc -l | tr -d ' ')
echo "coverage gate: src/domain/**/*.ts matches=$domain_count src/lib/**/*.ts matches=$lib_count src/ui/*.ts matches=$ui_ts_count src/ui/*.tsx matches=$ui_tsx_count"

if [ "$domain_count" -eq 0 ] || [ "$lib_count" -eq 0 ] || [ "$ui_ts_count" -eq 0 ] || [ "$ui_tsx_count" -eq 0 ]; then
  echo "coverage gate: no files match the include globs — refusing to trust the coverage report" >&2
  exit 1
fi

# tests/api/auth-live.test.ts is skipped here, not in `npm test` itself:
# ci.yml's own preceding step already runs the full suite once (that's where
# this file's real coverage-irrelevant integration check belongs), and this
# script runs the WHOLE suite a second time just to instrument coverage.
# auth-live.test.ts boots a real `next dev` in this checkout directory, and
# Next 16/Turbopack's per-directory dev-server lock does not reliably release
# between the two passes (confirmed empirically: the lock persists even after
# properly waiting for the first pass's child process to exit, so it isn't a
# process-lifetime race — something about Next's own lock state, not this
# script, needs a directory it hasn't already used once this run). The file
# isn't in vitest.config.ts's coverage include globs (src/domain, src/lib,
# src/ui) either, so running it again here adds no coverage information.
npm test -- --coverage --exclude 'tests/api/auth-live.test.ts'
