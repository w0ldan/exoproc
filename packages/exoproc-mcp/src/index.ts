#!/usr/bin/env bun
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { getSharedIpcServer } from 'exoproc-ipc';
import { createMcpServer } from './server.js';

export * from './server.js';
export * from './tools/index.js';
export * as ipc from 'exoproc-ipc';

export async function main(argv: string[] = process.argv.slice(2)) {
  const pipeIdx = argv.findIndex((a) => a === '--pipe');
  if (pipeIdx !== -1 && argv[pipeIdx + 1]) {
    process.env.EXOPROC_PIPE = argv[pipeIdx + 1];
    getSharedIpcServer({ name: argv[pipeIdx + 1] });
  }
  const server = createMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

if (import.meta.main) {
  main().catch((err) => {
    console.error('Fatal exoproc-mcp server error:', err);
    process.exit(1);
  });
}
