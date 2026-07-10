const MAX_TAGS = 6;

/* ─── IndexedDB: 截图存储 ─── */
const SCREENSHOT_DB_NAME = "DouyinGalleryScreenshots";
const SCREENSHOT_STORE = "shots";
const SCREENSHOT_BY_URL_STORE = "shotsByUrl";
const SCREENSHOT_DB_VERSION = 2;

function openShotDB() {
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

function shotKeyForAccount(account) {
  return profileKey(account?.homeUrl) || account?.id || "";
}

function shotLookupKeys(account, extraUrls = []) {
  return [...new Set([
    profileKey(account?.homeUrl),
    account?.id,
    ...extraUrls.map(profileKey)
  ].filter(Boolean))];
}

function findAccountByUrl(url) {
  const key = profileKey(url);
  if (!key) return null;
  return state.accounts.find((account) => profileKey(account.homeUrl) === key) || null;
}

function requestToPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function getShotFromDB(account) {
  const db = await openShotDB();
  const keys = shotLookupKeys(account);
  const homeKey = profileKey(account?.homeUrl);
  if (homeKey && db.objectStoreNames.contains(SCREENSHOT_BY_URL_STORE)) {
    const tx = db.transaction(SCREENSHOT_BY_URL_STORE, "readonly");
    const shot = await requestToPromise(tx.objectStore(SCREENSHOT_BY_URL_STORE).get(homeKey));
    if (shot) return shot;
  }
  if (db.objectStoreNames.contains(SCREENSHOT_BY_URL_STORE)) {
    const tx = db.transaction(SCREENSHOT_BY_URL_STORE, "readonly");
    const shots = await requestToPromise(tx.objectStore(SCREENSHOT_BY_URL_STORE).getAll());
    const shot = (shots || []).find((item) => {
      const itemKeys = [
        item.homeKey,
        item.canonicalHomeKey,
        item.accountId,
        profileKey(item.homeUrl)
      ].filter(Boolean);
      return itemKeys.some((key) => keys.includes(key));
    });
    if (shot) return shot;
  }
  if (!account?.id) return null;
  const tx = db.transaction(SCREENSHOT_STORE, "readonly");
  const shot = await requestToPromise(tx.objectStore(SCREENSHOT_STORE).get(account.id));
  return shot || null;
}

async function countShotsInDB() {
  const db = await openShotDB();
  if (db.objectStoreNames.contains(SCREENSHOT_BY_URL_STORE)) {
    const tx = db.transaction(SCREENSHOT_BY_URL_STORE, "readonly");
    const shots = await requestToPromise(tx.objectStore(SCREENSHOT_BY_URL_STORE).getAll());
    const keys = new Set((shots || []).map((shot) => shot.canonicalHomeKey || shot.homeKey || shot.accountId).filter(Boolean));
    return keys.size;
  }
  const tx = db.transaction(SCREENSHOT_STORE, "readonly");
  const keys = await requestToPromise(tx.objectStore(SCREENSHOT_STORE).getAllKeys());
  return (keys || []).length;
}

async function loadShotAccountIdSet() {
  const db = await openShotDB();
  const set = new Set();
  if (db.objectStoreNames.contains(SCREENSHOT_BY_URL_STORE)) {
    const tx = db.transaction(SCREENSHOT_BY_URL_STORE, "readonly");
    const shots = await requestToPromise(tx.objectStore(SCREENSHOT_BY_URL_STORE).getAll());
    for (const shot of shots || []) {
      [shot.homeKey, shot.canonicalHomeKey, shot.accountId, profileKey(shot.homeUrl)].filter(Boolean).forEach((key) => set.add(key));
    }
  }
  const tx = db.transaction(SCREENSHOT_STORE, "readonly");
  const keys = await requestToPromise(tx.objectStore(SCREENSHOT_STORE).getAllKeys());
  for (const key of keys || []) set.add(key);
  state.shotAccountIdSet = set;
  return set.size;
}

function uniqueShotKeys(account, extraUrls = []) {
  return shotLookupKeys(account, extraUrls).filter((key) => key !== account?.id);
}

async function saveShotToDB(account, dataUrl, capturedAt, extraUrls = []) {
  const homeKey = shotKeyForAccount(account);
  if (!homeKey) throw new Error("缺少账号主页链接，无法绑定截图");
  const homeKeys = uniqueShotKeys(account, extraUrls);
  const db = await openShotDB();
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
    tx.onabort = () => reject(tx.error);
  });
}

