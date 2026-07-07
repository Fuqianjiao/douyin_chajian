const state = {
  accounts: [],
  pageShots: [],
  config: null
};

const els = {
  summary: document.querySelector("#summary"),
  statusText: document.querySelector("#statusText"),
  progress: document.querySelector("#progress"),
  stats: document.querySelector("#stats"),
  accountList: document.querySelector("#accountList"),
  collectBtn: document.querySelector("#collectBtn"),
  captureViewBtn: document.querySelector("#captureViewBtn"),
  openGalleryBtn: document.querySelector("#openGalleryBtn")
};

function setStatus(text, progress = null) {
  els.statusText.textContent = text;
  if (progress !== null) els.progress.value = progress;
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function classify(account) {
  const text = [account.nickname, account.bio, account.douyinId, ...(account.rawTexts || [])].join(" ").toLowerCase();
  const matches = [];
  for (const category of state.config.categories) {
    const hitCount = category.keywords.filter((keyword) => text.includes(String(keyword).toLowerCase())).length;
    if (hitCount > 0) matches.push({ name: category.name, score: hitCount });
  }
  matches.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name, "zh-CN"));
  return matches[0]?.name || state.config.defaultCategory || "未分类";
}

function applyCategories(accounts) {
  return accounts.map((account) => ({
    ...account,
    category: account.category || classify(account),
    intro: account.bio || account.douyinId || "暂无页面可见简介"
  }));
}

function mergeAccounts(existing, incoming) {
  const map = new Map(existing.map((account) => [account.homeUrl, account]));
  for (const account of incoming) {
    map.set(account.homeUrl, { ...map.get(account.homeUrl), ...account });
  }
  return applyCategories([...map.values()]);
}

async function loadConfig() {
  const response = await fetch(chrome.runtime.getURL("config/categories.json"));
  state.config = await response.json();
}

async function loadState() {
  const stored = await chrome.storage.local.get(["accounts", "pageShots"]);
  state.accounts = applyCategories(stored.accounts || []);
  state.pageShots = stored.pageShots || [];
  render();
}

async function saveState() {
  await chrome.storage.local.set({ accounts: state.accounts, pageShots: state.pageShots });
  render();
}

function render() {
  const total = state.accounts.length;
  const screenshots = state.pageShots.length;
  els.summary.textContent = "打开抖音关注弹窗后开始采集。";

  const grouped = new Map();
  for (const account of state.accounts) {
    grouped.set(account.category, (grouped.get(account.category) || 0) + 1);
  }

  els.stats.innerHTML = `
    <article class="stat-card">
      <strong>${total}</strong>
      <span>已采集账号</span>
    </article>
    <article class="stat-card">
      <strong>${screenshots}</strong>
      <span>已缓存截图</span>
    </article>
  `;

  els.accountList.innerHTML = state.accounts.slice(0, 30).map((account) => `
    <article class="item">
      <img src="${escapeHtml(account.avatar)}" alt="" />
      <div>
        <h2>${escapeHtml(account.nickname)}</h2>
        <p>${escapeHtml(account.intro)}</p>
        <span class="tag">${escapeHtml(account.category)}</span>
      </div>
    </article>
  `).join("");
}

async function activeDouyinTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !/^https:\/\/(www\.)?douyin\.com\//.test(tab.url || "")) {
    throw new Error("请先切换到 douyin.com 的关注页或账号列表页。");
  }
  return tab;
}

async function collectWaterfall() {
  const tab = await activeDouyinTab();
  await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["src/content.js"] });
  setStatus("正在自动滚动关注列表并采集账号...", 20);
  const beforeCount = state.accounts.length;
  const response = await chrome.tabs.sendMessage(tab.id, {
    type: "DOUYIN_GALLERY_COLLECT_WATERFALL",
    options: {
      maxRounds: 140,
      settleMs: 900,
      idleLimit: 6
    }
  });
  if (!response?.ok) throw new Error(response?.error || "页面采集失败");
  state.accounts = mergeAccounts(state.accounts, response.accounts || []);
  await saveState();
  const addedCount = state.accounts.length - beforeCount;
  setStatus(`滚动采集完成：本轮发现 ${response.accounts.length} 个账号，新增 ${addedCount} 个。${response.stopReason || ""}`, 100);
}

