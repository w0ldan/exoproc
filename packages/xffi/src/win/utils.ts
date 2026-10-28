import {
  type ICallableMemoryAccessor,
  type ISyncCallableMemoryAccessor,
} from '../iaccessor.js';
import { type AddressLike } from '../pointer.js';
import { resolveAddress, alignUp } from '../ffi.js';
import { GetModuleHandleExFlag } from './defines.js';
import { Kernel32Impl } from './kernel32.js';
import { MsvcrtLibrary } from './msvcrt.js';
import { User32Library } from './user32.js';
import { NtdllImpl } from './ntdll.js';
import { read } from 'bun:ffi';

/**
 * IMAGE_SECTION_HEADER characteristics flag for writable sections.
 */
const IMAGE_SCN_MEM_WRITE = 0x80000000;

/**
 * Cached writable scratch address found in kernel32.dll section padding.
 * Since kernel32.dll is mapped at the same base address in every process
 * (ASLR is per-boot, not per-process), this only needs to be computed once.
 */
let cachedScratchAddress: number | null = null;

/**
 * Finds a writable 8-byte scratch address in the section padding of kernel32.dll.
 * PE sections are aligned to SectionAlignment (typically 0x1000), so there is
 * usually slack space between the end of a section's raw data and the next
 * section boundary. We look for writable sections and pick padding bytes
 * at the tail end of such a section.
 *
 * This address is safe to use as an output parameter (e.g. phModule for
 * GetModuleHandleExA) because it's writable and the 8 bytes at the end
 * of section padding are effectively unused.
 */
function findKernel32ScratchAddress(): number {
  if (cachedScratchAddress !== null) return cachedScratchAddress;

  const kernel32Base = Number(
    resolveAddress(Kernel32Impl.GetModuleHandleA('kernel32.dll')),
  );
  if (!kernel32Base || kernel32Base === 0) {
    throw new Error('Failed to get kernel32.dll base address');
  }

  // Call RtlImageNtHeader to get pointer to IMAGE_NT_HEADERS
  const ntHeaderPtr = Number(
    resolveAddress(NtdllImpl.RtlImageNtHeader(kernel32Base)),
  );
  if (!ntHeaderPtr || ntHeaderPtr === 0) {
    throw new Error('RtlImageNtHeader returned null for kernel32.dll');
  }

  // IMAGE_NT_HEADERS64 layout:
  //   0x00: DWORD Signature (4 bytes)
  //   0x04: IMAGE_FILE_HEADER (20 bytes)
  //     0x04: WORD Machine
  //     0x06: WORD NumberOfSections
  //     ...
  //   0x18: IMAGE_OPTIONAL_HEADER64 (starts at offset 0x18)
  //     0x38 from optional header start: DWORD SectionAlignment (offset 0x50 from NT headers)

  const fileHeaderOffset = ntHeaderPtr + 4; // past Signature
  const numberOfSections = read.u16((fileHeaderOffset + 2) as any);
  const sizeOfOptionalHeader = read.u16((fileHeaderOffset + 16) as any);
  const sectionAlignment = read.u32((ntHeaderPtr + 0x18 + 0x20) as any); // OptionalHeader.SectionAlignment

  // Section headers start right after optional header
  const sectionHeadersStart = fileHeaderOffset + 20 + sizeOfOptionalHeader;

  // IMAGE_SECTION_HEADER is 40 bytes each:
  //   0x08: DWORD VirtualSize
  //   0x0C: DWORD VirtualAddress
  //   0x24: DWORD Characteristics
  const SECTION_HEADER_SIZE = 40;

  for (let i = 0; i < numberOfSections; i++) {
    const sectionBase = sectionHeadersStart + i * SECTION_HEADER_SIZE;
    const virtualSize = read.u32((sectionBase + 0x08) as any);
    const virtualAddress = read.u32((sectionBase + 0x0c) as any);
    const characteristics = read.u32((sectionBase + 0x24) as any);

    if (!(characteristics & IMAGE_SCN_MEM_WRITE)) continue;

    // Calculate aligned size of the section
    const alignedSize = alignUp(virtualSize, sectionAlignment);
    const paddingSize = alignedSize - virtualSize;

    // We need at least 8 bytes of padding
    if (paddingSize < 8) continue;

    // Use the last 8 bytes of the padding area (least likely to be touched)
    const scratchAddr =
      kernel32Base + virtualAddress + virtualSize + (paddingSize - 8);
    cachedScratchAddress = scratchAddr;
    return scratchAddr;
  }

  throw new Error('No suitable writable section padding found in kernel32.dll');
}