function waitForTabComplete(tabId, timeoutMs = 10000) {
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

/* 安全检查标签页是否仍有效（避免 "No tab with id" 错误导致整个循环崩溃） */
async function tabStillValid(tabId) {
  if (!tabId) return false;
  try {
    const t = await chrome.tabs.get(tabId);
    return !t.discarded;
  } catch {
    return false;
  }
}

function normalizeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function upsertProfileNote(existingNote, profileDetail) {
  const detail = normalizeText(profileDetail);
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

const els = {
  meta: document.querySelector("#meta"),
  nameSearch: document.querySelector("#nameSearch"),
  toggleAdvanced: document.querySelector("#toggleAdvanced"),
  advancedFilters: document.querySelector("#advancedFilters"),
  tagFilter: document.querySelector("#tagFilter"),
  screenshotFilter: document.querySelector("#screenshotFilter"),
  noteFilter: document.querySelector("#noteFilter"),
  noteSearch: document.querySelector("#noteSearch"),
  applyFilters: document.querySelector("#applyFilters"),
  resetFilters: document.querySelector("#resetFilters"),
  folders: document.querySelector("#folders"),
  content: document.querySelector("#content"),
  batchBar: document.querySelector("#batchBar"),
  batchCount: document.querySelector("#batchCount"),
  batchMode: document.querySelector("#batchMode"),
  selectVisible: document.querySelector("#selectVisible"),
  clearSelection: document.querySelector("#clearSelection"),
  batchTagSelect: document.querySelector("#batchTagSelect"),
  batchAddTags: document.querySelector("#batchAddTags"),
  batchRemoveTags: document.querySelector("#batchRemoveTags"),
  batchDelete: document.querySelector("#batchDelete"),
  batchHint: document.querySelector("#batchHint"),
  autoShot: document.querySelector("#autoShot"),
  stopShot: document.querySelector("#stopShot"),
  logs: document.querySelector("#logs"),
  export: document.querySelector("#export"),
  captureStatus: document.querySelector("#captureStatus"),
  toast: document.querySelector("#toast"),
  editorModal: document.querySelector("#editorModal"),
  editorTitle: document.querySelector("#editorTitle"),
  editorClose: document.querySelector("#editorClose"),
  tagInput: document.querySelector("#tagInput"),
  addTag: document.querySelector("#addTag"),
  editorTags: document.querySelector("#editorTags"),
  noteText: document.querySelector("#noteText"),
  noteImages: document.querySelector("#noteImages"),
  notePreview: document.querySelector("#notePreview"),
  saveEditor: document.querySelector("#saveEditor"),
  logsModal: document.querySelector("#logsModal"),
  logsContent: document.querySelector("#logsContent"),
  logsClose: document.querySelector("#logsClose"),
  confirmModal: document.querySelector("#confirmModal"),
  confirmTitle: document.querySelector("#confirmTitle"),
  confirmMessage: document.querySelector("#confirmMessage"),
  confirmCancel: document.querySelector("#confirmCancel"),
  confirmOk: document.querySelector("#confirmOk")
};

const state = {
  accounts: [],
  shotCache: new Map(),
  shotAccountIdSet: new Set(),
  shotObserver: null,
  autoShotRunning: false,
  folder: "全部",
  searchKeyword: "",
  tagFilter: "",
  screenshotFilter: "",
  noteFilter: "",
  noteKeyword: "",
  batchMode: false,
  batchSelected: new Set(),
  batchTagSelected: new Set(),
  editingAccountId: null,
  editingNoteImages: [],
  logs: []
};

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
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
    bio,
    intro: bio || account.douyinId || "暂无页面可见简介"
  };
}

function readFileAsDataUrl(file) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => resolve("");
    reader.readAsDataURL(file);
  });
}

function ensureTags(account) {
  const tags = Array.isArray(account.tags) ? account.tags.slice() : [];
  /* 仅在完全无 AI 标签时才插入；优先复用已有首个标签名作为 AI 名，避免用陈旧 category 覆盖用户已编辑的标签 */
  if (!tags.some((t) => t.source === "ai")) {
    const aiName = tags[0]?.name || account.category || "未分类";
    tags.unshift({ name: aiName, source: "ai" });
  }
  return tags.slice(0, MAX_TAGS);
}

function allTagNames() {
  const set = new Set();
  for (const account of state.accounts) {
    for (const tag of ensureTags(account)) set.add(tag.name);
  }
  return [...set].sort((a, b) => a.localeCompare(b, "zh-CN"));
}

function shotFor(accountId) {
  return state.shotCache.get(accountId) || "";
}

function hasShotForAccount(account) {
  const key = shotKeyForAccount(account);
  return Boolean(key && state.shotAccountIdSet.has(key)) || Boolean(account?.id && state.shotAccountIdSet.has(account.id));
}

/* ─── 懒加载截图：IntersectionObserver ─── */
function lazyLoadShots() {
  // 先断开旧 observer
  if (state.shotObserver) {
    state.shotObserver.disconnect();
  }
  state.shotObserver = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      const placeholder = entry.target;
      const accountId = placeholder.dataset.shotId;
      const account = state.accounts.find((item) => item.id === accountId);
      if (!account) continue;
      // 停止观察这个元素
      state.shotObserver.unobserve(placeholder);
      // 从 IndexedDB 加载截图
      getShotFromDB(account).then((shot) => {
        if (shot?.dataUrl) {
          state.shotCache.set(account.id, shot.dataUrl);
          const parent = placeholder.closest(".shot");
          if (parent) {
            const img = document.createElement("img");
            img.src = shot.dataUrl;
            img.alt = parent.closest(".card")?.querySelector(".nickname")?.textContent || "";
            img.style.opacity = "0";
            img.style.transition = "opacity 0.3s";
            img.onload = () => { img.style.opacity = "1"; };
            parent.innerHTML = "";
            parent.appendChild(img);
          }
        } else {
          placeholder.textContent = "暂无截图";
          placeholder.classList.add("shot-empty");
        }
      }).catch(() => {
        placeholder.textContent = "暂无截图";
        placeholder.classList.add("shot-empty");
      });
    }
  }, { rootMargin: "200px 0px", threshold: 0.01 });
  // 观察所有需要懒加载的 placeholder
  els.content.querySelectorAll(".shot-placeholder[data-shot-id]").forEach((el) => {
    state.shotObserver.observe(el);
  });
}

