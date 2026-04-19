// Port for current-time access. Default impl wraps Date.now(); test/harness
// impls inject a deterministic counter for replay (per D-10, D-14).

export interface NowProvider {
  now(): number;
}
