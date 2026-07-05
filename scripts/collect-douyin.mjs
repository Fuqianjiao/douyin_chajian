import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";

const ROOT = path.resolve(new URL("..", import.meta.url).pathname);
const DATA_DIR = path.join(ROOT, "data");
const SCREENSHOT_DIR = path.join(DATA_DIR, "screenshots");
const FOLLOWING_URL = "https://www.douyin.com/user/self";

function parseArgs(argv) {
  const args = {
    cdp: "",
    profile: path.join(DATA_DIR, "browser-profile"),
    limit: 200,
    screenshots: false,
    headless: false,
    slowMo: 80
  };

  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    const next = argv[index + 1];
    if (key === "--cdp") args.cdp = next || "";
    if (key === "--profile") args.profile = path.resolve(next || args.profile);
    if (key === "--limit") args.limit = Number(next || args.limit);
    if (key === "--screenshots") args.screenshots = true;
    if (key === "--headless") args.headless = true;
    if (key === "--slow-mo") args.slowMo = Number(next || args.slowMo);
    if (key === "--help") {
      console.log(`用法:
  npm run collect -- --cdp http://127.0.0.1:9222 --limit 200 --screenshots
  npm run collect -- --profile ./data/browser-profile --limit 200 --screenshots`);
      process.exit(0);
    }
  }
  return args;
}

async function ensureDirs() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.mkdir(SCREENSHOT_DIR, { recursive: true });
}

async function openBrowser(args) {
  if (args.cdp) {
    const browser = await chromium.connectOverCDP(args.cdp);
    const context = browser.contexts()[0] || await browser.newContext();
    return { browser, context, close: () => browser.close() };
  }

  const context = await chromium.launchPersistentContext(args.profile, {
    channel: "chrome",
    headless: args.headless,
    slowMo: args.slowMo,
    viewport: { width: 1440, height: 1000 }
  });
  return { browser: null, context, close: () => context.close() };
}

async function clickVisibleText(page, candidates) {
  for (const text of candidates) {
    const locator = page.getByText(text, { exact: false }).first();
    if (await locator.count().catch(() => 0)) {
      try {
        await locator.click({ timeout: 2500 });
        return true;
      } catch {
        // Try the next candidate.
      }
    }
  }
  return false;
}

