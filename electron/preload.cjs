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
