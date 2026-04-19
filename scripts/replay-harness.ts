// Replay harness (SAFE-01 runtime oracle).
//
// Reads .fixtures/mud-traffic-baseline.log, walks direction=mud-in chunks, and
// drives them through the Phase-1 pipeline:
//   fake clock (D-10) -> mock map store (D-07) -> typed bus (Plan 02) -> parser (Plan 05)
// Every side-effect is recorded as a JSONL line in snapshots/replay-<mode>.jsonl.
//
// Default mode: write snapshots/replay-after.jsonl + byte-diff vs replay-before.jsonl.
//   Exit 0 on zero-diff; exit 1 on every diff.
// --write-initial mode: write snapshots/replay-before.jsonl (no diff). Developer
//   runs this once to seed the committed behaviour-of-record.
//
// Run: bun run scripts/replay-harness.ts [--write-initial] [--fixture PATH] [--out PATH]
//
// Phase 1 note: no controllers are subscribed to the bus yet (CONTEXT D-29), so the
// recorded transcript contains bus emits + parser events only (zero mapStore.*, zero
// timer.* entries). Phase 2 extractions will grow the recorded surface, at which
// point replay-before.jsonl is re-seeded per Plan 07 playbook ritual.

import { createReadStream, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { createInterface } from "node:readline";

import { createMudBus } from "../src/bus/mud-event-bus.ts";
import { createParserState, feedText } from "../src/map/parser.ts";

import { createFakeClock, type TranscriptSink } from "./lib/fake-clock.ts";
import { createMockMapStore } from "./lib/mock-map-store.ts";

const DEFAULT_FIXTURE_PATH = ".fixtures/mud-traffic-baseline.log";
const DEFAULT_BEFORE_PATH = "snapshots/replay-before.jsonl";
const DEFAULT_AFTER_PATH = "snapshots/replay-after.jsonl";
// LOG_LINE_REGEXP is reproduced verbatim from scripts/extract-baseline.ts (Plan 01)
// and scripts/parser-snapshot.ts (Plan 05). All three scripts MUST parse baseline
// log lines with byte-identical regex to prevent drift. Matches both
// direction=mud-in and direction=mud-out lines; the harness filters on mud-in.
const LOG_LINE_REGEXP = /^\[(?<ts>[^\]]+)\] session=(?<session>\S+) direction=(?<direction>\S+) message=/;
const TARGET_DIRECTION = "mud-in";

const USAGE = [
  "Replay harness (SAFE-01 runtime oracle)",
  "",
  "Usage: bun run scripts/replay-harness.ts [--write-initial] [--fixture PATH] [--out PATH]",
  "",
  "Flags:",
  "  --write-initial   Write snapshots/replay-before.jsonl (no diff). Run once; commit the result.",
  "  --fixture PATH    Override fixture path (default: .fixtures/mud-traffic-baseline.log).",
  "  --out PATH        Override output path (default depends on --write-initial).",
  "  --help, -h        Print this message.",
  "",
  "Exit codes: 0 success / 1 diff detected or error / 2 fixture missing.",
].join("\n");

interface CliOptions {
  writeInitial: boolean;
  fixture: string;
  out: string;
  help: boolean;
}

function parseArgs(argv: readonly string[]): CliOptions {
  let writeInitial = false;
  let fixture = DEFAULT_FIXTURE_PATH;
  let outOverride: string | null = null;
  let help = false;

  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (flag === "--help" || flag === "-h") {
      help = true;
    } else if (flag === "--write-initial") {
      writeInitial = true;
    } else if (flag === "--fixture") {
      if (value === undefined) {
        process.stderr.write("replay-harness: --fixture requires a value\n");
        process.stderr.write(`${USAGE}\n`);
        process.exit(1);
      }
      fixture = value;
      i += 1;
    } else if (flag === "--out") {
      if (value === undefined) {
        process.stderr.write("replay-harness: --out requires a value\n");
        process.stderr.write(`${USAGE}\n`);
        process.exit(1);
      }
      outOverride = value;
      i += 1;
    } else {
      process.stderr.write(`replay-harness: unknown argument "${flag}"\n`);
      process.stderr.write(`${USAGE}\n`);
      process.exit(1);
    }
  }

  const out = outOverride ?? (writeInitial ? DEFAULT_BEFORE_PATH : DEFAULT_AFTER_PATH);
  return { writeInitial, fixture, out, help };
}

