import chalk from 'chalk';

/**
 * ASCII-based logger for build scripts.
 * No font-icons used for maximum compatibility across all terminals.
 */
export const log = {
  /** Information messages with a cyan label. */
  info: (msg: string) => console.log(`${chalk.bgCyan.black(' INFO ')} ${msg}`),

  /** Waiting/Progress messages with a blue label. */
  wait: (msg: string) => console.log(`${chalk.bgBlue.black(' WAIT ')} ${msg}`),

  /** Success messages with a green label. */
  done: (msg: string) => console.log(`${chalk.bgGreen.black(' DONE ')} ${msg}`),

  /** Warning messages with a yellow label. */
  warn: (msg: string) =>
    console.log(`${chalk.bgYellow.black(' WARN ')} ${msg}`),

  /** Error messages with a red label. */
  fail: (msg: string) => {
    console.error(`${chalk.bgRed.black(' FAIL ')} ${chalk.red(msg)}`);
  },

  /** Bold highlight for important text. */
  bold: (msg: string) => chalk.bold(msg),

  /** Dimmed text for secondary information. */
  dim: (msg: string) => chalk.dim(msg),

  /** Empty line for spacing. */
  line: (msg: string = '') => console.log(msg),

  /** Section header with bold text and spacing. */
  section: (title: string) => {
    console.log(`\n${chalk.cyan.bold(title)}`);
    console.log(chalk.cyan(''.padStart(title.length, '─')));
  },
};
