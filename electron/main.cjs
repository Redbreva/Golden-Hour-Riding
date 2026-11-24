const { app, BrowserWindow, ipcMain, session } = require('electron');
const path = require('path');

// Enable Web Bluetooth features in Electron's Chromium runtime
app.commandLine.appendSwitch('enable-experimental-web-platform-features');
app.commandLine.appendSwitch('enable-web-bluetooth');

let mainWindow = null;
let pendingBtCallback = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    backgroundColor: '#0b0a09',
    title: 'Golden Hour Riding',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  // Grant Bluetooth & media permissions for smart trainer + voice control
  session.defaultSession.setPermissionCheckHandler((_wc, permission) => {
    return ['bluetooth', 'media', 'audioCapture'].includes(permission);
  });
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(['bluetooth', 'media', 'audioCapture'].includes(permission));
  });

  // Bridge Chromium's select-bluetooth-device event to our in-app picker UI
  mainWindow.webContents.on('select-bluetooth-device', (event, deviceList, callback) => {
    event.preventDefault();
    pendingBtCallback = callback;
    const devices = deviceList.map((d) => ({
      deviceId: d.deviceId,
      deviceName: d.deviceName || 'Unnamed Bluetooth Device',
    }));
    mainWindow.webContents.send('bt:device-list', devices);
  });

  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
    if (pendingBtCallback) {
      pendingBtCallback('');
      pendingBtCallback = null;
    }
  });
}

ipcMain.on('bt:select-device', (_event, deviceId) => {
  if (pendingBtCallback) {
    const cb = pendingBtCallback;
    pendingBtCallback = null;
    cb(deviceId || '');
  }
});

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