function hasNote(account) {
  if (account.note && account.note.trim()) return true;
  if (Array.isArray(account.noteImages) && account.noteImages.length > 0) return true;
  return false;
}

function matchFilters(account) {
  account = cleanAccountIdentity(account);
  if (state.searchKeyword) {
    const kw = state.searchKeyword.toLowerCase();
    const hay = [account.nickname, account.bio, account.intro, account.douyinId, account.note || ""].join(" ").toLowerCase();
    if (!hay.includes(kw)) return false;
  }
  if (state.tagFilter) {
    const names = ensureTags(account).map((t) => t.name);
    if (!names.includes(state.tagFilter)) return false;
  }
  if (state.screenshotFilter === "with" && !hasShotForAccount(account)) return false;
  if (state.screenshotFilter === "missing" && hasShotForAccount(account)) return false;
  if (state.noteFilter === "with" && !hasNote(account)) return false;
  if (state.noteFilter === "missing" && hasNote(account)) return false;
  if (state.noteKeyword) {
    const note = (account.note || "").toLowerCase();
    if (!note.includes(state.noteKeyword.toLowerCase())) return false;
  }
  return true;
}

function groupedFolders(accounts) {
  const groups = new Map();
  for (const account of accounts) {
    const tags = ensureTags(account);
    const key = tags[0]?.name || "未分类";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ ...account, tags });
  }
  return groups;
}

function renderFolders() {
  const groups = groupedFolders(state.accounts);
  const items = [["全部", state.accounts.length], ...[...groups.entries()].map(([name, list]) => [name, list.length])];
  els.folders.innerHTML = items.map(([name, count]) => `
    <a class="folder-link ${name === state.folder ? "active" : ""}" href="#" data-folder="${escapeHtml(name)}">
      ${escapeHtml(name)} <strong>${count}</strong>
    </a>
  `).join("");
  els.folders.querySelectorAll(".folder-link").forEach((link) => {
    link.addEventListener("click", (event) => {
      event.preventDefault();
      state.folder = link.dataset.folder;
      renderFolders();
      renderContent();
    });
  });
}

function renderTagFilterOptions() {
  const names = allTagNames();
  els.tagFilter.innerHTML = `<option value="">请选择</option>` +
    names.map((n) => `<option value="${escapeHtml(n)}" ${state.tagFilter === n ? "selected" : ""}>${escapeHtml(n)}</option>`).join("");
}

function renderContent() {
  const groups = groupedFolders(state.accounts);

  /* 「全部」模式：不按分类分组，全部平铺 */
  if (state.folder === "全部") {
    const all = state.accounts.filter(matchFilters);
    if (!all.length) {
      els.content.innerHTML = `<div class="empty">没有匹配的账号。试试「重置」清空筛选条件。</div>`;
      return;
    }
    els.content.innerHTML = `<div class="gallery">${all.map(renderCard).join("")}</div>`;
    bindCardEvents();
    updateBatchCount();
    lazyLoadShots();
    return;
  }

  const ordered = groups.has(state.folder)
    ? [[state.folder, groups.get(state.folder)]]
    : [];

  const visibleGroups = ordered
    .map(([name, list]) => [name, list.filter(matchFilters)])
    .filter(([, list]) => list.length > 0);

  if (!visibleGroups.length) {
    els.content.innerHTML = `<div class="empty">没有匹配的账号。试试「重置」清空筛选条件。</div>`;
    return;
  }

  els.content.innerHTML = visibleGroups.map(([name, items]) => `
    <section class="folder">
      <div class="folder-head">
        <h2>${escapeHtml(name)}</h2>
        <span class="hint">${items.length} 个账号</span>
      </div>
      <div class="gallery">
        ${items.map(renderCard).join("")}
      </div>
    </section>
  `).join("");

  bindCardEvents();
  updateBatchCount();
  lazyLoadShots();
}