/**
 * Checks if a specific module (by its base address) is loaded in the target process represented by the accessor.
 * Performs a remote GetModuleHandleExA call with FROM_ADDRESS flag in the target process context.
 *
 * Uses a pre-computed writable scratch address in kernel32.dll's section padding as the
 * output parameter, completely avoiding any alloc/free calls.
 */
export async function isModuleLoadedInProcess(
  accessor: ICallableMemoryAccessor,
  moduleAddress: AddressLike,
): Promise<boolean> {
  try {
    const targetAddress = resolveAddress(moduleAddress);
    const scratchAddr = findKernel32ScratchAddress();

    const flags =
      GetModuleHandleExFlag.UNCHANGED_REFCOUNT |
      GetModuleHandleExFlag.FROM_ADDRESS;
    const success = await accessor.call(
      Kernel32Impl.GetModuleHandleExA,
      flags,
      targetAddress,
      scratchAddr,
    );
    return Number(success) !== 0;
  } catch {
    return false;
  }
}

/** Synchronous twin of {@link isModuleLoadedInProcess}. */
export function isModuleLoadedInProcessSync(
  accessor: ISyncCallableMemoryAccessor,
  moduleAddress: AddressLike,
): boolean {
  try {
    const targetAddress = resolveAddress(moduleAddress);
    const scratchAddr = findKernel32ScratchAddress();

    const flags =
      GetModuleHandleExFlag.UNCHANGED_REFCOUNT |
      GetModuleHandleExFlag.FROM_ADDRESS;
    const success = accessor.callSync(
      Kernel32Impl.GetModuleHandleExA,
      flags,
      targetAddress,
      scratchAddr,
    );
    return Number(success) !== 0;
  } catch {
    return false;
  }
}

export interface CoreModulesStatus {
  ntdll: boolean;
  kernel32: boolean;
  kernelbase: boolean;
  msvcrt: boolean;
  user32: boolean;
}

/**
 * High-level helper to quickly verify presence of essential system DLLs inside a target process.
 */
export async function verifyCoreModules(
  accessor: ICallableMemoryAccessor,
): Promise<CoreModulesStatus> {
  if (accessor.isLocal) {
    return {
      ntdll: true,
      kernel32: true,
      kernelbase: true,
      msvcrt: true,
      user32: true,
    };
  }
  const msvcrtBase = MsvcrtLibrary.baseAddress;
  const user32Base = User32Library.baseAddress;

  return {
    ntdll: true,
    kernel32: true,
    kernelbase: true,
    msvcrt: !msvcrtBase.isNull()
      ? await isModuleLoadedInProcess(accessor, msvcrtBase)
      : false,
    user32: !user32Base.isNull()
      ? await isModuleLoadedInProcess(accessor, user32Base)
      : false,
  };
}

/** Synchronous twin of {@link verifyCoreModules}. */
export function verifyCoreModulesSync(
  accessor: ISyncCallableMemoryAccessor,
): CoreModulesStatus {
  if (accessor.isLocal) {
    return {
      ntdll: true,
      kernel32: true,
      kernelbase: true,
      msvcrt: true,
      user32: true,
    };
  }
  const msvcrtBase = MsvcrtLibrary.baseAddress;
  const user32Base = User32Library.baseAddress;

  return {
    ntdll: true,
    kernel32: true,
    kernelbase: true,
    msvcrt: !msvcrtBase.isNull()
      ? isModuleLoadedInProcessSync(accessor, msvcrtBase)
      : false,
    user32: !user32Base.isNull()
      ? isModuleLoadedInProcessSync(accessor, user32Base)
      : false,
  };
}
