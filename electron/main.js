const { app, BrowserWindow, Tray, Menu, nativeImage } = require('electron');
const path = require('path');
const config = require('../lib/config');
const db = require('../lib/db');
const events = require('../lib/events');
const ipc = require('./ipc');
const scheduler = require('./scheduler');
const browser = require('../lib/browser');

// 16x16 privacy-eye tray icon (base64 PNG)
const TRAY_ICON_DATA_URL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAWElEQVR4nGNgoDb4TwBQpBmvIcRqxmoIqZoxDMGj4D8+8/EaANOMzxC4AV4THv1HxuiaYRiLOhoZgM0QHGpwG4BsCB55/AYQwihpgSLNpBqCNz9QpJkcAABvTP7WxxEv9gAAAABJRU5ErkJggg==';

let mainWindow = null;
let tray = null;
let quitting = false;

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    config.load();
    db.open();
    events.setMaxListeners(100);

    mainWindow = createWindow();
    ipc.setWindow(mainWindow);
    ipc.register();
    createTray();
    scheduler.start();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        mainWindow = createWindow();
        ipc.setWindow(mainWindow);
        ipc.register();
      }
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin' && !quitting) {
      if (config.get().settings?.closeToTray !== true) {
        quitting = true;
        app.quit();
      }
    }
  });

  app.on('before-quit', async (e) => {
    if (quitting) return;
    e.preventDefault();
    quitting = true;
    try {
      scheduler.stop();
    } catch {}
    try {
      await browser.close();
    } catch {}
    try {
      db.closeDb();
    } catch {}
    app.quit();
  });

  process.on('uncaughtException', (err) => {
    console.error('[uncaughtException]', err);
  });
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1080,
    height: 720,
    minWidth: 760,
    minHeight: 520,
    title: 'FollowAnonymous',
    titleBarStyle: 'default',
    backgroundColor: '#f5f6fa',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
    },
  });
  win.loadFile(path.join(__dirname, '..', 'src', 'index.html'));

  win.on('close', (e) => {
    if (!quitting && config.get().settings?.closeToTray === true) {
      e.preventDefault();
      win.hide();
    }
  });

  return win;
}

function createTray() {
  const icon = nativeImage.createFromDataURL(TRAY_ICON_DATA_URL);
  tray = new Tray(icon);
  tray.setToolTip('FollowAnonymous - 匿名监听');
  const menu = Menu.buildFromTemplate([
    {
      label: '显示主窗口',
      click: () => {
        mainWindow.show();
        mainWindow.focus();
      },
    },
    { type: 'separator' },
    {
      label: '立即检查全部主页',
      click: () => {
        scheduler.runAll().catch(() => {});
      },
    },
    { type: 'separator' },
    {
      label: '退出',
      click: () => {
        quitting = true;
        app.quit();
      },
    },
  ]);
  tray.setContextMenu(menu);
  tray.on('double-click', () => {
    mainWindow.show();
    mainWindow.focus();
  });
}