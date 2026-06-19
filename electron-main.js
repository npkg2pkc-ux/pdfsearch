const path = require('path');
const { app, BrowserWindow } = require('electron');
const { spawn } = require('child_process');
const fetch = require('node-fetch');

let serverProcess = null;
const PORT = process.env.PORT || 3000;

function startServer() {
  // set DB and uploads to userData directory
  const userData = app.getPath('userData');
  process.env.DB_PATH = path.join(userData, 'data.db');
  process.env.UPLOAD_DIR_FALLBACK = path.join(userData, 'uploads');
  process.env.PORT = String(PORT);

  // fork server.js as a child process
  const serverPath = path.join(__dirname, 'server.js');
  serverProcess = spawn(process.execPath, [serverPath], { env: process.env, stdio: 'inherit' });

  serverProcess.on('exit', (code) => {
    console.log('Server process exited with', code);
  });
}

async function waitForServer() {
  const url = `http://localhost:${PORT}/api/settings`;
  for (let i = 0; i < 40; i++) {
    try {
      const r = await fetch(url, { timeout: 2000 });
      if (r.ok) return;
    } catch (e) {}
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('Server did not start in time');
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });
  win.loadURL(`http://localhost:${PORT}`);
}

app.whenReady().then(async () => {
  startServer();
  try {
    await waitForServer();
    createWindow();
  } catch (err) {
    console.error('Failed to start server:', err);
  }

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('before-quit', () => {
  if (serverProcess) {
    serverProcess.kill();
  }
});
