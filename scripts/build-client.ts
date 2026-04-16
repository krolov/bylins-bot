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
