// Parser snapshot harness (SAFE-02).
//
// Reads .fixtures/mud-traffic-baseline.log (gitignored; regenerate via
// `bun run scripts/extract-baseline.ts --start <ISO>`), filters direction=mud-in
// chunks, feeds each through src/map/parser.ts::feedText, and writes a JSONL
// snapshot — one line per chunk — to snapshots/.
//
// Default mode: write snapshots/parser-after.jsonl + byte-diff vs
//   snapshots/parser-before.jsonl. Exit 0 on zero-diff, exit 1 on every diff.
// --write-initial mode: write snapshots/parser-before.jsonl (no diff).
//   Used once, by a developer, to seed the committed behaviour-of-record.
//
// Run: bun run scripts/parser-snapshot.ts [--write-initial] [--fixture PATH] [--out PATH]

import { createReadStream, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { createInterface } from "node:readline";

import { createParserState, feedText } from "../src/map/parser.ts";

const DEFAULT_FIXTURE_PATH = ".fixtures/mud-traffic-baseline.log";
const DEFAULT_BEFORE_PATH = "snapshots/parser-before.jsonl";
const DEFAULT_AFTER_PATH = "snapshots/parser-after.jsonl";
// LOG_LINE_REGEXP is reproduced verbatim from scripts/extract-baseline.ts (Plan 01, SAFE-01).
// Both scripts MUST parse baseline log lines with byte-identical regex to prevent drift.
// The message body is sliced out of the line after this match — see extractMessageLiteral.
const LOG_LINE_REGEXP = /^\[(?<ts>[^\]]+)\] session=(?<session>\S+) direction=(?<direction>\S+) message=/;
const TARGET_DIRECTION = "mud-in";

const USAGE = [
  "Parser snapshot harness (SAFE-02)",
  "",
  "Usage: bun run scripts/parser-snapshot.ts [--write-initial] [--fixture PATH] [--out PATH]",
  "",
  "Flags:",
  "  --write-initial   Write snapshots/parser-before.jsonl (no diff). Run once; commit the result.",
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
        process.stderr.write("parser-snapshot: --fixture requires a value\n");
        process.stderr.write(`${USAGE}\n`);
        process.exit(1);
      }
      fixture = value;
      i += 1;
    } else if (flag === "--out") {
      if (value === undefined) {
        process.stderr.write("parser-snapshot: --out requires a value\n");
        process.stderr.write(`${USAGE}\n`);
        process.exit(1);
      }
      outOverride = value;
      i += 1;
    } else {
      process.stderr.write(`parser-snapshot: unknown argument "${flag}"\n`);
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
// trailing portion is not a well-formed quoted string.
//
// Format from src/server.ts::logEvent (line 898):
//   [<ts>] session=<id> direction=<dir> message=<JSON.stringify(message)>[ <suffix>]
// JSON.stringify always produces a double-quoted string with JSON escapes —
// so the message literal starts at the position right after `message=` and
// ends at the matching closing double-quote (honouring backslash escapes).
function extractMessageLiteral(line: string, matchLength: number): string | null {
  if (line[matchLength] !== '"') return null;
  let index = matchLength + 1;
  while (index < line.length) {
    const ch = line[index];
    if (ch === "\\") {
      // Skip escape + next char.
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

interface SnapshotEntry {
  chunkIndex: number;
  events: ReturnType<typeof feedText>;
}

async function generateSnapshot(
  fixturePath: string,
  outPath: string,
): Promise<{ chunksProcessed: number; malformedLines: number }> {
  mkdirSync(dirname(outPath), { recursive: true });

  const state = createParserState();
  const rl = createInterface({ input: createReadStream(fixturePath), crlfDelay: Infinity });

  let lineNumber = 0;
  let chunkIndex = 0;
  let malformedLines = 0;
  const outLines: string[] = [];

  for await (const line of rl) {
    lineNumber += 1;
    if (line.length === 0) continue;
    const match = LOG_LINE_REGEXP.exec(line);
    if (match === null || match.groups === undefined) {
      malformedLines += 1;
      process.stderr.write(`parser-snapshot: WARNING skipping malformed line ${lineNumber}\n`);
      continue;
    }
    const direction = match.groups["direction"];
    if (direction !== TARGET_DIRECTION) continue;
    const messageLiteral = extractMessageLiteral(line, match[0].length);
    if (messageLiteral === null) {
      malformedLines += 1;
      process.stderr.write(
        `parser-snapshot: WARNING skipping line ${lineNumber} — message literal unparseable\n`,
      );
      continue;
    }
    let chunkText: unknown;
    try {
      chunkText = JSON.parse(messageLiteral);
    } catch (_error: unknown) {
      malformedLines += 1;
      process.stderr.write(
        `parser-snapshot: WARNING skipping line ${lineNumber} — message not valid JSON\n`,
      );
      continue;
    }
    if (typeof chunkText !== "string") {
      malformedLines += 1;
      process.stderr.write(
        `parser-snapshot: WARNING skipping line ${lineNumber} — decoded message not a string\n`,
      );
      continue;
    }
    const events = feedText(state, chunkText);
    const entry: SnapshotEntry = { chunkIndex, events };
    outLines.push(JSON.stringify(entry));
    chunkIndex += 1;
  }

  const payload = outLines.length > 0 ? `${outLines.join("\n")}\n` : "";
  writeFileSync(outPath, payload);
  return { chunksProcessed: chunkIndex, malformedLines };
}

function diffSnapshots(
  beforePath: string,
  afterPath: string,
): { equal: boolean; firstDiff: string | null } {
  if (!existsSync(beforePath)) {
    return {
      equal: false,
      firstDiff: `parser-snapshot: before file missing at ${beforePath} — run --write-initial first`,
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
        `parser-snapshot: fixture not found at ${args.fixture}. Run \`bun run scripts/extract-baseline.ts --start <ISO>\` first (see docs/refactor-playbook.md).\n`,
      );
      process.exit(2);
    }
    const result = await generateSnapshot(args.fixture, args.out);
    process.stdout.write(
      `parser-snapshot: processed ${result.chunksProcessed} chunks (${result.malformedLines} malformed lines skipped) -> ${args.out}\n`,
    );
    if (args.writeInitial) {
      process.exit(0);
    }
    const diff = diffSnapshots(DEFAULT_BEFORE_PATH, args.out);
    if (diff.equal) {
      process.stdout.write(`parser-snapshot: zero diff vs ${DEFAULT_BEFORE_PATH}\n`);
      process.exit(0);
    }
    process.stderr.write(`parser-snapshot: REGRESSION detected.\n${diff.firstDiff ?? ""}\n`);
    process.exit(1);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "unknown error";
    process.stderr.write(`parser-snapshot: ${message}\n`);
    process.exit(1);
  }
}

await main();
