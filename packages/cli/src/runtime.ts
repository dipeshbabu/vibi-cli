/**
 * How this copy of vibi was shipped. The standalone binary (scripts/build-cli.mjs)
 * carries the Go TUI inside it and sets `globalThis.__VIBI_EMBEDDED_TUI` to the
 * embedded file's path before loading the CLI; npm and source checkouts do not.
 */
declare global {
  // eslint-disable-next-line no-var
  var __VIBI_EMBEDDED_TUI: string | undefined;
}

export function embeddedTuiPath(): string | null {
  return typeof globalThis.__VIBI_EMBEDDED_TUI === 'string' ? globalThis.__VIBI_EMBEDDED_TUI : null;
}

export function isStandaloneBinary(): boolean {
  return embeddedTuiPath() !== null;
}
