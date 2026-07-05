import fs from "node:fs";

const file = process.argv[2];
if (!file) {
  console.error("用法: node scripts/test-saved-html.mjs <douyin-saved-page.html>");
  process.exit(2);
}

const html = fs.readFileSync(file, "utf8");
const rowPattern = /<div class=TtfqvVUt\b[\s\S]*?(?=<div class=TtfqvVUt\b|<div class=PgpCotBg\b|<\/body>)/g;
const rows = html.match(rowPattern) || [];
const users = [];
const seen = new Set();

function clean(text = "") {
  return text
    .replace(/<img\b[^>]*alt=([^ >]+)头像[^>]*>/g, "")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

for (const row of rows) {
  const url = (row.match(/<a href=(https:\/\/www\.douyin\.com\/user\/[^ >]+)/) || [])[1] || "";
  const names = Array.from(row.matchAll(/<a href=https:\/\/www\.douyin\.com\/user\/[^ >]+[\s\S]*?<span><span class=cWFktkUR>[\s\S]*?<span>([^<]+)<\/span>/g))
    .map((match) => clean(match[1]))
    .filter(Boolean);
  const name = names.find((item) => !item.endsWith("头像")) || names[0] || "";
  const worksHint = clean((row.match(/<span class=pMckBAht>([^<]+)<\/span>/) || [])[1] || "");
  const textBlocks = Array.from(row.matchAll(/<div class=Zq04EtuT>([\s\S]*?)<\/div><span class=pMckBAht/g))
    .map((match) => clean(match[1]))
    .filter(Boolean);
  const bio = textBlocks.find((item) => item !== name && item !== worksHint) || "";
  if (!url || !name || seen.has(url)) continue;
  seen.add(url);
  users.push({ name, bio, worksHint, url });
}

console.log(JSON.stringify({
  rows: rows.length,
  users: users.length,
  sample: users.slice(0, 8)
}, null, 2));

if (users.length < 10) {
  console.error(`自测失败: 只识别到 ${users.length} 个账号`);
  process.exit(1);
}
