import { Command } from 'commander';
import { enroll } from './commands/enroll';
import { pull } from './commands/pull';
import { push } from './commands/push';
import { invite } from './commands/invite';
import { pending } from './commands/pending';
import { changePassword, lock, unlock } from './commands/key';
import { sessions } from './commands/sessions';
import { status } from './commands/status';
import { upgrade } from './commands/upgrade';
import { VERSION } from './version';

const program = new Command();

program
  .name('vibi')
  .description(
    'vibi: the vibivibi machine client. Uploads encrypted coding-agent sessions from this machine and pulls them onto any other machine you unlock with your password.'
  )
  .version(VERSION);

program
  .command('enroll')
  .description('Register this machine using a code from the dashboard')
  .argument('<code>', 'enrollment code shown in the dashboard')
  .option('--server <url>', 'vibivibi server URL (default: $VIBI_SERVER_URL or https://vibivibi.com)')
  .option('--name <name>', 'display name for this machine (default: hostname)')
  .option('--force', 'enroll again even if this machine already has a config')
  .option('--no-unlock', 'do not ask for the encryption password now (uploads still work)')
  .option('--remember', 'keep the unlocked private key on this machine (otherwise you are asked)')
  .option('--no-remember', 'never keep the private key on this machine')
  .action(enroll);

program
  .command('status')
  .description('Show local config, key fingerprint and what the server knows')
  .action(status);

program
  .command('push')
  .description('Pick a coding-agent session under this directory and sync it or send it to another user')
  .option('--session <key|n>', 'skip the picker: session key (harness:id), id prefix, or list number')
  .option('--sync', 'with --session: encrypt for yourself and upload')
  .option('--send <email>', 'with --session: encrypt for this user and send')
  .option('--name <label>', 'plaintext name for the session (shown in the dashboard and to recipients)')
  .option('--list', 'print the sessions under this directory and exit')
  .option('--json', 'print them as JSON and exit')
  .option('--all', 'consider sessions from every directory, not just this one')
  .option('--force', 'upload even if this machine believes the session is already stored')
  .option('--max <count>', 'newest sessions to scan', '500')
  .action(push);

program
  .command('pending')
  .description('People you sent sessions to before they had a key, and the passphrases they need')
  .option('--reset <email>', 'make a new passphrase for that address')
  .option('--json', 'print raw JSON')
  .action(pending);

program
  .command('invite')
  .description('Email someone an invitation to join vibivibi so you can send them sessions')
  .argument('<email>', 'their email address')
  .action(invite);

program
  .command('pull')
  .description('Pick a session stored for your account and install it here, or download one by id')
  .argument('[id]', 'pull id from the list or the dashboard, e.g. #3f9a1c7b2e')
  .option('--list', 'print the list instead of opening the picker')
  .option('--into <dir>', 'Claude Code: project directory to install the session under (default: current directory)')
  .option('--out <file>', 'write the decrypted trace to this file instead of installing it')
  .option('--overwrite', 'replace an existing local file that has different content')
  .option('--rev <ref>', 'a specific version: its number (2, v2) or a prefix of its content hash (default: latest)')
  .option('--versions', 'list the versions of this session instead of downloading')
  .option('--json', 'print the raw list as JSON')
  .action(pull);

program
  .command('sessions')
  .description('List the coding-agent sessions found on this machine')
  .option('--max <count>', 'newest sessions to list', '200')
  .option('--json', 'print raw JSON')
  .action(sessions);

program
  .command('unlock')
  .description('Unlock your private key with the password and keep it on this machine')
  .action(unlock);

program
  .command('lock')
  .description('Forget the private key kept on this machine; commands that need it will ask for the password')
  .action(lock);

program
  .command('change-password')
  .description('Re-encrypt your private key with a new encryption password')
  .action(changePassword);

program
  .command('upgrade')
  .description('Install the latest release of vibi over this one')
  .action(upgrade);

program.parseAsync(process.argv).catch((error: unknown) => {
  console.error(`vibi: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
