export function log(message: string) {
  console.log(`[cybermind ${new Date().toISOString()}] ${message}`);
}

export function fail(message: string, code = 1): never {
  console.error(`cybermind: ${message}`);
  process.exit(code);
}
