# vibi

The command-line client for [vibivibi](https://vibivibi.com): end-to-end encrypted storage and sharing of coding-agent sessions (Claude Code, Codex CLI, OpenCode, Pi).

Sessions are encrypted on your machine with keys only you and your recipients hold. The service stores ciphertext it cannot read.

## Install

macOS and Linux:

```sh
curl -fsSL https://vibivibi.com/install.sh | sh
```

Windows (PowerShell):

```powershell
irm https://vibivibi.com/install.ps1 | iex
```

With Node.js 20 or newer already installed, `npm install -g vibi` works too. `vibi upgrade` updates a standalone install.

## Use

```sh
vibi enroll <code>        # code from https://vibivibi.com/dashboard/machines; first time creates your key
vibi push                 # pick a session from this directory: Sync it to your account or Send it to someone
vibi pull                 # pick a stored session and install it on this machine
vibi pending              # passphrases for people you sent sessions to before they had a key
vibi status               # local config, key fingerprint, what the server knows
```

`vibi --help` lists everything, including the non-interactive forms (`push --session <n> --sync`, `pull <id> --out file`).

## Build from source

The client is TypeScript bundled with [Bun](https://bun.sh); the picker is a Go program under `tui/`.

```sh
pnpm install
node scripts/build-tui.mjs --host     # Go 1.26+
node scripts/build-cli.mjs --host     # Bun 1.4+ -> dist/bin/<platform>/vibi
```

Source: https://github.com/subconscious-systems/vibi-cli. Licensed under the Apache License 2.0.
