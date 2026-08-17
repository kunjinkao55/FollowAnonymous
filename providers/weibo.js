const { BaseProvider, ProviderError, normalizePost } = require('./base');
const browser = require('../lib/browser');
const { unescapeHtml } = require('../lib/fetcher');

const HOST_PATTERN = /(^|\.)(weibo\.cn|weibo\.com|weibo\.com\.cn)$/i;
const CONTAINER_RE = /api\/container\/getIndex/i;

function stripTags(html) {
  return unescapeHtml(String(html || '').replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

async function resolveUidFromNickname(name) {
  const clean = name.split('?')[0].split('#')[0];
  let lastErr;
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 3000 + Math.random() * 2000));
    try {
      return await browser.withPage(
        async (page) => {
          await browser.gotoPage(page, `https://m.weibo.cn/n/${encodeURIComponent(clean)}`, {
            waitUntil: 'domcontentloaded',
            timeout: 30000,
          });
          const deadline = Date.now() + 15000;
          let final = page.url();
          while (Date.now() < deadline) {
            final = page.url();
            if (/\/u\/\d+/.test(final)) return final.match(/\/u\/(\d+)/)[1];
            await page.waitForTimeout(400);
          }
          throw new ProviderError(`无法解析昵称「${clean}」对应的用户ID（游客方式解析失败）`);
        },
        { mobile: true }
      );
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr;
}

function extractMblogs(cards) {
  const out = [];
  const walk = (list) => {
    for (const card of list || []) {
      if (!card) continue;
      if (card.card_type === 9 && card.mblog) out.push(card.mblog);
      if (card.card_type === 11 && Array.isArray(card.card_group)) walk(card.card_group);
    }
  };
  walk(cards);
  return out;
}

class WeiboProvider extends BaseProvider {
  static platform = 'weibo';
  static label = '微博';

  static detect(url) {
    try {
      return HOST_PATTERN.test(new URL(url).hostname);
    } catch {
      return false;
    }
  }

  static async parseUrl(url) {
    const u = new URL(url);
    const path = u.pathname.replace(/\/+$/, '');

    const uMatch = path.match(/^\/u\/(\d+)/i);
    if (uMatch) {
      return { platform: this.platform, uid: uMatch[1], name: '' };
    }

    const nMatch = path.match(/^\/n\/([^/]+)/i);
    if (nMatch) {
      const uid = await resolveUidFromNickname(decodeURIComponent(nMatch[1]));
      return { platform: this.platform, uid, name: decodeURIComponent(nMatch[1]) };
    }

    const bare = decodeURIComponent(path.replace(/^\//, ''));
    if (/^\d+$/.test(bare)) {
      return { platform: this.platform, uid: bare, name: '' };
    }

    if (bare && bare !== 'u' && bare !== 'n') {
      const uid = await resolveUidFromNickname(bare);
      return { platform: this.platform, uid, name: bare };
    }

    throw new ProviderError(
      '无法解析微博主页链接，请使用 weibo.com/u/数字ID 或 weibo.com/昵称 形式'
    );
  }

  async fetchRecent(profile) {
    const pageUrl = `https://m.weibo.cn/u/${profile.uid}`;

    let lastErr;
    for (let attempt = 0; attempt < 2; attempt++) {
      if (attempt > 0) await new Promise((r) => setTimeout(r, 2500 + Math.random() * 2000));
      try {
        return await browser.withPage(
          async (page) => {
            const captured = [];
            page.on('response', async (res) => {
              try {
                if (!CONTAINER_RE.test(res.url())) return;
                const ct = res.headers()['content-type'] || '';
                if (!/json/.test(ct)) return;
                captured.push({ url: res.url(), body: JSON.parse(await res.text()) });
              } catch {
                /* ignore */
              }
            });

            await browser.gotoPage(page, pageUrl, {
              waitUntil: 'domcontentloaded',
              timeout: 35000,
            });
            await page.waitForTimeout(5000);

            if (/passport\./.test(page.url())) {
              throw new ProviderError('微博访客验证未通过，暂时无法匿名访问该主页', {
                code: 'GUEST_LIMITED',
              });
            }

            const profileJson = captured.find((c) => c.body?.data?.userInfo);
            const listJson = captured.find(
              (c) => Array.isArray(c.body?.data?.cards) && c.body?.data?.cards.length
            );

            const userInfo = profileJson?.body?.data?.userInfo || null;
            const cards = (listJson || profileJson)?.body?.data?.cards || [];
            let mblogs = extractMblogs(cards);
            mblogs = mblogs.filter(
              (mb) => !mb.user?.id || String(mb.user.id) === String(profile.uid)
            );

            if (!mblogs.length) {
              throw new ProviderError('未能获取到该微博主页的内容（可能未对游客开放）', {
                code: 'GUEST_LIMITED',
              });
            }

            const name =
              userInfo?.screen_name ||
              mblogs.find((m) => m.user)?.user?.screen_name ||
              profile.display_name ||
              '';
            const posts = mblogs.slice(0, 20).map((mb) => {
              const postId = String(mb.idstr || mb.id || '');
              const mid = mb.mid || postId;
              const media = (mb.pics || []).map((pic) => ({
                type: 'image',
                url: (pic.large && pic.large.url) || pic.url || '',
                thumbnail: pic.url || '',
              }));
              const retweeted = mb.retweeted_status;
              let content = stripTags(mb.text);
              if (retweeted && retweeted.user) {
                content +=
                  ` （转发自 @${retweeted.user.screen_name}：${stripTags(retweeted.text)}）`.slice(
                    0,
                    500
                  );
              }
              return normalizePost({
                id: postId,
                author: name,
                content,
                publishedAt: mb.created_at,
                postUrl: `https://weibo.com/${profile.uid}/${mid}`,
                media,
              });
            });

            return { posts, name, platform: this.platform };
          },
          { mobile: true }
        );
      } catch (err) {
        lastErr = err;
      }
    }
    throw lastErr;
  }
}

module.exports = WeiboProvider;