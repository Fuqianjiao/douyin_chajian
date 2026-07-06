const categories = [
  { id: "food-lifestyle", name: "美食与生活方式", keywords: ["美食", "探店", "咖啡", "面包", "甜品", "餐厅", "吃", "穿搭", "日常", "生活", "vlog", "旅行"] },
  { id: "beauty-fashion", name: "颜值穿搭与妆造", keywords: ["穿搭", "妆", "美妆", "护肤", "发型", "变装", "ootd", "时尚", "拍照", "写真", "颜值"] },
  { id: "dance-music", name: "舞蹈音乐与表演", keywords: ["舞蹈", "跳舞", "音乐", "唱歌", "翻唱", "乐队", "钢琴", "吉他", "表演", "剧情"] },
  { id: "knowledge-career", name: "知识职场与产品", keywords: ["产品", "运营", "互联网", "职场", "创业", "商业", "增长", "学习", "读书", "ai", "设计", "编程"] },
  { id: "campus-youth", name: "校园与年轻人设", keywords: ["校园", "大学", "高中", "少女", "06", "05", "00后", "学生", "宿舍", "青春"] },
  { id: "reference-other", name: "待观察对象", keywords: [] }
];

const MAX_TAGS = 5;
const SELF_PROFILE_NAMES = ["新时代霹雳娇羊"];
const INITIAL_VISIBLE_LIMIT = 60;
const LOAD_MORE_STEP = 60;
// 截图虚拟化：按视口批量加载，防止 Chrome 内存爆裂
const MAX_ACTIVE_SHOT_IMAGES = 30;  // 约 1.5 屏的量

const foldersEl = document.querySelector("#folders");
const contentEl = document.querySelector("#content");
const metaEl = document.querySelector("#meta");
const exportButton = document.querySelector("#export");
const autoShotButton = document.querySelector("#autoShot");
const rangeShotButton = document.querySelector("#rangeShot");
const batchModeButton = document.querySelector("#batchMode");
const stopShotButton = document.querySelector("#stopShot");
const logsButton = document.querySelector("#logs");
const captureStatusEl = document.querySelector("#captureStatus");
const toastEl = document.querySelector("#toast");
const nameSearchEl = document.querySelector("#nameSearch");
const toggleAdvancedButton = document.querySelector("#toggleAdvanced");
const advancedFiltersEl = document.querySelector("#advancedFilters");
const tagFilterEl = document.querySelector("#tagFilter");
const screenshotFilterEl = document.querySelector("#screenshotFilter");
const noteFilterEl = document.querySelector("#noteFilter");
const noteSearchEl = document.querySelector("#noteSearch");
const applyFiltersButton = document.querySelector("#applyFilters");
const resetFiltersButton = document.querySelector("#resetFilters");
const batchBarEl = document.querySelector("#batchBar");
const batchCountEl = document.querySelector("#batchCount");
const selectVisibleButton = document.querySelector("#selectVisible");
const clearSelectionButton = document.querySelector("#clearSelection");
const batchTagSelectEl = document.querySelector("#batchTagSelect");
const batchAddTagsButton = document.querySelector("#batchAddTags");
const batchRemoveTagsButton = document.querySelector("#batchRemoveTags");
const batchDeleteButton = document.querySelector("#batchDelete");
const batchHintEl = document.querySelector("#batchHint");
const editorModal = document.querySelector("#editorModal");
const editorTitle = document.querySelector("#editorTitle");
const editorClose = document.querySelector("#editorClose");
const tagInput = document.querySelector("#tagInput");
const addTagButton = document.querySelector("#addTag");
const tagHint = document.querySelector("#tagHint");
const tagSuggestionsEl = document.querySelector("#tagSuggestions");
const editorTagsEl = document.querySelector("#editorTags");
const noteText = document.querySelector("#noteText");
const noteImages = document.querySelector("#noteImages");
const notePreview = document.querySelector("#notePreview");
const saveEditorButton = document.querySelector("#saveEditor");
const logsModal = document.querySelector("#logsModal");
const logsClose = document.querySelector("#logsClose");
const logsContent = document.querySelector("#logsContent");
const rangeShotModal = document.querySelector("#rangeShotModal");
const rangeShotClose = document.querySelector("#rangeShotClose");
const rangeStartNameInput = document.querySelector("#rangeStartName");
const rangeCountInput = document.querySelector("#rangeCount");
const rangeShotHint = document.querySelector("#rangeShotHint");
const rangeShotStartButton = document.querySelector("#rangeShotStart");
const confirmModal = document.querySelector("#confirmModal");
const confirmTitle = document.querySelector("#confirmTitle");
const confirmMessage = document.querySelector("#confirmMessage");
const confirmCancelButton = document.querySelector("#confirmCancel");
const confirmOkButton = document.querySelector("#confirmOk");

let currentRenderData = {
  users: [],
  screenshots: {}
};
let activeTag = "all";
let nameQuery = "";
let filtersExpanded = false;
let advancedFilters = {
  tag: "",
  screenshot: "",
  note: "",
  noteText: ""
};
let editingKey = "";
let draftAiTags = [];
let draftUserTags = [];
let draftNoteImages = [];
let toastTimer = 0;
let batchMode = false;
let selectedKeys = new Set();
let hideToastAfterEnd = false;
let renderTimer = 0;
let renderPromise = null;
let renderQueued = false;
let confirmResolver = null;
let screenshotsLoaded = false;
let screenshotLoadToken = 0;
let visibleLimit = INITIAL_VISIBLE_LIMIT;

// 截图虚拟化状态
let activeShotKeys = [];
let shotObserver = null;

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function normalizeUrl(url = "") {
  return url.split("?")[0].split("#")[0];
}

