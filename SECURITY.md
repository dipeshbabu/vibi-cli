# Security

vibi is the client of an end-to-end encrypted service. Everything that matters for confidentiality happens in this repository: key generation, password wrapping of the private key, per-session content keys, and the envelope format. `docs/crypto.md` describes the design; `packages/shared/src/sessions.ts` and `packages/shared/src/api.ts` are the exact shapes of what the client sends to the server.

## Reporting a vulnerability

Email **support@subconscious.dev** with a description and, if you have one, a proof of concept. Please do not open a public issue for anything that could expose other users' data. We acknowledge reports within three business days and will tell you when a fix ships.

## What is in scope

- Anything that lets the server, or anyone with its database and storage, read session content, titles, working directories or model names.
- Anything that leaks the encryption password, a private key, or a provisional-recipient passphrase off the machine.
- Weaknesses in the key wrapping, the envelope, the provisional-recipient flow, or the installer's download verification.

## Verifying what you run

Release executables are built by `.github/workflows/release.yml` from a tag of this repository; `checksums.txt` on each release lists their SHA-256 and the installers refuse a mismatch. To avoid trusting the published binaries at all, build from source: `pnpm install && pnpm build:host` (needs Go and Bun) and run `packages/cli/dist/bin/<platform>/vibi`.
