/**
 * The renderer's own copy of `packages/simulate/src/platform/common/
 * event.ts`, restated rather than imported.
 *
 * This is not duplication for its own sake: `src/base/**`, `src/platform/
 * **` and `src/workbench/**` may not import `simulate` at all
 * (see the `no-restricted-imports` boundary in `eslint.config.mjs`), and
 * that boundary is what guarantees the renderer cannot reach the
 * simulation engine even by accident. `Emitter`/`Event`/`Disposable` are
 * simple enough (33 lines in the original) that copying them once here
 * costs far less than the alternative of weakening the boundary to let
 * one shared file through it.
 */

export interface Disposable {
  dispose(): void;
}

export type Event<T> = (listener: (event: T) => void) => Disposable;

export const EventNone: Event<never> = () => ({ dispose: () => undefined });

export class Emitter<T> implements Disposable {
  private readonly listeners = new Set<(event: T) => void>();
  private disposed = false;

  public readonly event: Event<T> = (listener) => {
    if (this.disposed) return { dispose: () => undefined };
    this.listeners.add(listener);
    return {
      dispose: () => {
        this.listeners.delete(listener);
      },
    };
  };

  public fire(event: T): void {
    if (this.disposed) return;
    for (const listener of [...this.listeners]) listener(event);
  }

  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.listeners.clear();
  }
}
