// Extract a 30-minute baseline window from /var/log/bylins-bot/mud-traffic.log
// into .fixtures/mud-traffic-baseline.log for regression-oracle use.
//
// Source log lines follow src/server.ts::logEvent format:
//   [<ISO timestamp>] session=<id> direction=<mud-in|mud-out|session|browser-*|error> message="<JSON>"
// Concrete direction values include `direction=mud-in` (server->client MUD text)
// and `direction=mud-out` (client->server MUD command), among others.
//
// Selection strategy (D-02): caller passes --start (ISO); script copies every
// line whose timestamp is in [start, start + --minutes) to the output file.
// Lines are written byte-for-byte from the source (no re-encoding per D-03).
//
// Run: bun run scripts/extract-baseline.ts --start 2026-04-15T09:30:00Z [--minutes 30] [--source PATH] [--out PATH]

import { createReadStream, createWriteStream, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { createInterface } from "node:readline";

const DEFAULT_SOURCE_LOG = "/var/log/bylins-bot/mud-traffic.log";
const DEFAULT_OUTPUT_PATH = ".fixtures/mud-traffic-baseline.log";
const DEFAULT_WINDOW_MINUTES = 30;
const MAX_WINDOW_MINUTES = 240;
const LOG_LINE_REGEXP = /^\[(?<ts>[^\]]+)\] session=(?<session>\S+) direction=(?<direction>\S+) message=/;

const USAGE_LINE =
  "Run: bun run scripts/extract-baseline.ts --start <ISO-8601> [--minutes 30] [--source PATH] [--out PATH]";

interface CliOptions {
  start: Date;
  minutes: number;
  source: string;
  out: string;
}

function parseArgs(argv: readonly string[]): CliOptions {
  let startRaw: string | null = null;
  let minutes = DEFAULT_WINDOW_MINUTES;
  let source = DEFAULT_SOURCE_LOG;
  let out = DEFAULT_OUTPUT_PATH;

  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (flag === "--start") {
      if (value === undefined) {
        process.stderr.write("extract-baseline: --start requires a value\n");
        process.stderr.write(`${USAGE_LINE}\n`);
        process.exit(1);
      }
      startRaw = value;
      i += 1;
    } else if (flag === "--minutes") {
      if (value === undefined) {
        process.stderr.write("extract-baseline: --minutes requires a value\n");
        process.exit(1);
      }
      const parsed = Number(value);
      if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed <= 0 || parsed > MAX_WINDOW_MINUTES) {
        process.stderr.write(
          `extract-baseline: --minutes must be a positive integer <= ${MAX_WINDOW_MINUTES}\n`,
        );
        process.exit(1);
      }
      minutes = parsed;
      i += 1;
    } else if (flag === "--source") {
      if (value === undefined) {
        process.stderr.write("extract-baseline: --source requires a value\n");
        process.exit(1);
      }
      source = value;
      i += 1;
    } else if (flag === "--out") {
      if (value === undefined) {
        process.stderr.write("extract-baseline: --out requires a value\n");
        process.exit(1);
      }
      out = value;
      i += 1;
    } else {
      process.stderr.write(`extract-baseline: unknown argument "${flag}"\n`);
      process.stderr.write(`${USAGE_LINE}\n`);
      process.exit(1);
    }
  }

  if (startRaw === null) {
    process.stderr.write("extract-baseline: --start is required\n");
    process.stderr.write(`${USAGE_LINE}\n`);
    process.exit(1);
  }

  const start = new Date(startRaw);
  if (Number.isNaN(start.getTime())) {
    process.stderr.write("extract-baseline: --start must be a valid ISO-8601 timestamp\n");
    process.exit(1);
  }

  return { start, minutes, source, out };
}

async function extractWindow(params: {
  source: string;
  out: string;
  start: Date;
  endExclusive: Date;
}): Promise<{ linesRead: number; linesWritten: number }> {
  const { source, out, start, endExclusive } = params;

  mkdirSync(dirname(out), { recursive: true });

  const readStream = createReadStream(source);
  const writeStream = createWriteStream(out, { flags: "w" });
  const rl = createInterface({ input: readStream, crlfDelay: Infinity });

  const startMs = start.getTime();
  const endMs = endExclusive.getTime();
  let linesRead = 0;
  let linesWritten = 0;
  let stopped = false;

  for await (const line of rl) {
    if (stopped) break;
    linesRead += 1;
    const match = LOG_LINE_REGEXP.exec(line);
    if (match === null || match.groups === undefined) continue;
    const ts = new Date(match.groups.ts);
    const tsMs = ts.getTime();
    if (Number.isNaN(tsMs)) continue;
    if (tsMs >= endMs) {
      stopped = true;
      rl.close();
      readStream.destroy();
      break;
    }
    if (tsMs >= startMs) {
      writeStream.write(`${line}\n`);
      linesWritten += 1;
    }
  }

  await new Promise<void>((resolve, reject) => {
    writeStream.end((error?: Error | null) => {
      if (error) reject(error);
      else resolve();
    });
  });

  return { linesRead, linesWritten };
}

const { start, minutes, source, out } = parseArgs(process.argv.slice(2));
const endExclusive = new Date(start.getTime() + minutes * 60_000);

try {
  const { linesRead, linesWritten } = await extractWindow({ source, out, start, endExclusive });
  process.stdout.write(
    `extract-baseline: read ${linesRead} lines, wrote ${linesWritten} to ${out}\n`,
  );
  if (linesWritten === 0) {
    process.stderr.write(
      `extract-baseline: WARNING no lines matched window [${start.toISOString()}, ${endExclusive.toISOString()})\n`,
    );
    process.exit(2);
  }
  process.exit(0);
} catch (error: unknown) {
  const message = error instanceof Error ? error.message : "unknown error";
  process.stderr.write(`extract-baseline: ${message}\n`);
  process.exit(1);
}
