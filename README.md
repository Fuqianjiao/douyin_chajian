# 抖音起号学习看板

这是一个本地 Codex 插件和 Chrome 扩展雏形，用于把 `https://www.douyin.com/user/self` 里的关注列表抓取下来，按账号简介和昵称做本地分类，并为账号缓存主页截图，最终生成一个可离线打开的画廊页面。

## 能做什么

- Chrome 扩展模式：直接加载本目录，利用当前抖音页面登录态采集可见关注列表。
- 复用本机登录态：优先连接你用调试端口打开的 Chrome/Edge；也支持插件自己的持久化浏览器目录。
- 抓取关注列表：昵称、简介、头像、主页链接、抖音号等页面可见信息。
- 缓存主页截图：每个账号一张主页截图，后续画廊离线查看。
- 智能文件夹分类：基于 `config/categories.json` 的中文关键词规则自动归类。
- 生成画廊：输出 `data/gallery/index.html`，按文件夹展示账号截图和一句话介绍。

## Chrome 扩展模式

1. 打开 `chrome://extensions/`。
2. 开启「开发者模式」。
3. 点击「加载已解压的扩展程序」。
4. 选择本目录：`douyin-learning-board`。
5. 打开 `https://www.douyin.com/user/self`，点开关注弹窗。
6. 点击扩展图标，选择「开启实时滚动采集」。
7. 向下滚动关注弹窗加载更多账号，新出现的账号会被 content script 持续扫描并自动去重合并；扩展弹窗关闭也不影响采集。
8. 打开某个主播主页后，点击「缓存当前主页截图」。这一步会同时保存主页截图、主页链接、昵称和简介。
9. 点击「打开离线画廊」查看分类结果。

更新扩展文件后，需要在 `chrome://extensions/` 点击本扩展卡片上的刷新按钮，再回到抖音页面刷新网页。

Chrome 扩展模式的数据存在浏览器本地 `chrome.storage.local`，不会上传 Cookie 或账号数据。

## 安装依赖

在插件目录执行：

```bash
npm config set registry https://registry.npmmirror.com
npm install
```

## 推荐 Cookie 模式：连接本地 Chrome

先完全退出 Chrome，然后用调试端口打开你的常用用户目录：

```bash
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome \
  --remote-debugging-port=9222 \
  --user-data-dir="$HOME/Library/Application Support/Google/Chrome"
```

确认这个浏览器里已经登录抖音，然后运行：

```bash
npm run collect -- --cdp http://127.0.0.1:9222 --limit 200 --screenshots
npm run gallery
```

如果 Chrome 提示用户目录被占用，可以换用插件自己的浏览器目录，第一次扫码登录后会自动保留 Cookie：

```bash
npm run collect -- --profile ./data/browser-profile --limit 200 --screenshots
npm run gallery
```

## 输出文件

- `data/following.json`：抓到的账号原始列表。
- `data/screenshots/`：账号主页截图缓存。
- `data/gallery/index.html`：离线画廊入口。

Chrome 扩展弹窗和画廊页里的「仅补缺失主页截图」会交给后台任务处理：只挑选已采集账号中还没有截图的主页链接，逐个打开页面、等待渲染、截取当前可见主页并写回画廊。已有截图的账号会跳过。这个过程会临时切换到抖音主页标签页，完成后自动回到原标签页。

## 采集自测数据

扩展弹窗里的「查看采集自测数据」会生成最近一次扫描快照，并打开调试页。调试页会展示：

- 当前可见账号解析结果。
- 每一行账号 DOM 的原始文本、尺寸、链接数量、按钮文本。
- 最近一次采集诊断信息。
- 可导出的 JSON，方便排查选择器或滚动监听问题。

## 注意

- 本插件只在你的本机读取登录态，不会上传 Cookie。
- 抖音页面结构可能调整，脚本里保留了多层选择器和可见文本兜底；如果后续失效，优先更新 `scripts/collect-douyin.mjs` 中的选择器。
- 请只抓取你自己账号可见的数据，并遵守平台规则和合理频率。
