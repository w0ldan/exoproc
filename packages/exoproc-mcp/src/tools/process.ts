import { exec, spawn } from 'node:child_process';
import { ToolhelpSnapshot } from 'bun-winapi';
import { ToolhelpSnapshotFlag } from 'bun-xffi';

export interface ProcessItem {
  pid: number;
  name: string;
  commandLine?: string;
}

export interface SpawnProcessOptions {
  command?: string;
  executable?: string;
  path?: string;
  args?: string[];
  detached?: boolean;
  cwd?: string;
}

export interface SpawnProcessResult {
  success: boolean;
  pid?: number;
  launcherPid?: number;
  message: string;
}

export interface ExecuteCommandOptions {
  command: string;
  timeoutMs?: number;
  cwd?: string;
}

export interface ExecuteCommandResult {
  success: boolean;
  stdout: string;
  stderr: string;
  exitCode: number;
}

/**
 * Lists all running processes on the Windows target.
 */
export async function listProcesses(): Promise<ProcessItem[]> {
  const snap = new ToolhelpSnapshot(ToolhelpSnapshotFlag.SNAPPROCESS);
  const list: ProcessItem[] = [];
  for (const p of snap.getProcesses()) {
    list.push({ pid: p.pid, name: p.name });
  }
  snap.close();
  return list;
}

/**
 * Spawns a process on the target system (e.g. notepad.exe, calc.exe, or any executable).
 */
export async function spawnProcess(
  options: SpawnProcessOptions,
): Promise<SpawnProcessResult> {
  const cmd = (
    options.command ??
    options.executable ??
    options.path ??
    ''
  ).trim();
  if (!cmd) {
    return {
      success: false,
      message: 'Missing command/executable to spawn.',
    };
  }

  const beforeProcs = await listProcesses().catch(() => [] as ProcessItem[]);
  const beforePids = new Set(beforeProcs.map((p) => p.pid));

  const detached = options.detached ?? true;
  const needsShell = /[|&><;]/.test(cmd);
  let spawnCmd = cmd;
  let spawnArgs = options.args ?? [];
  if (!needsShell && spawnArgs.length === 0 && /\s/.test(cmd)) {
    const parts = cmd.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) ?? [cmd];
    spawnCmd = parts[0]!.replace(/^["']|["']$/g, '');
    spawnArgs = parts.slice(1).map((a) => a.replace(/^["']|["']$/g, ''));
  }

  const child = spawn(spawnCmd, spawnArgs, {
    detached,
    cwd: options.cwd,
    stdio: detached ? 'ignore' : 'pipe',
    shell: needsShell,
  });

  if (detached && child.unref) {
    child.unref();
  }

  let resolvedPid = child.pid;
  const baseExe = cmd
    .split(/[\\/\s]+/)
    .filter(Boolean)[0]
    ?.replace(/^["']|["']$/g, '')
    .toLowerCase();
  const baseNoExe = baseExe?.replace(/\.exe$/i, '');

  if (baseNoExe && baseNoExe !== 'cmd') {
    for (let attempt = 0; attempt < 8; attempt++) {
      await new Promise((r) => setTimeout(r, 80));
      const afterProcs = await listProcesses().catch(() => [] as ProcessItem[]);
      const newMatch = afterProcs.find((p) => {
        if (beforePids.has(p.pid)) return false;
        const n = p.name.toLowerCase();
        return (
          n === `${baseNoExe}.exe` || n === baseExe || n.includes(baseNoExe)
        );
      });
      if (newMatch) {
        resolvedPid = newMatch.pid;
        break;
      }
    }
  }

  return {
    success: !!resolvedPid,
    pid: resolvedPid,
    ...(child.pid && child.pid !== resolvedPid
      ? { launcherPid: child.pid }
      : {}),
    message: resolvedPid
      ? `Successfully spawned "${cmd}" with PID ${resolvedPid}`
      : `Failed to spawn "${cmd}": No PID returned`,
  };
}

/**
 * Executes a shell command on the target system and captures stdout, stderr, and exit code.
 */
export async function executeCommand(
  options: ExecuteCommandOptions,
): Promise<ExecuteCommandResult> {
  return new Promise((resolve) => {
    exec(
      options.command,
      {
        timeout: options.timeoutMs ?? 15000,
        cwd: options.cwd,
      },
      (error, stdout, stderr) => {
        resolve({
          success: !error,
          stdout: stdout.toString(),
          stderr: stderr.toString(),
          exitCode: error
            ? typeof error.code === 'number'
              ? error.code
              : 1
            : 0,
        });
      },
    );
  });
}
