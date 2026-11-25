const { app, BrowserWindow, dialog, ipcMain, session } = require('electron');
const path = require('path');
const { createVoiceService } = require('./voice-service.cjs');
const {
  importRouteFile,
  listPersonalCourses,
  loadPersonalCourseData,
  deletePersonalCourse,
} = require('./route-importer.cjs');

// Enable Web Bluetooth and immediate desktop audio in Electron's Chromium runtime
app.commandLine.appendSwitch('enable-experimental-web-platform-features');
app.commandLine.appendSwitch('enable-web-bluetooth');
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

let mainWindow = null;
let pendingBtCallback = null;
const voiceService = createVoiceService(ipcMain, () => mainWindow);

const iconPath = path.join(__dirname, '..', 'build', 'icon.png');

function createWindow() {
  if (process.platform === 'darwin' && app.dock) {
    app.dock.setIcon(iconPath);
  }

  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    backgroundColor: '#0b0a09',
    title: 'Golden Hour Riding',
    icon: iconPath,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  // Grant Bluetooth permissions for smart trainers
  session.defaultSession.setPermissionCheckHandler((_wc, permission) => {
    return permission === 'bluetooth';
  });
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(permission === 'bluetooth');
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

  mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));

  mainWindow.on('closed', () => {
    mainWindow = null;
    voiceService.stop();
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

// Personal route library & GPX/FIT/TCX importer
const getCoursesDir = () => path.join(app.getPath('userData'), 'courses');

ipcMain.handle('courses:list', () => listPersonalCourses(getCoursesDir()));

ipcMain.handle('courses:load', (_event, courseId) => loadPersonalCourseData(getCoursesDir(), courseId));

ipcMain.handle('courses:delete', (_event, courseId) => deletePersonalCourse(getCoursesDir(), courseId));

ipcMain.handle('courses:import', async () => {
  if (!mainWindow) return { canceled: true };
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Import Route (GPX, FIT, or TCX)',
    properties: ['openFile'],
    filters: [
      { name: 'Cycling Routes', extensions: ['gpx', 'fit', 'tcx'] },
      { name: 'All Files', extensions: ['*'] },
    ],
  });
  if (result.canceled || !result.filePaths.length) {
    return { canceled: true };
  }
  const filePath = result.filePaths[0];
  try {
    const meta = await importRouteFile(filePath, getCoursesDir(), (message) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('courses:import-progress', { message });
      }
    });
    return { canceled: false, course: meta };
  } catch (err) {
    return { canceled: false, error: err.message || String(err) };
  }
});

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
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
}

app.on('window-all-closed', () => {
  voiceService.stop();
  app.quit();
});
