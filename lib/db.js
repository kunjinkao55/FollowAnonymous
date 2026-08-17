const Database = require('better-sqlite3');
const path = require('path');
const { dataDirectory } = require('./config');

let db = null;

function open() {
  if (db) return db;
  db = new Database(path.join(dataDirectory(), 'follow.db'));
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS profiles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      platform TEXT NOT NULL,
      uid TEXT NOT NULL,
      display_name TEXT NOT NULL DEFAULT '',
      url TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      poll_interval_minutes INTEGER,
      last_checked_at TEXT,
      last_success_at TEXT,
      last_error TEXT,
      status TEXT NOT NULL DEFAULT 'ok',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(platform, uid)
    );

    CREATE TABLE IF NOT EXISTS posts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      profile_id INTEGER NOT NULL,
      post_id TEXT NOT NULL,
      author TEXT NOT NULL DEFAULT '',
      content TEXT NOT NULL DEFAULT '',
      published_at TEXT,
      post_url TEXT NOT NULL DEFAULT '',
      media TEXT NOT NULL DEFAULT '[]',
      first_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
      is_new INTEGER NOT NULL DEFAULT 1,
      pushed_at TEXT,
      UNIQUE(profile_id, post_id)
    );

    CREATE TABLE IF NOT EXISTS notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL DEFAULT 'new_post',
      title TEXT NOT NULL,
      body TEXT NOT NULL DEFAULT '',
      link TEXT,
      profile_id INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      read INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_notifications_created ON notifications(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_posts_profile ON posts(profile_id, published_at DESC);
  `);

  const profileCols = db.prepare(`PRAGMA table_info(profiles)`).all();
  if (!profileCols.some((c) => c.name === 'last_notice')) {
    db.exec(`ALTER TABLE profiles ADD COLUMN last_notice TEXT`);
  }

  return db;
}

function closeDb() {
  if (db) {
    db.close();
    db = null;
  }
}

// ---------- profiles ----------

const listProfiles = () =>
  db.prepare('SELECT * FROM profiles ORDER BY created_at DESC').all();

function addProfile({ platform, uid, display_name, url }) {
  db.prepare(
    `INSERT INTO profiles(platform, uid, display_name, url)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(platform, uid) DO UPDATE SET url=excluded.url, display_name=excluded.display_name`
  ).run(platform, uid, display_name || '', url);
  return db.prepare('SELECT * FROM profiles WHERE platform = ? AND uid = ?').get(platform, uid);
}

const getProfile = (id) => db.prepare('SELECT * FROM profiles WHERE id = ?').get(id);

function updateProfile(id, fields) {
  const allowed = [
    'display_name',
    'enabled',
    'poll_interval_minutes',
    'last_checked_at',
    'last_success_at',
    'last_error',
    'last_notice',
    'status',
  ];
  const sets = allowed.filter((k) => k in fields).map((k) => `${k} = ?`);
  if (!sets.length) return getProfile(id);
  const values = allowed.filter((k) => k in fields).map((k) => fields[k]);
  db.prepare(`UPDATE profiles SET ${sets.join(', ')} WHERE id = ?`).run(...values, id);
  return getProfile(id);
}

const removeProfile = (id) => {
  db.prepare('DELETE FROM posts WHERE profile_id = ?').run(id);
  db.prepare('DELETE FROM notifications WHERE profile_id = ?').run(id);
  db.prepare('DELETE FROM profiles WHERE id = ?').run(id);
};

function countProfiles() {
  return db.prepare('SELECT COUNT(*) AS c FROM profiles').get().c;
}

// ---------- posts ----------

/**
 * Insert posts that do not already exist. Returns the newly inserted rows.
 */
function insertNewPosts(profileId, posts) {
  const exists = db.prepare('SELECT post_id FROM posts WHERE profile_id = ? AND post_id = ?');
  const insert = db.prepare(
    `INSERT OR IGNORE INTO posts(profile_id, post_id, author, content, published_at, post_url, media, is_new)
     VALUES (?, ?, ?, ?, ?, ?, ?, 1)`
  );
  const added = [];
  for (const p of posts) {
    const postId = String(p.postId ?? p.id);
    if (!postId) continue;
    if (exists.get(profileId, postId)) continue;
    insert.run(
      profileId,
      postId,
      p.author || '',
      p.content || '',
      p.publishedAt || null,
      p.postUrl || '',
      JSON.stringify(p.media || [])
    );
    added.push({
      profileId,
      postId,
      author: p.author || '',
      content: p.content || '',
      publishedAt: p.publishedAt || null,
      postUrl: p.postUrl || '',
      media: p.media || [],
    });
  }
  return added;
}

const listPosts = (profileId, limit = 50) =>
  db
    .prepare('SELECT * FROM posts WHERE profile_id = ? ORDER BY published_at DESC, id DESC LIMIT ?')
    .all(profileId, limit);

const markPostPushed = (id) =>
  db.prepare("UPDATE posts SET is_new = 0, pushed_at = datetime('now') WHERE id = ?").run(id);

// ---------- notifications ----------

function addNotification({ type = 'new_post', title, body, link, profile_id }) {
  const info = db
    .prepare('INSERT INTO notifications(type, title, body, link, profile_id) VALUES (?, ?, ?, ?, ?)')
    .run(type, title, body || '', link || null, profile_id || null);
  return db.prepare('SELECT * FROM notifications WHERE id = ?').get(info.lastInsertRowid);
}

const listNotifications = (limit = 200) =>
  db
    .prepare('SELECT * FROM notifications ORDER BY created_at DESC, id DESC LIMIT ?')
    .all(limit);

const markNotificationsRead = (ids) => {
  if (!ids || !ids.length) {
    db.prepare('UPDATE notifications SET read = 1').run();
    return;
  }
  const placeholders = ids.map(() => '?').join(',');
  db.prepare(`UPDATE notifications SET read = 1 WHERE id IN (${placeholders})`).run(...ids);
};

const clearNotifications = () => db.prepare('DELETE FROM notifications').run();

const countUnread = () => db.prepare('SELECT COUNT(*) AS c FROM notifications WHERE read = 0').get().c;

module.exports = {
  open,
  closeDb,
  listProfiles,
  addProfile,
  getProfile,
  updateProfile,
  removeProfile,
  countProfiles,
  insertNewPosts,
  listPosts,
  markPostPushed,
  addNotification,
  listNotifications,
  markNotificationsRead,
  clearNotifications,
  countUnread,
};