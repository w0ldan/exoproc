import { CType, type Win32Dll } from './types.js';

/**
 * Winsock 2 ABI definitions.
 *
 * These declarations describe the native signatures only. Network policy is
 * supplied by the consumer; @exoproc/simulate intentionally implements a
 * loopback-only transport.
 */
export const Ws2_32Definitions = {
  WSAStartup: {
    args: [CType.WORD, CType.ptr],
    returns: CType.INT,
  },
  WSACleanup: {
    args: [],
    returns: CType.INT,
  },
  WSAGetLastError: {
    args: [],
    returns: CType.INT,
  },
  socket: {
    args: [CType.INT, CType.INT, CType.INT],
    returns: CType.SOCKET,
  },
  closesocket: {
    args: [CType.SOCKET],
    returns: CType.INT,
  },
  bind: {
    args: [CType.SOCKET, CType.ptr, CType.INT],
    returns: CType.INT,
  },
  send: {
    args: [CType.SOCKET, CType.ptr, CType.INT, CType.INT],
    returns: CType.INT,
  },
  recv: {
    args: [CType.SOCKET, CType.ptr, CType.INT, CType.INT],
    returns: CType.INT,
  },
  sendto: {
    args: [CType.SOCKET, CType.ptr, CType.INT, CType.INT, CType.ptr, CType.INT],
    returns: CType.INT,
  },
  recvfrom: {
    args: [CType.SOCKET, CType.ptr, CType.INT, CType.INT, CType.ptr, CType.ptr],
    returns: CType.INT,
  },
  inet_addr: {
    args: [CType.cstring],
    returns: CType.ULONG,
  },
  htons: {
    args: [CType.USHORT],
    returns: CType.USHORT,
  },
  htonl: {
    args: [CType.ULONG],
    returns: CType.ULONG,
  },
  ntohs: {
    args: [CType.USHORT],
    returns: CType.USHORT,
  },
  ntohl: {
    args: [CType.ULONG],
    returns: CType.ULONG,
  },
} as const;

export const Ws2_32Dll = {
  name: 'ws2_32',
  knownToLinker: true,
  definitions: Ws2_32Definitions,
} as const satisfies Win32Dll;
