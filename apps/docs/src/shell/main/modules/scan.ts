import {
  Win64MemoryScanner,
  decodeScanValue,
  writeScanValue,
  type Win64FirstScanOptions,
  type Win64NextScanOptions,
  type Win64ScanReport,
} from 'win32-simulate';
import {
  ScanChannel,
  type FirstScanOptions,
  type NextScanOptions,
  type ScanReportDto,
  type ScanStringEncoding,
  type ScanValue,
  type ScanValueType,
} from '../../common/channels';
import { ipc } from '../ipc';
import { getMachine, requireProcess } from './machine';

/**
 * Memory search, in the style of a live-value scanner.
 *
 * Unlike the other modules this one is *stateful*: a search is a
 * conversation. `first` establishes a candidate set and each `next`
 * narrows it, so the scanner object has to outlive a single request. It
 * is therefore kept here, one per process, rather than being rebuilt per
 * call -- rebuilding it would silently reset the user's narrowing.
 *
 * Payload size needs no special handling: the engine caps a report's
 * `results` and sets `truncated`, so even a scan matching millions of
 * addresses crosses as a bounded page plus a count.
 */

const scanners = new Map<number, Win64MemoryScanner>();

function getScanner(pid: number): Win64MemoryScanner {
  // Resolve the process first: it throws for a dead pid, which is also
  // the moment to drop a scanner still holding that process's state.
  const process = requireProcess(pid);

  const existing = scanners.get(pid);
  if (existing && existing.process === process) return existing;

  const created = new Win64MemoryScanner(process);
  scanners.set(pid, created);
  return created;
}

/** Drops scanners whose process is gone, so a long session cannot leak them. */
function pruneScanners(): void {
  const machine = getMachine();
  for (const pid of [...scanners.keys()]) {
    if (!machine.getProcess(pid)) scanners.delete(pid);
  }
}

function toReportDto(report: Win64ScanReport): ScanReportDto {
  return {
    type: report.type,
    valueSize: report.valueSize,
    total: report.total,
    // Each result is `{ bigint, ScanValue, ScanValue }` -- all clone-safe,
    // so the page passes through without re-encoding.
    results: report.results.map((result) => ({
      address: result.address,
      value: result.value,
      previousValue: result.previousValue,
    })),
    truncated: report.truncated,
  };
}

export function registerScanHandlers(): void {
  ipc.handle(ScanChannel.first, (pid: number, options: FirstScanOptions) => {
    pruneScanners();
    return toReportDto(
      getScanner(pid).firstScan(options as Win64FirstScanOptions),
    );
  });

  ipc.handle(ScanChannel.next, (pid: number, options: NextScanOptions) =>
    toReportDto(getScanner(pid).nextScan(options as Win64NextScanOptions)),
  );

  ipc.handle(ScanChannel.page, (pid: number, offset?: number, limit?: number) =>
    toReportDto(getScanner(pid).page(offset, limit)),
  );

  ipc.handle(ScanChannel.reset, (pid: number) => {
    getScanner(pid).reset();
  });

  ipc.handle(ScanChannel.readValue, (pid: number, address: bigint) =>
    getScanner(pid).readValue(address),
  );

  ipc.handle(
    ScanChannel.writeValue,
    (pid: number, address: bigint, value: ScanValue) => {
      getScanner(pid).writeValue(address, value);
    },
  );

  // Decodes/encodes with a caller-given type rather than the scanner's own
  // current one -- a pinned watch row must keep reading at the width it was
  // added with, independent of whatever the scanner has moved on to.
  ipc.handle(
    ScanChannel.readTypedValue,
    (
      pid: number,
      address: bigint,
      length: number,
      type: ScanValueType,
      encoding?: ScanStringEncoding,
    ) =>
      decodeScanValue(
        type,
        requireProcess(pid).memory.read(address, length),
        encoding,
      ),
  );

  ipc.handle(
    ScanChannel.writeTypedValue,
    (
      pid: number,
      address: bigint,
      type: ScanValueType,
      value: ScanValue,
      encoding?: ScanStringEncoding,
    ) => writeScanValue(requireProcess(pid), address, type, value, encoding),
  );

  // Freezing lives on the machine, not the scanner -- a frozen address
  // must survive `reset()`/a fresh search, same as it does today.
  ipc.handle(
    ScanChannel.freeze,
    (pid: number, address: bigint, bytes: Uint8Array) => {
      getMachine().freezeAddress(pid, address, bytes);
    },
  );

  ipc.handle(ScanChannel.unfreeze, (pid: number, address: bigint) => {
    getMachine().unfreezeAddress(pid, address);
  });

  ipc.handle(ScanChannel.isFrozen, (pid: number, address: bigint) =>
    getMachine().isAddressFrozen(pid, address),
  );

  ipc.handle(
    ScanChannel.frozenCount,
    (pid: number) =>
      getMachine()
        .getFrozenAddresses()
        .filter((frozen) => frozen.pid === pid).length,
  );
}
