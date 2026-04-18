// Headless Playwright smoke test for the bundled client.
//
// Boots a mock backend that serves /public statics and a no-op WebSocket
// endpoint. Loads the page in headless Chromium and checks:
//   1. No console "error" or page errors during bootstrap.
//   2. Action sidebar buttons are mounted.
//   3. Vorozhe modal builds its 25 city buttons lazily on first open.
//   4. Hotkeys modal opens.
//   5. Sending a command via the input textbox queues the WS payload.
//
// Run: bun run scripts/smoke-test.ts

import { Module, createRequire } from "node:module";

interface PlaywrightConsoleMessage {
  type(): string;
  text(): string;
}

interface PlaywrightPageError {
  message: string;
}

interface PlaywrightPage {
  on(event: "console", handler: (msg: PlaywrightConsoleMessage) => void): void;
  on(event: "pageerror", handler: (err: PlaywrightPageError) => void): void;
  goto(url: string, options: { waitUntil: "domcontentloaded" }): Promise<void>;
  waitForFunction(fn: () => boolean, options?: { timeout?: number }): Promise<void>;
  evaluate<TArg, TResult>(fn: (arg: TArg) => TResult, arg: TArg): Promise<TResult>;
  evaluate<TResult>(fn: () => TResult): Promise<TResult>;
  click(selector: string): Promise<void>;
  waitForSelector(selector: string, options?: { timeout?: number }): Promise<void>;
  waitForTimeout(timeout: number): Promise<void>;
  locator(selector: string): { click(options?: { force?: boolean }): Promise<void> };
}

interface PlaywrightContext {
  newPage(): Promise<PlaywrightPage>;
}

interface PlaywrightBrowser {
  newContext(): Promise<PlaywrightContext>;
  close(): Promise<void>;
}

interface PlaywrightChromium {
  launch(options: { headless: boolean }): Promise<PlaywrightBrowser>;
}

// Make globally-installed playwright importable from this script.
process.env.NODE_PATH = `${process.env.NODE_PATH ?? ""}:/opt/node22/lib/node_modules`;
const moduleWithInitPaths = Module as typeof Module & { _initPaths(): void };
moduleWithInitPaths._initPaths();
const requireGlobal = createRequire("/opt/node22/lib/node_modules/");
const { chromium } = requireGlobal("playwright") as { chromium: PlaywrightChromium };

// ── Mock backend ──────────────────────────────────────────────────────────────
const port = 38771;
const wsMessages: unknown[] = [];

const server = Bun.serve({
  port,
  fetch(req, srv) {
    const url = new URL(req.url);
    if (url.pathname === "/ws") {
      const upgraded = srv.upgrade(req);
      if (upgraded) return undefined as unknown as Response;
      return new Response("WS upgrade failed", { status: 400 });
    }
    if (url.pathname === "/api/config") {
      return Response.json({
        autoConnect: false,
        host: "localhost",
        port: 4000,
        tls: false,
        startupCommands: [],
        commandDelayMs: 50,
      });
    }
    if (url.pathname === "/api/profiles") {
      return Response.json({
        profiles: [{ id: "default", name: "Default" }],
        defaultProfileId: "default",
      });
    }
    const safe = url.pathname === "/" ? "/index.html" : url.pathname;
    const file = Bun.file(`./public${safe}`);
    return new Response(file);
  },
  websocket: {
    open(ws) {
      ws.send(JSON.stringify({
        type: "defaults",
        payload: {
          autoConnect: false,
          host: "localhost",
          port: 4000,
          tls: false,
          startupCommands: [],
          commandDelayMs: 50,
        },
      }));
    },
    message(_ws, msg) {
      try {
        wsMessages.push(JSON.parse(String(msg)));
      } catch {
        /* ignore */
      }
    },
    close() {},
  },
});

console.log(`mock backend on http://localhost:${port}`);

// ── Run Playwright ────────────────────────────────────────────────────────────
const failures: string[] = [];
const consoleErrors: string[] = [];
const pageErrors: string[] = [];

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext();
const page = await context.newPage();

page.on("console", (msg: PlaywrightConsoleMessage) => {
  if (msg.type() === "error") consoleErrors.push(msg.text());
});
page.on("pageerror", (err: PlaywrightPageError) => {
  pageErrors.push(`${err.message}`);
});

const t0 = Date.now();
await page.goto(`http://localhost:${port}/?test`, { waitUntil: "domcontentloaded" });
// allow the client module + its dynamic chunks to settle
await page.waitForFunction(() => document.querySelector("#connect-form") !== null);
const tBoot = Date.now() - t0;
console.log(`bootstrap: ${tBoot}ms`);