async function captureCurrentView() {
  const tab = await activeDouyinTab();
  setStatus("正在截取当前抖音界面...", 35);
  const response = await chrome.runtime.sendMessage({
    type: "DOUYIN_GALLERY_CAPTURE_ACTIVE_TAB",
    tab: {
      id: tab.id,
      windowId: tab.windowId,
      title: tab.title,
      url: tab.url
    }
  });
  if (!response?.ok) throw new Error(response?.error || "当前界面截图失败");
  state.pageShots = [response.shot, ...state.pageShots].slice(0, 12);
  await saveState();
  setStatus("当前界面截图已保存，并会进入画廊。", 100);
}

function groupedAccounts() {
  const groups = new Map();
  for (const account of state.accounts) {
    if (!groups.has(account.category)) groups.set(account.category, []);
    groups.get(account.category).push(account);
  }
  return groups;
}

function galleryHtml() {
  const groups = groupedAccounts();
  const nav = [...groups.entries()].map(([name, accounts]) => `<button data-filter="${escapeHtml(name)}">${escapeHtml(name)} <b>${accounts.length}</b></button>`).join("");
  const pageShots = state.pageShots.map((shot) => `
    <article class="screen-card">
      <img src="${escapeHtml(shot.previewDataUrl || shot.screenshotPath)}" alt="${escapeHtml(shot.title)}" />
      <div>
        <h3>${escapeHtml(shot.title)}</h3>
        <p>${escapeHtml(new Date(shot.capturedAt).toLocaleString("zh-CN"))}</p>
        <a href="${escapeHtml(shot.url)}" target="_blank" rel="noreferrer">打开来源页面</a>
      </div>
    </article>
  `).join("");
  const sections = [...groups.entries()].map(([name, accounts]) => `
    <section class="folder" data-folder="${escapeHtml(name)}">
      <div class="folder-head">
        <h2>${escapeHtml(name)}</h2>
        <span>${accounts.length} 个账号</span>
      </div>
      <div class="grid">
        ${accounts.map((account) => `
    <article class="card" data-category="${escapeHtml(name)}">
      <img class="shot" src="${escapeHtml(account.screenshotPath || account.avatar || "")}" alt="${escapeHtml(account.nickname)}" />
      <div class="body">
        <img class="avatar" src="${escapeHtml(account.avatar)}" alt="" />
        <div>
          <h3>${escapeHtml(account.nickname)}</h3>
          <p>${escapeHtml(account.intro)}</p>
          <span>${escapeHtml(account.category)}</span>
        </div>
      </div>
      <footer>
        <a href="${escapeHtml(account.homeUrl)}" target="_blank" rel="noreferrer">打开主页</a>
        <small>${escapeHtml(account.douyinId || "")}</small>
      </footer>
    </article>
        `).join("")}
      </div>
    </section>
  `).join("");

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>起号学习离线画廊</title>
  <style>
    :root{color-scheme:dark;--bg:#101116;--panel:#191b23;--line:#303442;--text:#f4f6f8;--muted:#a5adba;--cyan:#38d5f5;--pink:#ff2f6d}
    *{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif}
    main{padding:32px 40px}header{display:flex;justify-content:space-between;align-items:end;gap:24px;border-bottom:1px solid var(--line);padding-bottom:24px;margin-bottom:24px}
    h1{margin:0 0 10px;font-size:44px;line-height:1.1}p{color:var(--muted);line-height:1.6}.filters{display:flex;gap:10px;flex-wrap:wrap;margin-bottom:28px}
    button{border:1px solid var(--line);background:#20232d;color:var(--text);border-radius:8px;padding:12px 16px;font-weight:800;cursor:pointer}button.active{border-color:var(--cyan);color:var(--cyan)}
    .folder{margin-bottom:34px}.folder-head{display:flex;justify-content:space-between;align-items:end;margin:0 0 14px}.folder-head h2{margin:0;font-size:28px}.folder-head span{color:var(--muted)}
    .screens{margin-bottom:34px}.screen-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(360px,1fr));gap:20px}.screen-card{overflow:hidden;border:1px solid var(--line);border-radius:8px;background:var(--panel)}
    .screen-card img{display:block;width:100%;aspect-ratio:16/10;object-fit:cover;background:#252832}.screen-card div{padding:16px}.screen-card h3{margin:0 0 8px;font-size:20px}
    .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:20px}.card{overflow:hidden;border:1px solid var(--line);border-radius:8px;background:var(--panel)}
    .shot{width:100%;aspect-ratio:16/10;object-fit:cover;background:#252832}.body{display:grid;grid-template-columns:58px 1fr;gap:14px;padding:16px}.avatar{width:58px;height:58px;border-radius:50%;object-fit:cover}
    h3{margin:0 0 8px;font-size:21px}.body p{margin:0}.body span{display:inline-block;margin-top:12px;color:var(--cyan);font-weight:800}
    footer{display:flex;justify-content:space-between;gap:12px;padding:0 16px 16px;align-items:center}a{color:var(--pink);font-weight:800;text-decoration:none}small{color:var(--muted)}
    @media(max-width:720px){main{padding:20px}header{display:block}h1{font-size:32px}.grid{grid-template-columns:1fr}}
  </style>
</head>
<body>
  <main>
    <header>
      <div>
        <h1>起号学习离线画廊</h1>
        <p>本地采集 ${state.accounts.length} 个账号，已保存 ${state.pageShots.length} 张界面截图。</p>
      </div>
    </header>
    <section class="screens">
      <div class="folder-head">
        <h2>界面截图</h2>
        <span>${state.pageShots.length} 张截图</span>
      </div>
      <div class="screen-grid">${pageShots || "<p>暂无界面截图</p>"}</div>
    </section>
    <nav class="filters"><button class="active" data-filter="全部">全部 <b>${state.accounts.length}</b></button>${nav}</nav>
    ${sections}
  </main>
  <script>
    const buttons = document.querySelectorAll("button[data-filter]");
    const folders = document.querySelectorAll(".folder");
    buttons.forEach((button) => button.addEventListener("click", () => {
      const filter = button.dataset.filter;
      buttons.forEach((item) => item.classList.toggle("active", item === button));
      folders.forEach((folder) => folder.style.display = filter === "全部" || folder.dataset.folder === filter ? "" : "none");
    }));
  </script>
</body>
</html>`;
}

async function downloadText(filename, text, mime) {
  const url = URL.createObjectURL(new Blob([text], { type: `${mime};charset=utf-8` }));
  try {
    await chrome.downloads.download({
      url,
      filename,
      saveAs: false,
      conflictAction: "overwrite"
    });
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }
}

async function exportJson() {
  await downloadText("data/gallery/accounts.json", JSON.stringify({
    exportedAt: new Date().toISOString(),
    config: state.config,
    pageShots: state.pageShots,
    accounts: state.accounts
  }, null, 2), "application/json");
}

async function exportGallery() {
  await downloadText("data/gallery/index.html", galleryHtml(), "text/html");
}

async function openOfflineGallery() {
  await chrome.storage.local.set({
    accounts: state.accounts,
    pageShots: state.pageShots,
    config: state.config,
    gallerySyncedAt: new Date().toISOString()
  });
  await exportGallery();
  await exportJson();
  await chrome.tabs.create({ url: chrome.runtime.getURL("src/gallery.html") });
  setStatus("已打开离线画廊，并同步下载版画廊文件。", 100);
}

function setBusy(busy) {
  for (const button of document.querySelectorAll("button")) button.disabled = busy;
}

async function run(task) {
  try {
    setBusy(true);
    setStatus("正在处理...", 15);
    await task();
  } catch (error) {
    setStatus(error.message || String(error), 0);
  } finally {
    setBusy(false);
  }
}

els.collectBtn.addEventListener("click", () => run(collectWaterfall));
els.captureViewBtn.addEventListener("click", () => run(captureCurrentView));
els.openGalleryBtn.addEventListener("click", () => run(openOfflineGallery));

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (changes.captureProgress?.newValue) {
    const progress = changes.captureProgress.newValue;
    const percent = Math.round((progress.current / progress.total) * 100);
    setStatus(`正在截图 ${progress.current}/${progress.total}：${progress.nickname || ""}`, percent);
  }
  if (changes.accounts?.newValue) {
    state.accounts = applyCategories(changes.accounts.newValue);
    render();
  }
  if (changes.pageShots?.newValue) {
    state.pageShots = changes.pageShots.newValue;
    render();
  }
});

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type !== "DOUYIN_GALLERY_SCROLL_PROGRESS") return;
  const round = message.round || 0;
  const total = message.total || 0;
  const added = message.added || 0;
  const progress = Math.min(95, 20 + round * 0.8);
  setStatus(`正在滚动采集：第 ${round} 次滚动，已发现 ${total} 个账号，本轮新增 ${added} 个。`, progress);
});

(async function init() {
  await loadConfig();
  await loadState();
})();
