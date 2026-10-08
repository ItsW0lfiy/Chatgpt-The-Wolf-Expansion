import { context } from "esbuild";
import { copyFile, mkdir, rm } from "node:fs/promises";
import { watch as watchFiles } from "node:fs";
import path from "node:path";

const root = process.cwd();
const distDirectory = path.join(root, "dist");
const watchMode = process.argv.includes("--watch");

const staticFiles = [
  ["src/manifest.json", "manifest.json"],
  ["src/settings/options/options.html", "options.html"],
  ["assets/branding/icons/wolf-expansion-mark-16.png", "icons/wolf-expansion-mark-16.png"],
  ["assets/branding/icons/wolf-expansion-mark-32.png", "icons/wolf-expansion-mark-32.png"],
  ["assets/branding/icons/wolf-expansion-mark-48.png", "icons/wolf-expansion-mark-48.png"],
  ["assets/branding/icons/wolf-expansion-mark-96.png", "icons/wolf-expansion-mark-96.png"],
  ["assets/branding/icons/wolf-expansion-mark-128.png", "icons/wolf-expansion-mark-128.png"],
  ["assets/icons/Settings/settings_currentcolor.svg", "icons/settings-gear.svg"],
];

async function copyStaticFiles() {
  await Promise.all(
    staticFiles.map(async ([source, destination]) => {
      const destinationPath = path.join(distDirectory, destination);
      await mkdir(path.dirname(destinationPath), { recursive: true });
      await copyFile(path.join(root, source), destinationPath);
    }),
  );
}

await rm(distDirectory, { recursive: true, force: true });
await mkdir(distDirectory, { recursive: true });
await copyStaticFiles();

const buildContext = await context({
  entryPoints: {
    content: "src/content.ts",
    "navigation-compat": "src/navigation-compat.ts",
    "options/options": "src/settings/options/options.ts",
  },
  bundle: true,
  entryNames: "[name]",
  format: "iife",
  outdir: "dist",
  platform: "browser",
  target: "firefox128",
  sourcemap: false,
  minify: false,
  legalComments: "none",
  logLevel: "info",
});

if (watchMode) {
  await buildContext.watch();

  for (const [source] of staticFiles) {
    watchFiles(path.join(root, source), async () => {
      try {
        await copyStaticFiles();
        console.log("[Wolf Expansion] Copied static files.");
      } catch (error) {
        console.error("[Wolf Expansion] Could not copy static files.", error);
      }
    });
  }

  console.log("[Wolf Expansion] Watching source files...");
} else {
  await buildContext.rebuild();
  await buildContext.dispose();
}
