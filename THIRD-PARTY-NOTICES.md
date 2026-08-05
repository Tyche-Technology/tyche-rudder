# Third-Party Notices

Rudder itself is licensed under **AGPL-3.0-only** (see [LICENSE](LICENSE)).
This document records the licenses of third-party components. Third-party
packages remain under **their own licenses**; nothing here relicenses them.

- **Generated:** 2026-08-04, from `package-lock.json` (lockfileVersion 3) and
  the license metadata of the installed packages in `node_modules`.
- **How to regenerate:** re-run a license audit against the lockfile after any
  dependency change (`npm ls --omit=dev --all` for the tree; each package's
  `license` field and bundled license files for the terms).

## Scope and method

Section 1 lists the **runtime dependency closure**: every package reachable
from `dependencies` in `package.json` by following `dependencies` and
`optionalDependencies`. This is the set the production build draws from —
Next.js bundles most of these into the server output, traces some into
`.next/standalone/node_modules`, and the Dockerfile copies `drizzle-orm` and
`postgres` explicitly. Bundled code is still redistribution; the closure is
therefore the correct notice set.

Platform notes:

- `@img/sharp-*` and `@img/sharp-libvips-*` are **per-platform optional
  binaries**; any given artifact ships only its own platform's variants (the
  published Docker image: `linuxmusl-x64`/`linuxmusl-arm64`). All variants are
  listed for completeness.
- `@next/swc-*` binaries are used at **build time only** and are not present
  in the runtime image.

Section 3 lists packages that npm's production closure *formally* contains
only because `better-auth` and `next` declare **optional peerDependencies**
on test tooling (`vitest`, `@playwright/test`); they are not part of the
application and were verified absent from the built image. Section 4 records
development-only dependencies, which are **not distributed** at all.

## 1. Runtime dependencies (distributed)

166 packages. License summary: MIT × 112, Apache-2.0 × 28, LGPL-3.0-or-later × 10, ISC × 5, Apache-2.0 AND LGPL-3.0-or-later × 3, BSD-3-Clause × 2, Apache-2.0 AND LGPL-3.0-or-later AND MIT × 1, CC-BY-4.0 × 1, Unlicense × 1, OFL-1.1 × 1, 0BSD × 1, BSD-2-Clause × 1.

