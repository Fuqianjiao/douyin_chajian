/* ─── background.js — Service Worker 长驻内存 ─── */
/* 截图/补图等长任务必须在此运行，popup 失焦即被销毁 */

async function blobToDataUrl(blob) {
  const buffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return `data:${blob.type || "image/png"};base64,${btoa(binary)}`;
}

async function cropDataUrl(dataUrl, crop) {
  if (!crop || !crop.width || !crop.height || !crop.viewportWidth || !crop.viewportHeight) return dataUrl;
  const sourceBlob = await (await fetch(dataUrl)).blob();
  const bitmap = await createImageBitmap(sourceBlob);
  const scaleX = bitmap.width / crop.viewportWidth;
  const scaleY = bitmap.height / crop.viewportHeight;
  const sx = Math.max(0, Math.floor(crop.x * scaleX));
  const sy = Math.max(0, Math.floor(crop.y * scaleY));
  const sw = Math.min(bitmap.width - sx, Math.floor(crop.width * scaleX));
  const sh = Math.min(bitmap.height - sy, Math.floor(crop.height * scaleY));
  if (sw <= 0 || sh <= 0) return dataUrl;
  const canvas = new OffscreenCanvas(sw, sh);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(bitmap, sx, sy, sw, sh, 0, 0, sw, sh);
  const croppedBlob = await canvas.convertToBlob({ type: "image/png" });
  return blobToDataUrl(croppedBlob);
}

async function captureActiveTab(tab, crop) {
  const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" });
  const screenshotDataUrl = await cropDataUrl(dataUrl, crop);
  return {
    title: tab.title || "当前界面",
    url: tab.url || "",
    screenshotDataUrl,
    capturedAt: new Date().toISOString(),
    crop: crop || null
  };
}

/* ─── IndexedDB 操作（background 中也需要） ─── */

const SCREENSHOT_DB_NAME = "DouyinGalleryScreenshots";
const SCREENSHOT_STORE = "shots";
const SCREENSHOT_BY_URL_STORE = "shotsByUrl";
const SCREENSHOT_DB_VERSION = 3;

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

function requestToPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transactionDone(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
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

function accountHasShot(account, keySet) {
  if (!keySet || !keySet.size) return false;
  const key = profileKey(account?.homeUrl);
  if (key && keySet.has(key)) return true;
  if (account?.id && keySet.has(account.id)) return true;
  return false;
}

async function saveScreenshotToDB(account, dataUrl, capturedAt, extraUrls = []) {
  const homeKey = profileKey(account?.homeUrl);
  if (!homeKey) throw new Error("缺少账号主页链接，无法绑定截图");
  const homeKeys = [homeKey, ...new Set(extraUrls.map(profileKey).filter(Boolean))];
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
        capturedAt,
        aliasOnly: true
      });
    }
  }
  return transactionDone(tx);
}

async function resolveScreenshotRecord(db, shot) {
  if (!shot) return null;
  if (shot.dataUrl) return shot;
  if (shot.accountId && db.objectStoreNames.contains(SCREENSHOT_STORE)) {
    const tx = db.transaction(SCREENSHOT_STORE, "readonly");
    const byAccount = await requestToPromise(tx.objectStore(SCREENSHOT_STORE).get(shot.accountId));
    if (byAccount?.dataUrl) return byAccount;
  }
  return null;
}

async function getScreenshotFromDB(account) {
  const db = await openScreenshotDB();
  const homeKey = profileKey(account?.homeUrl);
  if (homeKey && db.objectStoreNames.contains(SCREENSHOT_BY_URL_STORE)) {
    const tx = db.transaction(SCREENSHOT_BY_URL_STORE, "readonly");
    const shot = await requestToPromise(tx.objectStore(SCREENSHOT_BY_URL_STORE).get(homeKey));
    const resolved = await resolveScreenshotRecord(db, shot);
    if (resolved) return resolved;
  }
  if (!account?.id) return null;
  const tx = db.transaction(SCREENSHOT_STORE, "readonly");
  return await requestToPromise(tx.objectStore(SCREENSHOT_STORE).get(account.id));
}