function profileIdFromUrl(url = "") {
  return normalizeUrl(url).match(/douyin\.com\/user\/([^/?#]+)/)?.[1] || "";
}

function profileKeyForUser(user = {}) {
  const id = profileIdFromUrl(user.url || "") || user.id || "";
  if (id) return `dy:${id}`;
  const fallback = `${user.name || ""}|${user.avatar || ""}`.trim();
  return fallback ? `fallback:${fallback}` : "";
}

function unique(values) {
  return Array.from(new Set(values.map((value) => String(value || "").trim()).filter(Boolean)));
}

function normalizeTag(value = "") {
  const tag = String(value || "").trim().replace(/\s+/g, " ");
  if (/^[A-Za-z]+(?:\s+[A-Za-z]+)+$/.test(tag)) {
    return tag.replace(/\s+/g, "");
  }
  return tag;
}

function tagIdentity(tag = "") {
  return normalizeTag(tag).toLowerCase();
}

function uniqueTags(values) {
  const seen = new Set();
  const tags = [];
  for (const value of values) {
    const tag = normalizeTag(value);
    const identity = tagIdentity(tag);
    if (!tag || seen.has(identity)) continue;
    seen.add(identity);
    tags.push(tag);
  }
  return tags;
}

function hasTag(tags, tag) {
  const identity = tagIdentity(tag);
  return tags.some((item) => tagIdentity(item) === identity);
}

function isSelfUser(user = {}) {
  const name = String(user.name || "").trim();
  const rawText = String(user.rawText || "");
  return SELF_PROFILE_NAMES.includes(name)
    || rawText.includes("naiyouzhang")
    || rawText.includes("新时代霹雳娇羊");
}

function classify(user) {
  const text = `${user.name} ${user.bio} ${user.rawText}`.toLowerCase();
  let best = categories[categories.length - 1];
  let score = -1;

  for (const category of categories) {
    const current = category.keywords.reduce((sum, keyword) => {
      return sum + (text.includes(keyword.toLowerCase()) ? 1 : 0);
    }, 0);
    if (current > score) {
      score = current;
      best = category;
    }
  }

  return best;
}

function tagsFor(user) {
  return uniqueTags([...(user.aiTags || []), ...(user.userTags || [])]).slice(0, MAX_TAGS);
}

function notesFor(user) {
  return {
    text: user.notes?.text || "",
    images: Array.isArray(user.notes?.images) ? user.notes.images : []
  };
}

function introFor(user) {
  return user.bio || user.worksHint || "暂无简介，适合作为待观察样本继续补充笔记。";
}

function searchTextFor(user) {
  const notes = notesFor(user);
  return [
    user.name,
    user.bio,
    user.worksHint,
    user.rawText,
    ...tagsFor(user),
    notes.text,
    notes.images.length ? "图片 备注 图片备注" : ""
  ].join(" ").toLowerCase();
}

function hasNote(user) {
  const notes = notesFor(user);
  return Boolean(notes.text.trim() || notes.images.length);
}

function screenshotFor(user, screenshots) {
  const expectedKey = profileKeyForUser(user);
  const shot = findScreenshotForUser(user, screenshots);
  if (!shot) return null;
  return {
    ...shot,
    profileKey: expectedKey,
    url: shot.url || user.url || "",
    normalizedUrl: normalizeUrl(shot.normalizedUrl || shot.url || user.url || ""),
    name: shot.name || user.name || ""
  };
}

function screenshotDataUrl(screenshot = {}) {
  const shot = screenshot || {};
  return shot.dataUrl
    || shot.imageDataUrl
    || shot.screenshotDataUrl
    || shot.image
    || shot.src
    || "";
}

function sameScreenshotProfile(user, screenshot = {}, key = "") {
  const userUrl = normalizeUrl(user.url || "");
  const shotUrl = normalizeUrl(screenshot.normalizedUrl || screenshot.url || "");
  const userName = String(user.name || "").trim();
  const shotName = String(screenshot.name || "").trim();
  return Boolean(
    key && (key === user.screenshotKey || key === user.screenshotUrl)
    || screenshot.profileKey && screenshot.profileKey === user.profileKey
    || userUrl && shotUrl && userUrl === shotUrl
    || userName && shotName && userName === shotName
  );
}

function findScreenshotForUser(user, screenshots = {}) {
  const expectedKey = profileKeyForUser(user);
  const directKeys = unique([expectedKey, user.screenshotKey, user.screenshotUrl]);
  for (const key of directKeys) {
    const shot = screenshots[key];
    if (screenshotDataUrl(shot)) {
      return shot;
    }
  }
  return Object.entries(screenshots).find(([key, shot]) => {
    return screenshotDataUrl(shot) && sameScreenshotProfile({ ...user, profileKey: expectedKey }, shot, key);
  })?.[1] || null;
}

function screenshotIdentity(screenshot = {}) {
  return screenshot.profileKey
    || normalizeUrl(screenshot.normalizedUrl || screenshot.url || "")
    || screenshot.name
    || screenshotDataUrl(screenshot).slice(0, 80)
    || "";
}

function repairLegacyScreenshots(users = [], screenshots = {}) {
  const nextScreenshots = { ...screenshots };
  const legacyShots = Object.values(nextScreenshots).filter((shot) => screenshotDataUrl(shot));
  if (!legacyShots.length) return { users, screenshots: nextScreenshots };

  const used = new Set();
  for (const user of users) {
    const profileKey = profileKeyForUser(user);
    const shot = findScreenshotForUser(user, nextScreenshots);
    if (screenshotDataUrl(shot)) {
      used.add(screenshotIdentity(shot));
      if (profileKey) {
        nextScreenshots[profileKey] = {
          ...shot,
          dataUrl: screenshotDataUrl(shot),
          profileKey,
          url: shot.url || user.url || "",
          normalizedUrl: normalizeUrl(shot.normalizedUrl || shot.url || user.url || ""),
          name: shot.name || user.name || ""
        };
      }
    }
  }

  const availableShots = legacyShots.filter((shot) => !used.has(screenshotIdentity(shot)));
  let cursor = 0;
  const nextUsers = users.map((user) => {
    const profileKey = profileKeyForUser(user);
    if (!profileKey || findScreenshotForUser(user, nextScreenshots)) return user;
    const shot = availableShots[cursor];
    if (!screenshotDataUrl(shot)) return user;
    cursor += 1;
    nextScreenshots[profileKey] = {
      ...shot,
      dataUrl: screenshotDataUrl(shot),
      profileKey,
      url: shot.url || user.url || "",
      normalizedUrl: normalizeUrl(shot.normalizedUrl || shot.url || user.url || ""),
      name: shot.name || user.name || "",
      legacyReboundAt: new Date().toISOString()
    };
    return {
      ...user,
      profileKey,
      screenshotKey: profileKey,
      screenshotUrl: profileKey
    };
  });

  return { users: nextUsers, screenshots: nextScreenshots };
}

function screenshotsMetaChanged(prev = {}, next = {}) {
  const prevKeys = Object.keys(prev);
  const nextKeys = Object.keys(next);
  if (prevKeys.length !== nextKeys.length) return true;
  for (const key of nextKeys) {
    const before = prev[key] || {};
    const after = next[key] || {};
    if (!prev[key]
      || before.profileKey !== after.profileKey
      || normalizeUrl(before.normalizedUrl || before.url || "") !== normalizeUrl(after.normalizedUrl || after.url || "")
      || before.name !== after.name) {
      return true;
    }
  }
  return false;
}

function migrateUsersAndScreenshots(users = [], screenshots = {}) {
  const nextScreenshots = { ...screenshots };
  const nextUsers = users.filter((user) => !isSelfUser(user)).map((user) => {
    const url = normalizeUrl(user.url || "");
    const profileKey = profileKeyForUser({ ...user, url });
    if (!profileKey) return user;

    const aiTags = uniqueTags(user.tagsEdited ? user.aiTags || [] : (user.aiTags?.length ? user.aiTags : [classify(user).name])).slice(0, MAX_TAGS);
    const userTags = uniqueTags(user.userTags || []).filter((tag) => !hasTag(aiTags, tag));
    const allowedUserTags = userTags.slice(0, Math.max(0, MAX_TAGS - aiTags.length));
    const notes = notesFor(user);

    const strictShot = findScreenshotForUser({ ...user, url, profileKey }, nextScreenshots);
    if (screenshotDataUrl(strictShot)) {
      nextScreenshots[profileKey] = {
        ...strictShot,
        dataUrl: screenshotDataUrl(strictShot),
        profileKey,
        url: strictShot.url || url,
        normalizedUrl: normalizeUrl(strictShot.url || url),
        name: strictShot.name || user.name || ""
      };
    }

    return {
      ...user,
      url,
      profileKey,
      aiTags,
      tagsEdited: Boolean(user.tagsEdited),
      userTags: allowedUserTags,
      notes,
      screenshotKey: strictShot ? profileKey : user.screenshotKey || "",
      screenshotUrl: strictShot ? profileKey : user.screenshotUrl || ""
    };
  });

  return repairLegacyScreenshots(nextUsers, nextScreenshots);
}

function filteredUsers(users, screenshots) {
  const name = nameQuery.trim().toLowerCase();
  const noteKeyword = advancedFilters.noteText.trim().toLowerCase();
  return users.filter((user) => {
    const tagOk = activeTag === "all" || tagsFor(user).includes(activeTag);
    const advancedTagOk = !advancedFilters.tag || tagsFor(user).includes(advancedFilters.tag);
    const nameOk = !name || String(user.name || "").toLowerCase().includes(name);
    const note = notesFor(user);
    const noteOk = !advancedFilters.note
      || (advancedFilters.note === "with" ? hasNote(user) : !hasNote(user));
    const noteTextOk = !noteKeyword || note.text.toLowerCase().includes(noteKeyword);
    const shot = screenshotFor(user, screenshots);
    const screenshotOk = !advancedFilters.screenshot
      || (advancedFilters.screenshot === "with" ? Boolean(shot) : !shot);
    return tagOk && advancedTagOk && nameOk && noteOk && noteTextOk && screenshotOk;
  });
}

function tagStats(users) {
  const counts = new Map();
  for (const user of users) {
    for (const tag of tagsFor(user)) {
      counts.set(tag, (counts.get(tag) || 0) + 1);
    }
  }
  const sorted = Array.from(counts.entries()).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "zh-CN"));
  return [["all", users.length], ...sorted];
}

function allPlatformTags(users) {
  return uniqueTags(users.flatMap((user) => tagsFor(user)))
    .sort((a, b) => a.localeCompare(b, "zh-CN"));
}

function selectedBatchTags() {
  return uniqueTags(Array.from(batchTagSelectEl.querySelectorAll("input[type='checkbox']:checked"))
    .map((input) => input.value)
    .filter(Boolean));
}

function visibleUsersNow() {
  return filteredUsers(currentRenderData.users, currentRenderData.screenshots);
}

function pruneSelectedKeys(users) {
  const validKeys = new Set(users.map(profileKeyForUser).filter(Boolean));
  selectedKeys = new Set(Array.from(selectedKeys).filter((key) => validKeys.has(key)));
}

function setBatchHint(message = "") {
  batchHintEl.textContent = message;
}

function resetVisibleLimit() {
  visibleLimit = INITIAL_VISIBLE_LIMIT;
}

function renderBatchControls(users, visibleUsers) {
  batchBarEl.hidden = !batchMode;
  batchModeButton.classList.toggle("active", batchMode);
  batchModeButton.textContent = batchMode ? "退出批量" : "批量标签";
  if (!batchMode) return;

  const tags = allPlatformTags(users);
  const previousSelected = new Set(selectedBatchTags());
  batchCountEl.textContent = `已选 ${selectedKeys.size} 个`;
  batchTagSelectEl.innerHTML = tags.length
    ? tags.map((tag) => `
      <label>
        <input type="checkbox" value="${escapeHtml(tag)}" ${previousSelected.has(tag) ? "checked" : ""}>
        <span>${escapeHtml(tag)}</span>
      </label>
    `).join("")
    : '<span class="hint">暂无可选标签</span>';
  const disabled = !selectedKeys.size || !tags.length;
  batchAddTagsButton.disabled = disabled;
  batchRemoveTagsButton.disabled = disabled;
  batchDeleteButton.disabled = !selectedKeys.size;
  selectVisibleButton.disabled = !visibleUsers.length;
}

function syncAdvancedControls(tags) {
  advancedFiltersEl.hidden = !filtersExpanded;
  toggleAdvancedButton.classList.toggle("active", filtersExpanded);
  toggleAdvancedButton.textContent = filtersExpanded ? "收起筛选" : "更多筛选";
  tagFilterEl.innerHTML = '<option value="">请选择</option>'
    + tags.filter(([tag]) => tag !== "all")
      .map(([tag]) => `<option value="${escapeHtml(tag)}">${escapeHtml(tag)}</option>`)
      .join("");
  tagFilterEl.value = advancedFilters.tag;
  screenshotFilterEl.value = advancedFilters.screenshot;
  noteFilterEl.value = advancedFilters.note;
  noteSearchEl.value = advancedFilters.noteText;
  nameSearchEl.value = nameQuery;
}

function phaseText(phase = "") {
  return {
    queued: "排队中",
    opening: "等待页面加载完全",
    rendering: "等待页面加载完全",
    capturing: "正在缓存当前可见主页截图...",
    saved: "保存完成",
    closing: "关闭主页",
    "item-error": "单个失败",
    paused: "已中途停止",
    stopping: "正在停止",
    idle: "空闲",
    error: "出错"
  }[phase] || "处理中";
}

function captureTitle(state = {}) {
  if (state?.phase === "saved") {
    return `缓存【${state.currentName || state.currentUrl || "-"}】主页成功`;
  }
  return phaseText(state?.phase);
}

function showToast(state, keep = false) {
  clearTimeout(toastTimer);
  if (hideToastAfterEnd && (state?.stopped || state?.phase === "stopping")) {
    toastEl.hidden = true;
    return;
  }
  const total = Number(state?.total || 0);
  const done = Number(state?.done || 0);
  const progress = total ? Math.round(done / total * 100) : 0;
  const current = state?.currentName || state?.currentUrl || "-";
  const active = Boolean(state?.running || state?.paused);
  toastEl.hidden = false;
  toastEl.style.setProperty("--progress", `${progress}%`);
  toastEl.innerHTML = `
    <strong>${escapeHtml(captureTitle(state))} ${total ? `${done}/${total}` : ""}</strong>
    <span>${escapeHtml(state?.message || "")}</span>
    <span>当前：${escapeHtml(current)}</span>
    <div class="bar"><i></i></div>
    ${active ? `
      <div class="toast-actions">
        <button data-capture-toggle type="button">${state?.paused ? "继续运行" : "中途停止"}</button>
        <button data-capture-end type="button">结束运行</button>
      </div>
    ` : ""}
  `;

  if (!keep && !active) {
    toastTimer = setTimeout(() => {
      toastEl.hidden = true;
    }, 4200);
  }
}

function renderTags(user) {
  const aiTags = uniqueTags(user.aiTags || []).slice(0, MAX_TAGS);
  const userTags = uniqueTags(user.userTags || []).filter((tag) => !hasTag(aiTags, tag)).slice(0, Math.max(0, MAX_TAGS - aiTags.length));
  const allTags = tagsFor(user).join("、");
  return `
    <div class="card-tags" title="${escapeHtml(allTags)}">
      ${aiTags.map((tag) => `<button class="tag-pill ai" data-tag="${escapeHtml(tag)}" title="${escapeHtml(tag)}" type="button"><span>${escapeHtml(tag)}</span></button>`).join("")}
      ${userTags.map((tag) => `<button class="tag-pill user" data-tag="${escapeHtml(tag)}" title="${escapeHtml(tag)}" type="button"><span>${escapeHtml(tag)}</span></button>`).join("")}
    </div>
  `;
}

function renderCards(users, screenshots) {
  if (!users.length) {
    return '<div class="empty">没有符合筛选条件的账号。</div>';
  }

  return `
    <div class="gallery">
      ${users.map((user) => {
        const shot = screenshotFor(user, screenshots);
        const shotSrc = screenshotDataUrl(shot);
        const key = profileKeyForUser(user);
        // 不直接渲染 <img>，用占位符 + IntersectionObserver 按需加载，防止内存爆炸
        const shotInner = shotSrc
          ? '<span class="shot-placeholder">截图待加载</span>'
          : "暂无截图";
        const selected = selectedKeys.has(key);
        return `
          <article class="card ${batchMode ? "batch-mode" : ""} ${selected ? "batch-selected" : ""}" data-key="${escapeHtml(key)}">
            <button class="delete-card" data-delete="${escapeHtml(key)}" type="button" aria-label="删除这个博主" title="删除这个博主">×</button>
            ${batchMode ? `
              <label class="select-card">
                <input type="checkbox" data-select-card="${escapeHtml(key)}" ${selected ? "checked" : ""}>
                <span>选择</span>
              </label>
            ` : ""}
            ${user.url
              ? `<a class="shot ${shotSrc ? "has-shot" : ""}" data-shot-key="${escapeHtml(key)}" href="${escapeHtml(user.url)}" target="_blank" rel="noreferrer">${shotInner}</a>`
              : `<div class="shot ${shotSrc ? "has-shot" : ""}" data-shot-key="${escapeHtml(key)}">${shotInner}</div>`}
            <div class="body">
              <div class="profile">
                ${user.avatar ? `<img src="${escapeHtml(user.avatar)}" alt="">` : `<span class="avatar">${escapeHtml((user.name || "?").slice(0, 1))}</span>`}
                <div>
                  <h3 title="${escapeHtml(user.name || "未命名账号")}">${escapeHtml(user.name || "未命名账号")}</h3>
                  <p class="intro" title="${escapeHtml(introFor(user))}">${escapeHtml(introFor(user))}</p>
                </div>
              </div>
              ${renderTags(user)}
              <div class="card-actions">
                ${user.url ? `<a class="open-link" href="${escapeHtml(user.url)}" target="_blank" rel="noreferrer">打开主页</a>` : '<span class="open-link">主页链接未暴露</span>'}
                <button class="note-button" data-edit="${escapeHtml(key)}" type="button">标签/备注</button>
              </div>
            </div>
          </article>
        `;
      }).join("")}
    </div>
  `;
}

// ─── 截图虚拟化：按整屏批量加载，防止内存爆炸 ───

function userByProfileKey(key = "") {
  return currentRenderData.users.find((u) => profileKeyForUser(u) === key) || null;
}

function cssEscape(value = "") {
  if (window.CSS?.escape) return window.CSS.escape(value);
  return String(value).replaceAll(/["\\]/g, "\\$&");
}

function unloadShotImage(shotEl) {
  if (!shotEl || shotEl.dataset.loaded !== "1") return;
  shotEl.dataset.loaded = "";
  shotEl.innerHTML = '<span class="shot-placeholder">截图待加载</span>';
  activeShotKeys = activeShotKeys.filter((k) => k !== shotEl.dataset.shotKey);
}

function hydrateShotImage(shotEl) {
  if (!shotEl || shotEl.dataset.loaded === "1") return;
  const key = shotEl.dataset.shotKey || "";
  const user = userByProfileKey(key);
  const shotSrc = screenshotDataUrl(
    user ? screenshotFor(user, currentRenderData.screenshots) : currentRenderData.screenshots[key]
  );
  if (!shotSrc) return;

  shotEl.dataset.loaded = "1";
  shotEl.innerHTML = `<img src="${shotSrc}" alt="${escapeHtml(user?.name || "博主")} 的主页截图" loading="eager" decoding="async">`;
  if (!activeShotKeys.includes(key)) activeShotKeys.push(key);
}

/** 卸载超出上限的最老截图 */
function pruneActiveShots(keepEl = null) {
  while (activeShotKeys.length > MAX_ACTIVE_SHOT_IMAGES) {
    const staleKey = activeShotKeys.shift();
    if (!staleKey) continue;
    const staleShot = contentEl.querySelector(`.shot[data-shot-key="${cssEscape(staleKey)}"]`);
    if (staleShot && staleShot !== keepEl) unloadShotImage(staleShot);
  }
}

/** 批量渲染当前视口内所有截图（一屏一起出） */
function hydrateVisibleShots() {
  const shots = Array.from(contentEl.querySelectorAll(".shot.has-shot[data-shot-key]"));
  for (const el of shots) {
    hydrateShotImage(el);
  }
  pruneActiveShots();
}

function teardownShotLazyLoading() {
  if (shotObserver) { shotObserver.disconnect(); shotObserver = null; }
  if (scrollRaf) { cancelAnimationFrame(scrollRaf); scrollRaf = null; }
  window.removeEventListener("scroll", onScroll, { passive: true });
  activeShotKeys = [];
}

let scrollRaf = null;

function onScroll() {
  if (scrollRaf) return;
  scrollRaf = requestAnimationFrame(() => {
    scrollRaf = null;
    hydrateVisibleShots();
  });
}

function setupShotLazyLoading() {
  teardownShotLazyLoading();
  const allShots = Array.from(contentEl.querySelectorAll(".shot.has-shot[data-shot-key]"));
  if (!allShots.length) return;

  // ① 首屏立即批量加载
  hydrateVisibleShots();

  // ② 滚动时按帧批量加载新进入的卡片
  window.addEventListener("scroll", onScroll, { passive: true });

  // ③ 用 IntersectionObserver 做粗粒度触发：只要视口附近有任何卡片就批量刷新
  if ("IntersectionObserver" in window) {
    // 用一个哨兵元素检测是否需要加载新区块
    const sentinel = document.createElement("div");
    sentinel.style.cssText = "position:absolute;height:1px;width:1px;pointer-events:none;bottom:0;";
    contentEl.closest("section")?.appendChild(sentinel);

    shotObserver = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          requestAnimationFrame(hydrateVisibleShots);
        }
      }
    }, {
      root: null,
      rootMargin: `${window.innerHeight}px 0px`,   // 上下各扩展一屏
      threshold: 0
    });
    shotObserver.observe(sentinel);
  }
}

