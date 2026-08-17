const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  profiles: {
    list: () => ipcRenderer.invoke('profiles:list'),
    add: (url) => ipcRenderer.invoke('profiles:add', url),
    remove: (id) => ipcRenderer.invoke('profiles:remove', id),
    setEnabled: (id, enabled) => ipcRenderer.invoke('profiles:setEnabled', id, enabled),
    checkNow: (id) => ipcRenderer.invoke('profiles:checkNow', id),
    listPosts: (id, limit) => ipcRenderer.invoke('profiles:listPosts', id, limit),
  },
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    save: (settings) => ipcRenderer.invoke('settings:save', settings),
    testSmtp: () => ipcRenderer.invoke('settings:testSmtp'),
  },
  notifications: {
    list: (limit) => ipcRenderer.invoke('notifications:list', limit),
    markRead: (ids) => ipcRenderer.invoke('notifications:markRead', ids),
    clear: () => ipcRenderer.invoke('notifications:clear'),
    unread: () => ipcRenderer.invoke('notifications:unread'),
  },
  on: (channel, cb) => {
    ipcRenderer.on(channel, (event, payload) => cb(payload));
  },
});