async function countScreenshotsInDB() {
  const db = await openScreenshotDB();
  const keys = new Set();
  if (db.objectStoreNames.contains(SCREENSHOT_BY_URL_STORE)) {
    const tx = db.transaction(SCREENSHOT_BY_URL_STORE, "readonly");
    const request = tx.objectStore(SCREENSHOT_BY_URL_STORE).openCursor();
    await new Promise((resolve, reject) => {
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) {
          resolve();
          return;
        }
        const shot = cursor.value;
        const key = shot.accountId || shot.canonicalHomeKey || shot.homeKey;
        if (key) keys.add(key);
        cursor.continue();
      };
    });
  }
  const tx = db.transaction(SCREENSHOT_STORE, "readonly");
  const storeKeys = await requestToPromise(tx.objectStore(SCREENSHOT_STORE).getAllKeys());
  for (const key of storeKeys || []) keys.add(key);
  return keys.size;
}

/* ─── 补图辅助函数 ─── */

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
      try { obj = JSON.parse(obj); } catch { return ""; }
    }
    if (typeof obj !== "object") return "";
    if (Array.isArray(obj)) {
      for (const item of obj) { const f = findSignature(item); if (f) return f; }
      return "";
    }
    if (obj.signature && typeof obj.signature === "string") {
      return normalize(obj.signature).replace(/\\n/g, " ");
    }
    for (const key of Object.keys(obj)) {
      const f = findSignature(obj[key]);
      if (f) return f;
    }
    return "";
  }

  for (const data of [window.__INITIAL_STATE__, window._SSR_HYDRATED_DATA, window.__RENDER_DATA__]) {
    if (!data) continue;
    const sig = findSignature(data);
    if (sig) return { url: location.href, profileDetail: sig, crop };
  }
  const el = document.getElementById("RENDER_DATA") || document.getElementById("SSR_HYDRATED_DATA");
  if (el) {
    try {
      const sig = findSignature(JSON.parse(decodeURIComponent(el.textContent || "")));
      if (sig) return { url: location.href, profileDetail: sig, crop };
    } catch {}
  }
  for (const script of document.querySelectorAll("script")) {
    const text = script.textContent || "";
    if (!text.includes("signature")) continue;
    try {
      const sig = findSignature(JSON.parse(text));
      if (sig) return { url: location.href, profileDetail: sig, crop };
    } catch {}
    const m = text.match(/"signature"\s*:\s*"([^"]{4,300})"/);
    if (m) return { url: location.href, profileDetail: normalize(m[1]).replace(/\\n/g, " "), crop };
  }
  return { url: location.href, profileDetail: "", crop };
}

function upsertProfileNote(existingNote, profileDetail) {
  const detail = String(profileDetail || "").trim();
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

/* 查找账号（按 homeUrl 匹配）— 在 background 中需要自己实现，不能依赖 popup 的 state */
async function findAccountByUrl(accounts, url) {
  const key = profileKey(url);
  if (!key) return null;
  return accounts.find((account) => profileKey(account.homeUrl) === key) || null;
}

/* 发送进度通知给 popup */
async function reportProgress(data) {
  await chrome.storage.local.set({ fillShotsProgress: data });
}

/* ─── 补图主流程（在 Service Worker 中运行） ─── */
let fillShotRunning = false;

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  /* 原有：截图消息 */
  if (message?.type === "DOUYIN_GALLERY_CAPTURE_ACTIVE_TAB") {
    captureActiveTab(message.tab, message.crop)
      .then((shot) => sendResponse({ ok: true, shot }))
      .catch((error) => sendResponse({ ok: false, error: error.message || String(error) }));
    return true;
  }

  /* 新增：触发补缺失截图 */
  if (message?.type === "DOUYIN_GALLERY_FILL_MISSING_SHOTS") {
    runFillMissingShots()
      .then((result) => sendResponse({ ok: true, result }))
      .catch((error) => sendResponse({ ok: false, error: error.message || String(error) }));
    return true;
  }

  /* 新增：查询补图运行状态 */
  if (message?.type === "DOUYIN_GALLERY_FILL_SHOTS_STATUS") {
    sendResponse({ running: fillShotRunning });
    return false;
  }

  return false;
});

