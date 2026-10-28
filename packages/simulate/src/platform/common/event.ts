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