// Extract the `message="..."` JSON-string literal from a baseline log line whose
// prefix already matched LOG_LINE_REGEXP. Returns the quoted JSON literal
// (including the surrounding quotes) ready for JSON.parse, or null if the
// trailing portion is not a well-formed quoted string. Verbatim copy of the
// helper shipped in scripts/parser-snapshot.ts — single source of truth.
function extractMessageLiteral(line: string, matchLength: number): string | null {
  if (line[matchLength] !== '"') return null;
  let index = matchLength + 1;
  while (index < line.length) {
    const ch = line[index];
    if (ch === "\\") {
      index += 2;
      continue;
    }
    if (ch === '"') {
      return line.slice(matchLength, index + 1);
    }
    index += 1;
  }
  return null;
}

interface SinkWithEntries {
  sink: TranscriptSink;
  entries: string[];
}

function createSink(): SinkWithEntries {
  const entries: string[] = [];
  let seq = 0;
  const sink: TranscriptSink = {
    emit(entry) {
      const withSeq = { seq, ...entry };
      entries.push(JSON.stringify(withSeq));
      seq += 1;
    },
  };
  return { sink, entries };
}

async function extractFirstTimestamp(fixturePath: string): Promise<number | null> {
  const rl = createInterface({ input: createReadStream(fixturePath), crlfDelay: Infinity });
  for await (const line of rl) {
    const match = LOG_LINE_REGEXP.exec(line);
    if (match?.groups?.["ts"] !== undefined) {
      const parsed = Date.parse(match.groups["ts"]);
      rl.close();
      return Number.isNaN(parsed) ? null : parsed;
    }
  }
  return null;
}

async function generateTranscript(
  fixturePath: string,
  outPath: string,
): Promise<{ chunks: number; malformed: number }> {
  mkdirSync(dirname(outPath), { recursive: true });

  const seedMs = (await extractFirstTimestamp(fixturePath)) ?? 0;
  const { sink, entries } = createSink();
  const clock = createFakeClock(seedMs, sink);
  const mapStore = createMockMapStore({ sink });
  // Plan 1 note: mapStore is intentionally unused by any subscriber yet — D-29.
  // It is wired so Phase 2 extractions snap in via composition without reshaping
  // the harness. Reference it once so tsc does not warn about unused identifier.
  void mapStore;

  const bus = createMudBus({
    onError: (message: string) => {
      sink.emit({ kind: "bus.error", message });
    },
  });

  const parserState = createParserState();

  let chunkIndex = 0;
  let malformed = 0;

  const rl = createInterface({ input: createReadStream(fixturePath), crlfDelay: Infinity });
  let lineNumber = 0;

  for await (const line of rl) {
    lineNumber += 1;
    if (line.length === 0) continue;
    const match = LOG_LINE_REGEXP.exec(line);
    if (match === null || match.groups === undefined) {
      malformed += 1;
      process.stderr.write(`replay-harness: WARNING skipping malformed line ${lineNumber}\n`);
      continue;
    }
    const direction = match.groups["direction"];
    if (direction !== TARGET_DIRECTION) continue;
    const ts = match.groups["ts"];
    if (ts === undefined) continue;

    // Advance virtual time to this chunk's timestamp BEFORE emitting — drains any
    // pending timers scheduled by prior chunks. In Phase 1 no timers are scheduled,
    // so advanceTo just moves the clock. Phase 2 timer-driven controllers engage here.
    const atMs = Date.parse(ts);
    if (!Number.isNaN(atMs)) {
      clock.advanceTo(atMs);
    }

    const messageLiteral = extractMessageLiteral(line, match[0].length);
    if (messageLiteral === null) {
      malformed += 1;
      process.stderr.write(
        `replay-harness: WARNING skipping line ${lineNumber} — message literal unparseable\n`,
      );
      continue;
    }

    let chunkText: unknown;
    try {
      chunkText = JSON.parse(messageLiteral);
    } catch (_error: unknown) {
      malformed += 1;
      process.stderr.write(
        `replay-harness: WARNING skipping line ${lineNumber} — message not valid JSON\n`,
      );
      continue;
    }
    if (typeof chunkText !== "string") {
      malformed += 1;
      continue;
    }

    // Emit the harness-intent entry BEFORE bus.emit — subscribers (Phase 2+)
    // append their own entries AFTER, preserving chronological order.
    sink.emit({ kind: "bus.emit", event: { kind: "mud_text_raw", text: chunkText } });
    bus.emit({ kind: "mud_text_raw", text: chunkText });

    const events = feedText(parserState, chunkText);
    sink.emit({ kind: "parser.events", chunkIndex, events });

    chunkIndex += 1;
  }

  // Drain any timers the last chunks may have scheduled (Phase 2+ concern; no-op in Phase 1).
  clock.drain();

  const payload = entries.length > 0 ? `${entries.join("\n")}\n` : "";
  writeFileSync(outPath, payload);
  return { chunks: chunkIndex, malformed };
}