function findCardByKey(key) {
  return Array.from(document.querySelectorAll(".card")).find((card) => card.dataset.key === key) || null;
}

function replaceCardScreenshot(user, screenshot) {
  const key = profileKeyForUser(user);
  const card = findCardByKey(key);
  const shotEl = card?.querySelector(".shot");
  const shotSrc = screenshotDataUrl(screenshot);
  if (!shotEl || !shotSrc) return;
  shotEl.innerHTML = `<img src="${shotSrc}" alt="${escapeHtml(user.name || "博主")} 的主页截图" loading="eager" decoding="async">`;
}

function applySavedScreenshot(payload = {}) {
  const screenshot = payload.screenshot || {};
  const shotSrc = screenshotDataUrl(screenshot);
  const payloadUser = payload.user || {};
  const profileKey = payload.profileKey
    || screenshot.profileKey
    || profileKeyForUser(payloadUser)
    || profileKeyForUser({ url: screenshot.url || screenshot.normalizedUrl || "", name: screenshot.name || "" });
  if (!profileKey || !shotSrc) return;

  screenshotLoadToken += 1;
  screenshotsLoaded = true;
  const nextScreenshot = {
    ...screenshot,
    dataUrl: shotSrc,
    profileKey,
    screenshotKey: profileKey,
    screenshotUrl: profileKey,
    url: normalizeUrl(screenshot.url || screenshot.normalizedUrl || payloadUser.url || ""),
    normalizedUrl: normalizeUrl(screenshot.normalizedUrl || screenshot.url || payloadUser.url || "")
  };
  const screenshots = {
    ...currentRenderData.screenshots,
    [profileKey]: nextScreenshot
  };
  const users = currentRenderData.users.map((user) => {
    const sameProfile = profileKeyForUser(user) === profileKey
      || normalizeUrl(user.url || "") === nextScreenshot.url;
    if (!sameProfile) return user;
    return {
      ...user,
      url: nextScreenshot.url || user.url || "",
      profileKey,
      screenshotKey: profileKey,
      screenshotUrl: profileKey
    };
  });
  const migrated = migrateUsersAndScreenshots(users, screenshots);
  renderView(migrated.users, migrated.screenshots);
  const freshUser = migrated.users.find((user) => profileKeyForUser(user) === profileKey) || payloadUser;
  requestAnimationFrame(() => replaceCardScreenshot(freshUser, nextScreenshot));
}

