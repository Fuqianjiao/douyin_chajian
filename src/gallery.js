function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

const state = {
  accounts: [],
  pageShots: [],
  filter: "全部",
  keyword: ""
};

const els = {
  summary: document.querySelector("#summary"),
  searchInput: document.querySelector("#searchInput"),
  moreFilterBtn: document.querySelector("#moreFilterBtn"),
  filters: document.querySelector("#filters"),
  folders: document.querySelector("#folders"),
  captureMissingBtn: document.querySelector("#captureMissingBtn"),
  bulkTagBtn: document.querySelector("#bulkTagBtn"),
  stopBtn: document.querySelector("#stopBtn"),
  logBtn: document.querySelector("#logBtn"),
  logPanel: document.querySelector("#logPanel"),
  logContent: document.querySelector("#logContent"),
  exportJsonBtn: document.querySelector("#exportJsonBtn")
};

function shotPreview(shot) {
  return shot.previewDataUrl || shot.screenshotPath || "";
}

function getAccountCover(account, shots) {
  const direct = shotPreview(shots.find((s) => s.accountId === account.id) || {});
  if (direct) return direct;
  return account.avatar || "";
}

function groupedAccounts(accounts) {
  const groups = new Map();
  for (const account of accounts) {
    const category = account.category || "未分类";
    if (!groups.has(category)) groups.set(category, []);
    groups.get(category).push(account);
  }
  return groups;
}

function matchKeyword(account, keyword) {
  if (!keyword) return true;
  const haystack = [account.nickname, account.bio, account.douyinId, ...(account.rawTexts || [])]
    .join(" ")
    .toLowerCase();
  return haystack.includes(keyword.toLowerCase());
}

function renderFilters(accounts) {
  const groups = groupedAccounts(accounts);
  const items = [["全部", accounts.length], ...[...groups.entries()].map(([name, list]) => [name, list.length])];
  els.filters.innerHTML = items.map(([name, count]) => `
    <button class="${name === state.filter ? "active" : ""}" data-filter="${escapeHtml(name)}">
      ${escapeHtml(name)}<b>${count}</b>
    </button>
  `).join("");

  els.filters.querySelectorAll("button[data-filter]").forEach((button) => {
    button.addEventListener("click", () => {
      state.filter = button.dataset.filter;
      renderFilters(state.accounts);
      renderFolders(state.accounts, state.pageShots);
    });
  });
}

function renderFolders(accounts, shots) {
  const groups = groupedAccounts(accounts);
  const ordered = state.filter === "全部"
    ? [...groups.entries()]
    : (groups.has(state.filter) ? [[state.filter, groups.get(state.filter)]] : []);

  if (!ordered.length) {
    els.folders.innerHTML = `<div class="empty">当前分类下没有匹配的账号。</div>`;
    return;
  }

  els.folders.innerHTML = ordered.map(([name, items]) => {
    const visible = items.filter((a) => matchKeyword(a, state.keyword));
    return `
      <section class="folder" data-folder="${escapeHtml(name)}">
        <div class="section-head">
          <h2>${escapeHtml(name)}</h2>
          <span>${visible.length} 个账号</span>
        </div>
        <div class="grid">
          ${visible.map((account) => {
            const cover = getAccountCover(account, shots);
            const cat = account.category || "未分类";
            const sub = account.subCategory || "";
            return `
              <article class="card" data-id="${escapeHtml(account.id)}">
                <img class="cover" src="${escapeHtml(cover)}" alt="${escapeHtml(account.nickname)}" />
                <div class="body">
                  <img class="avatar" src="${escapeHtml(account.avatar || "")}" alt="" />
                  <div class="meta">
                    <h3>${escapeHtml(account.nickname || "未命名账号")}</h3>
                    <p>${escapeHtml(account.bio || account.intro || "暂无页面可见简介")}</p>
                  </div>
                </div>
                <div class="tags">
                  <span class="tag">${escapeHtml(cat)}</span>
                  ${sub ? `<span class="tag pink">${escapeHtml(sub)}</span>` : ""}
                </div>
                <div class="footer">
                  <a class="primary" href="${escapeHtml(account.homeUrl || "#")}" target="_blank" rel="noreferrer" style="display:flex;align-items:center;justify-content:center;padding:10px 18px;border:1px solid var(--pink);border-radius:10px;background:var(--pink);color:#fff;font-weight:800;font-size:14px;text-decoration:none;">打开主页</a>
                  <button data-tag="${escapeHtml(account.id)}" style="flex:1;">标签/备注</button>
                </div>
              </article>
            `;
          }).join("")}
        </div>
      </section>
    `;
  }).join("");

  els.folders.querySelectorAll("button[data-tag]").forEach((button) => {
    button.addEventListener("click", () => {
      const account = state.accounts.find((a) => a.id === button.dataset.tag);
      if (!account) return;
      const next = prompt(`为「${account.nickname}」输入新标签（当前：${account.category || "未分类"}）：`, account.category || "");
      if (next === null) return;
      account.category = next || "未分类";
      chrome.storage.local.set({ accounts: state.accounts });
      renderFilters(state.accounts);
      renderFolders(state.accounts, state.pageShots);
    });
  });
}

