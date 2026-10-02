const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('node:path');

function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: 'Peeranki',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.cjs'),
    },
  });

  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;

    if (input.key === 'F11') {
      event.preventDefault();
      mainWindow.setFullScreen(!mainWindow.isFullScreen());
    } else if (input.key === 'Escape' && mainWindow.isFullScreen()) {
      event.preventDefault();
      mainWindow.setFullScreen(false);
    }
  });
  mainWindow.on('enter-full-screen', () => {
    mainWindow.webContents.send('peeranki:fullscreen-changed', true);
  });
  mainWindow.on('leave-full-screen', () => {
    mainWindow.webContents.send('peeranki:fullscreen-changed', false);
  });
  mainWindow.loadFile(
    path.join(__dirname, '..', 'dist', 'index.html'),
  );

}

ipcMain.handle('peeranki:set-fullscreen', (event, fullscreen) => {
  const window = BrowserWindow.fromWebContents(event.sender);
  if (!window || typeof fullscreen !== 'boolean') return false;
  window.setFullScreen(fullscreen);
  return window.isFullScreen();
});

ipcMain.handle('peeranki:quit', (event) => {
  const window = BrowserWindow.fromWebContents(event.sender);
  window?.close();
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
