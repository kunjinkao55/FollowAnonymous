# FollowAnonymous

社交媒体主页更新的"匿名监听"桌面客户端。粘贴一个社交主页链接，客户端以**未登录游客身份**低调地定时抓取对方公开内容，一旦有新动态就**在应用内提醒**，并可**合并发送邮件**。全程**无需登录你的社交媒体账号，不留访客痕迹**；社交媒体不对游客开放的内容天然无法被监听到。

当前支持平台：

| 平台 | 支持情况 | 说明 |
|------|----------|------|
| 微博 | ✅ 可用 | 支持 ID 链接（`weibo.com/u/1234567890`）与昵称链接（`weibo.com/昵称`） |
| 抖音 | ✅ 已实现（游客模式受限） | 支持主页链接（`www.douyin.com/user/xxx`）与 `v.douyin.com` 分享短链；详情见下方"游客模式限制" |

> 说明：QQ空间自带"访客记录"功能，若空间主人开启，游客访问可能留下痕迹，请自行权衡。

### 抖音的游客模式限制

抖音对**未登录游客**返回的作品列表是经过筛选的**历史热门内容**（通常仅最近 6~10 条），并通过 API 权限分级、CDN 缓存延迟等方式限制最新内容的可见性，属于平台主动设计：

- 游客接口只返回"高互动历史视频"，**不保证包含最新发布的作品**；
- 新发布视频需经历审核、冷启动，在游客视角可能数小时不可见；
- 请求频率过高还会触发更严格的限流/验证码。

因此监控抖音主页时，**最新视频可能延迟数小时出现**，甚至完全不显示，这并非软件缺陷。应用在发现返回内容偏少时会提示"游客模式仅展示部分内容，最新视频可能延迟"。若必须实时追踪最新发布，需要登录态（与"不登录、不留痕"的定位冲突），本工具不提供。

---

## 快速开始

### 安装（Windows）

1. 运行安装包 `dist/FollowAnonymous Setup 0.1.0.exe`
2. 启动后，在「主页管理」页粘贴目标主页链接，点「添加主页」
3. 应用会自动以游客身份抓取一次首页内容，之后按设定间隔（默认 15 分钟 + 随机抖动）巡检
4. 有新动态会出现在「消息中心」，并弹出桌面系统通知

### 开发模式运行

```bash
npm install
npx playwright install chromium   # 首次需下载 Chromium（约 300MB）
npm start
```

> Electron 二进制与原生模块（better-sqlite3）首次安装时若下载较慢/失败，可配置镜像：
>
> ```powershell
> $env:ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/"
> $env:PLAYWRIGHT_DOWNLOAD_HOST="https://npmmirror.com/mirrors/playwright"
> npx electron-builder install-app-deps   # 按 Electron ABI 重编 better-sqlite3
> ```

---

## 核心特性

- **游客身份抓取**：所有平台均通过无头 Chromium 真实执行访客流程，无需登录、无访客留痕。不抓取任何需要登录才能看到的内容。
- **定时巡检**：间隔可在设置中调整（5~1440 分钟），并自动加入随机抖动避免请求规律被识别。
- **本地去重**：SQLite 按 `(主页, 内容ID)` 去重，重复巡检不会重复推送。
- **应用内推送**：消息中心记录所有更新，未读数角标提醒。
- **桌面系统通知**：有新更新时弹窗，可开关。
- **SMTP 邮件推送**：支持 QQ 邮箱/Gmail 等，多条更新合并为一封邮件并做发送节流，避免轰炸。
- **托盘常驻**：关闭窗口后应用缩到托盘继续后台巡检；托盘菜单可显示窗口、立即巡检、退出。
- **代理支持**（可选）：用于规避 IP 级限流。
- **异常自愈**：单主页抓取失败只影响该主页，界面明确标注状态（正常 / 游客受限 / 异常），下轮自动重试。

---

## 架构

```
Electron 主进程（后台逻辑，关闭窗口仍运行）
├── electron/scheduler.js    定时轮询调度 + 去重 + 触发推送
├── providers/               平台适配层（统一接口）
│   ├── weibo.js             微博：无头浏览器执行访客流程 → 拦截 m.weibo.cn 容器接口
│   ├── douyin.js            抖音：无头浏览器 → 接口拦截 / SSR / DOM 三层容错
│   └── qzone.js             QQ空间：尽力而为，游客不可见则返回受限提示
├── lib/browser.js           Playwright 单浏览器实例复用 + 上下文池
├── lib/fetcher.js           纯 HTTP 封装（UA 伪装、随机 Cookie、重试退避）
├── lib/db.js                better-sqlite3 本地存储
├── lib/notify.js            应用内消息 + nodemailer 邮件（合并+节流）
└── lib/config.js            本地配置

渲染进程（src/）             主页管理 / 消息中心 / 设置
```

平台适配层统一接口（`providers/base.js`）：

```
parseUrl(url)  → { platform, uid, name }       解析链接
fetchRecent()  → { posts, name }               返回规范化内容列表
                                                 { postId, content, publishedAt, postUrl, media[] }
```

新增平台只需实现这两个方法并注册到 `providers/index.js`。

数据存储于 `%APPDATA%/follow-anonymous/follow-anonymous/`（`follow.db` 与 `config.json`）。

---

## 平台抓取原理与维护

**微博**：`m.weibo.cn` 纯 HTTP 接口已被访客验证墙拦截，故用无头浏览器自动完成访客跳转（`passport.weibo.cn`），再拦截 `api/container/getIndex` 的 JSON 响应提取微博内容与发布时间。

**抖音**：访问 `www.douyin.com/user/{sec_uid}`，依次尝试
1. 拦截 `aweme/v1/web/aweme/post` 作品列表接口；
2. 解析 SSR 内嵌数据（`_ROUTER_DATA` / `__pace_f` 等）；
3. DOM 兜底。

签名参数（`a_bogus` 等）由真实浏览器自动生成，无需逆向。若页面出现验证码则自动降级退避。

**注意**：平台前端结构与接口会随版本变化。若某平台解析失效，界面会把该主页标记为"异常"并提示原因，不影响其他平台继续运行。修平台适配时只需改对应 `providers/*.js` 文件的解析逻辑。

---

## 重新打包

```powershell
# 打 Windows 安装包（首次下载打包工具可能较慢，可用镜像加速）
$env:ELECTRON_BUILDER_BINARIES_MIRROR="https://npmmirror.com/mirrors/electron-builder-binaries/"
npm run dist
```

产物输出到 `dist/`（`FollowAnonymous Setup <版本>.exe`）。

### 分发到其他电脑

安装包内含应用本体，但 **Playwright 的 Chromium 由安装包之外提供**，目标机器需先安装一次：

```bash
npx playwright install chromium
```

或把本机 `%LOCALAPPDATA%\ms-playwright` 目录整体拷到目标机器相同位置。

---

## 合规说明

- 仅抓取社交平台向未登录游客公开的内容，不绕过登录、不模拟登录、不抓取私密内容。
- 请遵守目标平台的服务条款与当地法律，理性控制抓取频率，仅用于个人正当用途。