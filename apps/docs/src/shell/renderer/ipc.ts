import {
  deserializeError,
  type MainMessage,
  type RequestId,
} from '../common/protocol';

/** Unsubscribes a listener registered with {@link ShellConnection.on}. */
export type Unsubscribe = () => void;

interface PendingCall {
  readonly resolve: (value: unknown) => void;
  readonly reject: (reason: Error) => void;
}

/**
 * Renderer side of the boundary: correlates replies back to their calls
 * and fans `event` pushes out to listeners.
 *
 * Calls made before the main process signals readiness are queued rather
 * than rejected -- booting a worker is asynchronous, and leaking that
 * timing into every caller would be a worse API than waiting.
 */
export class ShellConnection {
  private readonly pending = new Map<RequestId, PendingCall>();
  private readonly listeners = new Map<string, Set<(payload: never) => void>>();
  private readonly queued: (() => void)[] = [];
  private nextId: RequestId = 1;
  private ready = false;
  private readyResolvers: (() => void)[] = [];
  private disposed = false;

  public constructor(private readonly worker: Worker) {
    worker.addEventListener('message', this.handleMessage);
    // Without these, a main process that dies on load -- a syntax error, a
    // throwing module, a payload that will not clone -- leaves every call
    // pending forever, which surfaces as a UI that simply never responds.
    worker.addEventListener('error', this.handleFailure);
    worker.addEventListener('messageerror', this.handleFailure);
  }

  public whenReady(): Promise<void> {
    if (this.ready) return Promise.resolve();
    return new Promise((resolve) => this.readyResolvers.push(resolve));
  }

  public invoke<TResult>(
    channel: string,
    ...args: readonly unknown[]
  ): Promise<TResult> {
    if (this.disposed) {
      return Promise.reject(new Error('Shell connection has been disposed.'));
    }

    return new Promise<TResult>((resolve, reject) => {
      const id = this.nextId++;
      this.pending.set(id, {
        resolve: resolve as (value: unknown) => void,
        reject,
      });

      const send = () =>
        this.worker.postMessage({ kind: 'invoke', id, channel, args });
      if (this.ready) send();
      else this.queued.push(send);
    });
  }

  public on<TPayload>(
    channel: string,
    listener: (payload: TPayload) => void,
  ): Unsubscribe {
    let listeners = this.listeners.get(channel);
    if (!listeners) {
      listeners = new Set();
      this.listeners.set(channel, listeners);
    }
    listeners.add(listener as (payload: never) => void);

    return () => {
      const current = this.listeners.get(channel);
      if (!current) return;
      current.delete(listener as (payload: never) => void);
      if (current.size === 0) this.listeners.delete(channel);
    };
  }

  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.worker.removeEventListener('message', this.handleMessage);
    this.worker.removeEventListener('error', this.handleFailure);
    this.worker.removeEventListener('messageerror', this.handleFailure);

    this.rejectAllPending(new Error('Shell connection has been disposed.'));
    this.listeners.clear();
    this.queued.length = 0;

    this.worker.terminate();
  }

  private rejectAllPending(reason: Error): void {
    for (const call of this.pending.values()) call.reject(reason);
    this.pending.clear();
  }

  private readonly handleFailure = (event: Event): void => {
    const detail =
      event instanceof ErrorEvent && event.message
        ? event.message
        : event.type === 'messageerror'
          ? 'a message could not be deserialized'
          : 'unknown error';
    this.rejectAllPending(new Error(`Main process failed: ${detail}`));
  };

  private readonly handleMessage = (event: MessageEvent): void => {
    const message = event.data as MainMessage | undefined;
    if (!message) return;

    if (message.kind === 'ready') {
      this.ready = true;
      for (const send of this.queued.splice(0)) send();
      for (const resolve of this.readyResolvers.splice(0)) resolve();
      return;
    }

    if (message.kind === 'reply') {
      const call = this.pending.get(message.id);
      if (!call) return;
      this.pending.delete(message.id);
      if (message.error) call.reject(deserializeError(message.error));
      else call.resolve(message.result);
      return;
    }

    const listeners = this.listeners.get(message.channel);
    if (!listeners) return;
    // Copied so a listener unsubscribing mid-dispatch cannot skip a sibling.
    for (const listener of [...listeners]) {
      (listener as (payload: unknown) => void)(message.payload);
    }
  };
}
