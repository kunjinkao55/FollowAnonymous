const STATUS_META = {
  ok: { text: '正常', cls: 'ok' },
  limited: { text: '游客受限', cls: 'limited' },
  error: { text: '异常', cls: 'error' },
};

const PLATFORM_META = {
  weibo: { text: '微博', cls: 'weibo' },
  douyin: { text: '抖音', cls: 'douyin' },
  qzone: { text: 'QZone', cls: 'qzone' },
};

const state = {
  profiles: [],
  notifications: [],
  settings: null,
};

const $ = (sel) => document.querySelector(sel);

document.addEventListener('DOMContentLoaded', init);

async function init() {
  bindTabs();
  bindActions();
  wireEvents();
  await Promise.all([loadProfiles(), loadNotifications(), loadSettings()]);
  refreshUnread();
  setInterval(refreshUnread, 60000);
}

function bindTabs() {
  document.querySelectorAll('.tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
      document.querySelectorAll('.view').forEach((v) => v.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById(`view-${btn.dataset.view}`).classList.add('active');
    });
  });
}

function bindActions() {
  $('#btn-add').addEventListener('click', addProfile);
  $('#input-url').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') addProfile();
  });
  $('#btn-check-all').addEventListener('click', async () => {
    setStatus('全局检查进行中…');
    await window.api.profiles.checkNow(null);
    await loadProfiles();
    await loadNotifications();
  });
  $('#btn-mark-read').addEventListener('click', async () => {
    await window.api.notifications.markRead([]);
    await loadNotifications();
    refreshUnread();
  });
  $('#btn-clear-notif').addEventListener('click', async () => {
    if (!confirm('确定清空所有消息记录吗？')) return;
    await window.api.notifications.clear();
    await loadNotifications();
    refreshUnread();
  });
  $('#btn-save-settings').addEventListener('click', saveSettings);
  $('#btn-test-smtp').addEventListener('click', testSmtp);
  document.getElementById('dialog-close').addEventListener('click', () => {
    document.getElementById('posts-dialog').close();
  });
}

function wireEvents() {
  window.api.on('notification:new', async (notifs) => {
    await loadNotifications();
    await loadProfiles();
    refreshUnread();
    if (notifs && notifs.length && document.getElementById('view-notifications').classList.contains('active')) {
      document.getElementById('notif-list').scrollTop = 0;
    }
  });
  window.api.on('check:done', async () => {
    await loadProfiles();
    await loadNotifications();
    refreshUnread();
  });
  window.api.on('scheduler:started', async () => {});
}

function setStatus(msg) {
  const el = $('#add-status');
  el.textContent = msg || '';
  el.classList.remove('hide');
  if (msg) setTimeout(() => el.classList.add('hide'), 6000);
}

function setSettingsStatus(msg, err) {
  const el = $('#settings-status');
  el.textContent = msg || '';
  el.className = 'status-line' + (err ? ' err' : '');
  if (msg) {
    setTimeout(() => {
      el.textContent = '';
      el.className = 'status-line';
    }, 6000);
  }
}

// ---------- profiles ----------

async function addProfile() {
  const input = $('#input-url');
  const url = input.value.trim();
  if (!url) return;
  setStatus('解析链接…');
  try {
    const profile = await window.api.profiles.add(url);
    input.value = '';
    setStatus(`已添加：${profile.platform || ''} ${profile.display_name || profile.uid}，正在抓取首页…`);
    await loadProfiles();
    window.api.profiles.checkNow(profile.id).then(async () => {
      await loadProfiles();
      await loadNotifications();
      refreshUnread();
    }).catch(async (err) => {
      setStatus(`首次抓取失败：${err.message}`);
      await loadProfiles();
    });
  } catch (err) {
    setStatus(`添加失败：${err.message}`);
  }
}

async function loadProfiles() {
  state.profiles = await window.api.profiles.list();
  renderProfiles();
}

