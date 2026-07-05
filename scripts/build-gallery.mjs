import fs from "node:fs/promises";
import path from "node:path";

const ROOT = path.resolve(new URL("..", import.meta.url).pathname);
const DATA_DIR = path.join(ROOT, "data");
const GALLERY_DIR = path.join(DATA_DIR, "gallery");
const CATEGORY_FILE = path.join(ROOT, "config", "categories.json");
const FOLLOWING_FILE = path.join(DATA_DIR, "following.json");

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function classify(user, categories) {
  const text = `${user.name} ${user.bio} ${user.rawText}`.toLowerCase();
  let best = categories[categories.length - 1];
  let score = -1;

  for (const category of categories) {
    const current = category.keywords.reduce((sum, keyword) => {
      return sum + (text.includes(String(keyword).toLowerCase()) ? 1 : 0);
    }, 0);
    if (current > score) {
      score = current;
      best = category;
    }
  }

  return best;
}

function introFor(user) {
  if (user.bio) return user.bio;
  if (user.worksHint) return user.worksHint;
  return "暂无简介，适合作为待观察样本继续补充笔记。";
}

function buildHtml(groups, meta) {
  const folderNav = groups.map((group) => `
    <a class="folder-pill" href="#${escapeHtml(group.id)}">
      <i class="fa fa-folder-open"></i>
      <span>${escapeHtml(group.name)}</span>
      <strong>${group.users.length}</strong>
    </a>
  `).join("");

  const sections = groups.map((group) => `
    <section class="folder" id="${escapeHtml(group.id)}">
      <div class="folder-head">
        <div>
          <p>智能文件夹</p>
          <h2>${escapeHtml(group.name)}</h2>
        </div>
        <span>${group.users.length} 个账号</span>
      </div>
      <div class="gallery">
        ${group.users.map((user) => {
          const shot = user.screenshot ? `../${user.screenshot}` : "";
          return `
            <article class="card">
              <a class="shot" href="${escapeHtml(user.url)}" target="_blank" rel="noreferrer">
                ${shot ? `<img src="${escapeHtml(shot)}" alt="${escapeHtml(user.name)} 的主页截图">` : `<div class="empty-shot"><i class="fa fa-image"></i><span>暂无截图</span></div>`}
              </a>
              <div class="card-body">
                <div class="profile">
                  ${user.avatar ? `<img src="${escapeHtml(user.avatar)}" alt="">` : `<span class="avatar-fallback">${escapeHtml(user.name.slice(0, 1))}</span>`}
                  <div>
                    <h3>${escapeHtml(user.name)}</h3>
                    <p>${escapeHtml(introFor(user))}</p>
                  </div>
                </div>
                <a class="open-link" href="${escapeHtml(user.url)}" target="_blank" rel="noreferrer">
                  <i class="fa fa-external-link"></i>
                  打开主页
                </a>
              </div>
            </article>
          `;
        }).join("")}
      </div>
    </section>
  `).join("");

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>抖音起号学习看板</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/font-awesome@4.7.0/css/font-awesome.min.css">
  <style>
    :root {
      color-scheme: dark;
      --bg: #101114;
      --panel: #181a20;
      --line: rgba(255,255,255,.1);
      --text: #f5f5f4;
      --muted: #a8a29e;
      --accent: #ff2f63;
      --accent-2: #20d5ec;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      background: var(--bg);
      color: var(--text);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
    }
    .shell { max-width: 1440px; margin: 0 auto; padding: 28px; }
    .topbar {
      display: flex;
      align-items: end;
      justify-content: space-between;
      gap: 20px;
      padding: 18px 0 24px;
      border-bottom: 1px solid var(--line);
    }
    h1 { margin: 0; font-size: clamp(28px, 4vw, 48px); letter-spacing: 0; }
    .meta { color: var(--muted); margin-top: 10px; }
    .stats {
      display: grid;
      grid-template-columns: repeat(2, minmax(120px, 1fr));
      gap: 10px;
      min-width: 260px;
    }
    .stat {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 14px;
    }
    .stat strong { display: block; font-size: 24px; }
    .stat span { color: var(--muted); font-size: 13px; }
    .folders {
      display: flex;
      gap: 10px;
      overflow-x: auto;
      padding: 18px 0 10px;
      position: sticky;
      top: 0;
      z-index: 10;
      background: rgba(16,17,20,.92);
      backdrop-filter: blur(16px);
    }
    .folder-pill {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      flex: 0 0 auto;
      color: var(--text);
      text-decoration: none;
      background: #20232b;
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 10px 12px;
    }
    .folder-pill strong { color: var(--accent-2); }
    .folder { padding: 28px 0 8px; }
    .folder-head {
      display: flex;
      align-items: end;
      justify-content: space-between;
      gap: 16px;
      margin-bottom: 14px;
    }
    .folder-head p { margin: 0 0 4px; color: var(--accent-2); font-size: 13px; }
    .folder-head h2 { margin: 0; font-size: 24px; }
    .folder-head span { color: var(--muted); }
    .gallery {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
      gap: 16px;
    }
    .card {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 8px;
      overflow: hidden;
    }
    .shot {
      display: block;
      aspect-ratio: 16 / 10;
      background: #0b0c0f;
      overflow: hidden;
    }
    .shot img {
      width: 100%;
      height: 100%;
      object-fit: cover;
      display: block;
    }
    .empty-shot {
      height: 100%;
      display: grid;
      place-items: center;
      color: var(--muted);
      gap: 6px;
    }
    .card-body { padding: 14px; }
    .profile {
      display: grid;
      grid-template-columns: 44px minmax(0, 1fr);
      gap: 10px;
      align-items: center;
    }
    .profile img, .avatar-fallback {
      width: 44px;
      height: 44px;
      border-radius: 50%;
      object-fit: cover;
      background: #2b2f39;
      display: grid;
      place-items: center;
      color: var(--accent-2);
      font-weight: 700;
    }
    h3 {
      margin: 0;
      font-size: 16px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .profile p {
      margin: 4px 0 0;
      color: var(--muted);
      font-size: 13px;
      line-height: 1.45;
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
    }
    .open-link {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      margin-top: 14px;
      color: var(--accent);
      text-decoration: none;
      font-size: 14px;
    }
    @media (max-width: 720px) {
      .shell { padding: 18px; }
      .topbar { display: block; }
      .stats { margin-top: 18px; min-width: 0; }
      .gallery { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>
  <main class="shell">
    <header class="topbar">
      <div>
        <h1>抖音起号学习看板</h1>
        <div class="meta">采集时间：${escapeHtml(meta.collectedAt || "")}</div>
      </div>
      <div class="stats">
        <div class="stat"><strong>${meta.count || 0}</strong><span>关注账号</span></div>
        <div class="stat"><strong>${groups.length}</strong><span>智能文件夹</span></div>
      </div>
    </header>
    <nav class="folders">${folderNav}</nav>
    ${sections}
  </main>
</body>
</html>`;
}

async function main() {
  const [raw, categoriesRaw] = await Promise.all([
    fs.readFile(FOLLOWING_FILE, "utf8"),
    fs.readFile(CATEGORY_FILE, "utf8")
  ]);
  const data = JSON.parse(raw);
  const categories = JSON.parse(categoriesRaw);
  const grouped = new Map(categories.map((category) => [category.id, { ...category, users: [] }]));

  for (const user of data.users || []) {
    const category = classify(user, categories);
    grouped.get(category.id).users.push(user);
  }

  const groups = Array.from(grouped.values()).filter((group) => group.users.length > 0);
  await fs.mkdir(GALLERY_DIR, { recursive: true });
  const output = path.join(GALLERY_DIR, "index.html");
  await fs.writeFile(output, buildHtml(groups, data));
  console.log(`已生成 ${output}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
