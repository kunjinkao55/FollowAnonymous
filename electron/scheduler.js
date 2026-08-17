const db = require('../lib/db');
const config = require('../lib/config');
const { getProvider } = require('../providers');
const notify = require('../lib/notify');
const events = require('../lib/events');

let timer = null;
let running = false;

function start() {
  if (timer) return;
  events.emit('scheduler:started');
  scheduleNext();
}

function stop() {
  clearTimeout(timer);
  timer = null;
}

function scheduleNext() {
  const cfg = config.get();
  const base = (cfg.pollIntervalMinutes || 15) * 60000;
  const jitter = (cfg.pollJitterMinutes || 10) * 60000 * Math.random();
  const delay = Math.max(base, 60000) + jitter;
  timer = setTimeout(() => {
    timer = null;
    runAll()
      .catch(() => {})
      .finally(() => scheduleNext());
  }, delay);
}

function enabledProfiles() {
  return db.listProfiles().filter((p) => p.enabled);
}

async function runAll() {
  if (running) {
    return { skipped: true };
  }
  running = true;
  const profiles = enabledProfiles();
  const results = [];
  try {
    for (const p of profiles) {
      results.push(await runCheck(p.id));
    }
  } finally {
    running = false;
  }
  events.emit('check:done', { at: new Date().toISOString(), results });
  notify.flushEmail().catch(() => {});
  return { results };
}

async function runCheck(profileId) {
  const profile = db.getProfile(profileId);
  if (!profile) return { profileId, ok: false, error: '主页不存在' };
  const provider = getProvider(profile.platform);
  const now = new Date().toISOString();

  if (!provider) {
    db.updateProfile(profileId, {
      last_checked_at: now,
      status: 'error',
      last_error: '未知平台',
    });
    return { profileId, ok: false, error: '未知平台' };
  }

  try {
    const res = await provider.fetchRecent(profile);
    const added = db.insertNewPosts(profileId, res.posts);
    const displayName = res.name || profile.display_name || profile.uid;
    const fields = {
      last_checked_at: now,
      last_success_at: now,
      status: 'ok',
      last_error: null,
      last_notice: null,
    };
    if (res.name) fields.display_name = res.name;
    if (profile.platform === 'douyin' && res.posts.length <= 3 && res.posts.length > 0) {
      fields.last_notice = '游客模式仅展示部分内容，最新视频可能延迟';
    }
    db.updateProfile(profileId, fields);
    if (added.length) {
      notify.pushNewPosts({ ...profile, display_name: displayName }, added);
    }
    return { profileId, ok: true, added: added.length };
  } catch (err) {
    const code = err.code || 'ERROR';
    const limited = code === 'GUEST_LIMITED' || code === 'NETWORK';
    db.updateProfile(profileId, {
      last_checked_at: now,
      status: limited ? 'limited' : 'error',
      last_error: err.message,
      last_notice: null,
    });
    return { profileId, ok: false, error: err.message, code };
  }
}

module.exports = { start, stop, runAll, runCheck, enabledProfiles };