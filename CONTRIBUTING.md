# Contributing to Rudder

Thank you for your interest in contributing. This document covers the legal
terms for contributions and the dependency-license policy. For architecture,
setup, testing, and conventions, see [README.md](README.md).

## License of contributions

- Rudder is licensed under **AGPL-3.0-only** (see [LICENSE](LICENSE)).
  All contributions are submitted under **AGPL-3.0-only** as well.
- **You retain the copyright** to your contributions. You do not assign
  ownership to Tyche Technologies Co., Ltd.
- Contributions additionally require agreement to the Contributor License
  Agreement — see [CLA.md](CLA.md). The CLA grants the project the right to
  distribute your contribution under AGPL-3.0-only and a narrowly limited
  right to apply future **AGPL §7 additional permissions** (e.g. a plugin
  exception). It does **not** grant a right to relicense the core under a
  proprietary or closed license.
- **The CLA (v1.0) has completed legal review and is final.** Signing
  happens electronically via a CLA-check bot on pull requests — see
  [CLA.md](CLA.md) §A8. **The bot is not yet enabled on this repository**;
  until it is live, no contribution is covered by the CLA and external
  contributions will not be merged. This file will be updated when signing
  opens.
- A Developer Certificate of Origin (DCO) `Signed-off-by` line is welcome
  but **does not replace the CLA** — the DCO only certifies provenance, it
  grants no license-management rights.

## Your responsibilities as a contributor

- You must have the **right to submit** the code you contribute — it is your
  original work, or you are authorized to submit it.
- Do **not** copy third-party code into the repository without verifying its
  license is compatible with AGPL-3.0-only and preserving its copyright and
  license notices.
- If your employer may own rights in your contribution, ensure you are
  authorized (see the Corporate CLA in [CLA.md](CLA.md)).

## Adding dependencies

Check the license **before** adding any dependency, and keep
[THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md) in sync when the dependency
tree changes.

| Category | Licenses | Policy |
|----------|----------|--------|
| Preferred | MIT, BSD-2-Clause, BSD-3-Clause, ISC, Apache-2.0 | Add freely |
| Case-by-case review | LGPL, MPL, other copyleft | Discuss in the PR before adding |
| Prior approval required | GPL-2.0-only, licenses with non-commercial restrictions, unclear provenance, custom source-available licenses | Do not add without explicit maintainer approval |

## Trademarks

Contributing code does not grant any rights to the Tyche name or logo — see
[TRADEMARKS.md](TRADEMARKS.md).
