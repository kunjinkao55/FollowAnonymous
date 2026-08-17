const { BaseProvider, ProviderError, normalizePost, toAuthorString } = require('./base');
const browser = require('../lib/browser');
const { followRedirectLocation } = require('../lib/fetcher');

const POST_LIST_URL_RE = /aweme\/v\d\/web\/aweme\/post/i;

function toStr(v) {
  if (typeof v === 'string') return v;
  return String(v == null ? '' : v);
}

function toNum(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function secUidFromUrl(pathname) {
  const m = pathname.match(/\/user\/([A-Za-z0-9_\-]+)/i);
  return m ? m[1] : null;
}

async function resolveShortUrl(shortUrl) {
  let current = shortUrl;
  for (let i = 0; i < 6; i++) {
    const location = await followRedirectLocation(current);
    if (!location) return current;
    current = new URL(location, current).toString();
    if (new URL(current).hostname === 'www.douyin.com') return current;
  }
  return current;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class DouyinProvider extends BaseProvider {
  static platform = 'douyin';
  static label = '抖音';

  static detect(url) {
    try {
      const host = new URL(url).hostname.toLowerCase();
      return host === 'douyin.com' || host.endsWith('.douyin.com');
    } catch {
      return false;
    }
  }

  static async parseUrl(url) {
    const u = new URL(url);
    const path = u.pathname.replace(/\/+$/, '');

    if (u.hostname === 'v.douyin.com') {
      const target = await resolveShortUrl(u.toString());
      const pu = new URL(target);
      const uid = secUidFromUrl(pu.pathname);
      if (uid) return { platform: this.platform, uid, name: '' };
      throw new ProviderError('该抖音短链接指向的不是用户主页（可能是视频/合集），请使用主页地址');
    }

    return this._fromUserPath(path);
  }

  static _fromUserPath(path) {
    const secUid = secUidFromUrl(path);
    if (!secUid || path.endsWith('/user/self')) {
      throw new ProviderError(
        '无法从该抖音链接解析出用户ID，请使用网页版主页地址（www.douyin.com/user/...）'
      );
    }
    return { platform: this.platform, uid: secUid, name: '' };
  }

  async fetchRecent(profile) {
    const secUid = profile.uid;
    const pageUrl = `https://www.douyin.com/user/${secUid}`;

    let lastErr;
    for (let attempt = 0; attempt < 2; attempt++) {
      if (attempt > 0) await sleep(2500 + Math.random() * 2000);
      try {
        return await browser.withPage(async (page) => {
          return this._loadPage(page, profile, pageUrl);
        }, {});
      } catch (err) {
        lastErr = err;
      }
    }
    throw lastErr;
  }

  async _loadPage(page, profile, pageUrl) {
    const captured = [];
    page.on('response', async (res) => {
      try {
        const ct = res.headers()['content-type'] || '';
        if (!/json/.test(ct)) return;
        const url = res.url();
        if (!POST_LIST_URL_RE.test(url)) return;
        const body = await res.text();
        captured.push(JSON.parse(body));
      } catch {
        /* ignore parse failures */
      }
    });

    try {
      await browser.gotoPage(page, pageUrl, { waitUntil: 'domcontentloaded', timeout: 35000 });
      await page.waitForTimeout(2500);

      const finalUrl = page.url();
      if (/(captcha|verify|_sec_verify)/i.test(finalUrl)) {
        throw new ProviderError('抖音要求验证码，当前无法匿名访问，稍后自动重试', {
          code: 'GUEST_LIMITED',
        });
      }

      let items = await this._collectPosts(page, captured, 12000);

      // Anonymous visitors may get a cached post list; reload once to pull the freshest copy.
      if (items.length) {
        await page.reload({ waitUntil: 'domcontentloaded', timeout: 35000 }).catch(() => {});
        await this._collectPosts(page, captured, 8000);
        items = this._fromCaptured(captured);
      }

      items = this._dedupe(items);

      if (!items.length) {
        items = await this._fromSsr(page).catch(() => []);
      }
      if (!items.length) {
        items = await this._fromDom(page);
      }
      if (!items.length) {
        throw new ProviderError('未能获取到该主页的作品列表（可能未对游客开放或风控拦截）', {
          code: 'GUEST_LIMITED',
        });
      }

      items.sort(
        (a, b) => toNum(b.create_time ?? b.createTime) - toNum(a.create_time ?? a.createTime)
      );

      const authorRaw = items.find((i) => i.author)?.author;
      const author = toAuthorString(authorRaw) || profile.display_name || '';

      const posts = items.slice(0, 20).map((i) => {
        const awemeId = String(i.aweme_id || i.awemeId || i.id || '');
        let media = [];
        const cover = i.video?.cover?.url_list?.[0] || i.cover?.url_list?.[0] || '';
        const play = i.video?.play_addr?.url_list?.[0] || '';
        if (Array.isArray(i.images) && i.images.length) {
          media = i.images.map((img) => ({
            type: 'image',
            url: img.url_list?.[0] || '',
            thumbnail: img.url_list?.[0] || '',
          }));
        } else if (play || cover) {
          media = [{ type: 'video', url: play, thumbnail: cover }];
        }
        return normalizePost({
          id: awemeId,
          author,
          content: toStr(i.desc),
          publishedAt: toNum(i.create_time ?? i.createTime) * 1000,
          postUrl: `https://www.douyin.com/video/${awemeId}`,
          media,
        });
      });

      return { posts, name: author, platform: this.platform };
    } catch (err) {
      if (err && err.providerError) throw err;
      throw new ProviderError(`抖音页面加载失败：${err.message}`, { code: 'NETWORK' });
    }
  }

  async _collectPosts(page, captured, maxWaitMs) {
    let items = [];
    const deadline = Date.now() + maxWaitMs;
    while (Date.now() < deadline && !items.length) {
      items = this._fromCaptured(captured);
      if (!items.length) await page.waitForTimeout(800);
    }
    return items;
  }

  _fromCaptured(captured) {
    for (const body of captured) {
      const list = body?.data?.aweme_list || body?.aweme_list;
      const aweme = list?.aweme_list || list;
      if (Array.isArray(aweme) && aweme.length) return aweme;
    }
    return [];
  }

  _dedupe(items) {
    const map = new Map();
    for (const i of items || []) {
      const id = i.aweme_id || i.awemeId || i.id;
      if (id == null) continue;
      const t = toNum(i.create_time ?? i.createTime);
      const key = String(id);
      const existing = map.get(key);
      if (!existing || t > toNum(existing.create_time ?? existing.createTime)) map.set(key, i);
    }
    return [...map.values()];
  }

  async _fromSsr(page) {
    const payload = await page.evaluate(() => {
      for (const k of ['_ROUTER_DATA', '__pace_f', '__INITIAL_STATE__', '__NUXT__']) {
        if (window[k]) return { key: k, value: window[k] };
      }
      return null;
    });
    if (!payload) return [];
    const lists = browser.findPostList(payload.value);
    const items = lists.flat().filter((i) => i.aweme_id || i.awemeId);
    return items.map((i) => ({
      aweme_id: i.aweme_id || i.awemeId,
      create_time: i.create_time || i.createTime || i.create_times,
      desc: i.desc ?? i.name ?? '',
      author: i.author?.nickname || i.nickname || i.author?.user?.nickname || '',
      video: i.video || i.videoInfo || {},
      cover: i.cover,
      images: i.images || i.imagePostInfo?.images,
    }));
  }

  async _fromDom(page) {
    const items = await page.evaluate(() => {
      const out = [];
      const nodes = document.querySelectorAll('a[href*="/video/"], li[data-e2e="user-post-item"]');
      const seen = new Set();
      for (const node of nodes) {
        const a = node.tagName === 'A' ? node : node.querySelector('a[href*="/video/"]');
        if (!a) continue;
        const href = a.getAttribute('href') || '';
        const m = href.match(/\/video\/(\d+)/);
        if (!m || seen.has(m[1])) continue;
        seen.add(m[1]);
        const img = node.querySelector('img');
        const desc = node.getAttribute('title') || img?.alt || '';
        out.push({
          aweme_id: m[1],
          desc,
          create_time: 0,
          cover: img?.src || '',
          author: '',
        });
      }
      return out;
    });
    return items;
  }
}

module.exports = DouyinProvider;