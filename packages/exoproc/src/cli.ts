#!/usr/bin/env bun
import readline from 'node:readline';
import {
  intro,
  outro,
  multiselect,
  isCancel,
  cancel,
  log,
  spinner,
  note,
} from '@clack/prompts';
import pc from 'picocolors';
import {
  runSetup,
  createSetupContext,
  detectClients,
  SUPPORTED_CLIENTS,
} from './setup/index.js';
import { runDoctor } from './doctor/index.js';
import pkg from '../package.json' with { type: 'json' };

const VERSION = pkg.version || '0.6.5';

async function promptSelectClients(
  clients: typeof SUPPORTED_CLIENTS,
  detectedIds: Set<string>,
): Promise<string[]> {
  if (process.stdin.isTTY) {
    try {
      const selected = await multiselect({
        message: 'Select the AI agent(s) you want to configure:',
        options: clients.map((c) => ({
          value: c.id,
          label: c.displayName,
          hint: detectedIds.has(c.id) ? 'detected' : undefined,
        })),
        initialValues: clients
          .filter((c) => detectedIds.has(c.id))
          .map((c) => c.id),
        required: false,
      });

      if (isCancel(selected)) {
        cancel('Setup cancelled.');
        return [];
      }
      return selected as string[];
    } catch {
      // Fallback to text prompt if TUI multiselect fails to initialize
    }
  }

  log.step('Select the AI agent(s) you want to configure:');
  clients.forEach((c, idx) => {
    const isDetected = detectedIds.has(c.id);
    const tag = isDetected ? pc.dim(' (detected)') : '';
    console.log(`  [${idx + 1}] ${c.displayName}${tag}`);
  });
  console.log(`  [A] All Agents`);
  console.log(`  [Q] Cancel / Quit\n`);

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(
      'Enter numbers separated by comma (e.g. 1, 3) or "A" for all [default: A]: ',
      (raw) => {
        rl.close();
        const input = raw.trim().toLowerCase();
        if (!input || input === 'a' || input === 'all') {
          resolve(clients.map((c) => c.id));
          return;
        }
        if (input === 'q' || input === 'quit' || input === 'exit') {
          resolve([]);
          return;
        }

        const selectedIds = new Set<string>();
        const parts = input.split(/[\s,]+/);

        for (const part of parts) {
          const num = parseInt(part, 10);
          if (!isNaN(num) && num >= 1 && num <= clients.length) {
            selectedIds.add(clients[num - 1]!.id);
            continue;
          }
          const lower = part.toLowerCase();
          if (lower === 'antigravity' || lower === 'gemini') {
            selectedIds.add('gemini_cli');
            continue;
          }
          const found = clients.find(
            (c) =>
              c.id.toLowerCase() === lower ||
              c.displayName.toLowerCase().includes(lower),
          );
          if (found) {
            selectedIds.add(found.id);
          }
        }

        if (selectedIds.size === 0) {
          log.warn('No valid agents selected.');
          resolve([]);
        } else {
          resolve(Array.from(selectedIds));
        }
      },
    );
  });
}

const BANNER_ART = [
  ' ███████╗ ██╗  ██╗  ██████╗  ██████╗  ██████╗   ██████╗   ██████╗',
  ' ██╔════╝ ╚██╗██╔╝ ██╔═══██╗ ██╔══██╗ ██╔══██╗ ██╔═══██╗ ██╔════╝',
  ' █████╗    ╚███╔╝  ██║   ██║ ██████╔╝ ██████╔╝ ██║   ██║ ██║     ',
  ' ██╔══╝    ██╔██╗  ██║   ██║ ██╔═══╝  ██╔══██╗ ██║   ██║ ██║     ',
  ' ███████╗ ██╔╝ ██╗ ╚██████╔╝ ██║      ██║  ██║ ╚██████╔╝ ╚██████╗',
  ' ╚══════╝ ╚═╝  ╚═╝  ╚═════╝  ╚═╝      ╚═╝  ╚═╝  ╚═════╝   ╚═════╝',
];

function printBanner() {
  const colors = [pc.cyan, pc.cyan, pc.blue, pc.blue, pc.blue, pc.blue];
  console.log('');
  BANNER_ART.forEach((line, i) => {
    console.log(colors[i] ? colors[i](line) : line);
  });
  console.log(
    `\n  ${pc.bold('Native Windows x64 Reverse Engineering & Instrumentation')} ${pc.dim(`v${VERSION}`)}\n` +
      `  ${pc.dim('One CLI and MCP server for thread hijacking, function detours, and memory inspection.')}\n`,
  );
}

