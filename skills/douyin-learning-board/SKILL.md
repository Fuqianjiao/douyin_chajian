---
name: douyin-learning-board
description: 使用本地登录态抓取抖音关注列表，缓存主页截图，并生成起号学习画廊。
---

# 抖音起号学习看板

当用户要抓取 `https://www.douyin.com/user/self` 的关注列表、复用本地 Cookie、分类主播或生成离线画廊时，使用本插件。

## 工作流

1. 确认用户只处理自己账号可见的数据。
2. 推荐用户用 `--cdp http://127.0.0.1:9222` 连接本地调试浏览器，以复用现有 Cookie。
3. 如果用户不方便用调试浏览器，改用 `--profile ./data/browser-profile`，首次登录后复用该目录 Cookie。
4. 执行 `npm run collect -- --limit 200 --screenshots` 抓取和截图。
5. 执行 `npm run gallery` 生成 `data/gallery/index.html`。
6. 如分类不理想，编辑 `config/categories.json` 后重新执行 `npm run gallery`。

## 重要边界

- 不要要求用户提供 Cookie 字符串。
- 不要把 Cookie、截图或账号数据上传到第三方服务。
- 不主动启动或停止用户项目服务；本插件脚本是一次性本地命令。
- 抖音页面结构变化时，优先调整 `scripts/collect-douyin.mjs` 里的选择器。
