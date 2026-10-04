# vibi

The command-line client for [vibivibi](https://vibivibi.com): end-to-end encrypted storage and sharing of coding-agent sessions (Claude Code, Codex CLI, OpenCode, Pi). Push a session from one machine, pull it onto another and resume, or send it to a teammate. It is encrypted on your machine with keys only you and your recipients hold; the service stores ciphertext it cannot read.

This repository is public so that claim can be checked: the encryption lives in `packages/shared/src`, the client in `packages/cli/src`, and the exact shapes of everything sent to the server in `packages/shared/src/sessions.ts` and `api.ts`. `docs/crypto.md` explains the design.

## Install

macOS and Linux:

```sh
curl -fsSL https://vibivibi.com/install.sh | sh
```

Windows (PowerShell):

```powershell
irm https://vibivibi.com/install.ps1 | iex
```

The installers (copies in `install/`) download the executable for your platform from the latest [release](https://github.com/subconscious-systems/vibi-cli/releases), check its SHA-256 against the release's `checksums.txt`, put it in `~/.vibi/bin` (or `%LOCALAPPDATA%\vibi\bin`) and add that directory to your PATH. No root, no Node, no npm. `vibi upgrade` updates it later.

With Node.js 20 or newer already installed, `npm install -g vibi` works too.

## Use

```sh
vibi enroll <code>     # code from https://vibivibi.com/dashboard/machines; the first time creates your key
vibi push              # pick a session from this directory: Sync it to your account, or Send it to someone
vibi pull              # pick a stored session and install it on this machine
vibi pending           # passphrases for people you sent sessions to before they had a key
vibi status            # local config, key fingerprint, what the server knows
```

`vibi --help` lists everything, including the non-interactive forms (`push --session <n> --sync`, `pull <id> --out file`).

## Build from source

The client is TypeScript bundled with [Bun](https://bun.sh) into a single executable; the interactive picker is a Go program under `packages/cli/tui` that the executable carries inside it.

```sh
pnpm install
pnpm test                 # envelope, user key, session discovery
pnpm build:host           # Go 1.26+ and Bun 1.4+: packages/cli/dist/bin/<platform>/vibi
```

`pnpm build` builds every platform; `.github/workflows/release.yml` does that for a tag `vX.Y.Z` and attaches the results to the release.

## Layout

```
packages/shared   X25519 keys, password-wrapped private key, envelope format, API schemas
packages/cli      the vibi command: enrollment, discovery of local sessions, push, pull, send
packages/cli/tui  the Go picker (derived from subconscious-cli, MIT)
install/          the installer scripts served at vibivibi.com/install.sh and install.ps1
docs/crypto.md    the encryption design
```

The code is developed in the vibivibi monorepo and mirrored here; issues and pull requests are welcome and will be carried across.

## License

Apache License 2.0, Copyright 2026 Subconscious Systems Technologies. See LICENSE and NOTICE.
