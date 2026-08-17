const { app } = require('electron');
const fs = require('fs');
const path = require('path');

let dataDir = null;
let settings = {};

function dataDirectory() {
  if (dataDir) return dataDir;
  dataDir = path.join(app.getPath('userData'), 'follow-anonymous');
  fs.mkdirSync(dataDir, { recursive: true });
  return dataDir;
}

function configPath() {
  return path.join(dataDirectory(), 'config.json');
}

const DEFAULTS = {
  pollIntervalMinutes: 15,
  pollJitterMinutes: 10,
  checkConcurrency: 1,
  smtp: {
    enabled: false,
    host: '',
    port: 465,
    secure: true,
    user: '',
    pass: '',
    from: '',
    to: '',
    batchMinutes: 30,
  },
  proxy: {
    enabled: false,
    url: '',
  },
  settings: {
    systemNotifications: true,
    closeToTray: false,
  },
};

function mergeDefaults() {
  settings = {
    ...DEFAULTS,
    ...settings,
    smtp: { ...DEFAULTS.smtp, ...(settings.smtp || {}) },
    proxy: { ...DEFAULTS.proxy, ...(settings.proxy || {}) },
    settings: { ...DEFAULTS.settings, ...(settings.settings || {}) },
  };
  return settings;
}

function load() {
  try {
    const raw = fs.readFileSync(configPath(), 'utf-8');
    settings = JSON.parse(raw);
  } catch {
    settings = {};
  }
  mergeDefaults();
  return settings;
}

function get() {
  return mergeDefaults();
}

function save(next) {
  if (next) settings = { ...settings, ...next };
  mergeDefaults();
  fs.writeFileSync(configPath(), JSON.stringify(settings, null, 2));
  return settings;
}

module.exports = { load, get, save, dataDirectory, configPath, DEFAULTS };