async function persistUsers(users) {
  await chrome.storage.local.set({ douyinUsers: users });
}

async function persistUsersAndRender(users) {
  screenshotLoadToken += 1;
  const migrated = migrateUsersAndScreenshots(users, currentRenderData.screenshots);
  renderView(migrated.users, migrated.screenshots, { loadingScreenshots: !screenshotsLoaded });
  await persistUsers(migrated.users);
}

async function persistUsersAndScreenshots(users, screenshots) {
  await chrome.storage.local.set({
    douyinUsers: users,
    douyinScreenshots: screenshots
  });
}

function openConfirm({ title, message, confirmText = "确认删除" }) {
  confirmTitle.textContent = title;
  confirmMessage.textContent = message;
  confirmOkButton.textContent = confirmText;
  confirmModal.hidden = false;
  return new Promise((resolve) => {
    confirmResolver = resolve;
  });
}

function closeConfirm(result = false) {
  confirmModal.hidden = true;
  if (confirmResolver) {
    confirmResolver(result);
    confirmResolver = null;
  }
}

async function deleteUsersByKeys(keys, reason = "delete") {
  const keySet = new Set(Array.from(keys).filter(Boolean));
  if (!keySet.size) return;

  const screenshots = { ...currentRenderData.screenshots };
  const users = currentRenderData.users.filter((user) => {
    const key = profileKeyForUser(user);
    if (!keySet.has(key)) return true;
    delete screenshots[key];
    if (user.screenshotKey) delete screenshots[user.screenshotKey];
    if (user.screenshotUrl) delete screenshots[user.screenshotUrl];
    return false;
  });
  for (const [screenshotKey, screenshot] of Object.entries(screenshots)) {
    if (keySet.has(screenshot?.profileKey) || keySet.has(profileKeyForUser(screenshot))) {
      delete screenshots[screenshotKey];
    }
  }

  selectedKeys = new Set(Array.from(selectedKeys).filter((key) => !keySet.has(key)));
  await persistUsersAndScreenshots(users, screenshots);
  setBatchHint(reason === "batch" ? `已删除 ${keySet.size} 个博主。` : "");
  await render();
}

