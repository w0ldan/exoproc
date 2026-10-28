/**
 * Wire format between the renderer (browser main thread) and the main
 * process (a Web Worker).
 *
 * Deliberately tiny and transport-agnostic: nothing here knows it is
 * travelling over `postMessage`. The same three message shapes -- a
 * request/reply pair and a one-way push -- are what any desktop
 * application shell moves across its process boundary, so swapping the
 * transport later touches only `main/ipc.ts` and `renderer/ipc.ts`.
 */

export type RequestId = number;

/** Errors cannot cross a structured-clone boundary as `Error` instances. */
export interface SerializedError {
  readonly name: string;
  readonly message: string;
  readonly stack?: string;
}

/** renderer -> main: "run this and reply". */
export interface InvokeMessage {
  readonly kind: 'invoke';
  readonly id: RequestId;
  readonly channel: string;
  readonly args: readonly unknown[];
}

export type RendererMessage = InvokeMessage;

/** main -> renderer: the answer to exactly one `InvokeMessage`. */
export interface ReplyMessage {
  readonly kind: 'reply';
  readonly id: RequestId;
  readonly result?: unknown;
  readonly error?: SerializedError;
}

/** main -> renderer: unsolicited push (terminal output, debug state, ...). */
export interface EventMessage {
  readonly kind: 'event';
  readonly channel: string;
  readonly payload: unknown;
}

/**
 * main -> renderer, exactly once: every handler is registered and calls
 * may begin. The renderer queues invocations until this arrives, so
 * callers never have to care how long the worker took to boot.
 */
export interface ReadyMessage {
  readonly kind: 'ready';
}

export type MainMessage = ReplyMessage | EventMessage | ReadyMessage;

export function serializeError(cause: unknown): SerializedError {
  if (cause instanceof Error) {
    return { name: cause.name, message: cause.message, stack: cause.stack };
  }
  return { name: 'Error', message: String(cause) };
}

export function deserializeError(error: SerializedError): Error {
  const restored = new Error(error.message);
  restored.name = error.name;
  // Keep the main-process stack -- the renderer-side one would only ever
  // point at this function, which is never where the failure happened.
  if (error.stack) restored.stack = error.stack;
  return restored;
}
