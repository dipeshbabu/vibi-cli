import { arch, hostname, platform } from 'node:os';
import { VERSION } from './version';

export function describeThisMachine(name?: string) {
  const host = hostname();
  return {
    name: (name ?? host.replace(/\.local$/, '')).slice(0, 100),
    platform: platform(),
    hostname: host,
    arch: arch(),
    clientVersion: VERSION
  };
}
