const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const { spawnSync } = require("child_process");
const { app, BrowserWindow, dialog, shell } = require("electron");

let mainWindow = null;
let localServer = null;

function writeDesktopLog(error) {
  try {
    const logDirectory = path.join(app.getPath("userData"), "logs");
    fs.mkdirSync(logDirectory, { recursive: true });
    const detail = error && error.stack ? error.stack : String(error || "Unknown desktop error");
    fs.appendFileSync(path.join(logDirectory, "gameframe-errors.log"), `[${new Date().toISOString()}] ${detail}\n`, "utf8");
  } catch (_) {}
}

function createAutomaticBackup(databasePath) {
  if (!fs.existsSync(databasePath)) return;
  const backupDirectory = path.join(path.dirname(databasePath), "backups");
  fs.mkdirSync(backupDirectory, { recursive: true });
  const day = new Date().toISOString().slice(0, 10);
  const destination = path.join(backupDirectory, `GameFrame-auto-${day}.db`);
  if (!fs.existsSync(destination)) fs.copyFileSync(databasePath, destination);
  const backups = fs.readdirSync(backupDirectory)
    .filter((name) => /^GameFrame-auto-\d{4}-\d{2}-\d{2}\.db$/.test(name))
    .sort()
    .reverse();
  for (const oldName of backups.slice(5)) fs.unlinkSync(path.join(backupDirectory, oldName));
}

function unpackedBinaryPath(binaryPath) {
  return binaryPath.replace("app.asar", "app.asar.unpacked");
}

function desktopApiUrl() {
  if (process.env.GAMEFRAME_API_URL) return process.env.GAMEFRAME_API_URL;
  try {
    const config = JSON.parse(fs.readFileSync(path.join(__dirname, "config.json"), "utf8"));
    return String(config.apiUrl || "");
  } catch (_) {
    return "";
  }
}

function deviceIdentifier() {
  let source = "";
  if (process.platform === "win32") {
    const result = spawnSync("reg.exe", [
      "query", "HKLM\\SOFTWARE\\Microsoft\\Cryptography", "/v", "MachineGuid",
    ], { encoding: "utf8", windowsHide: true });
    const match = String(result.stdout || "").match(/MachineGuid\s+REG_SZ\s+([^\r\n]+)/i);
    if (match) source = match[1].trim();
  }
  if (!source) {
    const fallbackPath = path.join(app.getPath("userData"), ".device-id");
    try {
      source = fs.readFileSync(fallbackPath, "utf8").trim();
    } catch (_) {
      source = crypto.randomUUID();
      fs.mkdirSync(path.dirname(fallbackPath), { recursive: true });
      fs.writeFileSync(fallbackPath, source, "utf8");
    }
  }
  return crypto.createHash("sha256").update(`gameframe-device-v1:${source}`).digest("hex");
}

async function launchGameFrame() {
  const dataDirectory = path.join(app.getPath("userData"), "data");
  process.env.DB_PATH = path.join(dataDirectory, "gameframe.db");
  createAutomaticBackup(process.env.DB_PATH);
  process.env.GAMEFRAME_DESKTOP = "1";
  process.env.GAMEFRAME_API_URL = desktopApiUrl();
  process.env.GAMEFRAME_DEVICE_ID = deviceIdentifier();
  process.env.GAMEFRAME_APP_VERSION = app.getVersion();
  process.env.FFMPEG_PATH = unpackedBinaryPath(require("ffmpeg-static"));
  process.env.FFPROBE_PATH = unpackedBinaryPath(require("ffprobe-static").path);

  const { startServer } = require("../server");
  localServer = startServer(0, "127.0.0.1");

  await new Promise((resolve, reject) => {
    localServer.once("listening", resolve);
    localServer.once("error", reject);
  });

  const address = localServer.address();
  const url = `http://127.0.0.1:${address.port}`;

  mainWindow = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 900,
    minHeight: 650,
    backgroundColor: "#ffffff",
    title: "GameFrame",
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });

  mainWindow.webContents.setWindowOpenHandler(({ url: targetUrl }) => {
    if (/^https?:\/\//i.test(targetUrl)) shell.openExternal(targetUrl);
    return { action: "deny" };
  });
  mainWindow.webContents.on("render-process-gone", (_event, details) => {
    writeDesktopLog(new Error(`Renderer stopped: ${details.reason} (${details.exitCode})`));
  });

  await mainWindow.loadURL(url);
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

app.whenReady().then(launchGameFrame).catch((error) => {
  writeDesktopLog(error);
  dialog.showErrorBox(
    "GameFrame could not start",
    error && error.message ? error.message : String(error)
  );
  app.quit();
});

process.on("uncaughtException", (error) => {
  writeDesktopLog(error);
  app.quit();
});
process.on("unhandledRejection", (error) => writeDesktopLog(error));

app.on("activate", () => {
  if (!mainWindow) launchGameFrame();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  if (localServer) {
    localServer.close();
    localServer = null;
  }
});
