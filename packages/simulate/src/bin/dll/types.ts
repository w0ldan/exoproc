import type { Win32Dll } from 'win32-abi';
import type {
  Win32DllMainCompiler,
  Win32ExportBindingRegistry,
} from '../../runtime/win32-dlls.js';

/**
 * Binary-side implementation manifest for one simulated Win32 DLL.
 *
 * The ABI package owns names and signatures. This layer owns executable
 * bindings such as guest wrappers, forwarders and constant-return stubs.
 */
export interface Win32GuestDllSource {
  readonly source: Win32Dll;
  configure?(bindings: Win32ExportBindingRegistry): void;
  /**
   * Optional `DllMain`. Most DLLs in this simulator are purely synthetic
   * export surfaces and don't need one -- only msvcrt.dll uses this today,
   * to initialize its CRT heap once per process.
   */
  readonly dllMain?: Win32DllMainCompiler;
}
