const MAX_TAGS = 6;
const MIN_AI_TAGS = 1;

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
  pageShots: [],
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

function cleanAccountIdentity(account) {
  const bio = normalizeAccountText(account.bio || account.intro || "");
  let nickname = normalizeAccountText(account.nickname || "");

  if (bio && nickname && nickname !== bio && nickname.endsWith(bio)) {
    nickname = normalizeAccountText(nickname.slice(0, -bio.length));
  }

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
  if (!tags.some((t) => t.source === "ai")) {
    tags.unshift({ name: account.category || "未分类", source: "ai" });
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
  const shot = state.pageShots.find((s) => s.accountId === accountId);
  return shot ? (shot.previewDataUrl || shot.screenshotPath || "") : "";
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
  if (state.screenshotFilter === "with" && !shotFor(account.id)) return false;
  if (state.screenshotFilter === "missing" && shotFor(account.id)) return false;
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
  const ordered = state.folder === "全部"
    ? [...groups.entries()]
    : (groups.has(state.folder) ? [[state.folder, groups.get(state.folder)]] : []);

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
}

function renderCard(account) {
  account = cleanAccountIdentity(account);
  const shot = shotFor(account.id);
  const tags = ensureTags(account);
  const isSelected = state.batchSelected.has(account.id);
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
        ${shot ? `<img src="${escapeHtml(shot)}" alt="${escapeHtml(account.nickname)}">` : `<span>暂无截图</span>`}
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
          <button class="note-button" data-edit="${escapeHtml(account.id)}">${hasNote(account) ? "查看备注" : "添加备注"}</button>
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
  `).join("") || "";
  els.editorTags.querySelectorAll("[data-remove-tag]").forEach((btn) => {
    btn.addEventListener("click", () => removeTagInEditor(Number(btn.dataset.removeTag)));
  });
}

function removeTagInEditor(index) {
  const account = state.accounts.find((a) => a.id === state.editingAccountId);
  if (!account) return;
  const tags = ensureTags(account);
  const target = tags[index];
  if (!target) return;
  if (target.source === "ai" && tags.filter((t) => t.source === "ai").length <= MIN_AI_TAGS) {
    showToast("不能删除", "至少保留 1 个 AI 标签");
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
  els.tagInput.value = "";
  renderEditorTags();
}

function saveEditor() {
  const account = state.accounts.find((a) => a.id === state.editingAccountId);
  if (!account) return;
  account.note = els.noteText.value.trim();
  account.noteImages = state.editingNoteImages.slice();
  persist();
  renderContent();
  els.editorModal.hidden = true;
  showToast("已保存", `「${account.nickname}」的标签和备注已更新`);
  addLog(`编辑账号：${account.nickname}（标签 ${ensureTags(account).length}/${MAX_TAGS}）`, "success");
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
    const aiCount = tags.filter((t) => t.source === "ai").length;
    const willRemoveAi = tags.filter((t) => t.source === "ai" && state.batchTagSelected.has(t.name)).length;
    if (aiCount - willRemoveAi < MIN_AI_TAGS) {
      // 不允许把 AI 标签删到 0
      continue;
    }
    const before = tags.length;
    tags = tags.filter((t) => !state.batchTagSelected.has(t.name));
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

function updateMeta() {
  const tagCount = allTagNames().length;
  els.meta.textContent = `本地已采集 ${state.accounts.length} 个账号，共 ${tagCount} 个不同标签。`;
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
    els.autoShot.disabled = true;
    els.stopShot.disabled = false;
    addLog("开始补缺失截图", "info");
    els.captureStatus.textContent = "正在补缺失截图...";
    try {
      const missing = state.accounts.filter((a) => !shotFor(a.id));
      addLog(`共 ${missing.length} 个账号需要补图`, "info");
      for (const account of missing.slice(0, 20)) {
        if (!account.homeUrl) continue;
        const created = await chrome.tabs.create({ url: account.homeUrl, active: false });
        await new Promise((r) => setTimeout(r, 1800));
        try {
          const result = await chrome.scripting.executeScript({
            target: { tabId: created.id },
            func: () => ({ url: location.href, title: document.title })
          });
          addLog(`已访问：${result?.[0]?.result?.title || account.nickname}`, "success");
        } catch (err) {
          addLog(`访问失败：${account.nickname} ${err.message || err}`, "failure");
        }
        await chrome.tabs.remove(created.id);
      }
    } catch (err) {
      addLog(`补图失败：${err.message || err}`, "failure");
    } finally {
      els.autoShot.disabled = false;
      els.stopShot.disabled = true;
      els.captureStatus.textContent = "";
    }
  });

  els.stopShot.addEventListener("click", () => {
    addLog("用户请求停止（占位）", "info");
  });

  els.logs.addEventListener("click", () => {
    els.logsModal.hidden = false;
  });
  els.logsClose.addEventListener("click", () => {
    els.logsModal.hidden = true;
  });

  els.export.addEventListener("click", () => {
    const data = JSON.stringify({ accounts: state.accounts, pageShots: state.pageShots }, null, 2);
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

  els.confirmCancel.addEventListener("click", () => { els.confirmModal.hidden = true; });
}

(async function init() {
  bindEvents();
  const stored = await chrome.storage.local.get(["accounts", "pageShots"]);
  state.accounts = (stored.accounts || []).map((a) => {
    const clean = cleanAccountIdentity(a);
    return { ...clean, tags: ensureTags(clean) };
  });
  state.pageShots = stored.pageShots || [];
  renderTagFilterOptions();
  renderBatchTags();
  renderFolders();
  renderContent();
  renderLogs();
  updateMeta();
})();
