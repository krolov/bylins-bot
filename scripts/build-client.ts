export {};

const result = await Bun.build({
  entrypoints: ["./src/client/main.ts"],
  target: "browser",
  format: "esm",
  sourcemap: "external",
  outdir: "./public",
  naming: "client.js",
  minify: true,
  splitting: true,
});

if (!result.success) {
  for (const log of result.logs) {
    console.error(log);
  }

  process.exit(1);
}

for (const output of result.outputs) {
  console.log(`built ${output.path}`);
}
