// Port for session teardown hook registration. Mirrors the server.ts:454
// `sessionTeardownHooks = new Set<() => void>()` pattern, exposing register/invokeAll
// as named methods so tests can drive teardown without touching module state.

export interface SessionTeardownRegistry {
  register(hook: () => void): () => void;
  invokeAll(): void;
}
