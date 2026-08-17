const config = require('./config');

const DESKTOP_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';
const MOBILE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 16_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.5 Mobile/15E148 Safari/604.1';

function randomHex(len = 24) {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let out = '';
  for (let i = 0; i < len; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

function randomCookie() {
  return `SUB=${randomHex()}; SUHB=${randomHex(16)}; _T_WM=${randomHex()}; ticket=${randomHex(16)}; WEIBOCN_FROM=${Math.floor(Math.random() * 1000)}; M_WEIBOCN_PARAMS=uid`;
}

function resolveProxy() {
  const p = config.get().proxy;
  if (p && p.enabled && p.url) return p.url;
  return undefined;
}

class HttpError extends Error {
  constructor(status, message) {
    super(message || `HTTP ${status}`);
    this.status = status;
  }
}

function proxyFetch(url, options = {}) {
  const proxyUrl = resolveProxy();
  if (!proxyUrl) return fetch(url, options);
  const { ProxyAgent } = require('undici');
  const proxy = new ProxyAgent({ uri: proxyUrl });
  return fetch(url, { ...options, dispatcher: proxy });
}

/**
 * GET with UA spoofing, optional referer, retries and backoff.
 * Returns parsed JSON when json=true, otherwise the raw text.
 */
async function get(url, opts = {}) {
  const {
    mobile = false,
    referer,
    headers = {},
    json = true,
    cookies = true,
    retries = 3,
    timeoutMs = 20000,
    validate,
  } = opts;

  const ua = mobile ? MOBILE_UA : DESKTOP_UA;
  let lastErr;

  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) {
      const delay = 1000 * Math.pow(2, attempt - 1) + Math.random() * 500;
      await new Promise((r) => setTimeout(r, delay));
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const h = {
        'User-Agent': ua,
        Accept: 'application/json, text/plain, */*',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      };
      if (referer) h.Referer = referer;
      if (cookies) h.Cookie = randomCookie();
      Object.assign(h, headers);

      const res = await proxyFetch(url, { headers: h, signal: controller.signal, redirect: 'follow' });
      if (!res.ok) throw new HttpError(res.status, `HTTP ${res.status} for ${url}`);
      const type = res.headers.get('content-type') || '';
      const text = await res.text();
      if (validate && !validate(text)) throw new HttpError(-1, 'content validation failed');
      if (json) {
        try {
          return JSON.parse(text);
        } catch {
          throw new HttpError(-1, 'invalid JSON response');
        }
      }
      return text;
    } catch (err) {
      lastErr = err;
      if (err instanceof HttpError && err.status >= 400 && err.status < 500 && err.status !== 429) {
        break;
      }
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr || new Error('request failed');
}

// Extract uid from a redirect Location header like https://m.weibo.cn/u/12345
async function followRedirectLocation(url, opts = {}) {
  const proxyUrl = resolveProxy();
  const fetchImpl = proxyUrl
    ? (u, o) => {
        const { ProxyAgent } = require('undici');
        return fetch(u, { ...o, dispatcher: new ProxyAgent({ uri: proxyUrl }) });
      }
    : fetch;

  const h = {
    'User-Agent': MOBILE_UA,
    Accept: 'text/html,application/xhtml+xml',
  };
  const res = await fetchImpl(url, { headers: h, redirect: 'manual' });
  return res.headers.get('location') || null;
}

function parseCookies(resHeaders) {
  const jar = new Map();
  const set = resHeaders.getSetCookie
    ? resHeaders.getSetCookie()
    : typeof resHeaders.get === 'function' && resHeaders.get('set-cookie')
      ? [resHeaders.get('set-cookie')]
      : [];
  for (const line of set) {
    const first = line.split(';')[0].trim();
    const idx = first.indexOf('=');
    if (idx < 0) continue;
    jar.set(first.slice(0, idx), first.slice(idx + 1));
  }
  return jar;
}

function jarToCookie(jar) {
  return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
}

/**
 * Follow a full redirect chain (e.g. Weibo's visitor flow) preserving cookies,
 * and return the final URL.
 */
async function resolveRedirectChain(url, { maxHops = 12, userAgent } = {}) {
  const ua = userAgent || MOBILE_UA;
  const proxyUrl = resolveProxy();
  const fetchImpl = proxyUrl
    ? (u, o) => {
        const { ProxyAgent } = require('undici');
        return fetch(u, { ...o, dispatcher: new ProxyAgent({ uri: proxyUrl }) });
      }
    : fetch;

  let current = url;
  const jar = new Map();
  for (let i = 0; i < maxHops; i++) {
    const headers = {
      'User-Agent': ua,
      Accept: 'text/html,application/xhtml+xml,application/json',
    };
    const cookie = jarToCookie(jar);
    if (cookie) headers.Cookie = cookie;
    const res = await fetchImpl(current, { headers, redirect: 'manual' });
    for (const [k, v] of parseCookies(res.headers)) jar.set(k, v);
    const loc = res.headers.get('location');
    if (!loc) return { url: current, status: res.status };
    current = new URL(loc, current).toString();
  }
  return { url: current, status: 0 };
}

function unescapeHtml(str = '') {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

module.exports = { get, followRedirectLocation, resolveRedirectChain, unescapeHtml, DESKTOP_UA, MOBILE_UA, randomHex, HttpError };