async function confirmDeleteUser(key) {
  const user = currentRenderData.users.find((item) => profileKeyForUser(item) === key);
  if (!user) return;
  const ok = await openConfirm({
    title: "删除博主",
    message: `确认删除「${user.name || "未命名账号"}」吗？对应主页截图缓存也会一起删除。`,
    confirmText: "删除"
  });
  if (!ok) return;
  await deleteUsersByKeys([key]);
}

async function confirmBatchDelete() {
  if (!selectedKeys.size) {
    setBatchHint("请先勾选需要删除的博主。");
    return;
  }
  const ok = await openConfirm({
    title: "批量删除博主",
    message: `确认删除已勾选的 ${selectedKeys.size} 个博主吗？对应主页截图缓存也会一起删除。`,
    confirmText: "批量删除"
  });
  if (!ok) return;
  await deleteUsersByKeys(selectedKeys, "batch");
}

async function applyBatchTags(mode) {
  const selectedTags = selectedBatchTags();
  if (!batchMode) return;
  if (!selectedKeys.size) {
    setBatchHint("请先勾选需要处理的博主。");
    return;
  }
  if (!selectedTags.length) {
    setBatchHint("请先选择一个或多个现存标签。");
    return;
  }

  let changedCount = 0;
  let skippedCount = 0;
  const users = currentRenderData.users.map((user) => {
    const key = profileKeyForUser(user);
    if (!selectedKeys.has(key)) return user;

    const currentTags = tagsFor(user);
    if (mode === "add") {
      const nextTags = uniqueTags([...currentTags, ...selectedTags]);
      if (nextTags.length > MAX_TAGS) {
        skippedCount += 1;
        return user;
      }
      const addableTags = selectedTags.filter((tag) => !hasTag(currentTags, tag));
      if (!addableTags.length) return user;
      changedCount += 1;
      return {
        ...user,
        userTags: uniqueTags([...(user.userTags || []), ...addableTags]).filter((tag) => !hasTag(user.aiTags || [], tag)),
        tagsEdited: true
      };
    }

    const nextTags = currentTags.filter((tag) => !hasTag(selectedTags, tag));
    if (nextTags.length < 1) {
      skippedCount += 1;
      return user;
    }
    if (nextTags.length === currentTags.length) return user;
    changedCount += 1;
    return {
      ...user,
      aiTags: uniqueTags(user.aiTags || []).filter((tag) => !hasTag(selectedTags, tag)),
      userTags: uniqueTags(user.userTags || []).filter((tag) => !hasTag(selectedTags, tag)),
      tagsEdited: true
    };
  });

  if (!changedCount && !skippedCount) {
    setBatchHint("选中的博主不需要变更。");
    return;
  }

  await persistUsersAndRender(users);
  setBatchHint(`已处理 ${changedCount} 个，跳过 ${skippedCount} 个。${mode === "add" ? "跳过原因：超过 5 个标签。" : "跳过原因：至少保留 1 个标签。"}`);
}

function renderView(users, screenshots, options = {}) {
  currentRenderData = { users, screenshots };
  pruneSelectedKeys(users);
  const boundShotCount = options.loadingScreenshots ? 0 : users.filter((user) => screenshotFor(user, screenshots)).length;
  metaEl.textContent = options.loadingScreenshots
    ? `本地已采集 ${users.length} 个账号，正在加载截图缓存...`
    : `本地已采集 ${users.length} 个账号，已精确绑定 ${boundShotCount} 张主页截图。`;

  const stats = tagStats(users);
  if (!stats.some(([tag]) => tag === activeTag)) activeTag = "all";
  if (advancedFilters.tag && !stats.some(([tag]) => tag === advancedFilters.tag)) {
    advancedFilters.tag = "";
  }
  syncAdvancedControls(stats);
  foldersEl.innerHTML = stats.map(([tag, count]) => `
    <button class="folder-link ${tag === activeTag ? "active" : ""}" data-tag="${escapeHtml(tag)}" type="button">
      <span>${escapeHtml(tag === "all" ? "全部" : tag)}</span>
      <strong>${count}</strong>
    </button>
  `).join("");

  const visibleUsers = filteredUsers(users, screenshots);
  const renderedUsers = visibleUsers.slice(0, visibleLimit);
  const hasMore = visibleUsers.length > renderedUsers.length;
  renderBatchControls(users, visibleUsers);
  const title = activeTag === "all" ? "全部账号" : activeTag;
  contentEl.innerHTML = `
    <section class="folder">
      <div class="folder-head">
        <h2>${escapeHtml(title)}</h2>
        <p>${renderedUsers.length}/${visibleUsers.length} 个账号</p>
      </div>
      ${renderCards(renderedUsers, screenshots)}
      ${hasMore ? `
        <div class="load-more-wrap">
          <button id="loadMoreCards" class="load-more" type="button">加载更多 ${Math.min(LOAD_MORE_STEP, visibleUsers.length - renderedUsers.length)} 个</button>
        </div>
      ` : ""}
    </section>
  `;

  // 截图虚拟化：用 IntersectionObserver 按需加载实际图片
  if (!options.loadingScreenshots) {
    requestAnimationFrame(() => setupShotLazyLoading());
  }
}

async function loadScreenshotsDeferred(usersSnapshot, token) {
  const { douyinScreenshots = {} } = await chrome.storage.local.get("douyinScreenshots");
  if (token !== screenshotLoadToken) return;
  const migrated = migrateUsersAndScreenshots(usersSnapshot, douyinScreenshots);
  screenshotsLoaded = true;
  renderView(migrated.users, migrated.screenshots);

  const patch = {};
  if (JSON.stringify(migrated.users) !== JSON.stringify(usersSnapshot)) {
    patch.douyinUsers = migrated.users;
  }
  if (screenshotsMetaChanged(douyinScreenshots, migrated.screenshots)) {
    patch.douyinScreenshots = migrated.screenshots;
  }
  if (Object.keys(patch).length) {
    chrome.storage.local.set(patch).catch((error) => {
      if (token === screenshotLoadToken) {
        captureStatusEl.textContent = `截图已恢复展示，但写回本地缓存失败：${error?.message || error}`;
      }
    });
  }
}

