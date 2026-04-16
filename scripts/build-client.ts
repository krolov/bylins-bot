export {};

const jsResult = await Bun.build({
  entrypoints: ["./src/client/main.ts"],
  target: "browser",
  format: "esm",
  sourcemap: "external",
  outdir: "./public",
  naming: "client.js",
  minify: true,
  splitting: true,
});

if (!jsResult.success) {
  for (const log of jsResult.logs) {
    console.error(log);
  }

  process.exit(1);
}

for (const output of jsResult.outputs) {
  console.log(`built ${output.path}`);
}

const cssResult = await Bun.build({
  entrypoints: ["./public/styles.css"],
  outdir: "./public",
  naming: "styles.min.css",
  minify: true,
});

if (!cssResult.success) {
  for (const log of cssResult.logs) {
    console.error(log);
  }

  process.exit(1);
}

for (const output of cssResult.outputs) {
  console.log(`built ${output.path}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Rewrite modulepreload tags in index.html so the browser can fetch eager
// chunks (e.g. shared bus+constants chunk) in parallel with client.js instead
// of waiting until client.js starts executing.
//
// We detect eager chunks by reading the static-import prelude at the top of
// the built client.js. Dynamic `import(...)` calls happen elsewhere in the
// bundle and use parens so they are naturally excluded. Tags are written
// between <!-- chunk-preload:start --> / <!-- chunk-preload:end --> markers
// in public/index.html.
// ─────────────────────────────────────────────────────────────────────────────

const clientJsContent = await Bun.file("./public/client.js").text();
const preludeMatch = clientJsContent.match(/^(?:import[^;]+;)+/);
const prelude = preludeMatch?.[0] ?? "";
const eagerChunks = [...prelude.matchAll(/["']\.\/(chunk-[a-z0-9]+\.js)["']/g)]
  .map((m) => m[1]!)
  .filter((chunk, idx, arr) => arr.indexOf(chunk) === idx);

const indexHtmlPath = "./public/index.html";
const indexHtml = await Bun.file(indexHtmlPath).text();
const indent = "    ";
const preloadTags = eagerChunks
  .map((chunk) => `${indent}<link rel="modulepreload" href="/${chunk}" />`)
  .join("\n");
const updatedHtml = indexHtml.replace(
  /<!-- chunk-preload:start -->[\s\S]*?<!-- chunk-preload:end -->/,
  `<!-- chunk-preload:start -->\n${preloadTags}\n${indent}<!-- chunk-preload:end -->`,
);

if (updatedHtml !== indexHtml) {
  await Bun.write(indexHtmlPath, updatedHtml);
  console.log(
    `updated ${indexHtmlPath} with modulepreload for ${eagerChunks.length} eager chunk(s): ${eagerChunks.join(", ")}`,
  );
}
