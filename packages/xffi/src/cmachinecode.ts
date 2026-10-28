import { cjitopen } from './cjit.js';
import { type CTypeOrString } from './types.js';
import { createDynamicCFunction, type DynamicCFunction } from './cfunction.js';
import {
  type ICallableMemoryAccessor,
  type ISyncMemoryAccessor,
  type ISyncCallableMemoryAccessor,
} from './iaccessor.js';
import { type CCallResult } from './types.js';

export interface CMachineCode extends DynamicCFunction {
  shouldCloneForAccessor(accessor: any): boolean;
  machineCode(accessor: ICallableMemoryAccessor): Promise<number>;
  machineCodeSync(accessor: ISyncMemoryAccessor): number;
  cloneForAddress(address: number): CMachineCode;
  call(accessor: ICallableMemoryAccessor, ...args: any[]): Promise<CCallResult>;
  callSync(accessor: ISyncCallableMemoryAccessor, ...args: any[]): CCallResult;
}

export interface MachineCodeOptions {
  source: string;
  returns?: CTypeOrString;
  args?: CTypeOrString[];
}

/**
 * Creates a `CMachineCode` wrapping a known address.
 *
 * Unlike `cmachinecode()` (which compiles C source), this wraps bytes that
 * already exist at `address` — e.g. a stub in a system DLL, machineCode
 * already written to a local allocation, or a remote address post-injection.
 *
 * `shouldCloneForAccessor` returns `false` — no injection needed, the bytes
 * are already at `address`.
 *
 * @param callable  Optional callable to use for local invocation. Defaults to
 *                  a `BunCFunction` binding on `address`. Pass a throwing
 *                  function for remote-only machineCode that must not be called
 *                  from the local process.
 */
export function createMachineCode(
  address: number,
  sig: [CTypeOrString, CTypeOrString[]],
  bytes: number[] | Uint8Array,
  callable?: CallableFunction,
): CMachineCode {
  const bArray = bytes instanceof Uint8Array ? Array.from(bytes) : bytes;
  const wrapper = createDynamicCFunction(
    address,
    sig,
    bArray.length,
    bArray,
    callable,
  ) as any;

  wrapper.shouldCloneForAccessor = (_accessor: any): boolean => false;

  wrapper.machineCode = async (
    _accessor: ICallableMemoryAccessor,
  ): Promise<number> => address;
  wrapper.machineCodeSync = (_accessor: ISyncMemoryAccessor): number => address;

  wrapper.cloneForAddress = (addr: number): CMachineCode => {
    if (addr === address) return wrapper as CMachineCode;
    return createMachineCode(addr, sig, bytes, callable);
  };

  wrapper.call = function (
    accessor: ICallableMemoryAccessor,
    ...argsList: any[]
  ) {
    return accessor.call(wrapper, ...argsList);
  };
  wrapper.callSync = function (
    accessor: ISyncCallableMemoryAccessor,
    ...argsList: any[]
  ) {
    return accessor.callSync(wrapper, ...argsList);
  };

  return wrapper as CMachineCode;
}

/**
 * Wraps bytes that need remote injection before they're callable there.
 *
 * Unlike `createMachineCode()` (whose `shouldCloneForAccessor` always returns
 * `false` -- the "bytes already live at `address`" case), this always returns
 * `true`, so `accessor.machineCode()`/`machineCodeSync()` actually
 * allocate+write `bytes` into the target process instead of reporting
 * `address` back as-is, and `cloneForAddress()` hands back a
 * `createRemoteMachineCode()` wrapper for the concrete injected address.
 *
 * `address`/`callable` still describe local callability, same as
 * `createMachineCode()`: pass a real local address+symbol (as `cmachinecode()`
 * does with its `cjitopen`-compiled output below) to keep the bytes callable
 * in-process too; omit both (the default) for bytes with no local meaning at
 * all -- e.g. hand-assembled machine code for a different ABI than the host's
 * own -- which then throws if ever called directly instead of via an
 * accessor.
 */
export function createPendingMachineCode(
  sig: [CTypeOrString, CTypeOrString[]],
  bytes: number[] | Uint8Array,
  address: number = 0,
  callable?: CallableFunction,
): CMachineCode {
  const notLocallyCallable = (): never => {
    throw new Error(
      'This machineCode has no local address; inject it first via accessor.machineCode().',
    );
  };
  const wrapper = createMachineCode(
    address,
    sig,
    bytes,
    callable ?? notLocallyCallable,
  ) as any;

  wrapper.shouldCloneForAccessor = (_accessor: any): boolean => true;

  wrapper.machineCode = async (
    accessor: ICallableMemoryAccessor,
  ): Promise<number> => accessor.machineCode(wrapper);

  wrapper.machineCodeSync = (accessor: ISyncMemoryAccessor): number =>
    accessor.machineCodeSync(wrapper);

  wrapper.cloneForAddress = (remoteAddr: number): CMachineCode =>
    createRemoteMachineCode(remoteAddr, wrapper);

  return wrapper as CMachineCode;
}

/**
 * Modern dynamic MachineCode Builder that acts as a thin wrapper over cjitopen.
 * Compiles relocatable standalone bytecode entirely in-memory without any
 * file system operations.
 */
export function cmachinecode(options: MachineCodeOptions): CMachineCode {
  const returns = options.returns ?? 'void';
  const args = options.args ?? [];

  const jitLib = cjitopen(
    {
      machineCode: {
        source: options.source,
        returns: returns,
        args: args,
      },
    },
    {
      compileMode: 'machineCode',
    },
  );

  const shellSymbol = jitLib.symbols.machineCode as any;
  const bytes = Array.from<number>(Buffer.from(shellSymbol.bytes));

  const wrapper = createPendingMachineCode(
    [returns, args],
    bytes,
    shellSymbol,
    shellSymbol,
  ) as any;

  wrapper._jitLib = jitLib;

  // Unlike createPendingMachineCode's default (always needs remote
  // injection), this was already compiled by cjitopen and is sitting at a
  // real, directly-callable address in *this* process. So when the accessor
  // IS this process, that existing local address is already usable as-is --
  // only a genuinely different (remote) process needs the bytes copied over.
  wrapper.shouldCloneForAccessor = (accessor: any): boolean =>
    !accessor?.isLocal;

  return wrapper as CMachineCode;
}

export function createRemoteMachineCode(
  remoteAddress: number,
  localMachineCode: CMachineCode,
): CMachineCode {
  if (
    typeof localMachineCode.shouldCloneForAccessor === 'function' &&
    !localMachineCode.shouldCloneForAccessor(null)
  ) {
    return localMachineCode;
  }

  const throwingCallable = () => {
    throw new Error(
      'Remote machineCode execution requires a valid callable memory accessor as the first argument.',
    );
  };

  const wrapper = createMachineCode(
    remoteAddress,
    [localMachineCode.returns, Array.from(localMachineCode.args || [])] as [
      CTypeOrString,
      CTypeOrString[],
    ],
    localMachineCode.bytes,
    throwingCallable,
  ) as any;

  wrapper.localMachineCode = localMachineCode;

  wrapper.cloneForAddress = (addr: number): CMachineCode => {
    if (addr === remoteAddress) return wrapper as CMachineCode;
    return createRemoteMachineCode(addr, localMachineCode);
  };

  return wrapper as CMachineCode;
}