async function render(options = {}) {
  screenshotLoadToken += 1;
  const token = screenshotLoadToken;
  if (options.deferScreenshots) {
    const { douyinUsers = [] } = await chrome.storage.local.get("douyinUsers");
    const migrated = migrateUsersAndScreenshots(douyinUsers, {});
    const users = migrated.users;
    screenshotsLoaded = false;
    renderView(users, {}, { loadingScreenshots: true });
    loadScreenshotsDeferred(users, token).catch(() => {
      if (token === screenshotLoadToken) {
        screenshotsLoaded = true;
        metaEl.textContent = `本地已采集 ${users.length} 个账号，截图缓存加载失败。`;
      }
    });
    return;
  }

  const { douyinUsers = [], douyinScreenshots = {} } = await chrome.storage.local.get([
    "douyinUsers",
    "douyinScreenshots"
  ]);

  const migrated = migrateUsersAndScreenshots(douyinUsers, douyinScreenshots);
  const users = migrated.users;
  const screenshots = migrated.screenshots;
  const changed = JSON.stringify(users) !== JSON.stringify(douyinUsers)
    || screenshotsMetaChanged(douyinScreenshots, screenshots);
  screenshotsLoaded = true;
  renderView(users, screenshots);

  if (changed) {
    chrome.storage.local.set({
      douyinUsers: users,
      douyinScreenshots: screenshots
    }).catch((error) => {
      captureStatusEl.textContent = `截图已恢复展示，但写回本地缓存失败：${error?.message || error}`;
    });
  }
}

function scheduleRender(delay = 500) {
  clearTimeout(renderTimer);
  renderTimer = setTimeout(() => {
    if (renderPromise) {
      renderQueued = true;
      return;
    }
    renderPromise = render().finally(() => {
      renderPromise = null;
      if (renderQueued) {
        renderQueued = false;
        scheduleRender(delay);
      }
    });
  }, delay);
}

async function ensureScreenshotsLoaded() {
  if (screenshotsLoaded) return currentRenderData.screenshots;
  const { douyinScreenshots = {} } = await chrome.storage.local.get("douyinScreenshots");
  const migrated = migrateUsersAndScreenshots(currentRenderData.users, douyinScreenshots);
  screenshotsLoaded = true;
  renderView(migrated.users, migrated.screenshots);
  return migrated.screenshots;
}

function uniqueUsersWithMissingScreenshots(users, screenshots) {
  const seen = new Set();
  return users.filter((user) => {
    if (!user.url) return false;
    const url = normalizeUrl(user.url);
    const profileKey = profileKeyForUser({ ...user, url });
    if (!profileKey || seen.has(profileKey)) return false;
    seen.add(profileKey);
    return !screenshotFor({ ...user, url, screenshotKey: profileKey }, screenshots);
  });
}

async function autoCaptureMissingScreenshots() {
  await ensureScreenshotsLoaded();
  const missingUsers = uniqueUsersWithMissingScreenshots(currentRenderData.users, currentRenderData.screenshots);
  if (!missingUsers.length) {
    captureStatusEl.textContent = "当前账号都有截图，或者缺少主页链接。";
    return;
  }

  autoShotButton.disabled = true;
  stopShotButton.disabled = false;
  hideToastAfterEnd = false;

  try {
    await chrome.runtime.sendMessage({
      type: "DOUYIN_AUTO_CAPTURE_START",
      options: {
        delayMs: 800,
        renderTimeoutMs: 35000
      }
    });
    captureStatusEl.textContent = `后台补图已启动：待处理 ${missingUsers.length} 个主页，详情可查看日志。`;
    showToast({
      running: true,
      phase: "queued",
      done: 0,
      total: missingUsers.length,
      message: "准备逐个打开主页并缓存截图。"
    }, true);
  } catch (error) {
    captureStatusEl.textContent = "补图启动失败，详情请查看日志。";
  } finally {
    await render();
  }
}

function findRangeStartUser(name) {
  const keyword = String(name || "").trim().toLowerCase();
  if (!keyword) return null;
  return currentRenderData.users.find((user) => String(user.name || "").toLowerCase().includes(keyword)) || null;
}

function openRangeShotModal() {
  rangeStartNameInput.value = "";
  rangeCountInput.value = "20";
  rangeShotHint.textContent = "会按「全部」列表顺序，从匹配到的博主开始覆盖重新截图。";
  rangeShotModal.hidden = false;
  rangeStartNameInput.focus();
}

function closeRangeShotModal() {
  rangeShotModal.hidden = true;
}

async function startRangeRecapture() {
  const startName = rangeStartNameInput.value.trim();
  const count = Number(rangeCountInput.value || 0);
  const matchedUser = findRangeStartUser(startName);
  if (!startName) {
    rangeShotHint.textContent = "请先输入起始博主名称。";
    return;
  }
  if (!matchedUser) {
    rangeShotHint.textContent = "没有匹配到博主，请换一个名称关键词。";
    return;
  }
  if (!Number.isInteger(count) || count < 1) {
    rangeShotHint.textContent = "操作个数至少为 1。";
    return;
  }

  autoShotButton.disabled = true;
  rangeShotButton.disabled = true;
  stopShotButton.disabled = false;
  hideToastAfterEnd = false;
  closeRangeShotModal();

  try {
    const response = await chrome.runtime.sendMessage({
      type: "DOUYIN_AUTO_CAPTURE_START",
      options: {
        mode: "range-recapture",
        startName,
        count,
        delayMs: 800,
        renderTimeoutMs: 35000
      }
    });
    const state = response?.state || {};
    if (!state.running && state.message) {
      captureStatusEl.textContent = state.message;
      rangeShotButton.disabled = false;
      autoShotButton.disabled = false;
      stopShotButton.disabled = true;
      return;
    }
    captureStatusEl.textContent = `指定重截已启动：从「${matchedUser.name || startName}」开始，最多处理 ${count} 个主页，详情可查看日志。`;
    showToast({
      running: true,
      phase: "queued",
      done: 0,
      total: count,
      message: `准备从「${matchedUser.name || startName}」开始覆盖重截。`
    }, true);
  } catch (error) {
    captureStatusEl.textContent = "指定重截启动失败，详情请查看日志。";
  } finally {
    await render();
  }
}

async function refreshAutoCaptureStatus(options = {}) {
  const { douyinAutoCapture = null } = await chrome.storage.local.get("douyinAutoCapture");
  if (!douyinAutoCapture) return;
  updateAutoCaptureStatus(douyinAutoCapture, options);
}

function updateAutoCaptureStatus(douyinAutoCapture, options = {}) {
  if (!douyinAutoCapture) return;
  const showIdleToast = Boolean(options.showIdleToast);
  autoShotButton.disabled = Boolean(douyinAutoCapture.running);
  rangeShotButton.disabled = Boolean(douyinAutoCapture.running);
  stopShotButton.disabled = !douyinAutoCapture.running && !douyinAutoCapture.paused;
  stopShotButton.textContent = douyinAutoCapture.paused ? "继续" : "中途停止";
  if (douyinAutoCapture.running) {
    const failedText = douyinAutoCapture.failedCount ? `，失败 ${douyinAutoCapture.failedCount} 个` : "";
    captureStatusEl.textContent = `${captureTitle(douyinAutoCapture)}：${douyinAutoCapture.done || 0}/${douyinAutoCapture.total || 0}${failedText}，详情可查看日志。`;
    showToast(douyinAutoCapture, true);
  } else if (douyinAutoCapture.paused) {
    const failedText = douyinAutoCapture.failedCount ? `，失败 ${douyinAutoCapture.failedCount} 个` : "";
    captureStatusEl.textContent = `已中途停止：${douyinAutoCapture.done || 0}/${douyinAutoCapture.total || 0}${failedText}，可继续运行。`;
    showToast(douyinAutoCapture, true);
  } else if (douyinAutoCapture.message) {
    const failedText = douyinAutoCapture.failedCount ? `，失败 ${douyinAutoCapture.failedCount} 个` : "";
    captureStatusEl.textContent = `${douyinAutoCapture.message}${failedText}`;
    if (showIdleToast) showToast(douyinAutoCapture);
  }
}