async function openFollowingDialog(page) {
  await page.goto(FOLLOWING_URL, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(2500);

  const clicked = await clickVisibleText(page, ["关注", "关注 "]);
  if (!clicked) {
    throw new Error("没有找到关注入口。请确认当前浏览器已登录抖音，并停留在自己的主页。");
  }

  await page.waitForTimeout(1800);
  await page.getByText("关注", { exact: false }).first().waitFor({ timeout: 10000 }).catch(() => {});
}

async function collectVisibleUsers(page) {
  return page.evaluate(() => {
    const roots = Array.from(document.querySelectorAll('[role="dialog"], div, section'))
      .filter((node) => {
        const rect = node.getBoundingClientRect();
        const text = node.innerText || "";
        return rect.width > 420
          && rect.height > 420
          && text.includes("关注")
          && (text.includes("粉丝") || text.includes("综合排序") || text.includes("搜索"));
      })
      .sort((a, b) => {
        const areaA = a.getBoundingClientRect().width * a.getBoundingClientRect().height;
        const areaB = b.getBoundingClientRect().width * b.getBoundingClientRect().height;
        return areaB - areaA;
      });
    const root = roots[0] || document;
    const anchors = Array.from(root.querySelectorAll('a[href*="/user/"]'));
    const items = [];
    const seen = new Set();

    for (const anchor of anchors) {
      const href = anchor.href;
      if (!href || seen.has(href)) continue;

      const row = anchor.closest("li, div");
      const scope = row && row.innerText && row.innerText.length > anchor.innerText.length
        ? row
        : anchor;
      const lines = (scope.innerText || "")
        .split(/\n+/)
        .map((line) => line.trim())
        .filter(Boolean)
        .filter((line) => !["已关注", "关注", "粉丝"].includes(line));

      const name = lines[0] || anchor.innerText.trim();
      if (!name || name.length > 80) continue;

      const avatar = scope.querySelector("img")?.src || anchor.querySelector("img")?.src || "";
      const bio = lines.slice(1).find((line) => !/^\d+个作品/.test(line)) || "";
      const worksHint = lines.find((line) => /\d+个作品/.test(line)) || "";

      seen.add(href);
      items.push({
        id: href.split("/user/")[1]?.split(/[/?#]/)[0] || href,
        name,
        bio,
        worksHint,
        url: href,
        avatar,
        rawText: lines.join(" | ")
      });
    }

    return items;
  });
}

async function findScrollable(page) {
  const handle = await page.evaluateHandle(() => {
    const dialogRoots = Array.from(document.querySelectorAll('[role="dialog"], div, section'))
      .filter((node) => {
        const rect = node.getBoundingClientRect();
        const text = node.innerText || "";
        return rect.width > 420
          && rect.height > 420
          && text.includes("关注")
          && (text.includes("粉丝") || text.includes("综合排序") || text.includes("搜索"));
      });
    const searchRoot = dialogRoots[0] || document;
    const nodes = Array.from(searchRoot.querySelectorAll("div, section, main"));
    return nodes
      .filter((node) => node.scrollHeight > node.clientHeight + 120)
      .sort((a, b) => b.scrollHeight - a.scrollHeight)[0] || document.scrollingElement;
  });
  return handle;
}

async function collectFollowing(page, limit) {
  await openFollowingDialog(page);
  const scrollable = await findScrollable(page);
  const usersByUrl = new Map();
  let stableRounds = 0;

  while (usersByUrl.size < limit && stableRounds < 8) {
    const before = usersByUrl.size;
    const visibleUsers = await collectVisibleUsers(page);
    for (const user of visibleUsers) {
      if (usersByUrl.size >= limit) break;
      usersByUrl.set(user.url, user);
    }

    await scrollable.evaluate((node) => {
      node.scrollTop = node.scrollTop + Math.max(node.clientHeight * 0.85, 600);
    });
    await page.waitForTimeout(900);
    stableRounds = usersByUrl.size === before ? stableRounds + 1 : 0;
  }

  return Array.from(usersByUrl.values()).slice(0, limit);
}

function slugify(input) {
  const normalized = input
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || "douyin-user";
}

async function screenshotProfiles(context, users) {
  const page = await context.newPage();
  page.setDefaultTimeout(15000);

  for (let index = 0; index < users.length; index += 1) {
    const user = users[index];
    const filename = `${String(index + 1).padStart(3, "0")}-${slugify(user.name)}.png`;
    const output = path.join(SCREENSHOT_DIR, filename);
    try {
      await page.goto(user.url, { waitUntil: "domcontentloaded" });
      await page.waitForLoadState("networkidle", { timeout: 12000 }).catch(() => {});
      await page.waitForTimeout(1800);
      await page.screenshot({ path: output, fullPage: false });
      user.screenshot = path.relative(DATA_DIR, output);
      console.log(`截图 ${index + 1}/${users.length}: ${user.name}`);
    } catch (error) {
      user.screenshotError = String(error.message || error);
      console.warn(`截图失败: ${user.name} - ${user.screenshotError}`);
    }
  }

  await page.close();
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  await ensureDirs();
  const { context, close } = await openBrowser(args);
  const page = context.pages()[0] || await context.newPage();
  page.setDefaultTimeout(15000);

  try {
    const users = await collectFollowing(page, args.limit);
    console.log(`已抓取 ${users.length} 个关注账号。`);

    if (args.screenshots) {
      await screenshotProfiles(context, users);
    }

    const output = path.join(DATA_DIR, "following.json");
    await fs.writeFile(output, JSON.stringify({
      source: FOLLOWING_URL,
      collectedAt: new Date().toISOString(),
      count: users.length,
      users
    }, null, 2));
    console.log(`已写入 ${output}`);
  } finally {
    await close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
