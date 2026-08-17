const { ipcMain, Notification } = require('electron');
const db = require('../lib/db');
const config = require('../lib/config');
const events = require('../lib/events');
const notify = require('../lib/notify');
const { detectAndParse } = require('../providers');
const scheduler = require('./scheduler');

let currentWindow = null;

function setWindow(win) {
  currentWindow = win;
}

const CHANNELS = [
  'profiles:list',
  'profiles:add',
  'profiles:remove',
  'profiles:setEnabled',
  'profiles:checkNow',
  'profiles:listPosts',
  'settings:get',
  'settings:save',
  'settings:testSmtp',
  'notifications:list',
  'notifications:markRead',
  'notifications:unread',
];

function register() {
  for (const ch of CHANNELS) {
    try {
      ipcMain.removeHandler(ch);
    } catch {}
  }

  ipcMain.handle('profiles:list', () => db.listProfiles());

  ipcMain.handle('profiles:add', async (e, url) => {
    const { meta } = await detectAndParse(url);
    return db.addProfile({
      platform: meta.platform,
      uid: meta.uid,
      display_name: meta.name || '',
      url: meta.url,
    });
  });

  ipcMain.handle('profiles:remove', (e, id) => {
    db.removeProfile(id);
    return true;
  });

  ipcMain.handle('profiles:setEnabled', (e, id, enabled) => {
    return db.updateProfile(id, { enabled: enabled ? 1 : 0 });
  });

  ipcMain.handle('profiles:checkNow', async (e, id) => {
    if (id) return scheduler.runCheck(id);
    return scheduler.runAll();
  });

  ipcMain.handle('profiles:listPosts', (e, profileId, limit) => db.listPosts(profileId, limit || 50));

  ipcMain.handle('settings:get', () => config.get());
  ipcMain.handle('settings:save', (e, next) => config.save(next));
  ipcMain.handle('settings:testSmtp', async () => {
    await notify.testEmail();
    return { ok: true };
  });

  ipcMain.handle('notifications:list', (e, limit) => db.listNotifications(limit || 200));
  ipcMain.handle('notifications:markRead', (e, ids) => db.markNotificationsRead(ids));
  ipcMain.handle('notifications:unread', () => db.countUnread());

  if (events.listenerCount('notification:new') === 0) {
    events.on('notification:new', (notifs) => {
      const wc = currentWindow?.webContents;
      if (wc && !currentWindow.isDestroyed()) wc.send('notification:new', notifs);
      for (const n of notifs) {
        if (config.get().settings?.systemNotifications) {
          try {
            new Notification({ title: n.title, body: n.body, silent: true }).show();
          } catch {
            /* ignore */
          }
        }
      }
    });
  }

  if (events.listenerCount('check:done') === 0) {
    events.on('check:done', (result) => {
      const wc = currentWindow?.webContents;
      if (wc && !currentWindow.isDestroyed()) wc.send('check:done', result);
    });
  }

  if (events.listenerCount('scheduler:started') === 0) {
    events.on('scheduler:started', () => {
      const wc = currentWindow?.webContents;
      if (wc && !currentWindow.isDestroyed()) wc.send('scheduler:started');
    });
  }
}

module.exports = { register, setWindow };