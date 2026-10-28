import type {
  Win64Machine,
  Win64Process,
  Win64Thread,
  X64Registers,
} from 'win32-simulate';

/**
 * Generic dispatch machinery for `node.dll!createJSProcess`/
 * `enterJSProcess`/`terminateJSProcess`, keyed by the *calling process's
 * own image name* rather than being hardwired to "always run a script".
 *
 * These three syscalls normally belong to `NodeHostBridge` (see
 * `packages/simulate/src/runtime/node-host-bridge.ts`), which spawns a
 * real host Node.js child process to run them -- something no browser
 * context can ever provide, so `machine.ts` disables it entirely
 * (`enableNodeHostBridge: false`). This module reimplements the exact
 * same guest-facing contract (verified against `NodeHostBridge`'s source
 * and the compiled `node.exe` guest program in `packages/simulate/src/
 * bin/node.ts`) with a browser-native backend, but generalizes it: rather
 * than being `node.exe`-specific, `enterJSProcess` looks up a callback by
 * `process.image`, so *any* compiled guest program that makes the same
 * three calls -- not just `node.exe` -- can have its own registered JS
 * behavior. `js-host-programs.ts` registers the two this app actually
 * uses (`node.exe`, `exoproc-ide.exe`); `compileJsHostProgram` (`@exoproc/
 * simulate`) is what compiles a new one.
 *
 * Contract, unchanged from `NodeHostBridge`:
 * - `createJSProcess()` -> `hProcess` (a kernel-object id, RAX).
 * - `enterJSProcess(hProcess, argc, argv)` (RCX/RDX/R8) -> exit code
 *   (RAX). Two-pass kernel-object reentry: the first call looks up the
 *   registered callback for `process.image`, runs it in the background,
 *   parks the calling thread (`thread.state = 'waiting'`,
 *   `scheduler.blockOnObject`), rewinds `RIP` by 7 bytes (the length of
 *   the `mov eax, imm32; syscall` thunk `program.invoke` compiles to) so
 *   the same syscall instruction re-executes once rescheduled, and
 *   returns `0n` (never observed -- the thread is already blocked). Once
 *   the callback's promise settles, the result is cached, the object is
 *   signaled, and `machine.pumpScheduler()` is called explicitly --
 *   required because that happens from a microtask outside the
 *   simulator's own step loop, so nothing else would advance the parked
 *   thread without it. The second call (same register values, reentered
 *   via the rewound `RIP`) finds the cached result and returns it.
 * - `terminateJSProcess(hProcess, exitCode)` (RCX/RDX) -> marks the
 *   kernel object signaled (a safety net) and returns `1n` unconditionally.
 */

export interface JsHostResult {
  readonly exitCode: number;
}

export type JsHostCallback = (
  process: Win64Process,
  argc: number,
  argvPointer: bigint,
) => Promise<JsHostResult>;

const callbacks = new Map<string, JsHostCallback>();

/** Case-insensitive, matching Windows image-name lookup elsewhere in the engine. */
export function registerJsHostProgram(
  imageName: string,
  callback: JsHostCallback,
): void {
  callbacks.set(imageName.toLowerCase(), callback);
}

interface PendingResult {
  readonly exitCode: number;
}

export function registerNodeSyscalls(machine: Win64Machine): void {
  const results = new Map<number, PendingResult>();

  machine.registerHandler('node.dll', 'createJSProcess', () => {
    const objectId = machine.createKernelObject({
      kind: 'nodeInvocation',
      signaled: false,
    });
    return BigInt(objectId);
  });

  machine.registerHandler(
    'node.dll',
    'enterJSProcess',
    (
      process: Win64Process,
      thread: Win64Thread,
      registers: X64Registers,
    ): bigint => {
      const objectId = Number(registers.RCX);
      const argc = Number(registers.RDX & 0xffffffffn);
      const argvPointer = registers.R8;

      const existing = results.get(objectId);
      if (existing) {
        results.delete(objectId);
        return BigInt(existing.exitCode >>> 0);
      }

      const callback = callbacks.get(process.image.toLowerCase());
      if (!callback) {
        process.console.write(
          new TextEncoder().encode(
            `node: "${process.image}" için kayıtlı bir JS işleyici yok.\r\n`,
          ),
        );
        return 1n;
      }

      callback(process, argc, argvPointer)
        .then((result) => complete(machine, results, objectId, result.exitCode))
        .catch((cause: unknown) => {
          const message =
            cause instanceof Error ? cause.message : String(cause);
          process.console.write(
            new TextEncoder().encode(`${process.image}: ${message}\r\n`),
          );
          complete(machine, results, objectId, 1);
        });

      thread.state = 'waiting';
      machine.scheduler.blockOnObject(thread, objectId);
      registers.RIP -= 7n;
      return 0n;
    },
  );

  machine.registerHandler(
    'node.dll',
    'terminateJSProcess',
    (
      _process: Win64Process,
      _thread: Win64Thread,
      registers: X64Registers,
    ): bigint => {
      const objectId = Number(registers.RCX);
      const object = machine.getKernelObject(objectId);
      if (object && object.kind === 'nodeInvocation') object.signaled = true;
      return 1n;
    },
  );
}

function complete(
  machine: Win64Machine,
  results: Map<number, PendingResult>,
  objectId: number,
  exitCode: number,
): void {
  results.set(objectId, { exitCode });
  const object = machine.getKernelObject(objectId);
  if (object && object.kind === 'nodeInvocation') object.signaled = true;
  machine.scheduler.signalObject(objectId);
  machine.pumpScheduler();
}

/** `argvPointer` is a guest array of `argc` pointers, each a null-terminated string. */
export function readArgv(
  process: Win64Process,
  argvPointer: bigint,
  argc: number,
): string[] {
  const args: string[] = [];
  for (let index = 0; index < argc; index += 1) {
    const pointer = process.memory.readU64(argvPointer + BigInt(index) * 8n);
    args.push(readCString(process, pointer));
  }
  return args;
}

function readCString(process: Win64Process, address: bigint): string {
  const bytes: number[] = [];
  let cursor = address;
  for (;;) {
    let byte: number;
    try {
      byte = process.memory.read(cursor, 1)[0]!;
    } catch {
      break;
    }
    if (byte === 0) break;
    bytes.push(byte);
    cursor += 1n;
  }
  return new TextDecoder().decode(Uint8Array.from(bytes));
}
