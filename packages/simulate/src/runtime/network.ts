import type { Win64SocketObject, Win64SocketPacket } from './types.js';

export const AF_INET = 2;
export const SOCK_RAW = 3;
export const IPPROTO_ICMP = 1;

export const INVALID_SOCKET = 0xffffffffffffffffn;
export const SOCKET_ERROR = -1n;

export const WSANOTINITIALISED = 10093;
export const WSAEAFNOSUPPORT = 10047;
export const WSAESOCKTNOSUPPORT = 10044;
export const WSAEPROTONOSUPPORT = 10043;
export const WSAENOTSOCK = 10038;
export const WSAEHOSTUNREACH = 10065;
export const WSAEWOULDBLOCK = 10035;
export const WSAEINVAL = 10022;
export const WSAENOTCONN = 10057;

export interface ParsedIPv4Address {
  readonly bytes: Uint8Array;
  readonly winsockValue: number;
}

export function parseIPv4Address(value: string): ParsedIPv4Address | undefined {
  const parts = value.split('.');
  if (parts.length !== 4) return undefined;
  const octets = parts.map((part) => {
    if (!/^(0|[1-9]\d{0,2})$/.test(part)) return undefined;
    const octet = Number(part);
    return octet <= 0xff ? octet : undefined;
  });
  if (octets.some((octet) => octet === undefined)) {
    return undefined;
  }
  const bytes = Uint8Array.from(octets as number[]);
  return {
    bytes,
    // inet_addr returns a network-order value. When this u32 is stored by a
    // little-endian Win64 guest, memory contains the dotted-quad byte order.
    winsockValue:
      (bytes[0]! | (bytes[1]! << 8) | (bytes[2]! << 16) | (bytes[3]! << 24)) >>>
      0,
  };
}

export function isLoopbackIPv4(address: Uint8Array): boolean {
  return address.length === 4 && address[0] === 127;
}

/**
 * Closed, in-memory IPv4 transport.
 *
 * It has no host socket, fetch or DNS dependency. The only routable network is
 * 127.0.0.0/8. ICMP echo requests are answered synchronously by placing an
 * echo reply into the originating virtual socket's receive queue.
 */
export class Win32LoopbackNetwork {
  public sendIcmpEcho(
    socket: Win64SocketObject,
    destination: Uint8Array,
    request: Uint8Array,
  ): boolean {
    if (!isLoopbackIPv4(destination)) return false;
    const reply = request.slice();
    if (reply.length > 0 && reply[0] === 8) {
      reply[0] = 0;
    }
    socket.receiveQueue.push({
      payload: reply,
      address: destination.slice(),
    });
    return true;
  }

  public receive(socket: Win64SocketObject): Win64SocketPacket | undefined {
    return socket.receiveQueue.shift();
  }
}
