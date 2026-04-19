import type { NowProvider } from "../now-provider.ts";

export function createDefaultNowProvider(): NowProvider {
  return {
    now: () => Date.now(),
  };
}