function currentEditingUser() {
  return currentRenderData.users.find((user) => profileKeyForUser(user) === editingKey) || null;
}

function renderEditorTags(user) {
  const allCount = draftAiTags.length + draftUserTags.length;
  tagHint.textContent = `AI 标签 ${draftAiTags.length} 个，自定义标签 ${draftUserTags.length} 个，总计 ${allCount}/${MAX_TAGS}。至少保留 1 个标签。`;
  editorTagsEl.innerHTML = [
    ...draftAiTags.map((tag) => `<span class="editor-tag ai">${escapeHtml(tag)}<small>AI</small><button data-remove-ai-tag="${escapeHtml(tag)}" type="button">x</button></span>`),
    ...draftUserTags.map((tag) => `<span class="editor-tag user">${escapeHtml(tag)}<button data-remove-tag="${escapeHtml(tag)}" type="button">x</button></span>`)
  ].join("");
}

function tagCandidateScore(tag, keyword) {
  const normalizedTag = tagIdentity(tag);
  const normalizedKeyword = tagIdentity(keyword);
  if (!normalizedKeyword) return 1;
  if (normalizedTag === normalizedKeyword) return 100;
  if (normalizedTag.startsWith(normalizedKeyword)) return 80;
  if (normalizedTag.includes(normalizedKeyword)) return 60;

  let cursor = 0;
  for (const char of normalizedKeyword) {
    cursor = normalizedTag.indexOf(char, cursor);
    if (cursor === -1) return 0;
    cursor += 1;
  }
  return 30;
}

