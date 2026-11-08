const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const root = path.resolve(__dirname, "..");
const stage = fs.mkdtempSync(path.join(os.tmpdir(), "gameframe-electron-build-"));
const excludedAtRoot = new Set([".git", "node_modules", "dist", "app.db"]);

function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, stdio: "inherit", windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} failed with exit code ${result.status}`);
}

function verifyPackagedDatabase() {
  const unpackedDirectory = path.join(stage, "dist", "win-unpacked");
  const packagedExecutable = path.join(unpackedDirectory, "GameFrame.exe");
  const smokeTest = [
    "const Database = require('./resources/app.asar/node_modules/better-sqlite3');",
    "const database = new Database(':memory:');",
    "database.prepare('SELECT 1').get();",
    "database.close();",
    "process.stdout.write('SQLITE_OK');"
  ].join("");
  const result = spawnSync(packagedExecutable, ["-e", smokeTest], {
    cwd: unpackedDirectory,
    encoding: "utf8",
    windowsHide: true,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" }
  });
  if (result.error) throw result.error;
  if (result.status !== 0 || !String(result.stdout).includes("SQLITE_OK")) {
    throw new Error(`Packaged database smoke test failed: ${result.stderr || result.stdout || `exit ${result.status}`}`);
  }
  console.log("Packaged Electron database verified (SQLITE_OK).");
}

function safeRemoveStage() {
  const tempRoot = path.resolve(os.tmpdir()) + path.sep;
  const resolved = path.resolve(stage);
  if (!resolved.startsWith(tempRoot) || !path.basename(resolved).startsWith("gameframe-electron-build-")) {
    throw new Error(`Refusing to remove unexpected staging path: ${resolved}`);
  }
  fs.rmSync(resolved, { recursive: true, force: true });
}

try {
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (excludedAtRoot.has(entry.name)) continue;
    fs.cpSync(path.join(root, entry.name), path.join(stage, entry.name), { recursive: true });
  }

  const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
  const npxCommand = process.platform === "win32" ? "npx.cmd" : "npx";
  run(npmCommand, ["ci"], stage);
  run(npxCommand, ["--no-install", "electron-builder", "--win", "nsis", "portable"], stage);
  verifyPackagedDatabase();

  const outputDirectory = path.join(root, "dist");
  fs.mkdirSync(outputDirectory, { recursive: true });
  for (const name of fs.readdirSync(path.join(stage, "dist"))) {
    if (!/\.exe$|\.blockmap$|builder-effective-config\.yaml$/i.test(name)) continue;
    fs.copyFileSync(path.join(stage, "dist", name), path.join(outputDirectory, name));
  }
  console.log(`Clean Electron build copied to ${outputDirectory}`);
  safeRemoveStage();
} catch (error) {
  console.error(error && error.stack ? error.stack : error);
  console.error(`Build staging retained for diagnosis: ${stage}`);
  process.exitCode = 1;
}
