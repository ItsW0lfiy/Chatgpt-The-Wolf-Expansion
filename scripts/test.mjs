import { build } from "esbuild";
import { rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";

const root = process.cwd();
const outputDirectory = path.join(root, ".test-dist");
const tests = [
  "tests/accountIdentity.test.ts",
  "tests/accountScopeTransition.test.ts",
  "tests/accountScopedStorage.test.ts",
  "tests/backup.test.ts",
  "tests/conversationIdentity.test.ts",
  "tests/conversationUrl.test.ts",
  "tests/dragIndicatorState.test.ts",
  "tests/favorites.test.ts",
  "tests/fixturePrivacy.test.ts",
  "tests/folders.test.ts",
  "tests/folderDisplayMode.test.ts",
  "tests/folderNameEditorState.test.ts",
  "tests/hierarchyLayout.test.ts",
  "tests/itemNameDisplay.test.ts",
  "tests/interactionPolish.test.ts",
  "tests/legacyAccountRecovery.test.ts",
  "tests/menuContext.test.ts",
  "tests/nativeConversationActions.test.ts",
  "tests/outsideInteraction.test.ts",
  "tests/quickAccess.test.ts",
  "tests/quickAccessMembership.test.ts",
  "tests/refreshGeneration.test.ts",
  "tests/settings.test.ts",
  "tests/settingsIcon.test.ts",
  "tests/sidebarPlacement.test.ts",
  "tests/treeBranchMetadata.test.ts",
];

await rm(outputDirectory, { recursive: true, force: true });

try {
  await build({
    entryPoints: tests,
    bundle: true,
    entryNames: "[name]",
    format: "esm",
    outdir: outputDirectory,
    platform: "node",
    target: "node20",
    sourcemap: false,
    logLevel: "warning",
  });

  const generatedTests = tests.map((testFile) =>
    path.join(outputDirectory, `${path.basename(testFile, ".ts")}.js`),
  );
  const testProcess = spawn(process.execPath, ["--test", ...generatedTests], {
    cwd: root,
    stdio: "inherit",
  });
  const exitCode = await new Promise((resolve, reject) => {
    testProcess.once("error", reject);
    testProcess.once("exit", (code) => resolve(code ?? 1));
  });
  if (exitCode !== 0) {
    process.exitCode = exitCode;
  }
} finally {
  await rm(outputDirectory, { recursive: true, force: true });
}
