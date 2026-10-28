#!/usr/bin/env node

import { downloadAllWorkspaceDeps } from './downloader.js';

const workspaceRoot = process.cwd();

downloadAllWorkspaceDeps(workspaceRoot).catch((err) => {
  console.error('Failed to download dependencies:', err);
  process.exit(1);
});
