import { AbstractCallableMemoryAccessor } from 'bun-xffi';

export class AsyncLock {
  private promise = Promise.resolve();

  async acquire(): Promise<() => void> {
    let release = () => {};
    const next = new Promise<void>((resolve) => {
      release = resolve;
    });
    const current = this.promise;
    this.promise = current.then(() => next);
    await current;
    return release;
  }
}

export abstract class AbstractProxyThread extends AbstractCallableMemoryAccessor {
  public _lock = new AsyncLock();

  constructor() {
    super(-1);
  }

  public async acquire(): Promise<() => void> {
    return this._lock.acquire();
  }

  public as<T extends AbstractProxyThread>(clazz: {
    from(source: AbstractProxyThread): T;
  }): T {
    return clazz.from(this);
  }

  protected onAttach(_source: AbstractProxyThread): void {
    // Hook for subclasses
  }
}