function printHelp() {
  console.log(`
${pc.bold('exoproc')} ${pc.dim(`v${VERSION}`)} - Native Windows x64 Reverse Engineering & Instrumentation
One CLI and MCP server for thread hijacking, function detours, and memory inspection.

Usage:
  exoproc <command> [options]

Core Commands:
  setup              Configure AI agents with Exoproc MCP server & skills
                     (Claude Code, Cursor, Windsurf, Claude Desktop, Antigravity, Cline, Zed)
  mcp                Run the Model Context Protocol (MCP) server
                     (standard stdio transport for AI agents and IDEs)
  doctor, status     Inspect host environment and agent configurations

Diagnostics & Tools:
  ps, list-processes List active processes on host / target system
  windows            List visible desktop windows & child edit controls
  screenshot [path]  Capture desktop or window screenshot (PNG)
  compile <code|file> Compile C source to x86_64 machine code / shellcode
  exec <code>        Execute C-style Win32 code snippet (--pid <pid> for remote)
  run <script.ts>    Execute automation or diagnostics script

Global Options:
  --help, -h         Show this help message
  --version, -v      Show Exoproc version

Examples:
  exoproc setup                      Interactive agent configuration
  exoproc setup --yes                Auto-approve all detected agents
  exoproc mcp                        Start MCP server in stdio mode
  exoproc ps                         List running processes
  exoproc windows                    Inspect desktop windows
  exoproc compile -e "return 42;"    Compile C snippet into shellcode
  exoproc screenshot screen.png      Capture desktop screenshot
`);
}

// Guard against EPIPE when piping stdout (e.g. `exoproc ps | head -n 5`)
process.stdout.on('error', (err: any) => {
  if (err?.code === 'EPIPE') {
    process.exit(0);
  }
});

