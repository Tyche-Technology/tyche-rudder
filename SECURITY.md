# Security Policy

## Supported versions

Security fixes are made on the current `master` branch. Older commits and images are not supported.

## Reporting a vulnerability

Please use GitHub's [private vulnerability reporting](https://github.com/Tyche-Technology/tyche-rudder/security/advisories/new). Do not open a public issue or include credentials, personal data, production records, or exploit details in public discussions.

Include the affected revision, impact, reproduction steps, and any suggested mitigation. You should receive an acknowledgement within three business days. We will coordinate disclosure after a fix is available.

## Secrets and production data

Never commit real credentials or production data. Use `.env.example` only as a schema, generate fresh local secrets, and replace any credential that may have entered Git history before publishing a fork or release.
