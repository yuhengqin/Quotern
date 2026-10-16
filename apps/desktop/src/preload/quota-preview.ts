import { contextBridge, ipcRenderer } from 'electron';

// Window controls only. The preview renderer owns all fictional quota data.
contextBridge.exposeInMainWorld('tudQuotaPreview', {
  platform: process.platform,
  minimize: () => ipcRenderer.send('window:minimize'),
  toggleMaximize: () => ipcRenderer.send('window:toggle-maximize'),
  close: () => ipcRenderer.send('window:close'),
  onMaximized: (callback: (value: boolean) => void) => {
    const listener = (_event: unknown, value: boolean) => callback(value === true);
    ipcRenderer.on('window:is-maximized', listener);
    return () => ipcRenderer.removeListener('window:is-maximized', listener);
  },
});
