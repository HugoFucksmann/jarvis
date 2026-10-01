const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  show: () => ipcRenderer.send('jarvis:show'),
  hide: () => ipcRenderer.send('jarvis:hide'),
  minimize: () => ipcRenderer.send('jarvis:minimize'),
  close: () => ipcRenderer.send('jarvis:close'),
  resizeHeight: (height) => ipcRenderer.send('jarvis:resizeHeight', height),
  openExternal: (url) => ipcRenderer.send('jarvis:openExternal', url),
  wakeWordTriggered: (phrase) => ipcRenderer.send('jarvis:wakeWordTriggered', phrase),
});
