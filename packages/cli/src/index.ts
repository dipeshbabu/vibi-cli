import { Command } from 'commander';
import { enroll } from './commands/enroll';
import { daemon, heartbeatOnce } from './commands/heartbeat';
import { rotateKey } from './commands/rotate-key';
import { status } from './commands/status';
import { VERSION } from './version';

const program = new Command();

program
  .name('cybermind')
  .description(
    'CyberMind machine client. Keeps this machine registered with your account; the private key never leaves this machine.'
  )
  .version(VERSION);

program
  .command('enroll')
  .description('Register this machine using a code from the dashboard')
  .argument('<code>', 'enrollment code shown in the dashboard')
  .option('--server <url>', 'CyberMind server URL (default: $CYBERMIND_SERVER_URL or http://localhost:3000)')
  .option('--name <name>', 'display name for this machine (default: hostname)')
  .option('--force', 'enroll again even if this machine already has a config')
  .action(enroll);

program
  .command('status')
  .description('Show local config, key fingerprint and what the server knows')
  .action(status);

program
  .command('heartbeat')
  .description('Send a single heartbeat')
  .action(heartbeatOnce);

program
  .command('daemon')
  .description('Stay online: send a heartbeat every interval until stopped')
  .option('--interval <seconds>', 'seconds between heartbeats', '60')
  .action(daemon);

program
  .command('rotate-key')
  .description('Generate a new key pair, register it, and archive the old one locally')
  .action(rotateKey);

program.parseAsync(process.argv).catch((error: unknown) => {
  console.error(`cybermind: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
