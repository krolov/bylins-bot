import type {
  MudEvent,
  MudEventBus,
  MudEventBusDependencies,
  MudEventHandler,
  Unsubscribe,
} from "./types.ts";

type AnyHandler = (event: MudEvent) => void;

export function createMudBus(deps: MudEventBusDependencies): MudEventBus {
  const handlersByKind = new Map<MudEvent["kind"], Set<AnyHandler>>();
  const anyHandlers = new Set<AnyHandler>();

  function reportError(kind: string, error: unknown): void {
    const message = error instanceof Error ? error.message : "unknown error";
    deps.onError(`[bus] handler error for ${kind}: ${message}`);
  }

  function emit<K extends MudEvent["kind"]>(event: Extract<MudEvent, { kind: K }>): void {
    const bucket = handlersByKind.get(event.kind);
    if (bucket) {
      for (const handler of [...bucket]) {
        try {
          handler(event);
        } catch (error: unknown) {
          reportError(event.kind, error);
        }
      }
    }
    for (const handler of [...anyHandlers]) {
      try {
        handler(event);
      } catch (error: unknown) {
        reportError(`* (any for ${event.kind})`, error);
      }
    }
  }

  function on<K extends MudEvent["kind"]>(kind: K, handler: MudEventHandler<K>): Unsubscribe {
    let bucket = handlersByKind.get(kind);
    if (!bucket) {
      bucket = new Set<AnyHandler>();
      handlersByKind.set(kind, bucket);
    }
    bucket.add(handler as AnyHandler);
    return () => {
      handlersByKind.get(kind)?.delete(handler as AnyHandler);
    };
  }

  function once<K extends MudEvent["kind"]>(kind: K, handler: MudEventHandler<K>): Unsubscribe {
    const unsubscribe = on(kind, (event) => {
      unsubscribe();
      handler(event);
    });
    return unsubscribe;
  }

  function off<K extends MudEvent["kind"]>(kind: K, handler: MudEventHandler<K>): void {
    handlersByKind.get(kind)?.delete(handler as AnyHandler);
  }

  function onAny(handler: (event: MudEvent) => void): Unsubscribe {
    anyHandlers.add(handler);
    return () => {
      anyHandlers.delete(handler);
    };
  }

  return { emit, on, once, off, onAny };
}