| Package | Version | License | Source |
|---------|---------|---------|--------|
| `@better-auth/core` | 1.6.25 | MIT | https://github.com/better-auth/better-auth |
| `@better-auth/drizzle-adapter` | 1.6.25 | MIT | https://github.com/better-auth/better-auth |
| `@better-auth/kysely-adapter` | 1.6.25 | MIT | https://github.com/better-auth/better-auth |
| `@better-auth/memory-adapter` | 1.6.25 | MIT | https://github.com/better-auth/better-auth |
| `@better-auth/mongo-adapter` | 1.6.25 | MIT | https://github.com/better-auth/better-auth |
| `@better-auth/prisma-adapter` | 1.6.25 | MIT | https://github.com/better-auth/better-auth |
| `@better-auth/telemetry` | 1.6.25 | MIT | https://github.com/better-auth/better-auth |
| `@better-auth/utils` | 0.4.2 | MIT | https://github.com/better-auth/utils |
| `@better-fetch/fetch` | 1.3.1 | MIT | https://github.com/better-auth/better-fetch |
| `@emnapi/runtime` | 1.11.3 | MIT | https://github.com/toyobayashi/emnapi |
| `@google-cloud/paginator` | 5.0.2 | Apache-2.0 | https://github.com/googleapis/nodejs-paginator |
| `@google-cloud/projectify` | 4.0.0 | Apache-2.0 | https://github.com/googleapis/nodejs-projectify |
| `@google-cloud/promisify` | 4.0.0 | Apache-2.0 | https://github.com/googleapis/nodejs-promisify |
| `@google-cloud/storage` | 7.21.0 | Apache-2.0 | https://github.com/googleapis/google-cloud-node |
| `@img/colour` | 1.1.0 | MIT | https://github.com/lovell/colour |
| `@img/sharp-darwin-arm64` | 0.35.3 | Apache-2.0 | https://github.com/lovell/sharp |
| `@img/sharp-darwin-x64` | 0.35.3 | Apache-2.0 | — |
| `@img/sharp-freebsd-wasm32` | 0.35.3 | Apache-2.0 | — |
| `@img/sharp-libvips-darwin-arm64` | 1.3.2 | LGPL-3.0-or-later | https://github.com/lovell/sharp-libvips |
| `@img/sharp-libvips-darwin-x64` | 1.3.2 | LGPL-3.0-or-later | — |
| `@img/sharp-libvips-linux-arm` | 1.3.2 | LGPL-3.0-or-later | — |
| `@img/sharp-libvips-linux-arm64` | 1.3.2 | LGPL-3.0-or-later | — |
| `@img/sharp-libvips-linux-ppc64` | 1.3.2 | LGPL-3.0-or-later | — |
| `@img/sharp-libvips-linux-riscv64` | 1.3.2 | LGPL-3.0-or-later | — |
| `@img/sharp-libvips-linux-s390x` | 1.3.2 | LGPL-3.0-or-later | — |
| `@img/sharp-libvips-linux-x64` | 1.3.2 | LGPL-3.0-or-later | — |
| `@img/sharp-libvips-linuxmusl-arm64` | 1.3.2 | LGPL-3.0-or-later | — |
| `@img/sharp-libvips-linuxmusl-x64` | 1.3.2 | LGPL-3.0-or-later | — |
| `@img/sharp-linux-arm` | 0.35.3 | Apache-2.0 | — |
| `@img/sharp-linux-arm64` | 0.35.3 | Apache-2.0 | — |
| `@img/sharp-linux-ppc64` | 0.35.3 | Apache-2.0 | — |
| `@img/sharp-linux-riscv64` | 0.35.3 | Apache-2.0 | — |
| `@img/sharp-linux-s390x` | 0.35.3 | Apache-2.0 | — |
| `@img/sharp-linux-x64` | 0.35.3 | Apache-2.0 | — |
| `@img/sharp-linuxmusl-arm64` | 0.35.3 | Apache-2.0 | — |
| `@img/sharp-linuxmusl-x64` | 0.35.3 | Apache-2.0 | — |
| `@img/sharp-wasm32` | 0.35.3 | Apache-2.0 AND LGPL-3.0-or-later AND MIT | https://github.com/lovell/sharp |
| `@img/sharp-webcontainers-wasm32` | 0.35.3 | Apache-2.0 | — |
| `@img/sharp-win32-arm64` | 0.35.3 | Apache-2.0 AND LGPL-3.0-or-later | — |
| `@img/sharp-win32-ia32` | 0.35.3 | Apache-2.0 AND LGPL-3.0-or-later | — |
| `@img/sharp-win32-x64` | 0.35.3 | Apache-2.0 AND LGPL-3.0-or-later | — |
| `@next/env` | 16.2.12 | MIT | https://github.com/vercel/next.js |
| `@next/swc-darwin-arm64` | 16.2.12 | MIT | https://github.com/vercel/next.js |
| `@next/swc-darwin-x64` | 16.2.12 | MIT | — |
| `@next/swc-linux-arm64-gnu` | 16.2.12 | MIT | — |
| `@next/swc-linux-arm64-musl` | 16.2.12 | MIT | — |
| `@next/swc-linux-x64-gnu` | 16.2.12 | MIT | — |
| `@next/swc-linux-x64-musl` | 16.2.12 | MIT | — |
| `@next/swc-win32-arm64-msvc` | 16.2.12 | MIT | — |
| `@next/swc-win32-x64-msvc` | 16.2.12 | MIT | — |
| `@noble/ciphers` | 2.2.0 | MIT | https://github.com/paulmillr/noble-ciphers |
| `@noble/hashes` | 2.2.0 | MIT | https://github.com/paulmillr/noble-hashes |
| `@nodable/entities` | 3.0.0 | MIT | https://github.com/nodable/val-parsers |
| `@opentelemetry/semantic-conventions` | 1.43.0 | Apache-2.0 | https://github.com/open-telemetry/opentelemetry-js |
| `@standard-schema/spec` | 1.1.0 | MIT | https://github.com/standard-schema/standard-schema |
| `@swc/helpers` | 0.5.15 | Apache-2.0 | https://github.com/swc-project/swc |
| `@tootallnate/once` | 2.0.1 | MIT | https://github.com/TooTallNate/once |
| `@types/caseless` | 0.12.5 | MIT | https://github.com/DefinitelyTyped/DefinitelyTyped |
| `@types/node` | 20.19.43 | MIT | https://github.com/DefinitelyTyped/DefinitelyTyped |
| `@types/request` | 2.48.13 | MIT | https://github.com/DefinitelyTyped/DefinitelyTyped |
| `@types/tough-cookie` | 4.0.5 | MIT | https://github.com/DefinitelyTyped/DefinitelyTyped |
| `abort-controller` | 3.0.0 | MIT | https://github.com/mysticatea/abort-controller |
| `agent-base` | 6.0.2 | MIT | https://github.com/TooTallNate/node-agent-base |
| `agent-base` | 7.1.4 | MIT | https://github.com/TooTallNate/proxy-agents |
| `anynum` | 1.0.1 | MIT | https://github.com/NaturalIntelligence/anynum |
| `arrify` | 2.0.1 | MIT | https://github.com/sindresorhus/arrify |
| `async-retry` | 1.3.3 | MIT | https://github.com/vercel/async-retry |
| `asynckit` | 0.4.0 | MIT | https://github.com/alexindigo/asynckit |
| `base64-js` | 1.5.1 | MIT | https://github.com/beatgammit/base64-js |
| `baseline-browser-mapping` | 2.11.11 | Apache-2.0 | https://github.com/web-platform-dx/baseline-browser-mapping |
| `better-auth` | 1.6.25 | MIT | https://github.com/better-auth/better-auth |
| `better-call` | 1.3.7 | MIT | https://github.com/better-auth/better-call |
| `bignumber.js` | 9.3.1 | MIT | https://github.com/MikeMcl/bignumber.js |
| `buffer-equal-constant-time` | 1.0.1 | BSD-3-Clause | https://github.com/goinstant/buffer-equal-constant-time |
| `call-bind-apply-helpers` | 1.0.2 | MIT | https://github.com/ljharb/call-bind-apply-helpers |
| `caniuse-lite` | 1.0.30001806 | CC-BY-4.0 | https://github.com/browserslist/caniuse-lite |
| `client-only` | 0.0.1 | MIT | https://reactjs.org/ |
| `combined-stream` | 1.0.8 | MIT | https://github.com/felixge/node-combined-stream |
| `debug` | 4.4.3 | MIT | https://github.com/debug-js/debug |
| `defu` | 6.1.7 | MIT | https://github.com/unjs/defu |
| `delayed-stream` | 1.0.0 | MIT | https://github.com/felixge/node-delayed-stream |
| `detect-libc` | 2.1.2 | Apache-2.0 | https://github.com/lovell/detect-libc |
| `drizzle-orm` | 0.45.2 | Apache-2.0 | https://github.com/drizzle-team/drizzle-orm |
| `dunder-proto` | 1.0.1 | MIT | https://github.com/es-shims/dunder-proto |
| `duplexify` | 4.1.3 | MIT | https://github.com/mafintosh/duplexify |
| `ecdsa-sig-formatter` | 1.0.11 | Apache-2.0 | ssh://git@github.com/Brightspace/node-ecdsa-sig-formatter |
| `end-of-stream` | 1.4.5 | MIT | https://github.com/mafintosh/end-of-stream |
| `es-define-property` | 1.0.1 | MIT | https://github.com/ljharb/es-define-property |
| `es-errors` | 1.3.0 | MIT | https://github.com/ljharb/es-errors |
| `es-object-atoms` | 1.1.2 | MIT | https://github.com/ljharb/es-object-atoms |
| `es-set-tostringtag` | 2.1.0 | MIT | https://github.com/es-shims/es-set-tostringtag |
| `event-target-shim` | 5.0.1 | MIT | https://github.com/mysticatea/event-target-shim |
| `extend` | 3.0.2 | MIT | https://github.com/justmoon/node-extend |
| `fast-xml-builder` | 1.3.0 | MIT | https://github.com/NaturalIntelligence/fast-xml-builder |
| `fast-xml-parser` | 5.10.1 | MIT | https://github.com/NaturalIntelligence/fast-xml-parser |
| `form-data` | 2.5.6 | MIT | https://github.com/form-data/form-data |
| `function-bind` | 1.1.2 | MIT | https://github.com/Raynos/function-bind |
| `gaxios` | 6.7.1 | Apache-2.0 | https://github.com/googleapis/gaxios |
| `gcp-metadata` | 6.1.1 | Apache-2.0 | https://github.com/googleapis/gcp-metadata |
| `get-intrinsic` | 1.3.0 | MIT | https://github.com/ljharb/get-intrinsic |
| `get-proto` | 1.0.1 | MIT | https://github.com/ljharb/get-proto |
| `google-auth-library` | 9.15.1 | Apache-2.0 | https://github.com/googleapis/google-auth-library-nodejs |
| `google-logging-utils` | 0.0.2 | Apache-2.0 | https://github.com/googleapis/gax-nodejs |
| `gopd` | 1.2.0 | MIT | https://github.com/ljharb/gopd |
| `gtoken` | 7.1.0 | MIT | https://github.com/google/node-gtoken |
| `has-symbols` | 1.1.0 | MIT | https://github.com/inspect-js/has-symbols |
| `has-tostringtag` | 1.0.2 | MIT | https://github.com/inspect-js/has-tostringtag |
| `hasown` | 2.0.4 | MIT | https://github.com/inspect-js/hasOwn |
| `html-entities` | 2.6.0 | MIT | https://github.com/mdevils/html-entities |
| `http-proxy-agent` | 5.0.0 | MIT | https://github.com/TooTallNate/node-http-proxy-agent |
| `https-proxy-agent` | 5.0.1 | MIT | https://github.com/TooTallNate/node-https-proxy-agent |
| `https-proxy-agent` | 7.0.6 | MIT | https://github.com/TooTallNate/proxy-agents |
| `inherits` | 2.0.4 | ISC | https://github.com/isaacs/inherits |
| `is-stream` | 2.0.1 | MIT | https://github.com/sindresorhus/is-stream |
| `is-unsafe` | 2.0.0 | MIT | https://github.com/NaturalIntelligence/is-unsafe |
| `jose` | 6.2.8 | MIT | https://github.com/panva/jose |
| `json-bigint` | 1.0.0 | MIT | https://github.com/sidorares/json-bigint |
| `jwa` | 2.0.1 | MIT | https://github.com/brianloveswords/node-jwa |
| `jws` | 4.0.1 | MIT | https://github.com/brianloveswords/node-jws |
| `kysely` | 0.29.4 | MIT | https://github.com/kysely-org/kysely |
| `math-intrinsics` | 1.1.0 | MIT | https://github.com/es-shims/math-intrinsics |
| `mime` | 3.0.0 | MIT | https://github.com/broofa/mime |
| `mime-db` | 1.52.0 | MIT | https://github.com/jshttp/mime-db |
| `mime-types` | 2.1.35 | MIT | https://github.com/jshttp/mime-types |
| `ms` | 2.1.3 | MIT | https://github.com/vercel/ms |
| `nanoid` | 3.3.16 | MIT | https://github.com/ai/nanoid |
| `nanostores` | 1.4.2 | MIT | https://github.com/nanostores/nanostores |
| `next` | 16.2.12 | MIT | https://github.com/vercel/next.js |
| `node-fetch` | 2.7.0 | MIT | https://github.com/bitinn/node-fetch |
| `once` | 1.4.0 | ISC | https://github.com/isaacs/once |
| `p-limit` | 3.1.0 | MIT | https://github.com/sindresorhus/p-limit |
| `path-expression-matcher` | 1.6.2 | MIT | https://github.com/NaturalIntelligence/path-expression-matcher |
| `picocolors` | 1.1.1 | ISC | https://github.com/alexeyraspopov/picocolors |
| `postcss` | 8.5.25 | MIT | https://github.com/postcss/postcss |
| `postgres` | 3.4.9 | Unlicense | https://github.com/porsager/postgres |
| `pretendard` | 1.3.9 | OFL-1.1 | https://github.com/orioncactus/pretendard |
| `react` | 19.2.4 | MIT | https://github.com/facebook/react |
| `react-dom` | 19.2.4 | MIT | https://github.com/facebook/react |
| `readable-stream` | 3.6.2 | MIT | https://github.com/nodejs/readable-stream |
| `retry` | 0.13.1 | MIT | https://github.com/tim-kos/node-retry |
| `retry-request` | 7.0.2 | MIT | https://github.com/stephenplusplus/retry-request |
| `rou3` | 0.7.12 | MIT | https://github.com/h3js/rou3 |
| `safe-buffer` | 5.2.1 | MIT | https://github.com/feross/safe-buffer |
| `scheduler` | 0.27.0 | MIT | https://github.com/facebook/react |
| `semver` | 7.8.5 | ISC | https://github.com/npm/node-semver |
| `set-cookie-parser` | 3.1.2 | MIT | https://github.com/nfriedly/set-cookie-parser |
| `sharp` | 0.35.3 | Apache-2.0 | https://github.com/lovell/sharp |
| `source-map-js` | 1.2.1 | BSD-3-Clause | https://github.com/7rulnik/source-map-js |
| `stream-events` | 1.0.5 | MIT | https://github.com/stephenplusplus/stream-events |
| `stream-shift` | 1.0.3 | MIT | https://github.com/mafintosh/stream-shift |
| `string_decoder` | 1.3.0 | MIT | https://github.com/nodejs/string_decoder |
| `strnum` | 2.4.1 | MIT | https://github.com/NaturalIntelligence/strnum |
| `stubs` | 3.0.0 | MIT | https://github.com/stephenplusplus/stubs |
| `styled-jsx` | 5.1.6 | MIT | https://github.com/vercel/styled-jsx |
| `teeny-request` | 9.0.0 | Apache-2.0 | https://github.com/googleapis/teeny-request |
| `tr46` | 0.0.3 | MIT | https://github.com/Sebmaster/tr46.js |
| `tslib` | 2.8.1 | 0BSD | https://github.com/Microsoft/tslib |
| `undici-types` | 6.21.0 | MIT | https://github.com/nodejs/undici |
| `util-deprecate` | 1.0.2 | MIT | https://github.com/TooTallNate/util-deprecate |
| `uuid` | 11.1.1 | MIT | https://github.com/uuidjs/uuid |
| `webidl-conversions` | 3.0.1 | BSD-2-Clause | https://github.com/jsdom/webidl-conversions |
| `whatwg-url` | 5.0.0 | MIT | https://github.com/jsdom/whatwg-url |
| `wrappy` | 1.0.2 | ISC | https://github.com/npm/wrappy |
| `xml-naming` | 0.3.0 | MIT | https://github.com/NaturalIntelligence/xml-naming |
| `yocto-queue` | 0.1.0 | MIT | https://github.com/sindresorhus/yocto-queue |
| `zod` | 4.4.3 | MIT | https://github.com/colinhacks/zod |