async function runFillMissingShots() {
  if (fillShotRunning) {
    throw new Error("补图正在进行中，请等待完成");
  }
  fillShotRunning = true;

  try {
    // 1. 从 storage 读取账号数据
    const stored = await chrome.storage.local.get(["accounts"]);
    const accounts = stored.accounts || [];

    // 2. 加载截图 key 集，找出缺失的
    const keySet = await loadShotKeySet();
    const missing = accounts.filter((a) => a.homeUrl && !accountHasShot(a, keySet));

    if (!missing.length) {
      await reportProgress({ type: "done", total: 0, done: 0, failed: 0, log: "没有缺失截图的账号，全部已绑定。" });
      return { total: 0, done: 0, failed: 0 };
    }

    const total = missing.length;
    let done = 0;
    let failed = 0;

    await reportProgress({ type: "start", total });

    for (let i = 0; i < total; i++) {
      const account = missing[i];
      let line;
      let tab = null;

      try {
        // 报告进度
        await reportProgress({ type: "progress", current: i + 1, total, nickname: account.nickname, done, failed });

        // A. 打开博主主页
        tab = await chrome.tabs.create({ url: account.homeUrl, active: true });
        await focusTabForCapture(tab.id, tab.windowId);

        // B. 等待页面加载完全（25s 超时）
        await waitForTabComplete(tab.id, 25000);

        // 防御性检查：标签页是否还在
        try { await chrome.tabs.get(tab.id); } catch {
          throw new Error("标签页被提前关闭");
        }

        // C. 额外等待视觉渲染
        await new Promise((r) => setTimeout(r, 1800));

        // 再次确认存在
        try { await chrome.tabs.get(tab.id); } catch {
          throw new Error("标签页在渲染等待期间被关闭");
        }

        // D. 提取签名 + 裁剪坐标
        const [profileResult] = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: extractProfileAndCrop
        });
        const profile = profileResult?.result || {};

        // E. 确保标签激活后截图
        await focusTabForCapture(tab.id, tab.windowId);

        const response = await captureActiveTab(
          { id: tab.id, windowId: tab.windowId, title: tab.title, url: tab.url },
          profile.crop
        );

        // F. 绑定到画廊
        const bindingAccount = await findAccountByUrl(accounts, profile.url || response.url || tab.url) || account;
        const bindUrls = [account.homeUrl, bindingAccount.homeUrl, profile.url, response.url, tab.url];
        await saveScreenshotToDB(bindingAccount, response.screenshotDataUrl, response.capturedAt, bindUrls);

        if (bindingAccount.id !== account.id) {
          await saveScreenshotToDB(account, response.screenshotDataUrl, response.capturedAt, bindUrls);
        }

        // 回读验证
        let verifiedShot = await getScreenshotFromDB(account);
        if (!verifiedShot?.dataUrl && bindingAccount.id !== account.id) {
          verifiedShot = await getScreenshotFromDB(bindingAccount);
        }
        if (!verifiedShot?.dataUrl) {
          throw new Error("截图已生成但未能回读验证，绑定失败");
        }

        // G. 同步签名到备注（写回 storage）
        if (profile.profileDetail) {
          bindingAccount.note = upsertProfileNote(bindingAccount.note, profile.profileDetail);
          // 更新 accounts 数组中的对应项
          const idx = accounts.findIndex((a) => a.id === bindingAccount.id);
          if (idx >= 0) accounts[idx] = bindingAccount;
          if (bindingAccount.id !== account.id) {
            account.note = upsertProfileNote(account.note, profile.profileDetail);
            const aIdx = accounts.findIndex((a) => a.id === account.id);
            if (aIdx >= 0) accounts[aIdx] = account;
          }
        }

        // H. 标记成功并立即持久化
        account._hasScreenshot = true;
        done++;
        line = { type: "success", message: `✓ ${i + 1}/${total} ${account.nickname}${profile.profileDetail ? " +signature" : ""}` };

      } catch (err) {
        failed++;
        line = { type: "failure", message: `✗ ${i + 1}/${total} ${account.nickname}：${err.message || err}` };
      } finally {
        // I. 关闭标签页
        if (tab) {
          try { await chrome.tabs.remove(tab.id); } catch { /* 已关闭 */ }
        }

        // J. 发送日志行
        await reportProgress({ type: "log", ...line });

        // 最后一个不用等间隔
        if (i < total - 1) {
          await new Promise((r) => setTimeout(r, 1500));
        }
      }
    }

    // 最终汇总
    const summary = `补图完成：成功 ${done}，失败 ${failed}，共 ${total}`;

    // 更新 storage 中的截图计数和账号
    await chrome.storage.local.set({ accounts });
    const screenshotCount = await countScreenshotsInDB();
    await chrome.storage.local.set({ screenshotCount });

    await reportProgress({
      type: "done",
      total, done, failed,
      log: summary,
      screenshotCount
    });

    return { total, done, failed };

  } finally {
    fillShotRunning = false;
  }
}
