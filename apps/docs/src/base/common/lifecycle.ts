import type { Disposable as IDisposable } from './event';

/**
 * Grouping and combinator utilities for `Disposable`, analogous to VS
 * Code's `vs/base/common/lifecycle.ts`. `event.ts` only defines the
 * *interface* (`{ dispose(): void }`) -- this file is where the actual
 * bookkeeping lives.
 *
 * The workbench services in `src/workbench/services/**` (F5) each
 * accumulate several `window.exoproc.*.on...()` subscriptions; without
 * a `DisposableStore` every one of them would need its own hand-rolled
 * array of cleanup functions.
 */

export function toDisposable(fn: () => void): IDisposable {
  return { dispose: fn };
}

export function combinedDisposable(
  ...disposables: readonly IDisposable[]
): IDisposable {
  return toDisposable(() => {
    for (const disposable of disposables) disposable.dispose();
  });
}

/** A collection of disposables, disposed together. Safe to add to after disposal -- the addition is disposed immediately instead. */
export class DisposableStore implements IDisposable {
  private readonly items = new Set<IDisposable>();
  private disposed = false;

  public add<T extends IDisposable>(item: T): T {
    if (this.disposed) {
      item.dispose();
      return item;
    }
    this.items.add(item);
    return item;
  }

  public clear(): void {
    for (const item of [...this.items]) item.dispose();
    this.items.clear();
  }

  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.clear();
  }
}

/**
 * Base class for anything that owns disposable subscriptions. Subclasses
 * register cleanup via `this._register(...)` and get `dispose()` for
 * free; overriding `dispose()` to add extra work must call `super.
 * dispose()`.
 */
export abstract class Disposable implements IDisposable {
  private readonly store = new DisposableStore();

  protected _register<T extends IDisposable>(item: T): T {
    return this.store.add(item);
  }

  public dispose(): void {
    this.store.dispose();
  }
}
