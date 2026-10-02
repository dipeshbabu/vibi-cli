/** Progress reported by uploads and downloads, shown by the TUI or on the terminal. */
export type ProgressPhase =
  | 'reading'
  | 'encrypting'
  | 'registering'
  | 'uploading'
  | 'verifying'
  | 'downloading'
  | 'decrypting'
  | 'installing'
  | 'done';

export type Progress = { phase: ProgressPhase; loaded?: number; total?: number };
export type ProgressReporter = (progress: Progress) => void;

export const PHASE_LABEL: Record<ProgressPhase, string> = {
  reading: 'Reading the session',
  encrypting: 'Encrypting',
  registering: 'Registering with the server',
  uploading: 'Uploading',
  verifying: 'Verifying the upload',
  downloading: 'Downloading',
  decrypting: 'Decrypting',
  installing: 'Installing',
  done: 'Done'
};

export function formatBytes(bytes: number) {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

export function progressBar(loaded: number, total: number, width = 30) {
  const ratio = total > 0 ? Math.min(1, loaded / total) : 0;
  const filled = Math.round(ratio * width);
  return `[${'█'.repeat(filled)}${'░'.repeat(width - filled)}] ${Math.floor(ratio * 100)}%`;
}

/**
 * Reporter for the plain command line: rewrites one line on a terminal,
 * prints only phase changes otherwise. Call finish() when the command ends.
 */
export function lineReporter(stream: NodeJS.WriteStream = process.stderr): ProgressReporter & { finish(): void } {
  let lastPhase = '';
  let wrote = false;
  const tty = stream.isTTY;
  const reporter = ((p: Progress) => {
    if (p.phase === 'done') return;
    const label = PHASE_LABEL[p.phase];
    if (tty) {
      const bar = p.total ? ` ${progressBar(p.loaded ?? 0, p.total)} ${formatBytes(p.loaded ?? 0)} / ${formatBytes(p.total)}` : '...';
      stream.write(`\r\x1b[K${label}${bar}`);
      wrote = true;
    } else if (p.phase !== lastPhase) {
      stream.write(`${label}${p.total ? ` (${formatBytes(p.total)})` : ''}\n`);
    }
    lastPhase = p.phase;
  }) as ProgressReporter & { finish(): void };
  reporter.finish = () => {
    if (wrote) stream.write('\r\x1b[K');
  };
  return reporter;
}
