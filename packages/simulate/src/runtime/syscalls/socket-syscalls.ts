import type { Win64Machine, Win64Process } from '../win64-machine.js';
import type { Win64SocketObject } from '../types.js';
import {
  AF_INET,
  INVALID_SOCKET,
  IPPROTO_ICMP,
  parseIPv4Address,
  SOCK_RAW,
  SOCKET_ERROR,
  WSAEAFNOSUPPORT,
  WSAEHOSTUNREACH,
  WSAEINVAL,
  WSAENOTCONN,
  WSAENOTSOCK,
  WSAEPROTONOSUPPORT,
  WSAESOCKTNOSUPPORT,
  WSAEWOULDBLOCK,
  WSANOTINITIALISED,
} from '../network.js';

export function registerSocketSyscalls(machine: Win64Machine): void {
  const fail = (
    process: Win64Process,
    error: number,
    result = SOCKET_ERROR,
  ) => {
    process.winsockLastError = error;
    return result;
  };

  const socketFor = (
    process: Win64Process,
    rawHandle: bigint,
  ): Win64SocketObject | undefined => {
    const object = machine.getHandleObject(process, rawHandle);
    return object?.kind === 'socket' ? object : undefined;
  };

  const swap16 = (value: number) =>
    ((value & 0xff) << 8) | ((value >>> 8) & 0xff);

  const swap32 = (value: number) =>
    (((value & 0xff) << 24) |
      ((value & 0xff00) << 8) |
      ((value >>> 8) & 0xff00) |
      ((value >>> 24) & 0xff)) >>>
    0;

  machine.registerHandler(
    'ws2_32.dll',
    'WSAStartup',
    (process, _thread, registers) => {
      const requestedVersion = Number(registers.RCX & 0xffffn);
      const major = requestedVersion & 0xff;
      if (major !== 2 || registers.RDX === 0n) {
        process.winsockLastError = WSAEINVAL;
        return BigInt(WSAEINVAL);
      }
      const version = Uint8Array.from([
        requestedVersion & 0xff,
        (requestedVersion >>> 8) & 0xff,
        0x02,
        0x02,
      ]);
      process.memory.write(registers.RDX, version);
      process.winsockStarted = true;
      process.winsockLastError = 0;
      return 0n;
    },
  );

  machine.registerHandler('ws2_32.dll', 'WSACleanup', (process) => {
    if (!process.winsockStarted) {
      return fail(process, WSANOTINITIALISED);
    }
    process.winsockStarted = false;
    process.winsockLastError = 0;
    return 0n;
  });

  machine.registerHandler('ws2_32.dll', 'WSAGetLastError', (process) =>
    BigInt(process.winsockLastError),
  );

  machine.registerHandler(
    'ws2_32.dll',
    'socket',
    (process, _thread, registers) => {
      if (!process.winsockStarted) {
        return fail(process, WSANOTINITIALISED, INVALID_SOCKET);
      }
      const family = Number(registers.RCX);
      const type = Number(registers.RDX);
      const protocol = Number(registers.R8);
      if (family !== AF_INET) {
        return fail(process, WSAEAFNOSUPPORT, INVALID_SOCKET);
      }
      if (type !== SOCK_RAW) {
        return fail(process, WSAESOCKTNOSUPPORT, INVALID_SOCKET);
      }
      if (protocol !== IPPROTO_ICMP) {
        return fail(process, WSAEPROTONOSUPPORT, INVALID_SOCKET);
      }
      process.winsockLastError = 0;
      return BigInt(
        process.allocateHandle({
          kind: 'socket',
          socketFamily: family,
          socketType: type,
          socketProtocol: protocol,
          receiveQueue: [],
        }),
      );
    },
  );

  machine.registerHandler(
    'ws2_32.dll',
    'closesocket',
    (process, _thread, registers) => {
      const socket = socketFor(process, registers.RCX);
      if (!socket) return fail(process, WSAENOTSOCK);
      process.handles.delete(Number(registers.RCX));
      process.winsockLastError = 0;
      return 0n;
    },
  );

  machine.registerHandler(
    'ws2_32.dll',
    'inet_addr',
    (process, _thread, registers) => {
      const requested = process.memory.readCString(registers.RCX);
      const parsed = parseIPv4Address(
        requested.toLowerCase() === 'localhost' ? '127.0.0.1' : requested,
      );
      if (!parsed) return 0xffffffffn;
      return BigInt(parsed.winsockValue);
    },
  );

  machine.registerHandler(
    'ws2_32.dll',
    'bind',
    (process, _thread, registers) => {
      if (!process.winsockStarted) {
        return fail(process, WSANOTINITIALISED);
      }
      const socket = socketFor(process, registers.RCX);
      if (!socket) return fail(process, WSAENOTSOCK);
      if (Number(registers.R8) < 8) {
        return fail(process, WSAEINVAL);
      }
      const sockaddr = process.memory.read(registers.RDX, 8);
      const family = new DataView(
        sockaddr.buffer,
        sockaddr.byteOffset,
        sockaddr.byteLength,
      ).getUint16(0, true);
      if (family !== AF_INET || sockaddr[4] !== 127) {
        return fail(process, WSAEHOSTUNREACH);
      }
      process.winsockLastError = 0;
      return 0n;
    },
  );

  for (const functionName of ['send', 'recv'] as const) {
    machine.registerHandler(
      'ws2_32.dll',
      functionName,
      (process, _thread, registers) => {
        if (!process.winsockStarted) {
          return fail(process, WSANOTINITIALISED);
        }
        if (!socketFor(process, registers.RCX)) {
          return fail(process, WSAENOTSOCK);
        }
        return fail(process, WSAENOTCONN);
      },
    );
  }

  for (const functionName of ['htons', 'ntohs'] as const) {
    machine.registerHandler(
      'ws2_32.dll',
      functionName,
      (_process, _thread, registers) => BigInt(swap16(Number(registers.RCX))),
    );
  }

  for (const functionName of ['htonl', 'ntohl'] as const) {
    machine.registerHandler(
      'ws2_32.dll',
      functionName,
      (_process, _thread, registers) => BigInt(swap32(Number(registers.RCX))),
    );
  }

  machine.registerHandler(
    'ws2_32.dll',
    'sendto',
    (process, _thread, registers) => {
      if (!process.winsockStarted) {
        return fail(process, WSANOTINITIALISED);
      }
      const socket = socketFor(process, registers.RCX);
      if (!socket) return fail(process, WSAENOTSOCK);
      const sockaddr = process.memory.readU64(registers.RSP + 0x28n);
      const sockaddrLength = Number(
        process.memory.readU64(registers.RSP + 0x30n),
      );
      if (sockaddr === 0n || sockaddrLength < 8) {
        return fail(process, WSAEINVAL);
      }
      const destination = process.memory.read(sockaddr, 8);
      const family = new DataView(
        destination.buffer,
        destination.byteOffset,
        destination.byteLength,
      ).getUint16(0, true);
      if (family !== AF_INET) {
        return fail(process, WSAEAFNOSUPPORT);
      }
      const address = destination.slice(4, 8);
      const request = process.memory.read(registers.RDX, Number(registers.R8));
      if (!machine.network.sendIcmpEcho(socket, address, request)) {
        return fail(process, WSAEHOSTUNREACH);
      }
      process.winsockLastError = 0;
      return BigInt(request.length);
    },
  );

  machine.registerHandler(
    'ws2_32.dll',
    'recvfrom',
    (process, _thread, registers) => {
      if (!process.winsockStarted) {
        return fail(process, WSANOTINITIALISED);
      }
      const socket = socketFor(process, registers.RCX);
      if (!socket) return fail(process, WSAENOTSOCK);
      const packet = machine.network.receive(socket);
      if (!packet) return fail(process, WSAEWOULDBLOCK);

      const length = Math.min(Number(registers.R8), packet.payload.length);
      process.memory.write(registers.RDX, packet.payload.slice(0, length));

      const from = process.memory.readU64(registers.RSP + 0x28n);
      const fromLength = process.memory.readU64(registers.RSP + 0x30n);
      if (from !== 0n && fromLength !== 0n) {
        const sockaddr = new Uint8Array(16);
        const view = new DataView(sockaddr.buffer);
        view.setUint16(0, AF_INET, true);
        sockaddr.set(packet.address, 4);
        process.memory.write(from, sockaddr);
        process.memory.writeU32(fromLength, sockaddr.length);
      }
      process.winsockLastError = 0;
      return BigInt(length);
    },
  );
}
