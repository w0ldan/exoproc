/// <reference lib="webworker" />

import {
  serializeError,
  type InvokeMessage,
  type MainMessage,
  type RendererMessage,
} from '../common/protocol';

/**
 * Main-process side of the boundary: a channel-name -> handler registry
 * plus the dispatcher that drains the port.
 *
 * Handlers are registered by the feature modules (`main/modules/*`) at
 * import time and the dispatcher is started once, from `main.ts`, after
 * every module has had its chance to register -- the same
 * register-then-serve ordering a desktop shell's main process uses.
 */

type Handler = (...args: never[]) => unknown;

const handlers = new Map<string, Handler>();

const workerScope = self as unknown as DedicatedWorkerGlobalScope;

function post(message: MainMessage): void {
  workerScope.postMessage(message);
}

export const ipc = {
  /** Answers `invoke` on `channel`. Registering twice is a bug, not a merge. */
  handle<TArgs extends readonly unknown[], TResult>(
    channel: string,
    handler: (...args: TArgs) => TResult | Promise<TResult>,
  ): void {
    if (handlers.has(channel)) {
      throw new Error(`IPC channel "${channel}" already has a handler.`);
    }
    handlers.set(channel, handler as Handler);
  },

  /** Pushes to the renderer without being asked (output, state changes). */
  send(channel: string, payload: unknown): void {
    post({ kind: 'event', channel, payload });
  },
};

async function dispatch(message: InvokeMessage): Promise<void> {
  const handler = handlers.get(message.channel);
  if (!handler) {
    post({
      kind: 'reply',
      id: message.id,
      error: serializeError(
        new Error(
          `No handler registered for IPC channel "${message.channel}".`,
        ),
      ),
    });
    return;
  }

  try {
    const result = await (handler as (...args: unknown[]) => unknown)(
      ...message.args,
    );
    post({ kind: 'reply', id: message.id, result });
  } catch (cause) {
    post({ kind: 'reply', id: message.id, error: serializeError(cause) });
  }
}

/** Begins draining the port. Call once, after all handlers are registered. */
export function startIpc(): void {
  workerScope.addEventListener('message', (event: MessageEvent) => {
    const message = event.data as RendererMessage | undefined;
    if (message?.kind !== 'invoke') return;
    void dispatch(message);
  });
}

/** Tells the renderer it may stop queueing and start calling. */
export function signalReady(): void {
  post({ kind: 'ready' });
}
