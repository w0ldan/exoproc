import { MinHook, type MinHookInstance } from 'bun-minhook';
import { resolveAccessor } from './session.js';

interface ActiveMinHookRecord {
  hook: MinHookInstance;
  pid: number;
  address: string;
  trampoline: string;
  originalBytes: string;
}

const activeMinHookManagers = new Map<number, MinHook>();
const activeMinHooks = new Map<string, ActiveMinHookRecord>();

function getMinHookManager(pid: number): MinHook {
  let manager = activeMinHookManagers.get(pid);
  if (!manager) {
    manager = new MinHook(pid);
    activeMinHookManagers.set(pid, manager);
  }
  return manager;
}

export function listHooks(): {
  minhooks: { pid: number; address: string; trampoline: string }[];
} {
  return {
    minhooks: Array.from(activeMinHooks.values()).map((h) => ({
      pid: h.pid,
      address: h.address,
      trampoline: h.trampoline,
    })),
  };
}

export async function installMinHook(options: {
  session?: string;
  targetAddress: string | number | bigint;
  detourAddress: string | number | bigint;
}): Promise<{
  success: boolean;
  type: 'minhook-5byte';
  pid: number;
  target: string;
  detour: string;
  trampoline: string;
}> {
  const target = BigInt(options.targetAddress);
  const detour = BigInt(options.detourAddress);
  const mem = await resolveAccessor(options.session);
  const pid = mem.processId;
  const manager = getMinHookManager(pid);

  const hook = await manager.create(mem, target as any);
  await hook.enable(detour as any);

  const key = `${pid}:0x${target.toString(16)}`;
  activeMinHooks.set(key, {
    hook,
    pid,
    address: `0x${target.toString(16)}`,
    trampoline: `0x${hook.trampoline.address.toString(16)}`,
    originalBytes: hook.originalBytes.toString('hex'),
  });

  return {
    success: true,
    type: 'minhook-5byte',
    pid,
    target: `0x${target.toString(16)}`,
    detour: `0x${detour.toString(16)}`,
    trampoline: `0x${hook.trampoline.address.toString(16)}`,
  };
}

export async function removeMinHook(options: {
  session?: string;
  targetAddress: string | number | bigint;
}): Promise<{ success: boolean; pid: number; target: string }> {
  const target = BigInt(options.targetAddress);
  const mem = await resolveAccessor(options.session);
  const pid = mem.processId;
  const key = `${pid}:0x${target.toString(16)}`;
  const record = activeMinHooks.get(key);

  if (!record) {
    throw new Error(
      `No active minhook found at 0x${target.toString(16)} in PID ${pid}`,
    );
  }

  const manager = getMinHookManager(pid);
  await manager.disable(mem, record.hook);
  await manager.destroy(mem, record.hook);
  activeMinHooks.delete(key);

  return {
    success: true,
    pid,
    target: record.address,
  };
}
