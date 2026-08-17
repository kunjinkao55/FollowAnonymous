const { BaseProvider, ProviderError, normalizePost } = require('./base');
const { get, unescapeHtml } = require('../lib/fetcher');

const HOST_PATTERN = /qzone\.qq\.com$/i;

function detectLoginWall(html) {
  return /ptlogin2\.qq\.com|login\.qq\.com|web_login|location\.href\s*=\s*["']https?:\/\/xui\.ptlogin2/i.test(
    html
  );
}

class QzoneProvider extends BaseProvider {
  static platform = 'qzone';
  static label = 'QQ空间';

  static detect(url) {
    try {
      const host = new URL(url).hostname.toLowerCase();
      return host === 'user.qzone.qq.com' || HOST_PATTERN.test(host) || /^qzone\.qq\.com$/i.test(host);
    } catch {
      return false;
    }
  }

  static parseUrl(url) {
    const u = new URL(url);
    const segments = u.pathname.split('/').filter(Boolean);
    const qq = segments.find((s) => /^\d{4,12}$/.test(s));
    if (qq) {
      return { platform: this.platform, uid: qq, name: '' };
    }
    throw new ProviderError('无法解析QQ空间链接，请使用 user.qzone.qq.com/QQ号 形式');
  }

  async fetchRecent(profile) {
    const qq = profile.uid;
    const attempted = [`https://user.qzone.qq.com/${qq}`];

    let lastErr = new ProviderError('该QQ空间未对游客开放或无法匿名访问', {
      code: 'GUEST_LIMITED',
    });

    for (const url of attempted) {
      try {
        const html = await get(url, {
          json: false,
          referer: 'https://qzone.qq.com/',
          timeoutMs: 20000,
          retries: 1,
        });

        if (detectLoginWall(html)) {
          throw new ProviderError('该QQ空间当前要求登录，游客无法访问', { code: 'GUEST_LIMITED' });
        }

        const feeds = this._extractFeeds(html);
        if (!feeds.length) {
          throw new ProviderError('该QQ空间对游客不可见（可能设置为好友可见或需要登录）', {
            code: 'GUEST_LIMITED',
          });
        }

        return { posts: feeds, name: profile.display_name || qq, platform: this.platform };
      } catch (err) {
        lastErr = err;
      }
    }

    throw lastErr;
  }

  _extractFeeds(html) {
    const raw = /__INITIAL_DATA__\s*=\s*(\{[\s\S]*?\})\s*;?<\/script>/.exec(html);
    if (!raw) return [];
    try {
      const data = JSON.parse(raw[1]);
      const items = [];
      const walk = (o) => {
        if (!o || typeof o !== 'object') return;
        if (typeof o.createtime === 'number' && (o.content || o.content_text) && (o.tid || o.tid_str || o.appid)) {
          items.push(o);
          return;
        }
        for (const k of Object.keys(o)) {
          const v = o[k];
          if (Array.isArray(v)) for (const el of v) walk(el);
          else if (v && typeof v === 'object') walk(v);
        }
      };
      walk(data);
      return items.slice(0, 20).map((f) =>
        normalizePost({
          id: f.tid_str || f.tid || `${f.createtime}-${f.appid}`,
          author: f.nickname || profile_name(f) || '',
          content: unescapeHtml(String(f.content_text || f.content || '')).replace(/<[^>]*>/g, ' '),
          publishedAt: f.createtime * 1000,
          postUrl: `https://user.qzone.qq.com/${f.hostuin || ''}?postId=${f.tid_str || ''}`,
          media: Array.isArray(f.pic) ? f.pic.filter((p) => p && typeof p === 'string').slice(0, 6).map((p) => ({
            type: 'image',
            url: p,
            thumbnail: p,
          })) : [],
        })
      );
    } catch {
      return [];
    }
  }
}

function profile_name(f) {
  return (f.owner && f.owner.nickname) || '';
}

module.exports = QzoneProvider;