## 2. Required notices and special terms

- **Apache-2.0** (32 runtime packages, including dual-licensed
  `@img` variants): the license text is included inside each package.
  None of the runtime Apache-2.0 packages ships a `NOTICE` file (verified against the installed packages on the generation date), so no additional NOTICE propagation is currently required. Re-verify when upgrading — a future version may add one.
- **`@img/sharp-libvips-*` 1.3.2 — LGPL-3.0-or-later.** Prebuilt
  [libvips](https://github.com/lovell/sharp-libvips) shared libraries,
  dynamically linked by `sharp` (itself Apache-2.0, an optional dependency of
  Next.js image optimization). The npm packages do **not** bundle the LGPL
  license text; source and license are published at the upstream repository.
  See §5.
- **`pretendard` 1.3.9 — OFL-1.1 (SIL Open Font License 1.1).**
  Copyright Kil Hyung-jin (https://github.com/orioncactus/pretendard).
  The Pretendard Variable font files are copied into the built static assets
  and served to browsers — i.e. the font **is redistributed** by this
  application. OFL-1.1 permits this but requires the license text to
  accompany the font; the npm package does not bundle it. See §5.
- **`caniuse-lite` — CC-BY-4.0.** Browser-support data by the caniuse project
  (https://caniuse.com), redistributed under Creative Commons Attribution 4.0.
  This entry serves as the attribution.
- **`postgres` 3.4.9 — Unlicense** (public-domain dedication). No notice
  obligations.
- **`@img/sharp-win32-*` / `@img/sharp-wasm32`** carry compound SPDX
  expressions (`Apache-2.0 AND LGPL-3.0-or-later`, wasm32 additionally
  `AND MIT`) because they embed libvips. Only relevant when shipping those
  platforms; the production Docker image does not.

## 3. Optional-peer tooling in npm's production closure (not distributed)

52 packages, present in `npm ls --omit=dev` output only via optional
`peerDependencies` declarations of `better-auth` (on `vitest`) and `next`
(on `@playwright/test`). Verified not part of the built server output.

| Package | Version | License | Source |
|---------|---------|---------|--------|
| `@drizzle-team/brocli` | 0.10.2 | Apache-2.0 | https://github.com/drizzle-team/brocli |
| `@electric-sql/pglite` | 0.5.4 | Apache-2.0 | https://github.com/electric-sql/pglite |
| `@esbuild-kit/core-utils` | 3.3.2 | MIT | https://github.com/esbuild-kit/core-utils |
| `@esbuild-kit/esm-loader` | 2.6.5 | MIT | https://github.com/esbuild-kit/esm-loader |
| `@jridgewell/sourcemap-codec` | 1.5.5 | MIT | https://github.com/jridgewell/sourcemaps |
| `@oxc-project/types` | 0.142.0 | MIT | https://github.com/oxc-project/oxc |
| `@playwright/test` | 1.62.1 | Apache-2.0 | https://github.com/microsoft/playwright |
| `@rolldown/pluginutils` | 1.0.1 | MIT | https://github.com/rolldown/plugins |
| `@types/chai` | 5.2.3 | MIT | https://github.com/DefinitelyTyped/DefinitelyTyped |
| `@types/deep-eql` | 4.0.2 | MIT | https://github.com/DefinitelyTyped/DefinitelyTyped |
| `@types/estree` | 1.0.9 | MIT | https://github.com/DefinitelyTyped/DefinitelyTyped |
| `@vitest/expect` | 4.1.10 | MIT | https://github.com/vitest-dev/vitest |
| `@vitest/mocker` | 4.1.10 | MIT | https://github.com/vitest-dev/vitest |
| `@vitest/pretty-format` | 4.1.10 | MIT | https://github.com/vitest-dev/vitest |
| `@vitest/runner` | 4.1.10 | MIT | https://github.com/vitest-dev/vitest |
| `@vitest/snapshot` | 4.1.10 | MIT | https://github.com/vitest-dev/vitest |
| `@vitest/spy` | 4.1.10 | MIT | https://github.com/vitest-dev/vitest |
| `@vitest/utils` | 4.1.10 | MIT | https://github.com/vitest-dev/vitest |
| `assertion-error` | 2.0.1 | MIT | https://github.com/chaijs/assertion-error |
| `buffer-from` | 1.1.2 | MIT | https://github.com/LinusU/buffer-from |
| `chai` | 6.2.2 | MIT | https://github.com/chaijs/chai |
| `convert-source-map` | 2.0.0 | MIT | https://github.com/thlorenz/convert-source-map |
| `drizzle-kit` | 0.31.10 | MIT | https://github.com/drizzle-team/drizzle-orm |
| `es-module-lexer` | 2.3.1 | MIT | https://github.com/guybedford/es-module-lexer |
| `esbuild` | 0.25.12 | MIT | https://github.com/evanw/esbuild |
| `esbuild` | 0.28.1 | MIT | https://github.com/evanw/esbuild |
| `estree-walker` | 3.0.3 | MIT | https://github.com/Rich-Harris/estree-walker |
| `expect-type` | 1.4.0 | Apache-2.0 | https://github.com/mmkal/expect-type |
| `fdir` | 6.5.0 | MIT | https://github.com/thecodrr/fdir |
| `get-tsconfig` | 4.14.1 | MIT | https://github.com/privatenumber/get-tsconfig |
| `lightningcss` | 1.33.0 | MPL-2.0 | https://github.com/parcel-bundler/lightningcss |
| `magic-string` | 0.30.21 | MIT | https://github.com/Rich-Harris/magic-string |
| `obug` | 2.1.4 | MIT | https://github.com/sxzz/obug |
| `pathe` | 2.0.3 | MIT | https://github.com/unjs/pathe |
| `picomatch` | 4.0.5 | MIT | https://github.com/micromatch/picomatch |
| `playwright` | 1.62.1 | Apache-2.0 | https://github.com/microsoft/playwright |
| `playwright-core` | 1.62.1 | Apache-2.0 | https://github.com/microsoft/playwright |
| `resolve-pkg-maps` | 1.0.0 | MIT | https://github.com/privatenumber/resolve-pkg-maps |
| `rolldown` | 1.2.1 | MIT | https://github.com/rolldown/rolldown |
| `siginfo` | 2.0.0 | ISC | https://github.com/emilbayes/siginfo |
| `source-map` | 0.6.1 | BSD-3-Clause | http://github.com/mozilla/source-map |
| `source-map-support` | 0.5.21 | MIT | https://github.com/evanw/node-source-map-support |
| `stackback` | 0.0.2 | MIT | https://github.com/shtylman/node-stackback |
| `std-env` | 4.2.0 | MIT | https://github.com/unjs/std-env |
| `tinybench` | 2.9.0 | MIT | https://github.com/tinylibs/tinybench |
| `tinyexec` | 1.3.0 | MIT | https://github.com/tinylibs/tinyexec |
| `tinyglobby` | 0.2.17 | MIT | https://github.com/SuperchupuDev/tinyglobby |
| `tinyrainbow` | 3.1.1 | MIT | https://github.com/tinylibs/tinyrainbow |
| `tsx` | 4.23.5 | MIT | https://github.com/privatenumber/tsx |
| `vite` | 8.2.0 | MIT | https://github.com/vitejs/vite |
| `vitest` | 4.1.10 | MIT | https://github.com/vitest-dev/vitest |
| `why-is-node-running` | 2.3.0 | MIT | https://github.com/mafintosh/why-is-node-running |

## 4. Development-only dependencies (audit record, not distributed)

158 packages (test, build, and type tooling). Not part of any
distributed artifact; recorded here for audit completeness only.

- **MIT** (133): `@asamuzakjp/css-color@6.0.5`, `@asamuzakjp/dom-selector@8.3.2`, `@babel/code-frame@7.29.7`, `@babel/helper-string-parser@7.29.7`, `@babel/helper-validator-identifier@7.29.7`, `@babel/parser@7.29.8`, `@babel/runtime@7.29.7`, `@babel/types@7.29.8`, `@bcoe/v8-coverage@1.0.2`, `@bramus/specificity@2.4.2`, `@csstools/css-calc@3.3.0`, `@csstools/css-color-parser@4.1.10`, `@csstools/css-parser-algorithms@4.0.0`, `@csstools/css-tokenizer@4.0.0`, `@emnapi/core@2.0.0-alpha.3`, `@emnapi/runtime@2.0.0-alpha.3`, `@emnapi/wasi-threads@2.0.1`, `@esbuild/aix-ppc64@0.25.12`, `@esbuild/aix-ppc64@0.28.1`, `@esbuild/android-arm@0.25.12`, `@esbuild/android-arm@0.28.1`, `@esbuild/android-arm64@0.25.12`, `@esbuild/android-arm64@0.28.1`, `@esbuild/android-x64@0.25.12`, `@esbuild/android-x64@0.28.1`, `@esbuild/darwin-arm64@0.25.12`, `@esbuild/darwin-arm64@0.28.1`, `@esbuild/darwin-x64@0.25.12`, `@esbuild/darwin-x64@0.28.1`, `@esbuild/freebsd-arm64@0.25.12`, `@esbuild/freebsd-arm64@0.28.1`, `@esbuild/freebsd-x64@0.25.12`, `@esbuild/freebsd-x64@0.28.1`, `@esbuild/linux-arm@0.25.12`, `@esbuild/linux-arm@0.28.1`, `@esbuild/linux-arm64@0.25.12`, `@esbuild/linux-arm64@0.28.1`, `@esbuild/linux-ia32@0.25.12`, `@esbuild/linux-ia32@0.28.1`, `@esbuild/linux-loong64@0.25.12`, `@esbuild/linux-loong64@0.28.1`, `@esbuild/linux-mips64el@0.25.12`, `@esbuild/linux-mips64el@0.28.1`, `@esbuild/linux-ppc64@0.25.12`, `@esbuild/linux-ppc64@0.28.1`, `@esbuild/linux-riscv64@0.25.12`, `@esbuild/linux-riscv64@0.28.1`, `@esbuild/linux-s390x@0.25.12`, `@esbuild/linux-s390x@0.28.1`, `@esbuild/linux-x64@0.25.12`, `@esbuild/linux-x64@0.28.1`, `@esbuild/netbsd-arm64@0.25.12`, `@esbuild/netbsd-arm64@0.28.1`, `@esbuild/netbsd-x64@0.25.12`, `@esbuild/netbsd-x64@0.28.1`, `@esbuild/openbsd-arm64@0.25.12`, `@esbuild/openbsd-arm64@0.28.1`, `@esbuild/openbsd-x64@0.25.12`, `@esbuild/openbsd-x64@0.28.1`, `@esbuild/openharmony-arm64@0.25.12`, `@esbuild/openharmony-arm64@0.28.1`, `@esbuild/sunos-x64@0.25.12`, `@esbuild/sunos-x64@0.28.1`, `@esbuild/win32-arm64@0.25.12`, `@esbuild/win32-arm64@0.28.1`, `@esbuild/win32-ia32@0.25.12`, `@esbuild/win32-ia32@0.28.1`, `@esbuild/win32-x64@0.25.12`, `@esbuild/win32-x64@0.28.1`, `@exodus/bytes@1.15.1`, `@jridgewell/resolve-uri@3.1.2`, `@jridgewell/trace-mapping@0.3.31`, `@napi-rs/wasm-runtime@1.2.2`, `@rolldown/binding-android-arm64@1.2.1`, `@rolldown/binding-darwin-arm64@1.2.1`, `@rolldown/binding-darwin-x64@1.2.1`, `@rolldown/binding-freebsd-x64@1.2.1`, `@rolldown/binding-linux-arm-gnueabihf@1.2.1`, `@rolldown/binding-linux-arm64-gnu@1.2.1`, `@rolldown/binding-linux-arm64-musl@1.2.1`, `@rolldown/binding-linux-ppc64-gnu@1.2.1`, `@rolldown/binding-linux-s390x-gnu@1.2.1`, `@rolldown/binding-linux-x64-gnu@1.2.1`, `@rolldown/binding-linux-x64-musl@1.2.1`, `@rolldown/binding-openharmony-arm64@1.2.1`, `@rolldown/binding-wasm32-wasi@1.2.1`, `@rolldown/binding-win32-arm64-msvc@1.2.1`, `@rolldown/binding-win32-x64-msvc@1.2.1`, `@testing-library/dom@10.4.1`, `@testing-library/react@16.3.2`, `@tybys/wasm-util@0.10.3`, `@types/aria-query@5.0.4`, `@types/react@19.2.18`, `@types/react-dom@19.2.4`, `@vitest/coverage-v8@4.1.10`, `ansi-regex@5.0.1`, `ansi-styles@5.2.0`, `ast-v8-to-istanbul@1.0.5`, `bidi-js@1.0.3`, `css-tree@3.2.1`, `csstype@3.2.3`, `data-urls@7.0.0`, `decimal.js@10.6.0`, `dequal@2.0.3`, `dom-accessibility-api@0.5.16`, `fsevents@2.3.2`, `fsevents@2.3.3`, `has-flag@4.0.0`, `html-encoding-sniffer@6.0.0`, `html-escaper@2.0.2`, `is-potential-custom-element-name@1.0.1`, `js-tokens@10.0.0`, `js-tokens@4.0.0`, `jsdom@30.0.1`, `lz-string@1.5.0`, `magicast@0.5.4`, `make-dir@4.0.0`, `parse5@8.0.1`, `pretty-format@27.5.1`, `punycode@2.3.1`, `react-is@17.0.2`, `require-from-string@2.0.2`, `supports-color@7.2.0`, `symbol-tree@3.2.4`, `tldts@7.4.10`, `tldts-core@7.4.10`, `tr46@6.0.0`, `undici@8.9.0`, `w3c-xmlserializer@5.0.0`, `whatwg-mimetype@5.0.0`, `whatwg-url@16.0.1`, `whatwg-url@17.1.0`, `xmlchars@2.2.0`
- **MPL-2.0** (11): `lightningcss-android-arm64@1.33.0`, `lightningcss-darwin-arm64@1.33.0`, `lightningcss-darwin-x64@1.33.0`, `lightningcss-freebsd-x64@1.33.0`, `lightningcss-linux-arm-gnueabihf@1.33.0`, `lightningcss-linux-arm64-gnu@1.33.0`, `lightningcss-linux-arm64-musl@1.33.0`, `lightningcss-linux-x64-gnu@1.33.0`, `lightningcss-linux-x64-musl@1.33.0`, `lightningcss-win32-arm64-msvc@1.33.0`, `lightningcss-win32-x64-msvc@1.33.0`
- **BSD-3-Clause** (4): `istanbul-lib-coverage@3.2.2`, `istanbul-lib-report@3.0.1`, `istanbul-reports@3.2.0`, `tough-cookie@6.0.2`
- **Apache-2.0** (3): `aria-query@5.3.0`, `typescript@5.9.3`, `xml-name-validator@5.0.0`
- **MIT-0** (2): `@csstools/color-helpers@6.1.0`, `@csstools/css-syntax-patches-for-csstree@1.1.7`
- **BSD-2-Clause** (2): `entities@8.0.0`, `webidl-conversions@8.0.1`
- **BlueOak-1.0.0** (1): `lru-cache@11.5.2`
- **CC0-1.0** (1): `mdn-data@2.27.1`
- **ISC** (1): `saxes@6.0.0`

## 5. Review items

1. **OFL-1.1 text for Pretendard** — the font is redistributed but the npm
   package ships no license file. The OFL-1.1 text should accompany
   redistributed font files; until then this document plus the upstream
   license (https://github.com/orioncactus/pretendard/blob/main/LICENSE) are
   the reference. Consider vendoring the license text.
2. **LGPL-3.0-or-later libvips binaries** — LGPL obligations (license text,
   ability to relink/replace the library) are met in practice by dynamic
   linking and upstream source availability, but the packages bundle no
   license text. Flagged for legal review rather than assumed satisfied.
3. **Bundled server chunks carry no upstream LICENSE files** — Next.js
   compiles most runtime dependencies into server chunks, which strips the
   per-package license files that `node_modules` distribution would carry.
   This aggregate document is the compensating notice; the Dockerfile copies
   `LICENSE` and `THIRD-PARTY-NOTICES.md` into the image (`/app`) so the
   notices travel with the distributed artifact (verified in a local
   `docker build` on 2026-08-04).
4. No package with an unknown or unverifiable license was found (0 of 376
   audited packages).

---

This document is informational and is not legal advice. The license texts of
the individual packages are authoritative.
