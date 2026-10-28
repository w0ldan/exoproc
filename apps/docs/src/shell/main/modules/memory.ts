import { MemoryChannel } from '../../common/channels';
import { ipc } from '../ipc';
import { requireProcess } from './machine';
import { toMappingDto } from './snapshot';

/**
 * Reads and writes against a process's address space.
 *
 * Content is always fetched by explicit range. Listing regions returns
 * their shape only (`MappingDto` drops the backing buffer), so a heap
 * the size of a mapping never rides along with a request that only
 * wanted to know what exists.
 */
export function registerMemoryHandlers(): void {
  ipc.handle(
    MemoryChannel.read,
    (pid: number, address: bigint, length: number) =>
      // The engine returns a fresh copy, so nothing here aliases live
      // process memory once it crosses the boundary.
      requireProcess(pid).memory.read(address, length),
  );

  ipc.handle(
    MemoryChannel.write,
    (pid: number, address: bigint, bytes: Uint8Array) => {
      requireProcess(pid).memory.write(address, bytes);
    },
  );

  ipc.handle(MemoryChannel.listMappings, (pid: number) =>
    requireProcess(pid).memory.getMappings().map(toMappingDto),
  );

  ipc.handle(MemoryChannel.findMapping, (pid: number, address: bigint) => {
    const found = requireProcess(pid).memory.findMapping(address);
    return found ? toMappingDto(found) : undefined;
  });
}
