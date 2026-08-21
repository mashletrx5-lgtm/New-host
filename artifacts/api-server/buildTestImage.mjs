import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import esbuildPluginPino from "esbuild-plugin-pino";
import { spawn } from "node:child_process";

globalThis.require = createRequire(import.meta.url);
const artifactDir = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.resolve(artifactDir, "dist/test-image-build");

await build({
  entryPoints: [path.resolve(artifactDir, "src/scripts/postTestImage.ts")],
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
  ["--enable-source-maps", path.resolve(outDir, "postTestImage.mjs")],
  { stdio: "inherit", env: process.env },
);
child.on("exit", code => process.exit(code ?? 0));