function renderCard(account) {
  account = cleanAccountIdentity(account);
  const hasShot = hasShotForAccount(account);
  const cachedShot = shotFor(account.id);
  const tags = ensureTags(account);
  const isSelected = state.batchSelected.has(account.id);
  const shotHtml = cachedShot
    ? `<img src="${escapeHtml(cachedShot)}" alt="${escapeHtml(account.nickname)}">`
    : hasShot
      ? `<div class="shot-placeholder" data-shot-id="${escapeHtml(account.id)}">截图加载中...</div>`
      : `<span class="shot-empty">暂无截图</span>`;
  return `
    <article class="card ${isSelected ? "batch-selected" : ""}" data-id="${escapeHtml(account.id)}">
      ${state.batchMode ? `
        <label class="select-card">
          <input type="checkbox" data-select="${escapeHtml(account.id)}" ${isSelected ? "checked" : ""}>
          选择
        </label>
      ` : ""}
      <button class="delete-card" data-delete="${escapeHtml(account.id)}" title="删除此账号">×</button>
      <a class="shot" href="${escapeHtml(account.homeUrl || "#")}" target="_blank" rel="noreferrer">
        ${shotHtml}
      </a>
      <div class="body">
        <div class="profile">
          <img class="avatar" src="${escapeHtml(account.avatar || "")}" alt="">
          <div>
            <h3 class="nickname" tabindex="0" data-copy="${escapeHtml(account.nickname || "未命名账号")}" data-account-id="${escapeHtml(account.id)}">${escapeHtml(account.nickname || "未命名账号")}</h3>
            <p class="intro">${escapeHtml(account.bio || account.intro || "暂无页面可见简介")}</p>
          </div>
        </div>
        <div class="card-tags">
          ${tags.map((tag) => `
            <span class="tag-pill ${tag.source === "ai" ? "ai" : "user"}" title="${tag.source === "ai" ? "AI 标签" : "人工标签"}">
              <span>${escapeHtml(tag.name)}</span>
            </span>
          `).join("")}
        </div>
        <div class="card-actions">
          <a class="open-link" href="${escapeHtml(account.homeUrl || "#")}" target="_blank" rel="noreferrer">打开主页</a>
          <button class="note-button" data-edit="${escapeHtml(account.id)}">添加备注/分类</button>
        </div>
      </div>
    </article>
  `;
}

function bindCardEvents() {
  els.content.querySelectorAll("[data-delete]").forEach((btn) => {
    btn.addEventListener("click", (event) => {
      event.stopPropagation();
      confirmDelete(btn.dataset.delete);
    });
  });
  els.content.querySelectorAll("[data-edit]").forEach((btn) => {
    btn.addEventListener("click", () => openEditor(btn.dataset.edit));
  });
  els.content.querySelectorAll("[data-select]").forEach((cb) => {
    cb.addEventListener("change", () => {
      const id = cb.dataset.select;
      if (cb.checked) state.batchSelected.add(id);
      else state.batchSelected.delete(id);
      updateBatchCount();
    });
  });
  els.content.querySelectorAll(".nickname").forEach((node) => {
    node.addEventListener("mouseenter", () => showNicknameTooltip(node));
    node.addEventListener("focus", () => showNicknameTooltip(node));
    node.addEventListener("mouseleave", () => hideNicknameTooltip());
    node.addEventListener("blur", () => hideNicknameTooltip());
    node.addEventListener("keydown", (event) => {
      if ((event.key === "c" || event.key === "C") && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        copyNickname(node);
      }
    });
  });
}

function showNicknameTooltip(node) {
  const full = node.dataset.copy || node.textContent;
  const isTruncated = node.scrollWidth > node.clientWidth + 1;
  if (!isTruncated) return;
  const tip = ensureTooltip();
  tip.textContent = `${full}  ⌘/Ctrl+C 复制`;
  const rect = node.getBoundingClientRect();
  tip.style.top = `${rect.bottom + window.scrollY + 6}px`;
  tip.style.left = `${rect.left + window.scrollX}px`;
  tip.hidden = false;
  node._tipActive = true;
}

function hideNicknameTooltip() {
  const tip = document.getElementById("nicknameTip");
  if (tip) tip.hidden = true;
}

function ensureTooltip() {
  let tip = document.getElementById("nicknameTip");
  if (!tip) {
    tip = document.createElement("div");
    tip.id = "nicknameTip";
    tip.className = "nickname-tip";
    tip.hidden = true;
    document.body.appendChild(tip);
  }
  return tip;
}

async function copyNickname(node) {
  const text = node.dataset.copy || node.textContent || "";
  try {
    await navigator.clipboard.writeText(text);
    showToast("已复制", `「${text}」已复制到剪贴板`);
  } catch (err) {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand("copy");
      showToast("已复制", `「${text}」已复制到剪贴板`);
    } catch (e2) {
      showToast("复制失败", "请手动选择复制");
    } finally {
      document.body.removeChild(ta);
    }
  }
}

function updateBatchCount() {
  els.batchCount.textContent = `已选 ${state.batchSelected.size} 个`;
}

function showToast(title, message) {
  els.toast.innerHTML = `<strong>${escapeHtml(title)}</strong>${message ? `<span>${escapeHtml(message)}</span>` : ""}`;
  els.toast.hidden = false;
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => { els.toast.hidden = true; }, 2600);
}

function addLog(message, type = "info") {
  state.logs.unshift({ time: new Date().toLocaleTimeString("zh-CN"), message, type });
  renderLogs();
}

