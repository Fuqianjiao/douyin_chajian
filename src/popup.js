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
  fillShotsBtn: document.querySelector("#fillShotsBtn"),
  openGalleryBtn: document.querySelector("#openGalleryBtn"),
  shotLogSection: document.querySelector("#shotLogSection"),
  shotLogList: document.querySelector("#shotLogList"),
  shotLogSummary: document.querySelector("#shotLogSummary")
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
const SCREENSHOT_BY_URL_STORE = "shotsByUrl";
const SCREENSHOT_DB_VERSION = 2;

function openScreenshotDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(SCREENSHOT_DB_NAME, SCREENSHOT_DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(SCREENSHOT_STORE)) {
        db.createObjectStore(SCREENSHOT_STORE, { keyPath: "accountId" });
      }
      if (!db.objectStoreNames.contains(SCREENSHOT_BY_URL_STORE)) {
        db.createObjectStore(SCREENSHOT_BY_URL_STORE, { keyPath: "homeKey" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function uniqueScreenshotKeys(account, extraUrls = []) {
  return [...new Set([
    profileKey(account?.homeUrl),
    ...extraUrls.map(profileKey)
  ].filter(Boolean))];
}

function requestToPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function getScreenshotFromDB(account) {
  const db = await openScreenshotDB();
  const homeKey = profileKey(account?.homeUrl);
  if (homeKey && db.objectStoreNames.contains(SCREENSHOT_BY_URL_STORE)) {
    const tx = db.transaction(SCREENSHOT_BY_URL_STORE, "readonly");
    const shot = await requestToPromise(tx.objectStore(SCREENSHOT_BY_URL_STORE).get(homeKey));
    if (shot) return shot;
  }
  if (!account?.id) return null;
  const tx = db.transaction(SCREENSHOT_STORE, "readonly");
  return await requestToPromise(tx.objectStore(SCREENSHOT_STORE).get(account.id));
}

async function saveScreenshotToDB(account, dataUrl, capturedAt, extraUrls = []) {
  const homeKey = profileKey(account?.homeUrl);
  if (!homeKey) throw new Error("缺少账号主页链接，无法绑定截图");
  const homeKeys = uniqueScreenshotKeys(account, extraUrls);
  const db = await openScreenshotDB();
  const stores = db.objectStoreNames.contains(SCREENSHOT_BY_URL_STORE)
    ? [SCREENSHOT_STORE, SCREENSHOT_BY_URL_STORE]
    : [SCREENSHOT_STORE];
  const tx = db.transaction(stores, "readwrite");
  tx.objectStore(SCREENSHOT_STORE).put({
    accountId: account.id,
    homeKey,
    homeUrl: account.homeUrl || "",
    dataUrl,
    capturedAt
  });
  if (db.objectStoreNames.contains(SCREENSHOT_BY_URL_STORE)) {
    const byUrl = tx.objectStore(SCREENSHOT_BY_URL_STORE);
    for (const key of homeKeys) {
      byUrl.put({
        homeKey: key,
        accountId: account.id,
        canonicalHomeKey: homeKey,
        homeUrl: account.homeUrl || "",
        dataUrl,
        capturedAt
      });
    }
  }
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function countScreenshotsInDB() {
  const db = await openScreenshotDB();
  const storeName = db.objectStoreNames.contains(SCREENSHOT_BY_URL_STORE) ? SCREENSHOT_BY_URL_STORE : SCREENSHOT_STORE;
  const tx = db.transaction(storeName, "readonly");
  const store = tx.objectStore(storeName);
  const request = store.count();
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function getAllScreenshotsFromDB() {
  const db = await openScreenshotDB();
  const storeName = db.objectStoreNames.contains(SCREENSHOT_BY_URL_STORE) ? SCREENSHOT_BY_URL_STORE : SCREENSHOT_STORE;
  const tx = db.transaction(storeName, "readonly");
  const store = tx.objectStore(storeName);
  const request = store.getAll();
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/* 轻量加载所有截图的 key 集合（只读 key，不读 base64 图片数据） */
async function loadShotKeySet() {
  const db = await openScreenshotDB();
  const set = new Set();
  const storeNames = [];
  if (db.objectStoreNames.contains(SCREENSHOT_BY_URL_STORE)) storeNames.push(SCREENSHOT_BY_URL_STORE);
  if (db.objectStoreNames.contains(SCREENSHOT_STORE)) storeNames.push(SCREENSHOT_STORE);
  for (const name of storeNames) {
    const tx = db.transaction(name, "readonly");
    const keys = await requestToPromise(tx.objectStore(name).getAllKeys());
    for (const key of keys || []) set.add(key);
  }
  return set;
}

/* 判断某账号是否已绑定截图（用 key 集合，不读图片） */
function accountHasShot(account, keySet) {
  if (!keySet || !keySet.size) return false;
  const key = profileKey(account?.homeUrl);
  if (key && keySet.has(key)) return true;
  if (account?.id && keySet.has(account.id)) return true;
  return false;
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
  setStatus("正在读取主页 signature...", 25);
  const [profileResult] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: async () => {
      const normalize = (value) => String(value || "").replace(/\s+/g, " ").trim();
      function worksCropRect() {
        const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 0;
        const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;
        const visible = (element) => {
          if (!element) return false;
          const rect = element.getBoundingClientRect();
          const style = getComputedStyle(element);
          return rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.right > 0 &&
            rect.top < viewportHeight && rect.left < viewportWidth &&
            style.visibility !== "hidden" && style.display !== "none";
        };
        const tabNode = [...document.querySelectorAll("span, div, a, button")]
          .filter(visible)
          .find((node) => /^作品\s*\d*/.test(normalize(node.textContent)));
        const tabRect = tabNode?.getBoundingClientRect();
        const tabTop = tabRect ? Math.max(0, tabRect.top - 8) : 0;
        const mediaRects = [...document.querySelectorAll("img, video, canvas, a, div")]
          .filter(visible)
          .filter((node) => {
            const rect = node.getBoundingClientRect();
            const style = getComputedStyle(node);
            const tag = node.tagName.toLowerCase();
            const hasMediaTag = ["img", "video", "canvas"].includes(tag);
            const hasBackground = style.backgroundImage && style.backgroundImage !== "none";
            const hasMediaChild = !hasMediaTag && Boolean(node.querySelector?.("img, video, canvas"));
            return (hasMediaTag || hasBackground || hasMediaChild) &&
              rect.width <= Math.min(560, viewportWidth - 120) &&
              rect.height <= Math.min(760, viewportHeight);
          })
          .map((node) => node.getBoundingClientRect())
          .filter((rect) => rect.width >= 120 && rect.height >= 120)
          .filter((rect) => rect.top >= Math.max(0, tabTop - 12))
          .filter((rect) => rect.left > 120);
        if (!mediaRects.length) return null;
        const left = Math.max(0, Math.min(tabRect?.left ?? Infinity, ...mediaRects.map((rect) => rect.left)) - 2);
        const top = Math.max(0, tabRect ? tabTop : Math.min(...mediaRects.map((rect) => rect.top)) - 16);
        const right = Math.min(viewportWidth, Math.max(...mediaRects.map((rect) => rect.right)) + 2);
        const bottom = Math.min(viewportHeight, Math.max(...mediaRects.map((rect) => rect.bottom)) + 36);
        const width = right - left;
        const height = bottom - top;
        if (width < 240 || height < 180) return null;
        return { x: left, y: top, width, height, viewportWidth, viewportHeight };
      }
      const crop = worksCropRect();

      function findSignature(obj) {
        if (obj === null || obj === undefined) return "";
        if (typeof obj === "string") {
          try {
            obj = JSON.parse(obj);
          } catch {
            return "";
          }
        }
        if (typeof obj !== "object") return "";
        if (Array.isArray(obj)) {
          for (const item of obj) {
            const found = findSignature(item);
            if (found) return found;
          }
          return "";
        }
        if (obj.signature && typeof obj.signature === "string") {
          return normalize(obj.signature).replace(/\\n/g, " ");
        }
        for (const key of Object.keys(obj)) {
          const found = findSignature(obj[key]);
          if (found) return found;
        }
        return "";
      }

      function extractSignatureFromScripts() {
        const scripts = [...document.querySelectorAll("script")];
        for (const script of scripts) {
          const text = script.textContent || "";
          if (!text.includes("signature")) continue;
          try {
            const parsed = JSON.parse(text);
            const sig = findSignature(parsed);
            if (sig) return sig;
          } catch {}
          const match = text.match(/"signature"\s*:\s*"([^"]{4,300})"/);
          if (match) return normalize(match[1]).replace(/\\n/g, " ");
        }
        return "";
      }

      function extractSignatureFromRenderData() {
        const el = document.getElementById("RENDER_DATA") || document.getElementById("SSR_HYDRATED_DATA");
        if (el) {
          try {
            const text = decodeURIComponent(el.textContent || "");
            return findSignature(JSON.parse(text));
          } catch {}
        }
        return "";
      }

      // 优先从全局变量和页面数据取 signature
      const globalCandidates = [
        window.__INITIAL_STATE__,
        window._SSR_HYDRATED_DATA,
        window.__RENDER_DATA__,
        window.__DATA__
      ];
      for (const data of globalCandidates) {
        if (!data) continue;
        const sig = findSignature(data);
        if (sig) {
          return { url: location.href, title: document.title, profileDetail: sig, crop };
        }
      }

      let sig = extractSignatureFromRenderData();
      if (sig) return { url: location.href, title: document.title, profileDetail: sig, crop };

      sig = extractSignatureFromScripts();
      if (sig) return { url: location.href, title: document.title, profileDetail: sig, crop };

      // Fallback: 通过页面点击「更多」获取（不依赖接口）
      const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
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

      return { url: location.href, title: document.title, profileDetail: detail, crop };
    }
  });
  const profile = profileResult?.result || {};

  setStatus("正在截取当前抖音界面...", 55);
  const response = await chrome.runtime.sendMessage({
    type: "DOUYIN_GALLERY_CAPTURE_ACTIVE_TAB",
    tab: { id: tab.id, windowId: tab.windowId, title: tab.title, url: tab.url },
    crop: profile.crop
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
    await saveScreenshotToDB(matchedAccount, response.shot.screenshotDataUrl, response.shot.capturedAt, [
      profile.url,
      response.shot.url,
      tab.url
    ]);
    const verifiedShot = await getScreenshotFromDB(matchedAccount);
    if (!verifiedShot?.dataUrl) {
      throw new Error("截图已生成但未能按账号链接回读，绑定失败");
    }
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
    setStatus(`已截图，绑定「${matchedAccount.nickname}」并同步 signature 到备注。`, 100);
  } else if (matchedAccount) {
    setStatus(`已截图并绑定「${matchedAccount.nickname}」，未读取到 signature。`, 100);
  } else {
    const key = profileKey(profile.url || tab.url) || "无链接 key";
    setStatus(`当前界面未匹配到已采集账号（${key}），截图仅绑定成功时才保存。`, 100);
  }
}

/* ─── 仅补缺失截图（v0.1.25 风格：popup 内联执行） ─── */

/* 运行锁（防止重复点击） */
let _fillShotRunning = false;

function startShotLog(total) {
  els.shotLogSection.hidden = false;
  els.shotLogList.innerHTML = "";
  els.shotLogSummary.textContent = total ? `共 ${total} 个` : "";
}

function appendShotLog(line) {
  if (!line) return;
  const div = document.createElement("div");
  div.className = `shot-log-line ${line.type || "info"}`;
  div.textContent = line.message;
  els.shotLogList.appendChild(div);
  els.shotLogList.scrollTop = els.shotLogList.scrollHeight;
}

function finalizeShotLog(summary) {
  els.shotLogSummary.textContent = summary || "";
}

function waitForTabComplete(tabId, timeoutMs = 25000) {
  return new Promise((resolve) => {
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      chrome.tabs.onUpdated.removeListener(listener);
      resolve();
    };
    const listener = (updatedTabId, info) => {
      if (updatedTabId === tabId && info.status === "complete") done();
    };
    chrome.tabs.onUpdated.addListener(listener);
    chrome.tabs.get(tabId, (current) => {
      if (current?.status === "complete") done();
    });
    setTimeout(done, timeoutMs);
  });
}

async function focusTabForCapture(tabId, windowId) {
  await chrome.windows.update(windowId, { focused: true });
  await chrome.tabs.update(tabId, { active: true });
  await new Promise((resolve) => setTimeout(resolve, 500));
}

/* 注入到目标页提取 signature + 作品区裁剪坐标 */
function extractProfileAndCrop() {
  const normalize = (v) => String(v || "").replace(/\s+/g, " ").trim();
  function worksCropRect() {
    const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 0;
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;
    const visible = (element) => {
      if (!element) return false;
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.right > 0 &&
        rect.top < viewportHeight && rect.left < viewportWidth &&
        style.visibility !== "hidden" && style.display !== "none";
    };
    const tabNode = [...document.querySelectorAll("span, div, a, button")]
      .filter(visible)
      .find((node) => /^\s*作品\s*\d*/.test(normalize(node.textContent)));
    const tabRect = tabNode?.getBoundingClientRect();
    const tabTop = tabRect ? Math.max(0, tabRect.top - 8) : 0;
    const mediaRects = [...document.querySelectorAll("img, video, canvas, a, div")]
      .filter(visible)
      .filter((node) => {
        const rect = node.getBoundingClientRect();
        const style = getComputedStyle(node);
        const tag = node.tagName.toLowerCase();
        const hasMediaTag = ["img", "video", "canvas"].includes(tag);
        const hasBackground = style.backgroundImage && style.backgroundImage !== "none";
        const hasMediaChild = !hasMediaTag && Boolean(node.querySelector?.("img, video, canvas"));
        return (hasMediaTag || hasBackground || hasMediaChild) &&
          rect.width <= Math.min(560, viewportWidth - 120) &&
          rect.height <= Math.min(760, viewportHeight);
      })
      .map((node) => node.getBoundingClientRect())
      .filter((rect) => rect.width >= 120 && rect.height >= 120)
      .filter((rect) => rect.top >= Math.max(0, tabTop - 12))
      .filter((rect) => rect.left > 120);
    if (!mediaRects.length) return null;
    const left = Math.max(0, Math.min(tabRect?.left ?? Infinity, ...mediaRects.map((rect) => rect.left)) - 2);
    const top = Math.max(0, tabRect ? tabTop : Math.min(...mediaRects.map((rect) => rect.top)) - 16);
    const right = Math.min(viewportWidth, Math.max(...mediaRects.map((rect) => rect.right)) + 2);
    const bottom = Math.min(viewportHeight, Math.max(...mediaRects.map((rect) => rect.bottom)) + 36);
    const width = right - left;
    const height = bottom - top;
    if (width < 240 || height < 180) return null;
    return { x: left, y: top, width, height, viewportWidth, viewportHeight };
  }
  const crop = worksCropRect();
  function findSignature(obj) {
    if (obj === null || obj === undefined) return "";
    if (typeof obj === "string") { try { obj = JSON.parse(obj); } catch { return ""; } }
    if (typeof obj !== "object") return "";
    if (Array.isArray(obj)) { for (const item of obj) { const f = findSignature(item); if (f) return f; } return ""; }
    if (obj.signature && typeof obj.signature === "string") return normalize(obj.signature).replace(/\\n/g, " ");
    for (const key of Object.keys(obj)) { const f = findSignature(obj[key]); if (f) return f; }
    return "";
  }
  for (const data of [window.__INITIAL_STATE__, window._SSR_HYDRATED_DATA, window.__RENDER_DATA__]) {
    if (!data) continue;
    const sig = findSignature(data);
    if (sig) return { url: location.href, profileDetail: sig, crop };
  }
  const el = document.getElementById("RENDER_DATA") || document.getElementById("SSR_HYDRATED_DATA");
  if (el) { try { const sig = findSignature(JSON.parse(decodeURIComponent(el.textContent || ""))); if (sig) return { url: location.href, profileDetail: sig, crop }; } catch {} }
  for (const script of document.querySelectorAll("script")) {
    const text = script.textContent || "";
    if (!text.includes("signature")) continue;
    try { const sig = findSignature(JSON.parse(text)); if (sig) return { url: location.href, profileDetail: sig, crop }; } catch {}
    const m = text.match(/"signature"\s*:\s*"([^"]{4,300})"/);
    if (m) return { url: location.href, profileDetail: normalize(m[1]).replace(/\\n/g, " "), crop };
  }
  return { url: location.href, profileDetail: "", crop };
}

async function fillMissingScreenshots() {
  if (_fillShotRunning) { setStatus("补图正在进行中，请等待完成...", 100); return; }
  _fillShotRunning = true;

  const keySet = await loadShotKeySet();
  const missing = state.accounts.filter((a) => a.homeUrl && !accountHasShot(a, keySet));

  if (!missing.length) {
    startShotLog(0);
    appendShotLog({ type: "info", message: "没有缺失截图的账号，全部已绑定。" });
    finalizeShotLog("无需补图");
    setStatus("没有缺失截图的账号，全部已绑定。", 100);
    _fillShotRunning = false;
    return;
  }

  const total = missing.length;
  let done = 0, failed = 0;
  startShotLog(total);
  setStatus(`开始补缺失截图，共 ${total} 个账号...`, 5);

  try {
    for (let i = 0; i < total; i++) {
      const account = missing[i];
      const progress = Math.round((i / total) * 100);
      setStatus(`补图中 ${i + 1}/${total}：${account.nickname}`, Math.max(5, progress));
      let tab = null, line;

      try {
        // 1. 打开博主主页
        tab = await chrome.tabs.create({ url: account.homeUrl, active: true });
        await focusTabForCapture(tab.id, tab.windowId);

        // 2. 等待页面加载完全（超时 25s）
        await waitForTabComplete(tab.id, 25000);

        // 标签页存在性检查
        try { await chrome.tabs.get(tab.id); } catch { throw new Error("标签页被提前关闭"); }

        // 3. 等待视觉渲染
        await new Promise((r) => setTimeout(r, 1800));
        try { await chrome.tabs.get(tab.id); } catch { throw new Error("标签页在渲染期间被关闭"); }

        // 4. 提取签名 + 裁剪坐标
        const [profileResult] = await chrome.scripting.executeScript({
          target: { tabId: tab.id }, func: extractProfileAndCrop
        });
        const profile = profileResult?.result || {};

        // 5. 截图
        await focusTabForCapture(tab.id, tab.windowId);
        const response = await chrome.runtime.sendMessage({
          type: "DOUYIN_GALLERY_CAPTURE_ACTIVE_TAB",
          tab: { id: tab.id, windowId: tab.windowId, title: tab.title, url: tab.url },
          crop: profile.crop
        });
        if (!response?.ok) throw new Error(response?.error || "截图失败");

        // 6. 绑定到画廊
        const bindingAccount = findAccountByUrl(profile.url || response.shot.url || tab.url) || account;
        const bindUrls = [account.homeUrl, bindingAccount.homeUrl, profile.url, response.shot.url, tab.url];
        await saveScreenshotToDB(bindingAccount, response.shot.screenshotDataUrl, response.shot.capturedAt, bindUrls);
        if (bindingAccount.id !== account.id) {
          await saveScreenshotToDB(account, response.shot.screenshotDataUrl, response.shot.capturedAt, bindUrls);
        }
        let verifiedShot = await getScreenshotFromDB(account);
        if (!verifiedShot?.dataUrl && bindingAccount.id !== account.id) verifiedShot = await getScreenshotFromDB(bindingAccount);
        if (!verifiedShot?.dataUrl) throw new Error("截图已生成但未能回读验证，绑定失败");

        // 7. 同步签名
        if (profile.profileDetail) {
          bindingAccount.note = upsertProfileNote(bindingAccount.note, profile.profileDetail);
          bindingAccount.profileDetail = profile.profileDetail;
          bindingAccount.profileDetailSyncedAt = new Date().toISOString();
          if (bindingAccount.id !== account.id) {
            account.note = upsertProfileNote(account.note, profile.profileDetail);
            account.profileDetail = profile.profileDetail;
          }
        }

        // 8. 刷新计数
        state.screenshotCount = await countScreenshotsInDB();
        render();
        done++;
        line = { type: "success", message: `\u2713 ${i + 1}/${total} ${account.nickname}${profile.profileDetail ? " +signature" : ""}` };
      } catch (err) {
        failed++;
        line = { type: "failure", message: `\u2717 ${i + 1}/${total} ${account.nickname}\uff1a${err.message || err}` };
      } finally {
        if (tab) { try { await chrome.tabs.remove(tab.id); } catch {} }
        appendShotLog(line);
        if (i < total - 1) await new Promise((r) => setTimeout(r, 1500));
      }
    }

    await chrome.storage.local.set({ accounts: state.accounts });
    state.screenshotCount = await countScreenshotsInDB();
    render();
    const summary = `补图完成：成功 ${done}，失败 ${failed}，共 ${total}`;
    appendShotLog({ type: done > 0 ? "success" : "info", message: summary });
    finalizeShotLog(summary);
    setStatus(summary, 100);
  } finally {
    _fillShotRunning = false;
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
  const shotMap = new Map();
  for (const shot of screenshots) {
    if (shot.homeKey) shotMap.set(shot.homeKey, shot);
    if (shot.accountId) shotMap.set(shot.accountId, shot);
  }
  const sections = [...groups.entries()].map(([name, accounts]) => `
    <section class="folder" data-folder="${escapeHtml(name)}">
      <div class="folder-head">
        <h2>${escapeHtml(name)}</h2>
        <span>${accounts.length} 个账号</span>
      </div>
      <div class="grid">
        ${accounts.map((account) => `
    <article class="card" data-category="${escapeHtml(name)}">
      <img class="shot" src="${escapeHtml(shotMap.get(profileKey(account.homeUrl))?.dataUrl || shotMap.get(account.id)?.dataUrl || account.avatar || "")}" alt="${escapeHtml(account.nickname)}" />
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
els.fillShotsBtn.addEventListener("click", () => run(fillMissingScreenshots));
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
