const metaEl = document.querySelector("#meta");
const statsEl = document.querySelector("#stats");
const usersEl = document.querySelector("#users");
const rowsEl = document.querySelector("#rows");
const dialogEl = document.querySelector("#dialog");
const diagnosticsEl = document.querySelector("#diagnostics");
const refreshButton = document.querySelector("#refresh");
const exportButton = document.querySelector("#export");

let currentPayload = null;

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

async function loadDebugData() {
  const {
    douyinUsers = [],
    douyinLastCollect = null,
    douyinLastDebug = null,
    douyinScreenshots = {}
  } = await chrome.storage.local.get([
    "douyinUsers",
    "douyinLastCollect",
    "douyinLastDebug",
    "douyinScreenshots"
  ]);

  currentPayload = {
    exportedAt: new Date().toISOString(),
    douyinUsers,
    douyinLastCollect,
    douyinLastDebug,
    screenshotCount: Object.keys(douyinScreenshots).length
  };

  render(currentPayload);
}

function render(payload) {
  const debug = payload.douyinLastDebug || {};
  const visibleUsers = debug.visibleUsers || [];
  const debugRows = debug.debugRows || [];
  const diagnostics = debug.diagnostics || payload.douyinLastCollect?.diagnostics || {};
  const dialog = diagnostics.dialog || {};

  metaEl.textContent = debug.at
    ? `最近快照：${new Date(debug.at).toLocaleString()}，原因：${debug.reason || "-"}`
    : "还没有调试快照。请在抖音关注弹窗打开时点击扩展里的「查看采集自测数据」。";

  statsEl.innerHTML = [
    ["本地总账号", payload.douyinUsers.length],
    ["当前可见账号", visibleUsers.length],
    ["原始账号行", debugRows.length],
    ["已缓存截图", payload.screenshotCount],
    ["已关注按钮", diagnostics.followButtonCount || 0],
    ["主页链接", diagnostics.anchorCount || 0],
    ["弹窗命中", dialog.found ? "是" : "否"]
  ].map(([label, value]) => `
    <div class="stat"><strong>${escapeHtml(value)}</strong><span>${escapeHtml(label)}</span></div>
  `).join("");

  usersEl.innerHTML = visibleUsers.length ? visibleUsers.map((user) => `
    <article class="user">
      ${user.avatar ? `<img src="${escapeHtml(user.avatar)}" alt="">` : "<div></div>"}
      <div>
        <h3>${escapeHtml(user.name || "未命名账号")}</h3>
        <p>${escapeHtml(user.bio || user.worksHint || user.rawText || "")}</p>
      </div>
      ${user.url ? `<a href="${escapeHtml(user.url)}" target="_blank" rel="noreferrer">打开主页</a>` : "<span>无链接</span>"}
    </article>
  `).join("") : '<div class="empty">当前快照没有解析出账号。</div>';

  rowsEl.innerHTML = debugRows.length ? debugRows.map((row) => `
    <article class="row">
      <div class="row-head">
        <span>#${row.index} ${row.visible ? "可见" : "不可见"} | ${row.rect?.width || 0}x${row.rect?.height || 0} | 链接 ${row.linkCount}</span>
        <span>${escapeHtml(row.parsedUser?.name || "未解析")}</span>
      </div>
      <pre>${escapeHtml(JSON.stringify(row, null, 2))}</pre>
    </article>
  `).join("") : '<div class="empty">没有捕获到账号行。</div>';

  diagnosticsEl.textContent = JSON.stringify({
    diagnostics,
    lastCollect: payload.douyinLastCollect,
    lastDebugMeta: {
      at: debug.at,
      reason: debug.reason,
      totalCount: debug.totalCount,
      addedCount: debug.addedCount
    }
  }, null, 2);
  dialogEl.textContent = JSON.stringify(dialog, null, 2);
}

refreshButton.addEventListener("click", loadDebugData);

exportButton.addEventListener("click", () => {
  const blob = new Blob([JSON.stringify(currentPayload || {}, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `douyin-collect-debug-${new Date().toISOString().slice(0, 19).replaceAll(":", "-")}.json`;
  link.click();
  URL.revokeObjectURL(url);
});

loadDebugData();
