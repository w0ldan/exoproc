import { CType, type Win32Dll } from './types.js';

/**
 * Kernel32 Native Definitions
 */
export const Kernel32Definitions = {
  GetLastError: { args: [], returns: CType.DWORD },
  CreateFileA: {
    args: [
      'cstring',
      CType.DWORD,
      CType.DWORD,
      CType.LPVOID,
      CType.DWORD,
      CType.DWORD,
      CType.HANDLE,
    ],
    returns: CType.HANDLE,
  },
  WriteFile: {
    args: [CType.HANDLE, CType.ptr, CType.DWORD, CType.ptr, CType.LPVOID],
    returns: CType.BOOL,
  },
  ReadFile: {
    args: [CType.HANDLE, CType.LPVOID, CType.DWORD, CType.ptr, CType.LPVOID],
    returns: CType.BOOL,
  },
  ReadProcessMemory: {
    args: [CType.HANDLE, CType.ptr, CType.LPVOID, CType.SIZE_T, CType.ptr],
    returns: CType.BOOL,
  },
  WriteProcessMemory: {
    args: [CType.HANDLE, CType.LPVOID, CType.ptr, CType.SIZE_T, CType.ptr],
    returns: CType.BOOL,
  },
  VirtualAlloc: {
    args: [CType.LPVOID, CType.SIZE_T, CType.DWORD, CType.DWORD],
    returns: CType.LPVOID,
  },
  VirtualAllocEx: {
    args: [CType.HANDLE, CType.LPVOID, CType.SIZE_T, CType.DWORD, CType.DWORD],
    returns: CType.LPVOID,
  },
  VirtualFree: {
    args: [CType.LPVOID, CType.SIZE_T, CType.DWORD],
    returns: CType.BOOL,
  },
  VirtualFreeEx: {
    args: [CType.HANDLE, CType.LPVOID, CType.SIZE_T, CType.DWORD],
    returns: CType.BOOL,
  },
  VirtualProtect: {
    args: [CType.LPVOID, CType.SIZE_T, CType.DWORD, CType.LPDWORD],
    returns: CType.BOOL,
  },
  VirtualProtectEx: {
    args: [
      CType.HANDLE,
      CType.LPVOID,
      CType.SIZE_T,
      CType.DWORD,
      CType.LPDWORD,
    ],
    returns: CType.BOOL,
  },
  VirtualQuery: {
    args: [CType.ptr, CType.ptr, CType.SIZE_T],
    returns: CType.SIZE_T,
  },
  VirtualQueryEx: {
    args: [CType.HANDLE, CType.ptr, CType.ptr, CType.SIZE_T],
    returns: CType.SIZE_T,
  },
  GetCurrentThread: { args: [], returns: CType.HANDLE },
  GetCurrentThreadId: { args: [], returns: CType.DWORD },
  GetThreadId: { args: [CType.HANDLE], returns: CType.DWORD },
  OpenThread: {
    args: [CType.DWORD, CType.BOOL, CType.DWORD],
    returns: CType.HANDLE,
  },
  SuspendThread: { args: [CType.HANDLE], returns: CType.DWORD },
  ResumeThread: { args: [CType.HANDLE], returns: CType.DWORD },
  GetExitCodeThread: {
    args: [CType.HANDLE, CType.LPDWORD],
    returns: CType.BOOL,
  },
  GetThreadContext: {
    args: [CType.HANDLE, CType.ptr],
    returns: CType.BOOL,
  },
  SetThreadContext: {
    args: [CType.HANDLE, CType.ptr],
    returns: CType.BOOL,
  },
  GetCurrentProcess: { args: [], returns: CType.HANDLE },
  GetCurrentProcessId: { args: [], returns: CType.DWORD },
  GetProcessId: { args: [CType.HANDLE], returns: CType.DWORD },
  OpenProcess: {
    args: [CType.DWORD, CType.BOOL, CType.DWORD],
    returns: CType.HANDLE,
  },
  TerminateProcess: {
    args: [CType.HANDLE, CType.UINT],
    returns: CType.BOOL,
  },
  CreateProcessA: {
    args: [
      CType.ptr,
      CType.ptr,
      CType.ptr,
      CType.ptr,
      CType.BOOL,
      CType.DWORD,
      CType.LPVOID,
      CType.ptr,
      CType.ptr,
      CType.ptr,
    ],
    returns: CType.BOOL,
  },
  CreateProcessW: {
    args: [
      CType.ptr,
      CType.ptr,
      CType.ptr,
      CType.ptr,
      CType.BOOL,
      CType.DWORD,
      CType.LPVOID,
      CType.ptr,
      CType.ptr,
      CType.ptr,
    ],
    returns: CType.BOOL,
  },
  DuplicateHandle: {
    args: [
      CType.HANDLE,
      CType.HANDLE,
      CType.HANDLE,
      CType.ptr,
      CType.DWORD,
      CType.BOOL,
      CType.DWORD,
    ],
    returns: CType.BOOL,
  },
  CreateFileMappingA: {
    args: [
      CType.HANDLE,
      CType.ptr,
      CType.DWORD,
      CType.DWORD,
      CType.DWORD,
      CType.ptr,
    ],
    returns: CType.HANDLE,
  },
  CreateFileMappingW: {
    args: [
      CType.HANDLE,
      CType.ptr,
      CType.DWORD,
      CType.DWORD,
      CType.DWORD,
      CType.ptr,
    ],
    returns: CType.HANDLE,
  },
  OpenFileMappingA: {
    args: [CType.DWORD, CType.BOOL, CType.ptr],
    returns: CType.HANDLE,
  },
  MapViewOfFile: {
    args: [CType.HANDLE, CType.DWORD, CType.DWORD, CType.DWORD, CType.SIZE_T],
    returns: CType.LPVOID,
  },
  UnmapViewOfFile: { args: [CType.LPVOID], returns: CType.BOOL },
  CloseHandle: { args: [CType.HANDLE], returns: CType.BOOL },
  Sleep: { args: [CType.DWORD], returns: CType.void },
  WaitForSingleObject: {
    args: [CType.HANDLE, CType.DWORD],
    returns: CType.DWORD,
  },
  WaitForMultipleObjects: {
    args: [CType.DWORD, CType.ptr, CType.BOOL, CType.DWORD],
    returns: CType.DWORD,
  },
  CreateEventA: {
    args: [CType.ptr, CType.BOOL, CType.BOOL, CType.cstring],
    returns: CType.HANDLE,
  },
  SetEvent: { args: [CType.HANDLE], returns: CType.BOOL },
  GetExitCodeProcess: {
    args: [CType.HANDLE, CType.ptr],
    returns: CType.BOOL,
  },
  GetModuleHandleW: { args: ['cwstring'], returns: CType.HMODULE },
  GetModuleHandleA: { args: [CType.cstring], returns: CType.HMODULE },
  GetModuleHandleExW: {
    args: [CType.DWORD, 'cwstring', CType.ptr],
    returns: CType.BOOL,
  },
  GetModuleHandleExA: {
    args: [CType.DWORD, CType.cstring, CType.ptr],
    returns: CType.BOOL,
  },
  GetProcAddress: {
    args: [CType.HMODULE, CType.cstring],
    returns: CType.ptr,
  },
  CreateThread: {
    args: [
      CType.ptr,
      CType.SIZE_T,
      CType.ptr,
      CType.LPVOID,
      CType.DWORD,
      CType.LPDWORD,
    ],
    returns: CType.HANDLE,
  },
  CreateRemoteThread: {
    args: [
      CType.HANDLE,
      CType.ptr,
      CType.SIZE_T,
      CType.ptr,
      CType.LPVOID,
      CType.DWORD,
      CType.LPDWORD,
    ],
    returns: CType.HANDLE,
  },
  TerminateThread: {
    args: [CType.HANDLE, CType.DWORD],
    returns: CType.BOOL,
  },
  ExitThread: { args: [CType.DWORD], returns: CType.void },
  LoadLibraryA: { args: [CType.cstring], returns: CType.HMODULE },
  LoadLibraryW: { args: ['cwstring'], returns: CType.HMODULE },
  LoadLibraryExW: {
    args: ['cwstring', CType.HANDLE, CType.DWORD],
    returns: CType.HMODULE,
  },
  FreeLibrary: { args: [CType.HMODULE], returns: CType.BOOL },
  CreateToolhelp32Snapshot: {
    args: [CType.DWORD, CType.DWORD],
    returns: CType.HANDLE,
  },
  Process32FirstW: { args: [CType.HANDLE, CType.ptr], returns: CType.BOOL },
  Process32First: { args: [CType.HANDLE, CType.ptr], returns: CType.BOOL },
  Process32NextW: { args: [CType.HANDLE, CType.ptr], returns: CType.BOOL },
  Process32Next: { args: [CType.HANDLE, CType.ptr], returns: CType.BOOL },
  Module32FirstW: { args: [CType.HANDLE, CType.ptr], returns: CType.BOOL },
  Module32First: { args: [CType.HANDLE, CType.ptr], returns: CType.BOOL },
  Module32NextW: { args: [CType.HANDLE, CType.ptr], returns: CType.BOOL },
  Module32Next: { args: [CType.HANDLE, CType.ptr], returns: CType.BOOL },
  Thread32First: { args: [CType.HANDLE, CType.ptr], returns: CType.BOOL },
  Thread32Next: { args: [CType.HANDLE, CType.ptr], returns: CType.BOOL },
  Heap32ListFirst: { args: [CType.HANDLE, CType.ptr], returns: CType.BOOL },
  Heap32ListNext: { args: [CType.HANDLE, CType.ptr], returns: CType.BOOL },
  Heap32First: {
    args: [CType.ptr, CType.DWORD, CType.SIZE_T],
    returns: CType.BOOL,
  },
  Heap32Next: { args: [CType.ptr], returns: CType.BOOL },
  IsWow64Process: { args: [CType.HANDLE, CType.ptr], returns: CType.BOOL },
  GetProcessHeap: { args: [], returns: CType.HANDLE },
  HeapCreate: {
    args: [CType.DWORD, CType.SIZE_T, CType.SIZE_T],
    returns: CType.HANDLE,
  },
  HeapDestroy: { args: [CType.HANDLE], returns: CType.BOOL },
  HeapAlloc: {
    args: [CType.HANDLE, CType.DWORD, CType.SIZE_T],
    returns: CType.LPVOID,
  },
  HeapFree: {
    args: [CType.HANDLE, CType.DWORD, CType.LPVOID],
    returns: CType.BOOL,
  },
  HeapReAlloc: {
    args: [CType.HANDLE, CType.DWORD, CType.LPVOID, CType.SIZE_T],
    returns: CType.LPVOID,
  },
  HeapSize: {
    args: [CType.HANDLE, CType.DWORD, CType.LPVOID],
    returns: CType.SIZE_T,
  },
  GetCurrentDirectoryW: {
    args: [CType.DWORD, CType.ptr],
    returns: CType.DWORD,
  },
  GetCurrentDirectoryA: {
    args: [CType.DWORD, CType.ptr],
    returns: CType.DWORD,
  },
  SetCurrentDirectoryA: {
    args: [CType.cstring],
    returns: CType.BOOL,
  },
  SetCurrentDirectoryW: {
    args: [CType.cwstring],
    returns: CType.BOOL,
  },
  GetEnvironmentVariableA: {
    args: [CType.cstring, CType.ptr, CType.DWORD],
    returns: CType.DWORD,
  },
  GetEnvironmentVariableW: {
    args: [CType.cwstring, CType.ptr, CType.DWORD],
    returns: CType.DWORD,
  },
  SetEnvironmentVariableA: {
    args: [CType.cstring, CType.cstring],
    returns: CType.BOOL,
  },
  SetEnvironmentVariableW: {
    args: [CType.cwstring, CType.cwstring],
    returns: CType.BOOL,
  },
  FindFirstFileA: {
    args: [CType.cstring, CType.ptr],
    returns: CType.HANDLE,
  },
  FindNextFileA: {
    args: [CType.HANDLE, CType.ptr],
    returns: CType.BOOL,
  },
  FindClose: {
    args: [CType.HANDLE],
    returns: CType.BOOL,
  },
  SearchPathA: {
    args: [
      CType.cstring,
      CType.cstring,
      CType.cstring,
      CType.DWORD,
      CType.ptr,
      CType.ptr,
    ],
    returns: CType.DWORD,
  },
  ExitProcess: { args: [CType.UINT], returns: CType.void },
  GetStdHandle: { args: [CType.DWORD], returns: CType.HANDLE },
  SetStdHandle: {
    args: [CType.DWORD, CType.HANDLE],
    returns: CType.BOOL,
  },
  GetConsoleMode: {
    args: [CType.HANDLE, CType.LPDWORD],
    returns: CType.BOOL,
  },
  SetConsoleMode: {
    args: [CType.HANDLE, CType.DWORD],
    returns: CType.BOOL,
  },
  FillConsoleOutputCharacterA: {
    args: [CType.HANDLE, CType.uchar, CType.DWORD, CType.DWORD, CType.LPDWORD],
    returns: CType.BOOL,
  },
  FillConsoleOutputAttribute: {
    args: [CType.HANDLE, CType.WORD, CType.DWORD, CType.DWORD, CType.LPDWORD],
    returns: CType.BOOL,
  },
  SetConsoleTextAttribute: {
    args: [CType.HANDLE, CType.WORD],
    returns: CType.BOOL,
  },
  SetConsoleCursorPosition: {
    args: [CType.HANDLE, CType.DWORD],
    returns: CType.BOOL,
  },
  CreatePipe: {
    args: [CType.ptr, CType.ptr, CType.ptr, CType.DWORD],
    returns: CType.BOOL,
  },
  SetHandleInformation: {
    args: [CType.HANDLE, CType.DWORD, CType.DWORD],
    returns: CType.BOOL,
  },
  CreateFileW: {
    args: [
      CType.cwstring,
      CType.DWORD,
      CType.DWORD,
      CType.LPVOID,
      CType.DWORD,
      CType.DWORD,
      CType.HANDLE,
    ],
    returns: CType.HANDLE,
  },
};

export const Kernel32Dll = {
  name: 'kernel32',
  knownToLinker: true,
  definitions: Kernel32Definitions,
} as const satisfies Win32Dll;