export async function cli(
  args: string[] = process.argv.slice(2),
): Promise<void> {
  const cmd = args[0];
  const isJson = args.includes('--json');

  if (cmd === '--help' || cmd === '-h' || cmd === 'help') {
    printHelp();
    return;
  }

  if (cmd === '--version' || cmd === '-v' || cmd === 'version') {
    if (isJson) {
      console.log(JSON.stringify({ version: VERSION }));
    } else {
      console.log(`exoproc v${VERSION}`);
    }
    return;
  }

  if (cmd === 'mcp' || cmd === '--mcp') {
    const { main: runMcp } = await import('exoproc-mcp');
    process.argv = [process.argv[0]!, process.argv[1]!, ...args.slice(1)];
    await runMcp();
    return;
  }

  if (!cmd || cmd === 'setup') {
    const isAll = args.includes('--all');
    const yes = args.includes('--yes') || args.includes('-y') || isAll;
    const dryRun = args.includes('--dry-run');
    const skillOnly = args.includes('--skill-only');
    const dev = args.includes('--dev') || args.includes('--local');

    let clients: string[] | undefined;
    const clientIdx = args.findIndex((a) => a === '--client' || a === '-c');
    if (clientIdx !== -1 && args[clientIdx + 1]) {
      const cArg = args[clientIdx + 1]!.toLowerCase();
      if (cArg === 'antigravity' || cArg === 'gemini') {
        clients = ['gemini_cli'];
      } else {
        clients = [cArg];
      }
    }

    if (!isJson) {
      printBanner();
      intro(`${pc.bold('EXOPROC setup')} ${pc.dim(`v${VERSION}`)}`);
    }

    // Interactive client selection when not specified on command line:
    if (!clients && !yes && !isJson) {
      const ctx = createSetupContext({ dev });
      const detected = detectClients(ctx);
      const detectedIds = new Set(
        detected.filter((d) => d.detected).map((d) => d.client.id),
      );

      clients = await promptSelectClients(SUPPORTED_CLIENTS, detectedIds);
      if (clients.length === 0) {
        cancel('Setup cancelled. No configurations were changed.');
        return;
      }
    } else if (!isJson) {
      log.step('Detecting installed AI agents and IDEs...');
    }

    const s = !isJson ? spinner() : null;
    s?.start('Configuring AI agent integrations...');

    const summary = await runSetup({
      yes: true,
      dryRun,
      clients,
      skillOnly,
      dev,
    });

    s?.stop('Configuration complete');

    if (isJson) {
      console.log(JSON.stringify(summary, null, 2));
      return;
    }

    if (summary.configured.length > 0) {
      for (const c of summary.configured) {
        log.success(`Configured MCP server for ${pc.cyan(c)}`);
      }
    }

    if (summary.alreadyCurrent.length > 0) {
      for (const c of summary.alreadyCurrent) {
        log.info(`Already configured: ${pc.dim(c)}`);
      }
    }

    if (summary.skillsInstalled.length > 0) {
      note(summary.skillsInstalled.join('\n'), 'Agent Skills Installed');
    }

    if (summary.failed.length > 0) {
      for (const f of summary.failed) {
        log.error(`Failed ${pc.red(f.client)}: ${f.error}`);
      }
    }

    outro(
      `${pc.green('Setup complete!')} Restart your configured AI agents to load Exoproc tools.`,
    );
    return;
  }

  if (cmd === 'doctor' || cmd === 'status') {
    const report = runDoctor();
    if (isJson) {
      console.log(JSON.stringify(report, null, 2));
      return;
    }

    intro(
      `${pc.bold('EXOPROC doctor')} ${pc.dim(`v${VERSION}`)}\n` +
        `${pc.dim('│  Host Platform : ')}${report.platform} (${report.arch})\n` +
        `${pc.dim('│  Bun Version   : ')}${report.bunVersion}`,
    );

    log.step(pc.bold('Detected AI Agents'));
    if (report.detectedAgents.length === 0) {
      log.info(pc.dim('(none detected in default paths)'));
    } else {
      for (const a of report.detectedAgents) {
        if (a.configured) {
          log.success(
            `${a.name.padEnd(25)} ${pc.green('[configured]')}\n   ${pc.dim(`Config: ${a.configPath}`)}`,
          );
        } else {
          log.warn(
            `${a.name.padEnd(25)} ${pc.yellow('[not configured]')}\n   ${pc.dim(`Run: exoproc setup`)}`,
          );
        }
      }
    }

    log.step(pc.bold('Binary Dependencies (SHA-1 / SHA-256)'));
    if (!report.dependencies || report.dependencies.length === 0) {
      log.info(pc.dim('(no external dependencies configured)'));
    } else {
      for (const dep of report.dependencies) {
        if (dep.status === 'verified') {
          const shaPreview = dep.actualSha1
            ? ` ${pc.dim(`(SHA-1: ${dep.actualSha1.slice(0, 8)}...)`)}`
            : '';
          log.success(
            `${dep.name.padEnd(30)} ${pc.green('[verified]')}${shaPreview}`,
          );
        } else if (dep.status === 'mismatch') {
          log.error(
            `${dep.name.padEnd(30)} ${pc.red('[CHECKSUM MISMATCH]')}\n` +
              `   ${pc.dim(`Expected: ${dep.expectedSha1}`)}\n` +
              `   ${pc.dim(`Actual:   ${dep.actualSha1}`)}`,
          );
        } else {
          log.info(
            `${dep.name.padEnd(30)} ${pc.dim('[not cached] (will download on-demand)')}`,
          );
        }
      }
    }

    if (report.overallStatus === 'healthy') {
      outro(`Overall Status: ${pc.green(pc.bold('HEALTHY'))}`);
    } else if (report.overallStatus === 'warning') {
      outro(`Overall Status: ${pc.yellow(pc.bold('WARNING'))}`);
    } else {
      outro(`Overall Status: ${pc.red(pc.bold('ERROR'))}`);
    }

    if (report.messages.length > 0) {
      for (const m of report.messages) {
        console.log(`  ${pc.yellow('!')} ${m}`);
      }
      console.log();
    }
    return;
  }

  if (cmd === 'ps' || cmd === 'list-processes') {
    const { commandPs } = await import('./commands/ps.js');
    await commandPs({ json: isJson });
    return;
  }

  if (cmd === 'windows' || cmd === 'list-windows') {
    const { commandWindows } = await import('./commands/windows.js');
    await commandWindows({ json: isJson });
    return;
  }

  if (cmd === 'screenshot') {
    let outputPath: string | undefined;
    let pid: number | undefined;
    let title: string | undefined;

    for (let i = 1; i < args.length; i++) {
      const a = args[i]!;
      if (a === '--pid' && args[i + 1]) pid = parseInt(args[++i]!, 10);
      else if (a === '--title' && args[i + 1]) title = args[++i];
      else if (!a.startsWith('-')) outputPath = a;
    }

    const { commandScreenshot } = await import('./commands/screenshot.js');
    await commandScreenshot({ outputPath, pid, title });
    return;
  }

  if (cmd === 'compile') {
    let source = '';
    for (let i = 1; i < args.length; i++) {
      const a = args[i]!;
      if (
        (a === '-e' || a === '--eval' || a === '-s' || a === '--source') &&
        args[i + 1]
      ) {
        source = args[++i]!;
      } else if (!a.startsWith('-')) {
        source = a;
      }
    }
    if (!source) {
      console.error('Error: specify a C source file or -e "source code"');
      process.exit(1);
    }
    const { commandCompile } = await import('./commands/compile.js');
    await commandCompile({ codeOrPath: source, json: isJson });
    return;
  }

  if (cmd === 'exec') {
    let code = '';
    let pid: number | undefined;
    for (let i = 1; i < args.length; i++) {
      const a = args[i]!;
      if (a === '--pid' && args[i + 1]) pid = parseInt(args[++i]!, 10);
      else if (!a.startsWith('-')) code = a;
    }
    if (!code) {
      console.error('Error: specify code string to execute');
      process.exit(1);
    }
    const { commandExec } = await import('./commands/exec.js');
    await commandExec({ code, pid, json: isJson });
    return;
  }

  if (cmd === 'run') {
    const script = args[1];
    if (!script) {
      console.error('Error: specify script path to run');
      process.exit(1);
    }
    const { commandRun } = await import('./commands/run.js');
    await commandRun(script);
    return;
  }

  console.error(
    `Unknown command: "${cmd}". Run "exoproc --help" for available commands.`,
  );
  process.exit(1);
}

if (import.meta.main) {
  cli().catch((err) => {
    console.error('Exoproc CLI error:', err);
    process.exit(1);
  });
}
