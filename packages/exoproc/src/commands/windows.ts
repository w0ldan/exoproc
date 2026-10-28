export async function commandWindows(
  options: { json?: boolean } = {},
): Promise<void> {
  const { listWindows } = await import('exoproc-mcp');
  const wins = await listWindows();

  if (options.json) {
    console.log(JSON.stringify(wins, null, 2));
    return;
  }

  console.log(`\nFound ${wins.length} visible desktop windows:\n`);
  console.log(
    `${'HWND'.padEnd(12)} ${'PID'.padEnd(8)} ${'CLASS'.padEnd(20)} ${'TITLE'}`,
  );
  console.log(
    `${'-'.repeat(10).padEnd(12)} ${'-'.repeat(6).padEnd(8)} ${'-'.repeat(18).padEnd(20)} ${'-'.repeat(30)}`,
  );
  for (const w of wins) {
    const hwndHex = (w.hwnd || '').padEnd(12);
    const pidStr = String(w.pid).padEnd(8);
    const classStr = (w.className || '').slice(0, 18).padEnd(20);
    const title = w.title || '(no title)';
    console.log(`${hwndHex} ${pidStr} ${classStr} ${title}`);
  }
  console.log();
}
