// ---------------------------------------------------------------------------
// MUD event bus — public type surface
// ---------------------------------------------------------------------------
//
// Phase 1 defines exactly one event variant (`mud_text_raw`) so the
// discriminated union is stable yet extensible. Phase 2 will add variants
// like `session_teardown`, `room_parsed`, etc. — keep the leading `| ` in
// front of the single variant so extending is a one-line diff.
//
// Contract (per CONTEXT.md D-22..D-25): sync delivery, insertion-order
// dispatch, listener-snapshot-before-iterate, try/catch per handler.
// ---------------------------------------------------------------------------

export type MudEvent =
  | { kind: "mud_text_raw"; text: string };

export type MudEventHandler<K extends MudEvent["kind"] = MudEvent["kind"]> =
  (event: Extract<MudEvent, { kind: K }>) => void;

export type Unsubscribe = () => void;

export interface MudEventBus {
  emit<K extends MudEvent["kind"]>(event: Extract<MudEvent, { kind: K }>): void;
  on<K extends MudEvent["kind"]>(kind: K, handler: MudEventHandler<K>): Unsubscribe;
  once<K extends MudEvent["kind"]>(kind: K, handler: MudEventHandler<K>): Unsubscribe;
  off<K extends MudEvent["kind"]>(kind: K, handler: MudEventHandler<K>): void;
  onAny(handler: (event: MudEvent) => void): Unsubscribe;
}

export interface MudEventBusDependencies {
  onError(message: string): void;
}