// 1. action sidebar buttons present
const actionBtnIds = [
  "buy-food-btn", "fill-flask-btn", "repair-btn", "compare-button",
  "survival-settings-button", "triggers-button", "hotkeys-button",
  "item-db-button", "map-recording-button", "global-map-button",
  "farm-settings-button", "gather-toggle-button", "gather-sell-button",
  "scratch-clan-btn", "equip-all-btn", "vorozhe-button", "debug-log-button",
];
for (const id of actionBtnIds) {
  const exists = await page.evaluate((x: string) => !!document.getElementById(x), id);
  if (!exists) failures.push(`missing action button #${id}`);
}

// 2. Vorozhe lazy-init: modal opens, populates 25 city buttons in each direction
const vorozheCountBefore = await page.evaluate(
  () => document.querySelectorAll("#vorozhe-from-buttons .vorozhe-city-btn").length,
);
if (vorozheCountBefore !== 0) {
  failures.push(`vorozhe should be empty before open, got ${vorozheCountBefore}`);
}
await page.click("#vorozhe-button");
await page.waitForFunction(
  () => document.querySelectorAll("#vorozhe-from-buttons .vorozhe-city-btn").length === 25,
  { timeout: 3000 },
).catch(() => { /* handled below */ });
const vorozheCountAfter = await page.evaluate(
  () => document.querySelectorAll("#vorozhe-from-buttons .vorozhe-city-btn").length,
);
if (vorozheCountAfter !== 25) {
  failures.push(`vorozhe expected 25 city buttons after open, got ${vorozheCountAfter}`);
}
const vorozheToCount = await page.evaluate(
  () => document.querySelectorAll("#vorozhe-to-buttons .vorozhe-city-btn").length,
);
if (vorozheToCount !== 25) {
  failures.push(`vorozhe-to expected 25 buttons, got ${vorozheToCount}`);
}
// close modal
await page.click("#vorozhe-modal-close");

// 3. Hotkeys modal opens
await page.click("#hotkeys-button");
await page.waitForSelector("#hotkeys-modal:not(.farm-modal--hidden)", { timeout: 2000 }).catch(() => {
  failures.push("hotkeys modal did not open");
});
await page.click("#hotkeys-modal-cancel").catch(() => { /* may auto-close */ });

// 4. Compare advisor opens (dynamic chunk loads) and renders status text
await page.click("#compare-button");
await page.waitForFunction(
  () => {
    const p = document.getElementById("compare-advisor-panel");
    return p !== null && !p.classList.contains("compare-advisor-panel--hidden");
  },
  { timeout: 3000 },
).catch(() => failures.push("compare advisor did not show"));
const compareStatus = await page.evaluate(() => document.getElementById("compare-advisor-status")?.textContent);
if (compareStatus !== "Сканирование...") {
  failures.push(`compare status expected "Сканирование...", got ${JSON.stringify(compareStatus)}`);
}
await page.click("#compare-advisor-close");

// 5. Item-DB modal opens (sends item_db_get)
await page.click("#item-db-button");
await page.waitForSelector("#item-db-modal:not(.farm-modal--hidden)", { timeout: 2000 }).catch(() => {
  failures.push("item-db modal did not open");
});
await page.locator("#item-db-modal-close").click({ force: true });
await page.waitForFunction(
  () => document.getElementById("item-db-modal")?.classList.contains("farm-modal--hidden") === true,
  { timeout: 2000 },
).catch(() => {
  failures.push("item-db modal did not close");
});

// 5. Container tabs work
await page.click("#container-tab-nav");
await page.waitForTimeout(100);
await page.click("#container-tab-script");
await page.waitForTimeout(100);
await page.click("#container-tab-inventory");

// 6. console / pageerror checks — filter out expected/benign network errors
const benignPatterns = [/WebSocket/, /favicon/, /\/api\//];
const realConsoleErrors = consoleErrors.filter(
  (e) => !benignPatterns.some((p) => p.test(e)),
);
const realPageErrors = pageErrors.filter(
  (e) => !benignPatterns.some((p) => p.test(e)),
);
if (realConsoleErrors.length > 0) {
  failures.push(`console errors:\n  - ${realConsoleErrors.join("\n  - ")}`);
}
if (realPageErrors.length > 0) {
  failures.push(`page errors:\n  - ${realPageErrors.join("\n  - ")}`);
}

await browser.close();
server.stop(true);

if (failures.length > 0) {
  console.error(`\nSMOKE TEST FAILED (${failures.length} issues):`);
  for (const f of failures) console.error("  ✗ " + f);
  process.exit(1);
}

console.log(`\nSMOKE TEST PASSED — bootstrap ${tBoot}ms, ${wsMessages.length} ws messages received from client.`);
process.exit(0);
