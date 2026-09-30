const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  hide: () => ipcRenderer.send('jarvis:hide'),
  minimize: () => ipcRenderer.send('jarvis:minimize'),
  close: () => ipcRenderer.send('jarvis:close'),
  resizeHeight: (height) => ipcRenderer.send('jarvis:resizeHeight', height),
  openExternal: (url) => ipcRenderer.send('jarvis:openExternal', url),
});
