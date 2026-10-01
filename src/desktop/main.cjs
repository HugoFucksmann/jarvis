const { app, BrowserWindow, globalShortcut, Tray, Menu, ipcMain, nativeImage, shell, screen } = require('electron');
const path = require('path');

const WINDOW_WIDTH = 740;
// Altura inicial = la de antes; el renderer la ajusta al contenido vía jarvis:resizeHeight.
// Si preload no expone resizeHeight, el comportamiento es idéntico al anterior.
const INITIAL_HEIGHT = 480;
const MIN_HEIGHT = 80; // barra (56px) + padding de ventana (24px)
const MAX_HEIGHT = 750;

let mainWindow = null;
let tray = null;

const isAlive = () => mainWindow && !mainWindow.isDestroyed();

function showWindow() {
  if (!isAlive()) {
    createWindow();
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

// Single instance lock
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', showWindow);
}

// ── IPC: se registra UNA sola vez (antes se duplicaba al recrear la ventana) ──
ipcMain.on('jarvis:openExternal', (_event, targetUrl) => {
  if (typeof targetUrl === 'string' && /^https?:\/\//i.test(targetUrl)) {
    shell.openExternal(targetUrl);
  }
});

ipcMain.on('jarvis:show', showWindow);

ipcMain.on('jarvis:wakeWordTriggered', (_event, phrase) => {
  console.log('[JARVIS Desktop] Wake word triggered:', phrase);
  showWindow();
});

ipcMain.on('jarvis:hide', () => {
  if (isAlive()) mainWindow.hide();
});

ipcMain.on('jarvis:minimize', () => {
  if (isAlive()) mainWindow.minimize();
});

ipcMain.on('jarvis:close', () => {
  if (isAlive()) mainWindow.close();
});

ipcMain.on('jarvis:resizeHeight', (_event, height) => {
  if (!isAlive()) return;
  const requested = Number(height);
  if (!Number.isFinite(requested)) return;

  const bounds = mainWindow.getBounds();
  const { workArea } = screen.getDisplayMatching(bounds);
  // Nunca crecer más allá del borde inferior de la pantalla
  const maxByScreen = Math.max(workArea.y + workArea.height - bounds.y, MIN_HEIGHT);
  const next = Math.round(Math.min(Math.max(requested, MIN_HEIGHT), MAX_HEIGHT, maxByScreen));

  if (next !== bounds.height) mainWindow.setSize(bounds.width, next);
});

function createWindow() {
  // Barra anclada en el tercio superior: al crecer hacia abajo no se sale de pantalla
  const { workArea } = screen.getPrimaryDisplay();
  const x = Math.round(workArea.x + (workArea.width - WINDOW_WIDTH) / 2);
  const y = Math.round(workArea.y + workArea.height * 0.12);

  mainWindow = new BrowserWindow({
    x,
    y,
    width: WINDOW_WIDTH,
    height: INITIAL_HEIGHT,
    title: 'J.A.R.V.I.S.',
    backgroundColor: '#00000000',
    transparent: true,
    frame: false, // HUD flotante sin marco
    hasShadow: true,
    // La altura la gobierna el contenido; redimensionar a mano pelearía con resizeHeight
    resizable: false,
    minWidth: 520,
    minHeight: MIN_HEIGHT,
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

  // Enlaces externos en el navegador del sistema
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  mainWindow.webContents.on('before-input-event', (_event, input) => {
    if (input.key === 'F5' || (input.control && input.key.toLowerCase() === 'r')) {
      mainWindow.reload();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
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
      { label: 'Mostrar JARVIS', click: showWindow },
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
    tray.on('click', toggleWindow);
  } catch (err) {
    console.error('Tray init error:', err);
  }
}

function toggleWindow() {
  if (!isAlive()) {
    createWindow();
    return;
  }
  if (mainWindow.isVisible()) {
    mainWindow.hide();
  } else {
    showWindow();
  }
}

app.whenReady().then(() => {
  createWindow();
  createTray();

  ['Ctrl+Space', 'Alt+Space', 'CommandOrControl+Shift+J'].forEach((hk) => {
    try {
      const ok = globalShortcut.register(hk, toggleWindow);
      if (!ok) console.warn(`[JARVIS Desktop] Atajo no disponible (en uso): ${hk}`);
    } catch (err) {
      console.warn(`[JARVIS Desktop] Error registrando atajo ${hk}:`, err);
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