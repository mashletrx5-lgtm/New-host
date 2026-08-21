/**
 * Build + render a test stock image to see current icon state.
 * Run: node artifacts/api-server/renderTest.mjs
 */
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import esbuildPluginPino from "esbuild-plugin-pino";
import { writeFile, mkdir } from "node:fs/promises";
import { spawn } from "node:child_process";

globalThis.require = createRequire(import.meta.url);
const artifactDir = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.resolve(artifactDir, "dist/render-test");

await build({
  entryPoints: [path.resolve(artifactDir, "src/scripts/renderTestEntry.ts")],
  platform: "node",
  bundle: true,
  format: "esm",
  outdir: outDir,
  outExtension: { ".js": ".mjs" },
  logLevel: "warning",
  external: ["*.node", "@napi-rs/canvas", "bufferutil", "utf-8-validate", "pg-native"],
  sourcemap: false,
  banner: {
    js: `import { createRequire as __cr } from 'node:module';
import __bp from 'node:path';
import __bu from 'node:url';
globalThis.require = __cr(import.meta.url);
globalThis.__filename = __bu.fileURLToPath(import.meta.url);
globalThis.__dirname = __bp.dirname(globalThis.__filename);
`,
  },
  plugins: [esbuildPluginPino({ transports: ["pino-pretty"] })],
});

const child = spawn(
  process.execPath,
  [path.resolve(outDir, "renderTestEntry.mjs")],
  { stdio: "inherit", env: process.env },
);
child.on("exit", code => process.exit(code ?? 0));
