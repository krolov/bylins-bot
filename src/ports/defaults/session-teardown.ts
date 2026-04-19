import type { SessionTeardownRegistry } from "../session-teardown-registry.ts";

export function createDefaultSessionTeardownRegistry(): SessionTeardownRegistry {
  const hooks = new Set<() => void>();
  return {
    register(hook: () => void): () => void {
      hooks.add(hook);
      return () => {
        hooks.delete(hook);
      };
    },
    invokeAll(): void {
      for (const hook of [...hooks]) {
        hook();
      }
    },
  };
}
