const statusEl = document.querySelector("#status");
const countEl = document.querySelector("#count");
const shotsEl = document.querySelector("#shots");
const collectButton = document.querySelector("#collect");
const captureButton = document.querySelector("#capture");
const galleryButton = document.querySelector("#gallery");

function setStatus(text) {
  statusEl.textContent = text;
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function sendToActiveTab(message) {
  const tab = await getActiveTab();
  if (!tab?.id || !tab.url?.includes("douyin.com")) {
    throw new Error("请先切到抖音页面。");
  }

  try {
    return await chrome.tabs.sendMessage(tab.id, message);
  } catch {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        window.__douyinLearningBoardInjected = false;
      }
    });
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["extension/content.js"]
    });
    return chrome.tabs.sendMessage(tab.id, message);
  }
}

function normalizeUser(user) {
  return {
    ...user,
    url: normalizeUrl(user.url || ""),
    collectedAt: user.collectedAt || new Date().toISOString()
  };
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

function userKey(user) {
  return profileKeyForUser(user) || user.url || user.id || `${user.name}|${user.avatar || ""}`;
}

async function loadState() {
  const { douyinUsers = [], douyinScreenshots = {}, douyinLastCollect = null, douyinAutoCapture = null } = await chrome.storage.local.get([
    "douyinUsers",
    "douyinScreenshots",
    "douyinLastCollect",
    "douyinAutoCapture"
  ]);
  countEl.textContent = String(douyinUsers.length);
  shotsEl.textContent = String(Object.values(douyinScreenshots).filter((shot) => shot?.profileKey).length);
  if (douyinAutoCapture?.running) {
    setStatus(`正在仅补缺失截图：${douyinAutoCapture.done || 0}/${douyinAutoCapture.total || 0}，已跳过已有截图 ${douyinAutoCapture.skippedExistingCount || 0} 个，当前：${douyinAutoCapture.currentName || "-"}`);
    return;
  }
  if (douyinLastCollect?.totalCount) {
    const addedText = douyinLastCollect.addedCount ? `，本次新增 ${douyinLastCollect.addedCount} 个` : "";
    setStatus(`实时采集中：已采集 ${douyinLastCollect.totalCount} 个账号${addedText}。继续滚动关注弹窗会自动合并。`);
  }
}

collectButton.addEventListener("click", async () => {
  try {
    setStatus("正在开启滚动自动采集...");
    const response = await sendToActiveTab({ type: "DOUYIN_START_AUTO_COLLECT_V3" });
    const users = (response?.users || []).map(normalizeUser);
    if (!users.length) {
      const diagnostics = response?.diagnostics;
      const detail = diagnostics
        ? `已关注按钮 ${diagnostics.followButtonCount || 0} 个，结构行 ${diagnostics.knownRowCount || 0} 行，候选头像 ${diagnostics.imageCount} 个，候选账号行 ${diagnostics.rowCount} 行，链接 ${diagnostics.anchorCount} 个。`
        : "";
      setStatus(`没有读到账号。请先确认关注弹窗在当前页面打开。${detail}`);
      return;
    }

    const scrollTargets = response.autoMeta?.scrollTargetCount || 0;
    setStatus(`已开启实时采集：当前可见 ${users.length} 个，总计 ${response.totalCount || users.length} 个，监听 ${scrollTargets} 个滚动目标。继续滚动会自动合并。`);
    await loadState();
  } catch (error) {
    setStatus(error.message || String(error));
  }
});

captureButton.addEventListener("click", async () => {
  try {
    const tab = await getActiveTab();
    if (!tab?.id || !tab.url?.includes("douyin.com/user/")) {
      setStatus("请先打开某个主播主页，再缓存截图。");
      return;
    }

    setStatus("正在缓存当前可见主页截图...");
    const profileResponse = await sendToActiveTab({ type: "DOUYIN_GET_PROFILE_V1" });
    const profileUser = normalizeUser({
      ...(profileResponse?.user || {}),
      url: normalizeUrl(tab.url)
    });
    const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" });
    const { douyinUsers = [], douyinScreenshots = {} } = await chrome.storage.local.get([
      "douyinUsers",
      "douyinScreenshots"
    ]);
    const screenshotKey = profileKeyForUser(profileUser);
    douyinScreenshots[screenshotKey] = {
      dataUrl,
      profileKey: screenshotKey,
      url: profileUser.url,
      normalizedUrl: profileUser.url,
      name: profileUser.name,
      capturedAt: new Date().toISOString(),
      source: "manual-current-profile"
    };

    const byUrl = new Map(douyinUsers.map((user) => [userKey(user), user]));
    const key = userKey(profileUser);
    const existingUser = byUrl.get(key) || null;
    byUrl.set(key, {
      ...profileUser,
      ...(existingUser || {}),
      url: profileUser.url,
      avatar: existingUser?.avatar || profileUser.avatar,
      douyinId: profileUser.douyinId || existingUser?.douyinId || "",
      profileKey: screenshotKey,
      screenshotKey,
      screenshotUrl: screenshotKey
    });

    await chrome.storage.local.set({
      douyinUsers: Array.from(byUrl.values()),
      douyinScreenshots
    });
    setStatus(`已缓存 ${profileUser.name || "当前主页"} 的截图，并绑定主页链接。`);
    await loadState();
  } catch (error) {
    setStatus(error.message || String(error));
  }
});

galleryButton.addEventListener("click", () => {
  chrome.tabs.create({ url: chrome.runtime.getURL("extension/gallery.html") });
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === "local" && (changes.douyinUsers || changes.douyinScreenshots || changes.douyinLastCollect || changes.douyinAutoCapture)) {
    loadState();
  }
});

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === "DOUYIN_AUTO_CAPTURE_STATE" || message?.type === "DOUYIN_SCREENSHOT_SAVED") {
    loadState();
  }
});

loadState();