function matchingExistingTags(keyword = "") {
  const usedTags = new Set([...draftAiTags, ...draftUserTags].map(tagIdentity));
  return allPlatformTags(currentRenderData.users)
    .filter((tag) => !usedTags.has(tagIdentity(tag)))
    .map((tag) => ({ tag, score: tagCandidateScore(tag, keyword) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.tag.localeCompare(b.tag, "zh-CN"))
    .slice(0, 12)
    .map((item) => item.tag);
}

function renderTagSuggestions() {
  if (editorModal.hidden) return;
  const matches = matchingExistingTags(tagInput.value);
  tagSuggestionsEl.hidden = !matches.length;
  tagSuggestionsEl.innerHTML = matches.map((tag) => `
    <button data-suggest-tag="${escapeHtml(tag)}" type="button">${escapeHtml(tag)}</button>
  `).join("");
}

function renderNotePreview() {
  notePreview.innerHTML = draftNoteImages.length
    ? draftNoteImages.map((src, index) => `
      <div class="note-thumb">
        <img src="${src}" alt="备注图片">
        <button data-remove-image="${index}" type="button">移除</button>
      </div>
    `).join("")
    : '<span class="hint">暂无备注图片。</span>';
}

function openEditor(key) {
  const user = currentRenderData.users.find((item) => profileKeyForUser(item) === key);
  if (!user) return;
  editingKey = key;
  draftAiTags = uniqueTags(user.aiTags || []).slice(0, MAX_TAGS);
  draftUserTags = uniqueTags(user.userTags || []).filter((tag) => !hasTag(draftAiTags, tag)).slice(0, Math.max(0, MAX_TAGS - draftAiTags.length));
  draftNoteImages = [...notesFor(user).images];
  editorTitle.textContent = `编辑：${user.name || "未命名账号"}`;
  tagInput.value = "";
  noteText.value = notesFor(user).text;
  noteImages.value = "";
  editorModal.hidden = false;
  renderEditorTags(user);
  renderTagSuggestions();
  renderNotePreview();
}

function closeEditor() {
  editorModal.hidden = true;
  editingKey = "";
  draftAiTags = [];
  draftUserTags = [];
  draftNoteImages = [];
  tagSuggestionsEl.hidden = true;
}

function addDraftTag(inputTag = "") {
  const user = currentEditingUser();
  // 忽略事件对象：click 事件会将 event 作为第一个参数传入
  const raw = (inputTag && typeof inputTag === "string") ? inputTag : tagInput.value;
  const tag = normalizeTag(raw);
  if (!user || !tag) return;
  if (hasTag(draftAiTags, tag) || hasTag(draftUserTags, tag)) {
    tagHint.textContent = "这个标签已经存在。";
    return;
  }
  if (draftAiTags.length + draftUserTags.length >= MAX_TAGS) {
    tagHint.textContent = `最多只能保留 ${MAX_TAGS} 个标签。`;
    return;
  }
  draftUserTags.push(tag);
  tagInput.value = "";
  renderEditorTags(user);
  tagHint.textContent = `已添加「${tag}」，当前总计 ${draftAiTags.length + draftUserTags.length}/${MAX_TAGS} 个标签。`;
  renderTagSuggestions();
}

async function saveEditor() {
  const user = currentEditingUser();
  if (!user) return;
  const aiTags = uniqueTags(draftAiTags).slice(0, MAX_TAGS);
  const userTags = uniqueTags(draftUserTags).filter((tag) => !hasTag(aiTags, tag)).slice(0, Math.max(0, MAX_TAGS - aiTags.length));
  if (aiTags.length + userTags.length < 1) {
    tagHint.textContent = "至少保留 1 个标签。请先手动添加一个标签再保存。";
    return;
  }
  if (aiTags.length + userTags.length > MAX_TAGS) {
    tagHint.textContent = `最多只能保留 ${MAX_TAGS} 个标签。`;
    return;
  }
  const users = currentRenderData.users.map((item) => {
    if (profileKeyForUser(item) !== editingKey) return item;
    return {
      ...item,
      aiTags,
      userTags,
      tagsEdited: true,
      notes: {
        text: noteText.value.trim(),
        images: draftNoteImages
      }
    };
  });
  closeEditor();
  await persistUsersAndRender(users);
}

function readImages(files) {
  return Promise.all(Array.from(files).map((file) => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }));
}

async function openLogs() {
  const { douyinAutoCaptureLogs = [], douyinAutoCaptureFailures = [] } = await chrome.storage.local.get([
    "douyinAutoCaptureLogs",
    "douyinAutoCaptureFailures"
  ]);
  const logs = douyinAutoCaptureLogs.length ? douyinAutoCaptureLogs : douyinAutoCaptureFailures;
  logsContent.innerHTML = logs.length
    ? logs.map((log) => `
      <article class="log-item ${escapeHtml(log.type || "failure")}">
        <div>
          <strong>${escapeHtml(log.type === "success" ? "成功" : log.type === "summary" ? "汇总" : "失败")} · ${escapeHtml(log.name || "未命名账号")}</strong>
          <span>${escapeHtml(new Date(log.at).toLocaleString())} · ${escapeHtml(phaseText(log.phase))}</span>
          ${log.batchLabel ? `<span>${escapeHtml(log.batchLabel)}${log.itemIndex && log.total ? ` · ${log.itemIndex}/${log.total}` : ""}</span>` : ""}
        </div>
        <p>${escapeHtml(log.message || log.error || "")}</p>
        ${log.url ? `<a href="${escapeHtml(log.url)}" target="_blank" rel="noreferrer">${escapeHtml(log.url)}</a>` : ""}
      </article>
    `).join("")
    : '<div class="empty">暂无截图日志。</div>';
  logsModal.hidden = false;
}

exportButton.addEventListener("click", async () => {
  const data = await chrome.storage.local.get(["douyinUsers", "douyinScreenshots", "douyinAutoCaptureLogs"]);
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `douyin-learning-board-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  URL.revokeObjectURL(url);
});

autoShotButton.addEventListener("click", autoCaptureMissingScreenshots);
rangeShotButton.addEventListener("click", openRangeShotModal);
rangeShotClose.addEventListener("click", closeRangeShotModal);
rangeShotStartButton.addEventListener("click", startRangeRecapture);
rangeStartNameInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    startRangeRecapture();
  }
});
rangeCountInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    startRangeRecapture();
  }
});
batchModeButton.addEventListener("click", () => {
  batchMode = !batchMode;
  if (!batchMode) {
    selectedKeys.clear();
    setBatchHint("");
  }
  render();
});
selectVisibleButton.addEventListener("click", () => {
  for (const user of visibleUsersNow()) {
    const key = profileKeyForUser(user);
    if (key) selectedKeys.add(key);
  }
  setBatchHint("");
  render();
});
clearSelectionButton.addEventListener("click", () => {
  selectedKeys.clear();
  setBatchHint("");
  render();
});
batchAddTagsButton.addEventListener("click", () => {
  applyBatchTags("add");
});
batchRemoveTagsButton.addEventListener("click", () => {
  applyBatchTags("remove");
});
batchDeleteButton.addEventListener("click", confirmBatchDelete);
stopShotButton.addEventListener("click", () => {
  hideToastAfterEnd = false;
  chrome.runtime.sendMessage({ type: "DOUYIN_AUTO_CAPTURE_STOP" });
  captureStatusEl.textContent = "正在切换中途停止/继续运行状态。";
});
toastEl.addEventListener("click", (event) => {
  if (event.target.closest("[data-capture-toggle]")) {
    hideToastAfterEnd = false;
    chrome.runtime.sendMessage({ type: "DOUYIN_AUTO_CAPTURE_STOP" });
    return;
  }
  if (event.target.closest("[data-capture-end]")) {
    hideToastAfterEnd = true;
    clearTimeout(toastTimer);
    toastEl.hidden = true;
    chrome.runtime.sendMessage({ type: "DOUYIN_AUTO_CAPTURE_END" });
    captureStatusEl.textContent = "正在结束运行，详情可查看日志。";
  }
});
logsButton.addEventListener("click", openLogs);
logsClose.addEventListener("click", () => {
  logsModal.hidden = true;
});
confirmCancelButton.addEventListener("click", () => closeConfirm(false));
confirmOkButton.addEventListener("click", () => closeConfirm(true));
editorClose.addEventListener("click", closeEditor);
saveEditorButton.addEventListener("click", saveEditor);
addTagButton.addEventListener("click", addDraftTag);
tagInput.addEventListener("input", renderTagSuggestions);
tagInput.addEventListener("focus", renderTagSuggestions);
tagInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    addDraftTag();
  }
});
tagSuggestionsEl.addEventListener("mousedown", (event) => {
  const tag = event.target.closest("[data-suggest-tag]")?.dataset?.suggestTag;
  if (!tag) return;
  event.preventDefault();
  addDraftTag(tag);
});
nameSearchEl.addEventListener("input", () => {
  nameQuery = nameSearchEl.value;
  resetVisibleLimit();
  render();
});
toggleAdvancedButton.addEventListener("click", () => {
  filtersExpanded = !filtersExpanded;
  render();
});
applyFiltersButton.addEventListener("click", () => {
  advancedFilters = {
    tag: tagFilterEl.value,
    screenshot: screenshotFilterEl.value,
    note: noteFilterEl.value,
    noteText: noteSearchEl.value
  };
  resetVisibleLimit();
  render();
});
resetFiltersButton.addEventListener("click", () => {
  activeTag = "all";
  nameQuery = "";
  resetVisibleLimit();
  advancedFilters = {
    tag: "",
    screenshot: "",
    note: "",
    noteText: ""
  };
  nameSearchEl.value = "";
  tagFilterEl.value = "";
  screenshotFilterEl.value = "";
  noteFilterEl.value = "";
  noteSearchEl.value = "";
  render();
});
noteSearchEl.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    applyFiltersButton.click();
  }
});
noteImages.addEventListener("change", async () => {
  const images = await readImages(noteImages.files || []);
  draftNoteImages = [...draftNoteImages, ...images].slice(0, 12);
  renderNotePreview();
});
editorTagsEl.addEventListener("click", (event) => {
  const tag = event.target?.dataset?.removeTag;
  const aiTag = event.target?.dataset?.removeAiTag;
  const user = currentEditingUser();
  if (!user) return;
  if (aiTag) {
    draftAiTags = draftAiTags.filter((item) => tagIdentity(item) !== tagIdentity(aiTag));
  }
  if (tag) {
    draftUserTags = draftUserTags.filter((item) => tagIdentity(item) !== tagIdentity(tag));
  }
  renderEditorTags(user);
});
notePreview.addEventListener("click", (event) => {
  const index = event.target?.dataset?.removeImage;
  if (index === undefined) return;
  draftNoteImages.splice(Number(index), 1);
  renderNotePreview();
});
foldersEl.addEventListener("click", (event) => {
  const tag = event.target.closest("[data-tag]")?.dataset?.tag;
  if (!tag) return;
  activeTag = tag;
  resetVisibleLimit();
  render();
});
contentEl.addEventListener("click", (event) => {
  if (event.target.closest("#loadMoreCards")) {
    visibleLimit += LOAD_MORE_STEP;
    render();
    return;
  }
  const deleteKey = event.target.closest("[data-delete]")?.dataset?.delete;
  if (deleteKey) {
    confirmDeleteUser(deleteKey);
    return;
  }
  const tag = event.target.closest("[data-tag]")?.dataset?.tag;
  if (tag) {
    activeTag = tag;
    resetVisibleLimit();
    render();
    return;
  }
  const key = event.target.closest("[data-edit]")?.dataset?.edit;
  if (key) openEditor(key);
});
contentEl.addEventListener("change", (event) => {
  const key = event.target?.dataset?.selectCard;
  if (!key) return;
  if (event.target.checked) {
    selectedKeys.add(key);
  } else {
    selectedKeys.delete(key);
  }
  renderBatchControls(currentRenderData.users, visibleUsersNow());
});
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === "local" && changes.douyinUsers) {
    scheduleRender(300);
  }
  if (areaName === "local" && changes.douyinScreenshots) {
    const oldScreenshots = changes.douyinScreenshots.oldValue || {};
    const newScreenshots = changes.douyinScreenshots.newValue || {};
    const changedShots = Object.entries(newScreenshots)
      .filter(([key, shot]) => {
        const nextSrc = screenshotDataUrl(shot);
        return nextSrc && screenshotDataUrl(oldScreenshots[key]) !== nextSrc;
      })
      .slice(0, 8);
    if (changedShots.length) {
      for (const [profileKey, screenshot] of changedShots) {
        applySavedScreenshot({ profileKey, screenshot });
      }
    }
    const token = screenshotLoadToken + 1;
    screenshotLoadToken = token;
    loadScreenshotsDeferred(currentRenderData.users, token).catch(() => {
      if (token === screenshotLoadToken) {
        screenshotsLoaded = true;
        metaEl.textContent = `本地已采集 ${currentRenderData.users.length} 个账号，截图缓存加载失败。`;
      }
    });
  }
  if (areaName === "local" && changes.douyinAutoCapture) {
    updateAutoCaptureStatus(changes.douyinAutoCapture.newValue, { showIdleToast: true });
  }
});

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === "DOUYIN_AUTO_CAPTURE_STATE") {
    if (message.state) {
      updateAutoCaptureStatus(message.state);
    }
    return;
  }
  if (message?.type === "DOUYIN_SCREENSHOT_SAVED") {
    applySavedScreenshot(message);
  }
});

render({ deferScreenshots: true }).then(refreshAutoCaptureStatus).catch((error) => {
  metaEl.textContent = `读取本地采集数据失败：${error?.message || String(error)}`;
});