function renderProfiles() {
  const list = $('#profile-list');
  if (!state.profiles.length) {
    list.innerHTML = `<div class="empty">还没有监控主页，粘贴链接添加一个吧。</div>`;
    return;
  }
  list.innerHTML = '';
  for (const p of state.profiles) {
    const meta = STATUS_META[p.status] || STATUS_META.error;
    const plt = PLATFORM_META[p.platform] || { text: p.platform, cls: '' };
    const item = document.createElement('div');
    item.className = 'profile-card card';
    item.innerHTML = `
      <div class="profile-left">
        <div class="platform-badge ${plt.cls}">${plt.text}</div>
        <div class="profile-info">
          <div class="profile-name">${esc(p.display_name || p.uid)}</div>
          <div class="profile-url">${esc(p.url || `${p.platform}/${p.uid}`)}</div>
        </div>
      </div>
      <div class="profile-mid">
        <span class="status-badge ${meta.cls}">${meta.text}</span>
        ${
          p.last_error
            ? `<div class="profile-error" title="${esc(p.last_error)}">${esc(shortError(p.last_error))}</div>`
            : ''
        }
        ${
          p.last_notice
            ? `<div class="profile-notice">${esc(p.last_notice)}</div>`
            : ''
        }
        <div class="profile-time">上次检查：${p.last_checked_at ? esc(p.last_checked_at.replace('T', ' ').slice(0, 19)) : '尚未'}</div>
      </div>
      <div class="profile-actions">
        <button class="btn btn-sm" data-act="check">立即检查</button>
        <button class="btn btn-sm" data-act="posts">查看内容</button>
        <button class="btn btn-sm" data-act="toggle">${p.enabled ? '暂停' : '启用'}</button>
        <button class="btn btn-sm danger" data-act="remove">删除</button>
      </div>`;
    const acts = item.querySelectorAll('[data-act]');
    acts.forEach((btn) =>
      btn.addEventListener('click', () => handleProfileAction(p.id, btn.dataset.act, btn))
    );
    list.appendChild(item);
  }
}

function shortError(msg) {
  if (!msg) return '';
  return msg.length > 60 ? msg.slice(0, 60) + '…' : msg;
}

async function handleProfileAction(id, act, btn) {
  if (act === 'check') {
    btn.disabled = true;
    btn.textContent = '检查中…';
    try {
      await window.api.profiles.checkNow(id);
    } finally {
      await loadProfiles();
    }
  } else if (act === 'toggle') {
    const p = state.profiles.find((x) => x.id === id);
    await window.api.profiles.setEnabled(id, !p.enabled);
    await loadProfiles();
  } else if (act === 'remove') {
    if (confirm('确定删除这个主页及其历史记录吗？')) {
      await window.api.profiles.remove(id);
      await loadProfiles();
    }
  } else if (act === 'posts') {
    await showPosts(id);
  }
}

async function showPosts(id) {
  const p = state.profiles.find((x) => x.id === id);
  const posts = await window.api.profiles.listPosts(id, 50);
  const dialog = document.getElementById('posts-dialog');
  $('#dialog-title').textContent = `${p.display_name || p.uid} 的内容（${posts.length} 条）`;
  const body = $('#dialog-body');
  if (!posts.length) {
    body.innerHTML = `<div class="empty">暂无内容，点击「立即检查」抓取。</div>`;
  } else {
    body.innerHTML = '';
    for (const post of posts) {
      const el = document.createElement('div');
      el.className = 'post-item card';
      const time = post.published_at ? esc(post.published_at.replace('T', ' ').slice(0, 16)) : '时间未知';
      el.innerHTML = `
        <div class="post-head">
          <span class="post-time">${time}</span>
          ${post.media && post.media.length ? `<span class="post-media">🖼 ${post.media.length}</span>` : ''}
        </div>
        <div class="post-body">${esc(post.content || '(无文字内容)')}</div>
        ${post.post_url ? `<a class="post-link" href="${esc(post.post_url)}" target="_blank">查看原文</a>` : ''}`;
      body.appendChild(el);
    }
  }
  dialog.showModal();
}

// ---------- notifications ----------

