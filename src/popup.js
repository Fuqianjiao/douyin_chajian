const state = {
  accounts: [],
  screenshotCount: 0,
  lastRunAdded: 0,
  config: null
};

const els = {
  summary: document.querySelector("#summary"),
  statusText: document.querySelector("#statusText"),
  progress: document.querySelector("#progress"),
  stats: document.querySelector("#stats"),
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

const SELF_URL_PATTERN = /\/user\/self(\b|[/?#])/i;
const MAX_TAGS_PER_ACCOUNT = 6;
const MIN_TAGS_PER_ACCOUNT = 1;

/* ─── IndexedDB: 截图存储（无大小限制） ─── */
const SCREENSHOT_DB_NAME = "DouyinGalleryScreenshots";
const SCREENSHOT_STORE = "shots";
const SCREENSHOT_DB_VERSION = 1;

function openScreenshotDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(SCREENSHOT_DB_NAME, SCREENSHOT_DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(SCREENSHOT_STORE)) {
        db.createObjectStore(SCREENSHOT_STORE, { keyPath: "accountId" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function saveScreenshotToDB(accountId, dataUrl, capturedAt) {
  const db = await openScreenshotDB();
  const tx = db.transaction(SCREENSHOT_STORE, "readwrite");
  const store = tx.objectStore(SCREENSHOT_STORE);
  store.put({ accountId, dataUrl, capturedAt });
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function countScreenshotsInDB() {
  const db = await openScreenshotDB();
  const tx = db.transaction(SCREENSHOT_STORE, "readonly");
  const store = tx.objectStore(SCREENSHOT_STORE);
  const request = store.count();
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function getAllScreenshotsFromDB() {
  const db = await openScreenshotDB();
  const tx = db.transaction(SCREENSHOT_STORE, "readonly");
  const store = tx.objectStore(SCREENSHOT_STORE);
  const request = store.getAll();
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function clearOldPageShots() {
  await chrome.storage.local.remove("pageShots");
}

function normalizeAccountText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function cleanInlineBio(value) {
  return normalizeAccountText(value)
    .replace(/\b\d+\s*个作品未看\b/g, "")
    .replace(/^\s*[：:｜|,，。-]+/, "")
    .trim();
}

function isUsableNamePart(value) {
  const text = normalizeAccountText(value);
  if (!text || text.length > 36) return false;
  if (/已关注|关注|粉丝|获赞|作品未看|移除粉丝|搜索用户|综合排序/.test(text)) return false;
  return true;
}

function cleanAccountIdentity(account) {
  let bio = normalizeAccountText(account.bio || account.intro || "");
  let nickname = normalizeAccountText(account.nickname || "");
  const rawTexts = Array.isArray(account.rawTexts)
    ? account.rawTexts.map(normalizeAccountText).filter(Boolean)
    : [];
  const candidates = rawTexts
    .filter((text) => text !== nickname)
    .filter((text) => nickname.startsWith(`${text} `) || nickname.startsWith(text))
    .filter(isUsableNamePart)
    .sort((a, b) => a.length - b.length);

  if (candidates.length) {
    const name = candidates[0];
    const rest = cleanInlineBio(nickname.slice(name.length));
    nickname = name;
    if (rest && (!bio || bio === name || bio.length < rest.length)) bio = rest;
  } else if (bio && nickname && nickname !== bio) {
    if (nickname.startsWith(bio) && isUsableNamePart(bio)) {
      const rest = cleanInlineBio(nickname.slice(bio.length));
      if (rest) {
        nickname = bio;
        bio = rest;
      }
    } else if (nickname.endsWith(bio)) {
      nickname = normalizeAccountText(nickname.slice(0, -bio.length));
    } else if (nickname.includes(bio)) {
      const index = nickname.indexOf(bio);
      const before = cleanInlineBio(nickname.slice(0, index));
      if (isUsableNamePart(before)) nickname = before;
    }
  }

  bio = cleanInlineBio(bio);

  if (!nickname) nickname = "未命名账号";

  return {
    ...account,
    nickname,
    bio
  };
}

function classifyTag(account) {
  const text = [account.nickname, account.bio, account.douyinId, ...(account.rawTexts || [])].join(" ").toLowerCase();
  const matches = [];
  for (const category of state.config.categories) {
    const hitCount = category.keywords.filter((keyword) => text.includes(String(keyword).toLowerCase())).length;
    if (hitCount > 0) matches.push({ name: category.name, score: hitCount });
  }
  matches.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name, "zh-CN"));
  return matches[0]?.name || state.config.defaultCategory || "未分类";
}

function ensureAiTag(account) {
  const tags = Array.isArray(account.tags) ? account.tags.slice() : [];
  if (!tags.some((t) => t.source === "ai")) {
    tags.unshift({ name: classifyTag(account), source: "ai" });
  }
  if (tags.length > MAX_TAGS_PER_ACCOUNT) tags.length = MAX_TAGS_PER_ACCOUNT;
  if (tags.length < MIN_TAGS_PER_ACCOUNT) {
    tags.push({ name: state.config.defaultCategory || "未分类", source: "ai" });
  }
  const seen = new Set();
  return tags.filter((tag) => {
    const key = `${tag.source}::${tag.name}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function applyCategories(accounts) {
  return accounts
    .filter((account) => !SELF_URL_PATTERN.test(account.homeUrl || ""))
    .map((rawAccount) => {
      const account = cleanAccountIdentity(rawAccount);
      const tags = ensureAiTag(account);
      const firstTag = tags[0]?.name || "未分类";
      return {
        ...account,
        tags,
        category: account.category || firstTag,
        intro: account.bio || account.douyinId || "暂无页面可见简介"
      };
    });
}

function profileKey(url) {
  try {
    const parsed = new URL(url);
    const match = parsed.pathname.match(/\/user\/[^/?#]+/i);
    return match ? match[0].toLowerCase() : "";
  } catch {
    const match = String(url || "").match(/\/user\/[^/?#]+/i);
    return match ? match[0].toLowerCase() : "";
  }
}

function findAccountByUrl(url) {
  const key = profileKey(url);
  if (!key) return null;
  return state.accounts.find((account) => profileKey(account.homeUrl) === key) || null;
}

function upsertProfileNote(existingNote, profileDetail) {
  const detail = normalizeAccountText(profileDetail);
  if (!detail) return existingNote || "";
  const marker = "【主页详细介绍】";
  const block = `${marker}\n${detail}`;
  const note = String(existingNote || "").trim();
  if (!note) return block;
  if (note.includes(marker)) {
    return note.replace(new RegExp(`\\n*${marker}[\\s\\S]*$`), `\n\n${block}`).trim();
  }
  return `${note}\n\n${block}`;
}

function mergeAccounts(existing, incoming) {
  const map = new Map(existing.map((account) => [account.homeUrl, account]));
  for (const account of incoming) {
    const old = map.get(account.homeUrl) || {};
    const mergedTags = (() => {
      const oldAi = (old.tags || []).filter((t) => t.source === "ai");
      const oldHuman = (old.tags || []).filter((t) => t.source === "human");
      const incomingAi = (account.tags || []).filter((t) => t.source === "ai");
      const incomingHuman = (account.tags || []).filter((t) => t.source === "human");
      const out = [...oldAi];
      for (const t of incomingAi) if (!out.some((x) => x.name === t.name)) out.push(t);
      for (const t of oldHuman) if (!out.some((x) => x.name === t.name)) out.push(t);
      for (const t of incomingHuman) if (!out.some((x) => x.name === t.name)) out.push(t);
      return out.slice(0, MAX_TAGS_PER_ACCOUNT);
    })();
    map.set(account.homeUrl, { ...old, ...account, tags: mergedTags });
  }
  return applyCategories([...map.values()]);
}

async function loadConfig() {
  const response = await fetch(chrome.runtime.getURL("config/categories.json"));
  state.config = await response.json();
}

async function loadState() {
  const stored = await chrome.storage.local.get(["accounts", "lastRunAdded"]);
  const originalAccountsJson = JSON.stringify(stored.accounts || []);
  state.accounts = applyCategories(stored.accounts || []);
  state.lastRunAdded = Number(stored.lastRunAdded || 0);
  state.screenshotCount = await countScreenshotsInDB();
  // 清零旧 pageShots 数据（一次性清理）
  await clearOldPageShots();
  if (originalAccountsJson !== JSON.stringify(state.accounts)) {
    await chrome.storage.local.set({ accounts: state.accounts });
  }
  render();
}

async function saveState() {
  await chrome.storage.local.set({
    accounts: state.accounts,
    lastRunAdded: state.lastRunAdded
  });
  render();
}

function render() {
  const total = state.accounts.length;
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
      <strong>${state.screenshotCount}</strong>
      <span>已绑定截图</span>
    </article>
  `;
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
  await chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, files: ["src/content.js"] });
  setStatus("正在所有页面框架中定位关注弹窗...", 20);
  const beforeCount = state.accounts.length;
  const probeResults = await chrome.scripting.executeScript({
    target: { tabId: tab.id, allFrames: true },
    func: () => {
      if (typeof globalThis.__DOUYIN_GALLERY_COLLECT_VISIBLE__ !== "function") {
        return { ok: false, frameUrl: location.href, accounts: [] };
      }

      const accounts = globalThis.__DOUYIN_GALLERY_COLLECT_VISIBLE__();
      const text = document.body?.innerText || "";
      return {
        ok: true,
        frameUrl: location.href,
        title: document.title,
        accounts,
        hasFollowingDialog: /关注\s*\(\d+\)|已关注|搜索用户名字或抖音号/.test(text)
      };
    }
  });
  const targetFrame = probeResults
    .map((item) => ({ frameId: item.frameId, ...item.result }))
    .filter((item) => item.ok)
    .sort((a, b) => {
      const dialogScore = Number(Boolean(b.hasFollowingDialog)) - Number(Boolean(a.hasFollowingDialog));
      if (dialogScore !== 0) return dialogScore;
      return (b.accounts?.length || 0) - (a.accounts?.length || 0);
    })[0];

  if (!targetFrame || !targetFrame.accounts?.length) {
    throw new Error("没有在当前页面或 iframe 中识别到关注账号，请确认关注弹窗已打开。");
  }

  setStatus(`已定位关注弹窗 frame，首屏识别 ${targetFrame.accounts.length} 个账号，开始滚动采集...`, 30);
  const [runResult] = await chrome.scripting.executeScript({
    target: { tabId: tab.id, frameIds: [targetFrame.frameId] },
    args: [{
      maxRounds: 140,
      settleMs: 900,
      idleLimit: 6
    }],
    func: async (options) => {
      if (typeof globalThis.__DOUYIN_GALLERY_RUN_WATERFALL__ !== "function") {
        return {
          ok: false,
          error: "当前 frame 未加载采集脚本",
          frameUrl: location.href,
          accounts: []
        };
      }

      try {
        const result = await globalThis.__DOUYIN_GALLERY_RUN_WATERFALL__(options);
        return { ok: true, ...result };
      } catch (error) {
        return {
          ok: false,
          error: error.message || String(error),
          frameUrl: location.href,
          accounts: []
        };
      }
    }
  });
  const response = runResult?.result;

  if (!response?.ok) throw new Error(response?.error || "页面采集失败");
  if (!response.accounts?.length) throw new Error("没有在当前页面或 iframe 中识别到关注账号，请确认关注弹窗已打开。");

  state.accounts = mergeAccounts(state.accounts, response.accounts || []);
  const addedCount = state.accounts.length - beforeCount;
  state.lastRunAdded = addedCount;
  await saveState();
  let summary;
  if (addedCount > 0) {
    summary = `滚动采集完成：发现 ${response.accounts.length} 个账号，本次新增 ${addedCount} 个。${response.stopReason || ""}`;
  } else {
    summary = `滚动采集完成：发现 ${response.accounts.length} 个账号，本次未发现新账号（全部已存在）。${response.stopReason || ""}`;
  }
  setStatus(summary, 100);
}

async function captureCurrentView() {
  const tab = await activeDouyinTab();
  setStatus("正在读取主页详细介绍...", 25);
  const [profileResult] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: async () => {
      const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const normalize = (value) => String(value || "").replace(/\s+/g, " ").trim();
      const visible = (element) => {
        if (!element) return false;
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
      };
      const fire = (element, type) => {
        element.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
      };

      const moreTargets = [...document.querySelectorAll("button, span, div, a")]
        .filter(visible)
        .filter((node) => normalize(node.textContent) === "更多");

      for (const target of moreTargets.slice(0, 3)) {
        fire(target, "mouseover");
        fire(target, "mouseenter");
        fire(target, "mousemove");
        target.click?.();
        await wait(180);
      }
      await wait(450);

      const blocked = /关注|粉丝|获赞|作品|推荐|喜欢|收藏|私密作品|合集|短剧|搜索|分享主页|下载|客户端|已关注|私信/;
      const tooltipTexts = [...document.querySelectorAll("[role='tooltip'], .semi-tooltip, .semi-tooltip-content, .semi-popover, .semi-portal-inner")]
        .filter(visible)
        .map((node) => normalize(node.innerText || node.textContent))
        .filter((text) => text && text !== "更多" && text.length <= 260)
        .filter((text) => !blocked.test(text) || /[@#｜|，,。.!！?？]/.test(text));

      const profileRegion = [...document.querySelectorAll("main, header, section, div")]
        .filter(visible)
        .map((node) => normalize(node.innerText || node.textContent))
        .filter((text) => text.includes("抖音号") && text.length <= 900)
        .sort((a, b) => a.length - b.length)[0] || "";
      const inlineMatch = profileRegion.match(/(?:IP属地[:：]?\s*\S+\s*)?(.{4,180}?)(?:\s*更多|\s*作品|\s*推荐|\s*喜欢|$)/);
      const inlineBio = normalize(inlineMatch?.[1] || "")
        .replace(/^.*?抖音号[:：]?\s*[A-Za-z0-9_.-]+\s*/i, "")
        .replace(/^IP属地[:：]?\s*\S+\s*/, "");

      const detail = tooltipTexts
        .concat(inlineBio)
        .map((text) => text.replace(/^更多\s*/, "").trim())
        .filter((text) => text && text.length >= 4)
        .sort((a, b) => b.length - a.length)[0] || "";

      return {
        url: location.href,
        title: document.title,
        profileDetail: detail
      };
    }
  });
  const profile = profileResult?.result || {};

  setStatus("正在截取当前抖音界面...", 55);
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

  const matchedAccount = findAccountByUrl(profile.url || tab.url);
  if (matchedAccount) {
    response.shot.accountId = matchedAccount.id;
    response.shot.accountNickname = matchedAccount.nickname;
    if (profile.profileDetail) {
      matchedAccount.note = upsertProfileNote(matchedAccount.note, profile.profileDetail);
      matchedAccount.profileDetail = profile.profileDetail;
      matchedAccount.profileDetailSyncedAt = new Date().toISOString();
    }
    // 截图存 IndexedDB（关联到账号）
    await saveScreenshotToDB(matchedAccount.id, response.shot.screenshotDataUrl, response.shot.capturedAt);
    matchedAccount._hasScreenshot = true;
    state.screenshotCount = await countScreenshotsInDB();
    await saveState();
  } else {
    // 未关联账号 → 不存截图（截图只绑定到已有账号才有效）
    state.screenshotCount = await countScreenshotsInDB();
  }
  // 清零旧 pageShots 数据
  await clearOldPageShots();

  if (matchedAccount && profile.profileDetail) {
    setStatus(`已截图，绑定「${matchedAccount.nickname}」并同步主页介绍。`, 100);
  } else if (matchedAccount) {
    setStatus(`已截图并绑定「${matchedAccount.nickname}」，未读取到更多介绍。`, 100);
  } else {
    setStatus("当前界面截图未匹配到已采集账号，截图仅绑定成功时才保存。", 100);
  }
}

function groupedAccounts() {
  const groups = new Map();
  for (const account of state.accounts) {
    if (!groups.has(account.category)) groups.set(account.category, []);
    groups.get(account.category).push(account);
  }
  return groups;
}

async function galleryHtml() {
  const groups = groupedAccounts();
  const nav = [...groups.entries()].map(([name, accounts]) => `<button data-filter="${escapeHtml(name)}">${escapeHtml(name)} <b>${accounts.length}</b></button>`).join("");
  const screenshots = await getAllScreenshotsFromDB();
  const shotMap = new Map(screenshots.map((s) => [s.accountId, s]));
  const sections = [...groups.entries()].map(([name, accounts]) => `
    <section class="folder" data-folder="${escapeHtml(name)}">
      <div class="folder-head">
        <h2>${escapeHtml(name)}</h2>
        <span>${accounts.length} 个账号</span>
      </div>
      <div class="grid">
        ${accounts.map((account) => `
    <article class="card" data-category="${escapeHtml(name)}">
      <img class="shot" src="${escapeHtml(shotMap.get(account.id)?.dataUrl || account.avatar || "")}" alt="${escapeHtml(account.nickname)}" />
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
    main{padding:24px 28px}header{display:flex;justify-content:space-between;align-items:end;gap:18px;border-bottom:1px solid var(--line);padding-bottom:16px;margin-bottom:20px}
    h1{margin:0 0 8px;font-size:30px;line-height:1.1}p{color:var(--muted);font-size:14px;line-height:1.5}.filters{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:20px}
    button{border:1px solid var(--line);background:#20232d;color:var(--text);border-radius:8px;padding:8px 12px;font-size:13px;font-weight:800;cursor:pointer}button.active{border-color:var(--cyan);color:var(--cyan)}
    .folder{margin-bottom:24px}.folder-head{display:flex;justify-content:space-between;align-items:end;margin:0 0 12px}.folder-head h2{margin:0;font-size:20px}.folder-head span{color:var(--muted);font-size:13px}
    .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:12px}.card{overflow:hidden;border:1px solid var(--line);border-radius:8px;background:var(--panel)}
    .shot{width:100%;aspect-ratio:16/10;object-fit:cover;background:#252832}.body{display:grid;grid-template-columns:44px 1fr;gap:10px;padding:12px}.avatar{width:44px;height:44px;border-radius:50%;object-fit:cover}
    h3{margin:0 0 6px;font-size:16px}.body p{margin:0}.body span{display:inline-block;margin-top:8px;color:var(--cyan);font-size:13px;font-weight:800}
    footer{display:flex;justify-content:space-between;gap:10px;padding:0 12px 12px;align-items:center}a{color:var(--pink);font-weight:800;text-decoration:none}small{color:var(--muted);font-size:12px}
    @media(max-width:720px){main{padding:20px}header{display:block}h1{font-size:26px}.grid{grid-template-columns:1fr}}
  </style>
</head>
<body>
  <main>
    <header>
      <div>
        <h1>起号学习离线画廊</h1>
        <p>本地采集 ${state.accounts.length} 个账号，${state.screenshotCount} 张已绑定截图。</p>
      </div>
    </header>
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
  const screenshots = await getAllScreenshotsFromDB();
  await downloadText("data/gallery/accounts.json", JSON.stringify({
    exportedAt: new Date().toISOString(),
    config: state.config,
    screenshots,
    accounts: state.accounts
  }, null, 2), "application/json");
}

async function exportGallery() {
  await downloadText("data/gallery/index.html", galleryHtml(), "text/html");
}

async function openOfflineGallery() {
  await chrome.storage.local.set({
    accounts: state.accounts,
    config: state.config,
    gallerySyncedAt: new Date().toISOString()
  });
  await chrome.tabs.create({ url: chrome.runtime.getURL("src/gallery.html") });
  setStatus("已打开离线画廊。", 100);
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
  if (changes.lastRunAdded?.newValue !== undefined) {
    state.lastRunAdded = changes.lastRunAdded.newValue;
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
