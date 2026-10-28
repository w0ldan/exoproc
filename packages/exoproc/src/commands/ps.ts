export async function commandPs(
  options: { json?: boolean } = {},
): Promise<void> {
  const { listProcesses } = await import('exoproc-mcp');
  const procs = await listProcesses();

  if (options.json) {
    console.log(JSON.stringify(procs, null, 2));
    return;
  }

  console.log(`\nFound ${procs.length} running processes:\n`);
  console.log(`${'PID'.padEnd(10)} ${'NAME'}`);
  console.log(`${'-'.repeat(8).padEnd(10)} ${'-'.repeat(30)}`);
  for (const p of procs) {
    console.log(`${String(p.pid).padEnd(10)} ${p.name}`);
  }
  console.log();
}
