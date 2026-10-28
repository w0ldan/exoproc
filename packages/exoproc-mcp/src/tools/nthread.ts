import {
  type CTypeOrString,
  createCFunction,
  Kernel32Impl,
  resolveAddress,
  win32Symbols,
} from 'bun-xffi';
import { resolveAccessor } from './session.js';

function resolveTargetAddress(options: {
  address?: string | number | bigint;
  moduleName?: string;
  functionName?: string;
}): bigint {
  if (options.moduleName && options.functionName) {
    const hMod =
      Kernel32Impl.GetModuleHandleA(options.moduleName) ||
      Kernel32Impl.LoadLibraryA(options.moduleName);
    if (hMod && Number(hMod) !== 0) {
      const pProc = Kernel32Impl.GetProcAddress(hMod, options.functionName);
      if (pProc && Number(pProc) !== 0) {
        return BigInt(resolveAddress(pProc));
      }
    }
  }

  const raw = options.address ?? options.functionName;
  if (raw === undefined || raw === null) {
    throw new Error(
      'Missing target function address or symbol name for nthread_call.',
    );
  }
  if (typeof raw === 'bigint') return raw;
  if (typeof raw === 'number') return BigInt(raw);

  const str = String(raw).trim();
  if (/^-?0x[0-9a-fA-F]+$/.test(str) || /^\d+$/.test(str)) {
    return BigInt(str);
  }

  if (str.includes('!')) {
    const [mod, fn] = str.split('!', 2);
    if (mod && fn) {
      const hMod =
        Kernel32Impl.GetModuleHandleA(mod) || Kernel32Impl.LoadLibraryA(mod);
      if (hMod && Number(hMod) !== 0) {
        const pProc = Kernel32Impl.GetProcAddress(hMod, fn);
        if (pProc && Number(pProc) !== 0) {
          return BigInt(resolveAddress(pProc));
        }
      }
    }
  }

  const known =
    win32Symbols[str] ?? win32Symbols[`${str}W`] ?? win32Symbols[`${str}A`];
  if (known && known.ptr) {
    return BigInt(known.ptr);
  }

  for (const dll of [
    'kernel32.dll',
    'user32.dll',
    'ntdll.dll',
    'gdi32.dll',
    'msvcrt.dll',
    'advapi32.dll',
  ]) {
    const hMod =
      Kernel32Impl.GetModuleHandleA(dll) || Kernel32Impl.LoadLibraryA(dll);
    if (hMod && Number(hMod) !== 0) {
      const pProc =
        Kernel32Impl.GetProcAddress(hMod, str) ||
        Kernel32Impl.GetProcAddress(hMod, `${str}W`) ||
        Kernel32Impl.GetProcAddress(hMod, `${str}A`);
      if (pProc && Number(pProc) !== 0) {
        return BigInt(resolveAddress(pProc));
      }
    }
  }

  throw new Error(`Unable to resolve function address from "${str}"`);
}

export async function nthreadCall(options: {
  session?: string | number;
  pid?: number;
  address?: string | number | bigint;
  moduleName?: string;
  functionName?: string;
  args?: (number | string | bigint)[];
  returnType?: string;
}): Promise<{
  success: boolean;
  pid: number;
  targetAddress: string;
  result: string | number;
}> {
  const sessionKey = options.session ?? options.pid;
  if (sessionKey === undefined || sessionKey === null) {
    throw new Error('Missing session or pid for nthread_call.');
  }
  const addr = resolveTargetAddress(options);
  const acc = await resolveAccessor(sessionKey);

  const rawArgs = (options.args || []).map((a) => {
    if (typeof a === 'string') {
      if (/^-?0x[0-9a-fA-F]+$/.test(a.trim())) return BigInt(a.trim());
      return a;
    }
    return BigInt(a);
  });

  const argTypes: CTypeOrString[] = rawArgs.map(() => 'ptr');
  const retType: CTypeOrString = options.returnType || 'ptr';

  const fn = createCFunction(
    addr,
    [retType, argTypes],
    () => {
      throw new Error('remote target must not be called locally');
    },
    'remote_call',
  );
  const res = await acc.call(fn, ...rawArgs);

  return {
    success: true,
    pid: acc.processId,
    targetAddress: `0x${addr.toString(16)}`,
    result: typeof res === 'bigint' ? `0x${res.toString(16)}` : res,
  };
}
