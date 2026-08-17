const nodemailer = require('nodemailer');
const config = require('./config');
const db = require('./db');
const events = require('./events');

let pending = [];
let lastEmailAt = 0;
let emailLock = false;

function pushNewPosts(profile, addedPosts) {
  const displayName = profile.display_name || profile.uid || '未知主页';
  const notifs = [];
  for (const p of addedPosts) {
    const title = `${displayName}发布了新动态`;
    const notif = db.addNotification({
      title,
      body: p.content || '(无文字内容)',
      link: p.postUrl || null,
      profile_id: profile.id,
    });
    notifs.push(notif);
  }
  if (notifs.length) events.emit('notification:new', notifs);

  if (config.get().smtp.enabled) {
    pending.push({ profile, posts: addedPosts });
    flushEmail().catch(() => {});
  }
}

async function flushEmail() {
  if (emailLock || pending.length === 0) return;
  const s = config.get().smtp;
  if (!s.enabled) {
    pending = [];
    return;
  }
  const now = Date.now();
  if (now - lastEmailAt < (s.batchMinutes || 30) * 60000) return;
  if (!s.host || !s.user || !s.pass) return;

  emailLock = true;
  try {
    const batch = pending.splice(0, pending.length);
    await sendEmail(batch);
    lastEmailAt = Date.now();
  } finally {
    emailLock = false;
  }
}

function buildMailContent(batch) {
  const rows = [];
  for (const { profile, posts } of batch) {
    const name = profile.display_name || profile.uid;
    for (const p of posts) {
      const body = (p.content || '(无文字内容)').replace(/\n/g, '<br>');
      rows.push(
        `<li><b>${escapeHtml(name)}</b><br>${body}<br>` +
          `<a href="${escapeHtml(p.postUrl || '')}">查看原文</a></li>`
      );
    }
  }
  const subject = `【${batch.reduce((n, b) => n + b.posts.length, 0)} 条新动态更新】FollowAnonymous`;
  const text = batch
    .map(({ profile, posts }) => {
      const name = profile.display_name || profile.uid;
      return `${name}:\n${posts
        .map((p) => `  - ${(p.content || '(无文字内容)').slice(0, 120)} ${p.postUrl || ''}`)
        .join('\n')}`;
    })
    .join('\n\n');
  const html = `<h3>检测到以下主页有更新</h3><ul>${rows.join('')}</ul>`;
  return { subject, text, html };
}

function escapeHtml(s = '') {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function sendEmail(batch) {
  const s = config.get().smtp;
  const { subject, text, html } = buildMailContent(batch);
  const transporter = nodemailer.createTransport({
    host: s.host,
    port: Number(s.port) || 465,
    secure: s.secure !== false,
    auth: { user: s.user, pass: s.pass },
  });
  await transporter.sendMail({
    from: s.from || s.user,
    to: s.to || s.user,
    subject,
    text,
    html,
  });
}

async function testEmail() {
  const s = config.get().smtp;
  if (!s.host || !s.user || !s.pass) throw new Error('请先填写完整的SMTP信息');
  const transporter = nodemailer.createTransport({
    host: s.host,
    port: Number(s.port) || 465,
    secure: s.secure !== false,
    auth: { user: s.user, pass: s.pass },
  });
  await transporter.sendMail({
    from: s.from || s.user,
    to: s.to || s.user,
    subject: '【测试】FollowAnonymous SMTP 配置成功',
    text: '这是一封测试邮件，说明SMTP配置正确。',
  });
}

module.exports = { pushNewPosts, flushEmail, testEmail };