function appendLog(line) {
  if (els.logContent.textContent === "暂无日志。") els.logContent.textContent = "";
  els.logContent.textContent += `${new Date().toLocaleTimeString("zh-CN")}  ${line}\n`;
  els.logContent.parentElement.scrollTop = els.logContent.parentElement.scrollHeight;
}

function bindEvents() {
  els.searchInput.addEventListener("input", () => {
    state.keyword = els.searchInput.value.trim();
    renderFolders(state.accounts, state.pageShots);
  });

  els.moreFilterBtn.addEventListener("click", () => {
    appendLog("更多筛选：当前仅支持按名称/简介搜索。");
  });

  els.captureMissingBtn.addEventListener("click", async () => {
    els.captureMissingBtn.disabled = true;
    appendLog("开始为缺失截图的账号补图...");
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) throw new Error("请先切到抖音页面");
      const missing = state.accounts.filter((a) => !state.pageShots.find((s) => s.accountId === a.id));
      appendLog(`共 ${missing.length} 个账号需要补图，依次打开主页截图。`);
      for (const account of missing.slice(0, 12)) {
        const url = account.homeUrl;
        if (!url) continue;
        const created = await chrome.tabs.create({ url, active: false });
        await new Promise((r) => setTimeout(r, 1500));
        try {
          const result = await chrome.scripting.executeScript({
            target: { tabId: created.id },
            func: () => ({ url: location.href, title: document.title })
          });
          appendLog(`已访问：${result?.[0]?.result?.title || url}`);
        } catch (err) {
          appendLog(`访问失败：${account.nickname} ${err.message || err}`);
        }
        await chrome.tabs.remove(created.id);
      }
    } catch (err) {
      appendLog(`补图失败：${err.message || err}`);
    } finally {
      els.captureMissingBtn.disabled = false;
    }
  });

  els.bulkTagBtn.addEventListener("click", () => {
    const tag = prompt("批量设置标签：当前分类下所有账号都会被改写。\n输入新标签名：", "");
    if (!tag) return;
    const groups = groupedAccounts(state.accounts);
    const targets = state.filter === "全部" ? state.accounts : (groups.get(state.filter) || []);
    targets.forEach((a) => { a.category = tag; });
    chrome.storage.local.set({ accounts: state.accounts });
    appendLog(`批量标签：已设置 ${targets.length} 个账号为「${tag}」`);
    renderFilters(state.accounts);
    renderFolders(state.accounts, state.pageShots);
  });

  els.stopBtn.addEventListener("click", () => {
    appendLog("中途停止：当前为占位按钮，实际停止逻辑可在此扩展。");
  });

  els.logBtn.addEventListener("click", () => {
    els.logPanel.classList.toggle("hidden");
  });

  els.exportJsonBtn.addEventListener("click", async () => {
    const data = JSON.stringify({ accounts: state.accounts, pageShots: state.pageShots }, null, 2);
    const blob = new Blob([data], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `douyin-accounts-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    appendLog("已导出 JSON。");
  });
}

(async function init() {
  bindEvents();
  const stored = await chrome.storage.local.get(["accounts", "pageShots"]);
  state.accounts = stored.accounts || [];
  state.pageShots = stored.pageShots || [];
  els.summary.textContent = `本地已采集 ${state.accounts.length} 个账号，已精筛绑定 ${new Set(state.accounts.map((a) => a.category)).size} 条主页数据。`;
  renderFilters(state.accounts);
  renderFolders(state.accounts, state.pageShots);
})();