function renderLogs() {
  if (!state.logs.length) {
    els.logsContent.innerHTML = `<div class="log-item summary"><span>暂无日志。</span></div>`;
    return;
  }
  els.logsContent.innerHTML = state.logs.slice(0, 100).map((log) => `
    <div class="log-item ${log.type}">
      <strong>${escapeHtml(log.time)}</strong>
      <span>${escapeHtml(log.message)}</span>
    </div>
  `).join("");
}

function openEditor(accountId) {
  const account = state.accounts.find((a) => a.id === accountId);
  if (!account) return;
  state.editingAccountId = accountId;
  els.editorTitle.textContent = `编辑「${account.nickname}」`;
  els.noteText.value = account.note || "";
  state.editingNoteImages = Array.isArray(account.noteImages) ? account.noteImages.slice() : [];
  renderNotePreview();
  renderEditorTags();
  els.editorModal.hidden = false;
}

function renderNotePreview() {
  els.notePreview.innerHTML = state.editingNoteImages.map((url, index) => `
    <div class="note-thumb">
      <img src="${escapeHtml(url)}" alt="备注图 ${index + 1}">
      <button class="remove" data-remove-image="${index}" type="button" title="移除">×</button>
    </div>
  `).join("");
  els.notePreview.querySelectorAll("[data-remove-image]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const idx = Number(btn.dataset.removeImage);
      state.editingNoteImages.splice(idx, 1);
      renderNotePreview();
    });
  });
}

function renderEditorTags() {
  const account = state.accounts.find((a) => a.id === state.editingAccountId);
  if (!account) return;
  const tags = ensureTags(account);
  els.editorTags.innerHTML = tags.map((tag, index) => `
    <span class="editor-tag ${tag.source === "ai" ? "ai" : "user"}">
      ${escapeHtml(tag.name)} <small>${tag.source === "ai" ? "AI" : "人工"}</small>
      <button data-remove-tag="${index}" type="button" title="移除">×</button>
    </span>
  `).join("") || `<div class="editor-tags-empty">暂无已选标签</div>`;
  els.editorTags.querySelectorAll("[data-remove-tag]").forEach((btn) => {
    btn.addEventListener("click", () => removeTagInEditor(Number(btn.dataset.removeTag)));
  });
}

/* 直接删除标签（点击 × 立即从数组移除，保存时持久化） */
function removeTagInEditor(index) {
  const account = state.accounts.find((a) => a.id === state.editingAccountId);
  if (!account) return;
  const tags = ensureTags(account);
  const target = tags[index];
  if (!target) return;

  /* 至少保留 1 个标签（不区分 AI/人工） */
  if (tags.length <= 1) {
    showToast("不能删除", "每个博主至少需要保留 1 个标签");
    return;
  }

  tags.splice(index, 1);
  account.tags = tags;
  account.category = tags[0]?.name || "未分类";
  renderEditorTags();
}

function addTagInEditor() {
  const account = state.accounts.find((a) => a.id === state.editingAccountId);
  if (!account) return;
  const name = els.tagInput.value.trim();
  if (!name) return;
  const tags = ensureTags(account);
  if (tags.length >= MAX_TAGS) {
    showToast("标签已满", `最多 ${MAX_TAGS} 个`);
    return;
  }
  if (tags.some((t) => t.name === name)) {
    showToast("已存在", `标签「${name}」已存在`);
    return;
  }
  tags.push({ name, source: "human" });
  account.tags = tags;
  account.category = tags[0]?.name || account.category || "未分类";
  els.tagInput.value = "";
  renderEditorTags();
}

function saveEditor() {
  const account = state.accounts.find((a) => a.id === state.editingAccountId);
  if (!account) return;

  /* 校验：至少保留 1 个标签 */
  const tags = ensureTags(account);
  if (tags.length < 1) {
    showToast("保存失败", "每个博主至少需要保留 1 个标签");
    return;
  }

  /* 关键修复：将编辑器中最终确定的标签和 category 同步写回账号对象 */
  account.tags = tags;
  account.category = tags[0]?.name || account.category || "未分类";

  account.note = els.noteText.value.trim();
  account.noteImages = state.editingNoteImages.slice();
  persist();

  renderContent();
  els.editorModal.hidden = true;
  showToast("已保存", `「${account.nickname}」的标签和备注已更新`);
  addLog(`编辑账号：${account.nickname}（标签 ${tags.length}/${MAX_TAGS}）`, "success");
}

function confirmDelete(accountId) {
  const account = state.accounts.find((a) => a.id === accountId);
  if (!account) return;
  els.confirmTitle.textContent = "删除账号";
  els.confirmMessage.textContent = `确认从本地存储删除「${account.nickname}」？此操作不可撤销。`;
  els.confirmModal.hidden = false;
  els.confirmOk.onclick = () => {
    state.accounts = state.accounts.filter((a) => a.id !== accountId);
    state.batchSelected.delete(accountId);
    persist();
    renderFolders();
    renderContent();
    els.confirmModal.hidden = true;
    showToast("已删除", `「${account.nickname}」已从本地移除`);
    addLog(`删除账号：${account.nickname}`, "failure");
  };
}

