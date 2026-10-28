import type { Win64MachineSnapshot } from 'win32-simulate';
import type { SnapshotMetaDto } from '../../common/channels';

/**
 * IndexedDB-backed permanent storage for named VM snapshots
 * (`Win64Machine.snapshot()` results, see `vm-snapshots.ts`). Lives
 * entirely in `apps/docs` -- the engine package stays unaware IndexedDB
 * (or any browser storage) exists at all.
 *
 * This is the *only* thing in the whole app that persists across a page
 * reload on its own -- the workspace filesystem itself doesn't (see
 * `workspace.ts`'s doc comment); a snapshot is the sole save point.
 * IndexedDB fits "an arbitrary, growing/shrinking set of named blobs,
 * listed/created/deleted over the app's whole lifetime" naturally via its
 * own object-store/index/cursor primitives, and every operation here is
 * reached only through async IPC handlers anyway, so there's no reason to
 * reach for anything with a synchronous-access story. IndexedDB's storage
 * is `structuredClone`-based, so `Win64MachineSnapshot`'s actual shape
 * (`Uint8Array`, `Map`, `bigint`, nested plain objects) needs zero
 * conversion.
 */

const DB_NAME = 'exoproc-vm-snapshots';
const STORE_NAME = 'snapshots';
const DB_VERSION = 1;

interface SnapshotRecord extends SnapshotMetaDto {
  readonly blob: Win64MachineSnapshot;
}

export class SnapshotStore {
  private constructor(private readonly db: IDBDatabase) {}

  public static open(): Promise<SnapshotStore> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const store = request.result.createObjectStore(STORE_NAME, {
          keyPath: 'id',
        });
        store.createIndex('createdAt', 'createdAt');
      };
      request.onsuccess = () => resolve(new SnapshotStore(request.result));
      request.onerror = () =>
        reject(request.error ?? new Error('IndexedDB açılamadı.'));
    });
  }

  public async create(
    name: string,
    blob: Win64MachineSnapshot,
    warnings: readonly string[],
  ): Promise<SnapshotMetaDto> {
    const record: SnapshotRecord = {
      id: crypto.randomUUID(),
      name,
      createdAt: Date.now(),
      warnings,
      blob,
    };
    await this.run('readwrite', (store) => store.add(record));
    return {
      id: record.id,
      name: record.name,
      createdAt: record.createdAt,
      warnings: record.warnings,
    };
  }

  public list(): Promise<readonly SnapshotMetaDto[]> {
    return new Promise((resolve, reject) => {
      const results: SnapshotMetaDto[] = [];
      const request = this.db
        .transaction(STORE_NAME, 'readonly')
        .objectStore(STORE_NAME)
        .index('createdAt')
        .openCursor();
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) {
          resolve(results);
          return;
        }
        const record = cursor.value as SnapshotRecord;
        results.push({
          id: record.id,
          name: record.name,
          createdAt: record.createdAt,
          warnings: record.warnings,
        });
        cursor.continue();
      };
      request.onerror = () =>
        reject(request.error ?? new Error('Snapshot listesi okunamadı.'));
    });
  }

  public get(id: string): Promise<Win64MachineSnapshot | undefined> {
    return new Promise((resolve, reject) => {
      const request = this.db
        .transaction(STORE_NAME, 'readonly')
        .objectStore(STORE_NAME)
        .get(id);
      request.onsuccess = () =>
        resolve((request.result as SnapshotRecord | undefined)?.blob);
      request.onerror = () =>
        reject(
          request.error ?? new Error(`"${id}" kimlikli snapshot okunamadı.`),
        );
    });
  }

  public delete(id: string): Promise<void> {
    return this.run('readwrite', (store) => store.delete(id));
  }

  private run(
    mode: IDBTransactionMode,
    op: (store: IDBObjectStore) => IDBRequest,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(STORE_NAME, mode);
      op(transaction.objectStore(STORE_NAME));
      transaction.oncomplete = () => resolve();
      transaction.onerror = () =>
        reject(transaction.error ?? new Error('IndexedDB işlemi başarısız.'));
    });
  }
}
