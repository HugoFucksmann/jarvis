const { app, BrowserWindow, globalShortcut, Tray, Menu, ipcMain, nativeImage } = require('electron');
const path = require('path');

let mainWindow = null;
let tray = null;

// Single instance lock
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 740,
    height: 480,
    center: true,
    title: 'J.A.R.V.I.S.',
    backgroundColor: '#00000000',
    transparent: true,
    frame: false, // Frameless floating HUD for true native luxury feel
    hasShadow: true,
    resizable: true,
    minWidth: 520,
    minHeight: 360,
    autoHideMenuBar: true,
    show: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.resolve(__dirname, 'preload.cjs'),
      backgroundThrottling: false,
      webSecurity: false,
    },
  });

  const localHtml = path.resolve(__dirname, '../../public/native.html');
  mainWindow.loadFile(localHtml).catch((err) => {
    console.error('Error cargando la interfaz nativa:', err);
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Window IPC handlers
  ipcMain.on('jarvis:hide', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.hide();
    }
  });

  ipcMain.on('jarvis:minimize', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.minimize();
    }
  });

  ipcMain.on('jarvis:close', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.close();
    }
  });

  ipcMain.on('jarvis:resizeHeight', (_event, height) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      const [w] = mainWindow.getSize();
      mainWindow.setSize(w, Math.min(Math.max(Math.round(height), 200), 750));
    }
  });
}

function createTray() {
  try {
    const iconCanvas = nativeImage.createFromBuffer(
      Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAZElEQVQ4T2NkoBAwUqifgWoG/P//n5GBgYGBkZERw2J8BpA1MDIyMhI2gCgX4jSAYgPQDcCkAYsBhDWAyAZiYwCpBsAYyA1A0wB0E5BsAGkGYFkDswFsBgAbgO57Ug2g2AByAABiCRbxsKqBgwAAAABJRU5ErkJggg==',
        'base64'
      )
    );

    tray = new Tray(iconCanvas);
    tray.setToolTip('J.A.R.V.I.S. - Sistema Activo');

    const contextMenu = Menu.buildFromTemplate([
      {
        label: 'Mostrar JARVIS',
        click: () => {
          if (mainWindow) {
            mainWindow.show();
            mainWindow.focus();
          } else {
            createWindow();
          }
        },
      },
      { type: 'separator' },
      {
        label: 'Salir',
        click: () => {
          app.isQuitting = true;
          app.quit();
        },
      },
    ]);

    tray.setContextMenu(contextMenu);
    tray.on('click', () => {
      toggleWindow();
    });
  } catch (err) {
    console.error('Tray init error:', err);
  }
}

function toggleWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow();
    return;
  }
  if (mainWindow.isVisible()) {
    mainWindow.hide();
  } else {
    mainWindow.show();
    mainWindow.focus();
  }
}

app.whenReady().then(() => {
  createWindow();
  createTray();

  ['Ctrl+Space', 'Alt+Space', 'CommandOrControl+Shift+J'].forEach((hk) => {
    try {
      globalShortcut.register(hk, () => {
        toggleWindow();
      });
    } catch (_err) {
      // ignore shortcut registration conflict
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});