function renderBatchTags() {
  const names = allTagNames();
  els.batchTagSelect.innerHTML = names.map((name) => `
    <label>
      <input type="checkbox" data-batch-tag="${escapeHtml(name)}" ${state.batchTagSelected.has(name) ? "checked" : ""}>
      ${escapeHtml(name)}
    </label>
  `).join("");
  els.batchTagSelect.querySelectorAll("[data-batch-tag]").forEach((cb) => {
    cb.addEventListener("change", () => {
      if (cb.checked) state.batchTagSelected.add(cb.dataset.batchTag);
      else state.batchTagSelected.delete(cb.dataset.batchTag);
    });
  });
}

function batchAddTags() {
  if (!state.batchSelected.size || !state.batchTagSelected.size) {
    showToast("未选择", "请先勾选账号和标签");
    return;
  }
  let updated = 0, skipped = 0;
  for (const id of state.batchSelected) {
    const account = state.accounts.find((a) => a.id === id);
    if (!account) continue;
    const tags = ensureTags(account);
    for (const name of state.batchTagSelected) {
      if (tags.length >= MAX_TAGS) { skipped += 1; continue; }
      if (tags.some((t) => t.name === name)) continue;
      tags.push({ name, source: "human" });
      updated += 1;
    }
    account.tags = tags;
    account.category = tags[0]?.name || "未分类";
  }
  persist();
  renderContent();
  showToast("批量添加完成", `更新 ${state.batchSelected.size} 个账号，新增 ${updated} 个标签${skipped ? `，跳过 ${skipped} 个（已满）` : ""}`);
  addLog(`批量添加标签：${[...state.batchTagSelected].join("、")} → ${state.batchSelected.size} 个账号`, "success");
}

function batchRemoveTags() {
  if (!state.batchSelected.size || !state.batchTagSelected.size) {
    showToast("未选择", "请先勾选账号和标签");
    return;
  }
  let removed = 0;
  for (const id of state.batchSelected) {
    const account = state.accounts.find((a) => a.id === id);
    if (!account) continue;
    let tags = ensureTags(account);
    const before = tags.length;
    const after = tags.filter((t) => !state.batchTagSelected.has(t.name));
    if (after.length < 1) continue; /* 至少保留 1 个标签 */
    tags = after;
    removed += before - tags.length;
    account.tags = tags;
    account.category = tags[0]?.name || "未分类";
  }
  persist();
  renderContent();
  showToast("批量移除完成", `移除 ${removed} 个标签`);
  addLog(`批量移除标签：${[...state.batchTagSelected].join("、")} ← ${state.batchSelected.size} 个账号`, "success");
}

function batchDeleteAccounts() {
  if (!state.batchSelected.size) {
    showToast("未选择", "请先勾选账号");
    return;
  }
  els.confirmTitle.textContent = "批量删除";
  els.confirmMessage.textContent = `确认删除 ${state.batchSelected.size} 个账号？此操作不可撤销。`;
  els.confirmModal.hidden = false;
  els.confirmOk.onclick = () => {
    const count = state.batchSelected.size;
    state.accounts = state.accounts.filter((a) => !state.batchSelected.has(a.id));
    state.batchSelected.clear();
    persist();
    renderFolders();
    renderContent();
    els.confirmModal.hidden = true;
    showToast("批量删除完成", `已删除 ${count} 个账号`);
    addLog(`批量删除：${count} 个账号`, "failure");
  };
}

async function persist() {
  await chrome.storage.local.set({ accounts: state.accounts });
  renderFolders();
  renderTagFilterOptions();
  renderBatchTags();
  updateMeta();
}

async function updateMeta() {
  const tagCount = allTagNames().length;
  const shotCount = await countShotsInDB();
  els.meta.textContent = `已采集 ${state.accounts.length} 个账号 · ${tagCount} 个标签 · ${shotCount} 张已绑定截图`;
}

function resetFilters() {
  state.searchKeyword = "";
  state.tagFilter = "";
  state.screenshotFilter = "";
  state.noteFilter = "";
  state.noteKeyword = "";
  state.folder = "全部";
  els.nameSearch.value = "";
  els.tagFilter.value = "";
  els.screenshotFilter.value = "";
  els.noteFilter.value = "";
  els.noteSearch.value = "";
  renderFolders();
  renderContent();
  addLog("重置所有筛选条件", "info");
}

