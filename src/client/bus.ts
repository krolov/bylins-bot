// Tiny pub-sub bus used to decouple the server-event dispatcher in main.ts
// from modal modules that are dynamically imported on first use.
//
// When a modal chunk is loaded for the first time (after the user clicks its
// open-button), it calls `on()` with its handler. The bus replays the most
// recent payload for that event type if one was already received before the
// modal loaded — so a modal opening after the server already sent its data
// still renders correctly.

type Handler = (payload: unknown) => void;

const handlers = new Map<string, Handler>();
const cached = new Map<string, unknown>();

export function on<T = unknown>(type: string, fn: (payload: T) => void): void {
  handlers.set(type, fn as Handler);
  if (cached.has(type)) {
    fn(cached.get(type) as T);
  }
}

export function emit(type: string, payload: unknown): void {
  cached.set(type, payload);
  const h = handlers.get(type);
  if (h) h(payload);
}