async function loadNotifications() {
  state.notifications = await window.api.notifications.list(200);
  renderNotifications();
}

function renderNotifications() {
  const list = $('#notif-list');
  $('#notif-count').textContent = `共 ${state.notifications.length} 条记录`;
  if (!state.notifications.length) {
    list.innerHTML = `<div class="empty">暂无更新记录。</div>`;
    return;
  }
  list.innerHTML = '';
  for (const n of state.notifications) {
    const el = document.createElement('div');
    el.className = 'notif-item card' + (n.read ? '' : ' unread');
    const time = esc((n.created_at || '').replace('T', ' ').slice(0, 19));
    el.innerHTML = `
      <div class="notif-title">${esc(n.title)}</div>
      <div class="notif-body">${esc(n.body || '')}</div>
      <div class="notif-meta">
        <span class="post-time">${time}</span>
        ${n.link ? `<a class="post-link" href="${esc(n.link)}" target="_blank">打开</a>` : ''}
      </div>`;
    list.appendChild(el);
  }
}

async function refreshUnread() {
  const n = await window.api.notifications.unread();
  const badge = $('#unread-badge');
  if (n > 0) {
    badge.textContent = n > 99 ? '99+' : String(n);
    badge.classList.remove('hide');
  } else {
    badge.classList.add('hide');
  }
}

// ---------- settings ----------

async function loadSettings() {
  state.settings = await window.api.settings.get();
  const s = state.settings;
  $('#set-interval').value = s.pollIntervalMinutes;
  $('#set-jitter').value = s.pollJitterMinutes;
  $('#set-smtp-enabled').checked = !!s.smtp.enabled;
  $('#set-smtp-host').value = s.smtp.host;
  $('#set-smtp-port').value = s.smtp.port;
  $('#set-smtp-secure').checked = s.smtp.secure !== false;
  $('#set-smtp-user').value = s.smtp.user;
  $('#set-smtp-pass').value = s.smtp.pass;
  $('#set-smtp-from').value = s.smtp.from;
  $('#set-smtp-to').value = s.smtp.to;
  $('#set-smtp-batch').value = s.smtp.batchMinutes;
  $('#set-proxy-enabled').checked = !!s.proxy.enabled;
  $('#set-proxy-url').value = s.proxy.url;
  $('#set-system-notif').checked = s.settings.systemNotifications !== false;
  $('#set-close-tray').checked = !!s.settings.closeToTray;
}

async function saveSettings() {
  const s = state.settings || {};
  const next = {
    ...s,
    pollIntervalMinutes: Math.min(1440, Math.max(5, Number($('#set-interval').value) || 15)),
    pollJitterMinutes: Math.min(120, Math.max(0, Number($('#set-jitter').value) || 0)),
    smtp: {
      enabled: $('#set-smtp-enabled').checked,
      host: $('#set-smtp-host').value.trim(),
      port: Number($('#set-smtp-port').value) || 465,
      secure: $('#set-smtp-secure').checked,
      user: $('#set-smtp-user').value.trim(),
      pass: $('#set-smtp-pass').value,
      from: $('#set-smtp-from').value.trim(),
      to: $('#set-smtp-to').value.trim(),
      batchMinutes: Math.min(1440, Math.max(1, Number($('#set-smtp-batch').value) || 30)),
    },
    proxy: {
      enabled: $('#set-proxy-enabled').checked,
      url: $('#set-proxy-url').value.trim(),
    },
    settings: {
      systemNotifications: $('#set-system-notif').checked,
      closeToTray: $('#set-close-tray').checked,
    },
  };
  state.settings = await window.api.settings.save(next);
  setSettingsStatus('保存成功');
}

async function testSmtp() {
  await saveSettings();
  setSettingsStatus('正在发送测试邮件…');
  try {
    await window.api.settings.testSmtp();
    setSettingsStatus('测试邮件已发送，请检查收件箱');
  } catch (err) {
    setSettingsStatus(`发送失败：${err.message}`, true);
  }
}

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}