function bindEvents() {
  els.nameSearch.addEventListener("input", () => {
    state.searchKeyword = els.nameSearch.value.trim();
    renderContent();
  });

  els.toggleAdvanced.addEventListener("click", () => {
    els.advancedFilters.hidden = !els.advancedFilters.hidden;
    els.toggleAdvanced.classList.toggle("active", !els.advancedFilters.hidden);
  });

  els.applyFilters.addEventListener("click", () => {
    state.tagFilter = els.tagFilter.value;
    state.screenshotFilter = els.screenshotFilter.value;
    state.noteFilter = els.noteFilter.value;
    state.noteKeyword = els.noteSearch.value.trim();
    renderContent();
    addLog("应用筛选", "info");
  });

  els.resetFilters.addEventListener("click", resetFilters);

  els.batchMode.addEventListener("click", () => {
    state.batchMode = !state.batchMode;
    els.batchMode.classList.toggle("active", state.batchMode);
    els.batchBar.hidden = !state.batchMode;
    if (!state.batchMode) {
      state.batchSelected.clear();
    }
    renderContent();
  });

  els.selectVisible.addEventListener("click", () => {
    const visible = state.accounts.filter(matchFilters);
    for (const a of visible) state.batchSelected.add(a.id);
    renderContent();
  });

  els.clearSelection.addEventListener("click", () => {
    state.batchSelected.clear();
    renderContent();
  });

  els.batchAddTags.addEventListener("click", batchAddTags);
  els.batchRemoveTags.addEventListener("click", batchRemoveTags);
  els.batchDelete.addEventListener("click", batchDeleteAccounts);

  els.autoShot.addEventListener("click", async () => {
    if (state.autoShotRunning) return;
    state.autoShotRunning = true;
    els.autoShot.disabled = true;
    els.stopShot.disabled = false;

    const missing = state.accounts.filter((a) => a.homeUrl && !hasShotForAccount(a));
    if (missing.length === 0) {
      addLog("没有缺失截图的账号，全部已绑定", "success");
      els.captureStatus.textContent = "";
      state.autoShotRunning = false;
      els.autoShot.disabled = false;
      els.stopShot.disabled = true;
      return;
    }

    addLog(`开始补缺失截图，共 ${missing.length} 个账号`, "info");
    let done = 0;
    let failed = 0;

    for (let i = 0; i < missing.length; i++) {
      if (!state.autoShotRunning) {
        addLog(`用户已停止，已完成 ${done}/${missing.length}`, "info");
        break;
      }
      const account = missing[i];
      els.captureStatus.textContent = `补图中 ${i + 1}/${missing.length}：${account.nickname}`;

      let tab = null;
      try {
        // 1. 打开博主主页
        tab = await chrome.tabs.create({ url: account.homeUrl, active: true });
        // 创建后短暂等待 + 验证标签页仍存在（防止被拦截/重定向导致立即关闭）
        await new Promise((r) => setTimeout(r, 800));
        if (!(await tabStillValid(tab.id))) throw new Error("标签页创建后即丢失，可能被浏览器拦截或 URL 无效");

        // 2. 激活标签页并等待加载完成
        await focusTabForCapture(tab.id, tab.windowId);
        if (!(await tabStillValid(tab.id))) throw new Error("激活标签后丢失");
        await waitForTabComplete(tab.id, 12000);
        if (!(await tabStillValid(tab.id))) throw new Error("页面加载期间标签丢失");

        // 3. 额外等待视觉渲染（截图需要页面实际渲染到屏幕）
        await new Promise((r) => setTimeout(r, 2000));
        if (!(await tabStillValid(tab.id))) throw new Error("渲染等待期间标签丢失");

        // 3. 提取 signature（不点击「更多」按钮）
        if (!(await tabStillValid(tab.id))) throw new Error("注入脚本前标签丢失");
        const [profileResult] = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: () => {
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
                for (const item of obj) {
                  const f = findSignature(item);
                  if (f) return f;
                }
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
            // 全局变量
            for (const data of [window.__INITIAL_STATE__, window._SSR_HYDRATED_DATA, window.__RENDER_DATA__]) {
              if (!data) continue;
              const sig = findSignature(data);
              if (sig) return { url: location.href, profileDetail: sig, crop };
            }
            // RENDER_DATA / SSR_HYDRATED_DATA script 标签
            const el = document.getElementById("RENDER_DATA") || document.getElementById("SSR_HYDRATED_DATA");
            if (el) {
              try {
                const sig = findSignature(JSON.parse(decodeURIComponent(el.textContent || "")));
                if (sig) return { url: location.href, profileDetail: sig, crop };
              } catch {}
            }
            // 页面 script 标签
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
        });
        const profile = profileResult?.result || {};

        // 3.5 截图前确保标签是激活的
        if (!(await tabStillValid(tab.id))) throw new Error("截图聚焦前标签丢失");
        await focusTabForCapture(tab.id, tab.windowId);

        // 4. 截图（调用 background.js）
        if (!(await tabStillValid(tab.id))) throw new Error("截图时标签丢失");
        const response = await chrome.runtime.sendMessage({
          type: "DOUYIN_GALLERY_CAPTURE_ACTIVE_TAB",
          tab: { id: tab.id, windowId: tab.windowId, title: tab.title, url: tab.url },
          crop: profile.crop
        });

        if (!response?.ok) throw new Error(response?.error || "截图失败");

        const bindingAccount = findAccountByUrl(profile.url || response.shot.url || tab.url) || account;
        const bindUrls = [
          account.homeUrl,
          bindingAccount.homeUrl,
          profile.url,
          response.shot.url,
          tab.url
        ];

        // 5. 存 IndexedDB + 更新内存缓存
        await saveShotToDB(bindingAccount, response.shot.screenshotDataUrl, response.shot.capturedAt, bindUrls);
        if (bindingAccount.id !== account.id) {
          await saveShotToDB(account, response.shot.screenshotDataUrl, response.shot.capturedAt, bindUrls);
        }
        let verifiedShot = await getShotFromDB(account);
        if (!verifiedShot?.dataUrl && bindingAccount.id !== account.id) {
          verifiedShot = await getShotFromDB(bindingAccount);
        }
        if (!verifiedShot?.dataUrl) {
          throw new Error("截图已生成但未能按账号链接回读，绑定失败");
        }
        for (const key of shotLookupKeys(account, bindUrls)) state.shotAccountIdSet.add(key);
        for (const key of shotLookupKeys(bindingAccount, bindUrls)) state.shotAccountIdSet.add(key);
        state.shotCache.set(account.id, verifiedShot.dataUrl);
        state.shotCache.set(bindingAccount.id, verifiedShot.dataUrl);

        // 6. 同步 signature 到备注
        if (profile.profileDetail) {
          bindingAccount.note = upsertProfileNote(bindingAccount.note, profile.profileDetail);
          bindingAccount.profileDetail = profile.profileDetail;
          bindingAccount.profileDetailSyncedAt = new Date().toISOString();
          if (bindingAccount.id !== account.id) {
            account.note = upsertProfileNote(account.note, profile.profileDetail);
            account.profileDetail = profile.profileDetail;
            account.profileDetailSyncedAt = bindingAccount.profileDetailSyncedAt;
          }
        }

        done++;
        addLog(`✓ ${i + 1}/${missing.length} ${account.nickname}${profile.profileDetail ? " +signature" : ""}`, "success");
      } catch (err) {
        failed++;
        addLog(`✗ ${i + 1}/${missing.length} ${account.nickname}：${err.message || err}`, "failure");
      } finally {
        // 7. 关闭标签页
        if (tab) {
          try { await chrome.tabs.remove(tab.id); } catch {}
        }
        // 8. 间隔（避免被检测）
        await new Promise((r) => setTimeout(r, 1500));
      }
    }

    // 保存 accounts 到 storage
    await chrome.storage.local.set({ accounts: state.accounts });
    renderContent();
    await updateMeta();

    addLog(`补图完成：成功 ${done}，失败 ${failed}，共 ${missing.length}`, done > 0 ? "success" : "info");
    els.captureStatus.textContent = "";
    state.autoShotRunning = false;
    els.autoShot.disabled = false;
    els.stopShot.disabled = true;
  });

  els.stopShot.addEventListener("click", () => {
    state.autoShotRunning = false;
    addLog("正在停止补图循环...", "info");
    els.stopShot.disabled = true;
  });

  els.logs.addEventListener("click", () => {
    els.logsModal.hidden = false;
  });
  els.logsClose.addEventListener("click", () => {
    els.logsModal.hidden = true;
  });

  els.export.addEventListener("click", () => {
    const data = JSON.stringify({ accounts: state.accounts }, null, 2);
    const blob = new Blob([data], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `douyin-accounts-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    addLog("导出全部 JSON", "success");
  });

  els.editorClose.addEventListener("click", () => { els.editorModal.hidden = true; });
  els.addTag.addEventListener("click", addTagInEditor);
  els.tagInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") { event.preventDefault(); addTagInEditor(); }
  });
  els.saveEditor.addEventListener("click", saveEditor);

  els.noteImages.addEventListener("change", async (event) => {
    const files = [...(event.target.files || [])];
    for (const file of files) {
      const dataUrl = await readFileAsDataUrl(file);
      if (dataUrl) state.editingNoteImages.push(dataUrl);
    }
    event.target.value = "";
    renderNotePreview();
  });

  /* 粘贴上传图片（Ctrl+V / Cmd+V）— 在编辑弹窗打开时生效 */
  document.addEventListener("paste", async (event) => {
    if (els.editorModal.hidden || !state.editingAccountId) return;
    const items = event.clipboardData?.items;
    if (!items) return;
    for (const item of items) {
      if (!item.type.startsWith("image/")) continue;
      const file = item.getAsFile();
      if (!file) continue;
      const dataUrl = await readFileAsDataUrl(file);
      if (dataUrl) state.editingNoteImages.push(dataUrl);
    }
    renderNotePreview();
  });

  els.confirmCancel.addEventListener("click", () => { els.confirmModal.hidden = true; });
}

(async function init() {
  bindEvents();
  const stored = await chrome.storage.local.get(["accounts"]);
  // 清零旧 pageShots 数据（一次性）
  await chrome.storage.local.remove("pageShots");
  const originalAccountsJson = JSON.stringify(stored.accounts || []);
  state.accounts = (stored.accounts || []).map((a) => {
    const clean = cleanAccountIdentity(a);
    return { ...clean, tags: ensureTags(clean) };
  });
  if (originalAccountsJson !== JSON.stringify(state.accounts)) {
    await chrome.storage.local.set({ accounts: state.accounts });
  }
  // 加载截图 accountId 列表（轻量，只读 key 不读图片数据）
  await loadShotAccountIdSet();
  renderTagFilterOptions();
  renderBatchTags();
  renderFolders();
  renderContent();
  renderLogs();
  updateMeta();
})();