function diffSnapshots(
  beforePath: string,
  afterPath: string,
): { equal: boolean; firstDiff: string | null } {
  if (!existsSync(beforePath)) {
    return {
      equal: false,
      firstDiff: `replay-harness: before file missing at ${beforePath} — run --write-initial first`,
    };
  }
  const beforeLines = readFileSync(beforePath, "utf8").split("\n");
  const afterLines = readFileSync(afterPath, "utf8").split("\n");
  if (beforeLines.length !== afterLines.length) {
    return {
      equal: false,
      firstDiff: `length mismatch: before=${beforeLines.length} lines, after=${afterLines.length} lines`,
    };
  }
  for (let i = 0; i < beforeLines.length; i += 1) {
    if (beforeLines[i] !== afterLines[i]) {
      return {
        equal: false,
        firstDiff: `line ${i + 1} differs:\n  before: ${beforeLines[i] ?? ""}\n  after:  ${afterLines[i] ?? ""}`,
      };
    }
  }
  return { equal: true, firstDiff: null };
}

async function main(): Promise<never> {
  try {
    const args = parseArgs(process.argv.slice(2));
    if (args.help) {
      process.stdout.write(`${USAGE}\n`);
      process.exit(0);
    }
    if (!existsSync(args.fixture)) {
      process.stderr.write(
        `replay-harness: fixture not found at ${args.fixture}. Run \`bun run scripts/extract-baseline.ts --start <ISO>\` first (see docs/refactor-playbook.md).\n`,
      );
      process.exit(2);
    }
    const result = await generateTranscript(args.fixture, args.out);
    process.stdout.write(
      `replay-harness: processed ${result.chunks} chunks (${result.malformed} malformed lines skipped) -> ${args.out}\n`,
    );
    if (args.writeInitial) {
      process.exit(0);
    }
    const diff = diffSnapshots(DEFAULT_BEFORE_PATH, args.out);
    if (diff.equal) {
      process.stdout.write(`replay-harness: zero diff vs ${DEFAULT_BEFORE_PATH}\n`);
      process.exit(0);
    }
    process.stderr.write(`replay-harness: REGRESSION detected.\n${diff.firstDiff ?? ""}\n`);
    process.exit(1);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "unknown error";
    process.stderr.write(`replay-harness: ${message}\n`);
    process.exit(1);
  }
}

await main();
