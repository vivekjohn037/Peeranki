const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('peerankiDesktop', {
  setFullscreen: (fullscreen) =>
    ipcRenderer.invoke('peeranki:set-fullscreen', fullscreen),
  onFullscreenChange: (callback) => {
    const listener = (_event, fullscreen) => callback(fullscreen);
    ipcRenderer.on('peeranki:fullscreen-changed', listener);
    return () => ipcRenderer.removeListener('peeranki:fullscreen-changed', listener);
  },
  quit: () => ipcRenderer.invoke('peeranki:quit'),
});
