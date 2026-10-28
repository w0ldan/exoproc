import type { CpuStepResult } from './types.js';
import {
  getGlobalWin64Machine,
  type Win32ConsoleStdio,
  type Win64Machine,
  type Win64Process,
  type Win64Thread,
} from './win64-machine.js';
import { CMD_EXIT_REQUEST } from '../bin/cmd.js';
import type { NodeHostBridge } from './node-host-bridge.js';

const CMD_PATH = 'C:\\Windows\\System32\\cmd.exe';

export interface CommandExecutionResult {
  readonly command: string;
  readonly exitCode: number;
  readonly screenText: string;
  readonly steps: readonly CpuStepResult[];
}

/**
 * Host-side console bridge for the compiled cmd.exe process.
 *
 * This class does not dispatch commands. It only queues console input,
 * signals cmd.exe's stdin object and pumps the machine's scheduler until
 * everything settles again. Parsing, PATH resolution and child creation
 * follow the guest cmd.exe -> CreateProcessA -> loader path.
 *
 * Driving through the scheduler (rather than stepping `mainThread` directly)
 * matters once a command line is itself `cmd` -- cmd.exe now waits for its
 * child (see `bin/cmd.ts`), so the thread actually blocked reading the next
 * line is whichever nested cmd.exe is currently foreground, not necessarily
 * this session's own main thread. Signaling the shared stdin object wakes
 * whichever thread is really registered on it; the pump then runs it (and,
 * transitively, whatever it resumes) to the next settle point.
 */
export class Win32CommandPrompt {
  public readonly process: Win64Process;
  public readonly mainThreadId: number;
  private readonly machine: Win64Machine;
  private readonly mainThread: Win64Thread;
  private readonly stdinObjectId: number;
  private closed = false;
  private latestSteps: CpuStepResult[] = [];
  private lastExitCode = 0;

  constructor(
    machine: Win64Machine = getGlobalWin64Machine(),
    stdio: Win32ConsoleStdio = machine.createConsoleStdio(),
  ) {
    this.machine = machine;
    this.stdinObjectId = stdio.stdin.objectId;
    this.process = machine.createProcess(
      {
        image: 'cmd.exe',
        path: CMD_PATH,
      },
      {
        console: stdio.console,
        stdio,
      },
    );
    const image = machine.programs.get(CMD_PATH);
    if (!image) {
      throw new Error(`${CMD_PATH} is missing from the virtual disk`);
    }
    const loaded = machine.programs.load(this.process, image);
    this.mainThread = this.process.createThread(
      'cmd.exe main thread',
      loaded.entryPoint,
      [
        loaded.mainArguments.argc,
        loaded.mainArguments.argv,
        loaded.mainArguments.envp,
      ],
    );
    this.mainThreadId = this.mainThread.tid;
    this.machine.scheduler.enqueue(this.mainThread);
    this.pumpUntilSettled();
  }

  public get screenText(): string {
    return this.process.console.screenText;
  }

  public get isClosed(): boolean {
    return this.closed;
  }

  /** Exposes only what host-side CLI scripts actually need from `machine` -- waiting for pending Node child processes -- without giving them the whole (still `private`) machine. */
  public get nodeHostBridge(): NodeHostBridge | null {
    return this.machine.nodeHostBridge;
  }

  public execute(commandLine: string): CommandExecutionResult {
    if (this.closed) {
      throw new Error('cmd.exe has already exited');
    }

    const submitted = commandLine.replace(/[\r\n]+$/g, '');
    this.process.console.queueInput(`${submitted}\r\n`);
    this.machine.scheduler.signalObject(this.stdinObjectId);
    this.pumpUntilSettled();

    this.lastExitCode =
      this.process.lastChildExitCode === CMD_EXIT_REQUEST
        ? 0
        : this.process.lastChildExitCode;
    this.process.environment.set('ERRORLEVEL', this.lastExitCode.toString());

    return {
      command: submitted.trim(),
      exitCode: this.lastExitCode,
      screenText: this.screenText,
      steps: this.latestSteps,
    };
  }

  private pumpUntilSettled(): void {
    this.latestSteps = [];
    this.machine.pumpScheduler((_thread, result) => {
      this.latestSteps.push(result);
    });
    if (this.mainThread.state === 'terminated') {
      this.closed = true;
    }
  }
}
