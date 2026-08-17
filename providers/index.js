const { ProviderError } = require('./base');
const WeiboProvider = require('./weibo');
const DouyinProvider = require('./douyin');
const QzoneProvider = require('./qzone');

const providers = [WeiboProvider, DouyinProvider, QzoneProvider];
const instances = new Map();

function getProvider(platform) {
  const Cls = providers.find((p) => p.platform === platform) || null;
  if (!Cls) return null;
  if (!instances.has(platform)) instances.set(platform, new Cls());
  return instances.get(platform);
}

async function detectAndParse(url) {
  const trimmed = String(url || '').trim();
  if (!trimmed) throw new Error('请输入主页链接');
  for (const p of providers) {
    if (p.detect(trimmed)) {
      const meta = await p.parseUrl(trimmed);
      meta.url = trimmed;
      return { provider: p, meta };
    }
  }
  throw new Error('无法识别该链接所属的平台（目前支持：微博、抖音、QQ空间）');
}

module.exports = { providers, getProvider, detectAndParse, ProviderError };