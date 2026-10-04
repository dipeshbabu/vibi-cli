/**
 * Terminal styling for the plain command line. Colors and boxes only on a
 * TTY (and not under NO_COLOR), so scripts and tests see the same plain text
 * as before; the words never change, only the dressing.
 */
const enabled = Boolean(process.stdout.isTTY) && !process.env.NO_COLOR && process.env.TERM !== 'dumb';
const style = (open: string) => (text: string) => (enabled ? `\x1b[${open}m${text}\x1b[0m` : text);

export const bold = style('1');
export const dim = style('2');
export const red = style('31');
export const green = style('32');
export const yellow = style('33');
export const cyan = style('36');
export const orange = style('38;5;208');

/** A line that reports something finished. */
export const ok = (text: string) => `${green('✓')} ${text}`;
/** A line the user should act on or be careful about. */
export const warn = (text: string) => `${yellow('!')} ${text}`;
/** A command to type. */
export const cmd = (text: string) => bold(cyan(text));

export function heading(title: string) {
  return `\n${orange('✻')} ${bold(title)}`;
}

const visible = (text: string) => text.replace(/\x1b\[[0-9;]*m/g, '').length;

/** Wraps prose at `width` columns on spaces; explicit newlines are kept. */
export function wrap(text: string, width = 72): string[] {
  const out: string[] = [];
  for (const paragraph of text.split('\n')) {
    let line = '';
    for (const word of paragraph.split(' ')) {
      if (line && visible(line) + 1 + visible(word) > width) {
        out.push(line);
        line = word;
      } else {
        line = line ? `${line} ${word}` : word;
      }
    }
    out.push(line);
  }
  return out;
}

/** The lines in a rounded box, so the one fact that matters (a passphrase, a command) stands apart from the prose. */
export function box(lines: string[], opts: { title?: string } = {}): string {
  const width = Math.max(...lines.map(visible), opts.title ? visible(opts.title) + 2 : 0, 20);
  const top = opts.title
    ? `╭─ ${bold(opts.title)} ${'─'.repeat(width - visible(opts.title) - 1)}╮`
    : `╭${'─'.repeat(width + 2)}╮`;
  const body = lines.map((line) => `│ ${line}${' '.repeat(width - visible(line))} │`);
  return [top, ...body, `╰${'─'.repeat(width + 2)}╯`].join('\n');
}

/** Commands with a short explanation each, aligned in two columns. */
export function commands(rows: Array<[string, string]>): string {
  const width = Math.max(...rows.map(([c]) => c.length));
  return rows.map(([c, what]) => `  ${cmd(c.padEnd(width))}  ${dim(what)}`).join('\n');
}
