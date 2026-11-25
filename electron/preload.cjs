const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronBluetooth', {
  onDeviceList: (handler) => {
    const listener = (_event, devices) => handler(devices);
    ipcRenderer.on('bt:device-list', listener);
    return () => ipcRenderer.removeListener('bt:device-list', listener);
  },
  selectDevice: (deviceId) => {
    ipcRenderer.send('bt:select-device', deviceId);
  },
});

contextBridge.exposeInMainWorld('electronVoice', {
  start: () => ipcRenderer.send('voice:start'),
  stop: () => ipcRenderer.send('voice:stop'),
  onEvent: (handler) => {
    const listener = (_event, payload) => handler(payload);
    ipcRenderer.on('voice:event', listener);
    return () => ipcRenderer.removeListener('voice:event', listener);
  },
});

contextBridge.exposeInMainWorld('electronCourses', {
  list: () => ipcRenderer.invoke('courses:list'),
  load: (id) => ipcRenderer.invoke('courses:load', id),
  importRoute: () => ipcRenderer.invoke('courses:import'),
  deleteCourse: (id) => ipcRenderer.invoke('courses:delete', id),
  onImportProgress: (handler) => {
    const listener = (_event, payload) => handler(payload);
    ipcRenderer.on('courses:import-progress', listener);
    return () => ipcRenderer.removeListener('courses:import-progress', listener);
  },
});
