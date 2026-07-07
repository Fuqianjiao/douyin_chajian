function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
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

function renderScreens(pageShots) {
  document.querySelector("#shotCount").textContent = `${pageShots.length} 张截图`;
  document.querySelector("#screenGrid").innerHTML = pageShots.length
    ? pageShots.map((shot) => `
      <article class="screen-card">
        <img src="${escapeHtml(shot.previewDataUrl || shot.screenshotPath || "")}" alt="${escapeHtml(shot.title)}" />
        <div>
          <h3>${escapeHtml(shot.title || "当前主页截图")}</h3>
          <p>${escapeHtml(shot.capturedAt ? new Date(shot.capturedAt).toLocaleString("zh-CN") : "")}</p>
          <a href="${escapeHtml(shot.url || "#")}" target="_blank" rel="noreferrer">打开来源页面</a>
        </div>
      </article>
    `).join("")
    : "<p>暂无截图，回到抖音页面点击“缓存当前主页截图”。</p>";
}

function renderAccounts(accounts) {
  const groups = groupedAccounts(accounts);
  const filters = document.querySelector("#filters");
  const folders = document.querySelector("#folders");

  filters.innerHTML = [
    `<button class="active" data-filter="全部">全部 <b>${accounts.length}</b></button>`,
    ...[...groups.entries()].map(([name, items]) => `<button data-filter="${escapeHtml(name)}">${escapeHtml(name)} <b>${items.length}</b></button>`)
  ].join("");

  folders.innerHTML = [...groups.entries()].map(([name, items]) => `
    <section class="folder" data-folder="${escapeHtml(name)}">
      <div class="section-head">
        <h2>${escapeHtml(name)}</h2>
        <span>${items.length} 个账号</span>
      </div>
      <div class="grid">
        ${items.map((account) => `
          <article class="card">
            <img class="shot" src="${escapeHtml(account.avatar || "")}" alt="${escapeHtml(account.nickname)}" />
            <div class="body">
              <img class="avatar" src="${escapeHtml(account.avatar || "")}" alt="" />
              <div>
                <h3>${escapeHtml(account.nickname || "未命名账号")}</h3>
                <p>${escapeHtml(account.intro || account.bio || "暂无页面可见简介")}</p>
                <span>${escapeHtml(account.category || "未分类")}</span>
              </div>
            </div>
            <footer>
              <a href="${escapeHtml(account.homeUrl || "#")}" target="_blank" rel="noreferrer">打开主页</a>
              <small>${escapeHtml(account.douyinId || "")}</small>
            </footer>
          </article>
        `).join("")}
      </div>
    </section>
  `).join("");

  filters.querySelectorAll("button[data-filter]").forEach((button) => {
    button.addEventListener("click", () => {
      const filter = button.dataset.filter;
      filters.querySelectorAll("button").forEach((item) => item.classList.toggle("active", item === button));
      folders.querySelectorAll(".folder").forEach((folder) => {
        folder.style.display = filter === "全部" || folder.dataset.folder === filter ? "" : "none";
      });
    });
  });
}

(async function init() {
  const stored = await chrome.storage.local.get(["accounts", "pageShots", "gallerySyncedAt"]);
  const accounts = stored.accounts || [];
  const pageShots = stored.pageShots || [];
  document.querySelector("#summary").textContent = `本地已采集 ${accounts.length} 个账号，已缓存 ${pageShots.length} 张截图。`;
  renderScreens(pageShots);
  renderAccounts(accounts);
})();
