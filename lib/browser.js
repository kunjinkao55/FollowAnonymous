const { chromium } = require('playwright');
const { DESKTOP_UA, MOBILE_UA } = require('./fetcher');
const config = require('./config');

let browser = null;
let queue = Promise.resolve();
let closed = false;
const contextPool = new Map(); // key -> context

function proxyOptions() {
  const p = config.get().proxy;
  if (p && p.enabled && p.url) {
    try {
      const u = new URL(p.url);
      const server = `${u.protocol}//${u.host}`;
      const opts = { server };
      if (u.username) opts.username = decodeURIComponent(u.username);
      if (u.password) opts.password = decodeURIComponent(u.password);
      return opts;
    } catch {
      return undefined;
    }
  }
  return undefined;
}

async function launch() {
  if (browser) return browser;
  const executablePath = chromium.executablePath();
  browser = await chromium.launch({
    headless: true,
    executablePath,
    proxy: proxyOptions(),
    args: [
      '--disable-blink-features=AutomationControlled',
      '--no-sandbox',
      '--disable-dev-shm-usage',
      '--disable-http-cache',
    ],
  });
  closed = false;
  return browser;
}

function contextOptions(key, opts) {
  if (opts.mobile) {
    return {
      userAgent: opts.ua || MOBILE_UA,
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 3,
      isMobile: true,
      hasTouch: true,
      locale: 'zh-CN',
    };
  }
  return {
    userAgent: opts.ua || DESKTOP_UA,
    viewport: { width: 1280, height: 800 },
    locale: 'zh-CN',
  };
}

async function getContext(key, opts) {
  await launch();
  let ctx = contextPool.get(key);
  if (ctx && ctx.isClosed()) {
    contextPool.delete(key);
    ctx = null;
  }
  if (!ctx) {
    ctx = await browser.newContext(contextOptions(key, opts));
    contextPool.set(key, ctx);
  }
  return ctx;
}

/**
 * Run fn with a page, serialized through a queue so only one page
 * operation happens at a time with the shared browser instance.
 * opts.mobile: use a mobile UA/viewport context (Weibo m-station).
 */
async function withPage(fn, opts = {}) {
  const key = opts.mobile ? 'mobile' : 'desktop';
  const job = queue.then(async () => {
    await launch();
    const ctx = await getContext(key, opts);
    const page = await ctx.newPage();
    const guard = setTimeout(() => page.close().catch(() => {}), opts.timeoutMs || 90000);
    try {
      return await fn(page);
    } finally {
      clearTimeout(guard);
      await page.close().catch(() => {});
    }
  });
  queue = job.then(
    () => {},
    () => {}
  );
  return job;
}

async function gotoPage(page, url, { waitUntil = 'domcontentloaded', timeout = 30000 } = {}) {
  await page.goto(url, { waitUntil, timeout });
}

/** Recursively search the SSR payload for the first array of items shaped like media posts. */
function findPostList(root, maxDepth = 12) {
  const results = [];
  const visited = new WeakSet();
  const wantKeys = /\baweme(_id|Id|id)?\b/i;

  function walk(node, depth) {
    if (depth > maxDepth || !node || typeof node !== 'object' || visited.has(node)) return;
    visited.add(node);
    if (Array.isArray(node)) {
      const looksLikePosts = node.some(
        (v) =>
          v &&
          typeof v === 'object' &&
          (v.aweme_id || v.awemeId) &&
          (v.create_time || v.createTime || v.create_times)
      );
      if (looksLikePosts && node.length > 0) {
        results.push(node);
        return;
      }
      for (const v of node) walk(v, depth + 1);
      return;
    }
    for (const k of Object.keys(node)) {
      if (node[k] && typeof node[k] === 'object') walk(node[k], depth + 1);
    }
  }

  walk(root, 0);
  return results;
}

/** Clear cached browser contexts so fresh anonymous credentials are fetched. */
async function refreshContexts() {
  for (const ctx of [...contextPool.values()]) {
    try {
      await ctx.close();
    } catch {}
  }
  contextPool.clear();
}

async function close() {
  for (const ctx of [...contextPool.values()]) {
    try {
      await ctx.close();
    } catch {
      /* ignore */
    }
  }
  contextPool.clear();
  if (browser) {
    await browser.close().catch(() => {});
    browser = null;
  }
  closed = true;
}

module.exports = {
  launch,
  withPage,
  gotoPage,
  findPostList,
  refreshContexts,
  close,
  isClosed: () => closed,
};