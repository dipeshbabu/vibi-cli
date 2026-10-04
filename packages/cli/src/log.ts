import { red } from './ui';

export function log(message: string) {
  console.log(`[vibi ${new Date().toISOString()}] ${message}`);
}

export function fail(message: string, code = 1): never {
  console.error(`${red('vibi:')} ${message}`);
  process.exit(code);
}
