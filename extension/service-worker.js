let autoCaptureState = {
  running: false,
  stopped: false,
  paused: false,
  total: 0,
  done: 0,
  currentName: "",
  error: ""
};

const PROFILE_RENDER_TIMEOUT_MS = 35000;

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

function normalizeUser(user = {}) {
  return {
    ...user,
    url: normalizeUrl(user.url || ""),
    collectedAt: user.collectedAt || new Date().toISOString()
  };
}

function userKey(user = {}) {
  return profileKeyForUser(user) || user.url || user.id || `${user.name || ""}|${user.avatar || ""}`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function errorMessage(error) {
  return error?.message || String(error || "未知错误");
}

async function interruptibleSleep(ms, stepMs = 250) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < ms) {
    if (autoCaptureState.stopped || autoCaptureState.paused) return false;
    await sleep(Math.min(stepMs, ms - (Date.now() - startedAt)));
  }
  return true;
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
  const directKeys = Array.from(new Set([expectedKey, user.screenshotKey, user.screenshotUrl].filter(Boolean)));
  for (const key of directKeys) {
    const shot = screenshots[key];
    if (shot?.dataUrl) {
      return shot;
    }
  }
  return Object.entries(screenshots).find(([key, shot]) => {
    return shot?.dataUrl && sameScreenshotProfile({ ...user, profileKey: expectedKey }, shot, key);
  })?.[1] || null;
}

async function broadcastCaptureState(state = autoCaptureState) {
  await chrome.runtime.sendMessage({
    type: "DOUYIN_AUTO_CAPTURE_STATE",
    state
  }).catch(() => {});

  const tabs = await chrome.tabs.query({ url: "https://www.douyin.com/*" }).catch(() => []);
  await Promise.all(tabs.map((tab) => chrome.tabs.sendMessage(tab.id, {
    type: "DOUYIN_AUTO_CAPTURE_STATE",
    state
  }).catch(() => {})));
}

async function broadcastScreenshotSaved(payload) {
  await chrome.runtime.sendMessage({
    type: "DOUYIN_SCREENSHOT_SAVED",
    ...payload
  }).catch(() => {});
}

async function collectProfileUserFromTab(tabId, fallbackUser, url) {
  let profileResponse = await chrome.tabs.sendMessage(tabId, {
    type: "DOUYIN_GET_PROFILE_V1"
  }).catch(() => null);
  if (!profileResponse?.user) {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["extension/content.js"]
    }).catch(() => {});
    profileResponse = await chrome.tabs.sendMessage(tabId, {
      type: "DOUYIN_GET_PROFILE_V1"
    }).catch(() => null);
  }
  return normalizeUser({
    ...fallbackUser,
    ...(profileResponse?.user || {}),
    url
  });
}

async function saveProfileScreenshotLikePopup({ tabId, fallbackUser, url, dataUrl, pageSnapshot = {}, source = "background-auto-profile" }) {
  const profileUser = await collectProfileUserFromTab(tabId, fallbackUser, url);
  const screenshotKey = profileKeyForUser(profileUser);
  if (!screenshotKey) {
    throw new Error("无法识别当前主页的 profileKey，已跳过。");
  }

  const { douyinUsers = [], douyinScreenshots = {} } = await chrome.storage.local.get([
    "douyinUsers",
    "douyinScreenshots"
  ]);

  const savedScreenshot = {
    dataUrl,
    profileKey: screenshotKey,
    url: profileUser.url,
    normalizedUrl: profileUser.url,
    name: profileUser.name,
    pageTitle: pageSnapshot.title || "",
    pageUrl: normalizeUrl(pageSnapshot.url || profileUser.url),
    capturedAt: new Date().toISOString(),
    source
  };
  douyinScreenshots[screenshotKey] = savedScreenshot;

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

  const updatedUsers = Array.from(byUrl.values());
  await chrome.storage.local.set({
    douyinUsers: updatedUsers,
    douyinScreenshots
  });

  const savedUser = byUrl.get(key) || profileUser;
  await broadcastScreenshotSaved({
    profileKey: screenshotKey,
    screenshot: savedScreenshot,
    user: savedUser
  });

  return {
    profileKey: screenshotKey,
    user: savedUser,
    screenshot: savedScreenshot
  };
}

function uniqueUsersWithMissingScreenshots(users, screenshots, limit = 9999) {
  const seen = new Set();
  return users.filter((user) => {
    if (!user.url) return false;
    const url = normalizeUrl(user.url);
    const profileKey = profileKeyForUser({ ...user, url });
    if (!url.includes("douyin.com/user/") || !profileKey || seen.has(profileKey)) return false;
    seen.add(profileKey);
    return !screenshotFor({ ...user, url, screenshotKey: profileKey }, screenshots);
  }).slice(0, limit);
}

function migrateScreenshotBindings(users = [], screenshots = {}) {
  const nextScreenshots = { ...screenshots };
  const nextUsers = users.map((user) => {
    const url = normalizeUrl(user.url || "");
    const profileKey = profileKeyForUser({ ...user, url });
    if (!profileKey) return user;

    const strictShot = findScreenshotForUser({ ...user, url, profileKey }, nextScreenshots);
    if (strictShot?.dataUrl) {
      nextScreenshots[profileKey] = {
        ...strictShot,
        profileKey,
        url: strictShot.url || url,
        normalizedUrl: normalizeUrl(strictShot.url || url),
        name: strictShot.name || user.name || ""
      };
      return {
        ...user,
        url,
        profileKey,
        screenshotKey: profileKey,
        screenshotUrl: profileKey
      };
    }

    return {
      ...user,
      url,
      profileKey,
      screenshotKey: user.screenshotKey || "",
      screenshotUrl: user.screenshotUrl || ""
    };
  });

  return { users: nextUsers, screenshots: nextScreenshots };
}

async function waitForTabReady(tabId, expectedUrl, timeoutMs = PROFILE_RENDER_TIMEOUT_MS) {
  const expectedId = profileIdFromUrl(expectedUrl);
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (autoCaptureState.stopped || autoCaptureState.paused) return false;
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    const currentUrl = normalizeUrl(tab?.url || "");
    const currentId = profileIdFromUrl(currentUrl);
    if (tab?.status === "complete") return true;
    if (expectedId && currentId === expectedId) return true;
    await sleep(150);
  }
  return false;
}

function waitForTabComplete(tabId, timeoutMs = 8000) {
  return new Promise((resolve) => {
    let done = false;
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      chrome.tabs.onUpdated.removeListener(listener);
      resolve(false);
    }, timeoutMs);

    function listener(updatedTabId, changeInfo) {
      if (updatedTabId !== tabId || changeInfo.status !== "complete" || done) return;
      done = true;
      clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(listener);
      resolve(true);
    }

    chrome.tabs.onUpdated.addListener(listener);
  });
}

async function readTabProfileSnapshot(tabId) {
  try {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;
        const visibleImages = Array.from(document.images || []).filter((img) => {
          const rect = img.getBoundingClientRect();
          return rect.width > 20
            && rect.height > 20
            && rect.bottom > 0
            && rect.top < viewportHeight;
        });
        const loadedVisibleImages = visibleImages.filter((img) => img.complete && img.naturalWidth > 0);
        const visibleLoaders = Array.from(document.querySelectorAll("[class*='loading'],[class*='Loading'],[class*='spinner'],[class*='Spinner']")).filter((node) => {
          const rect = node.getBoundingClientRect();
          return rect.width > 6
            && rect.height > 6
            && rect.bottom > 0
            && rect.top < viewportHeight;
        });

        return {
          url: location.href.split("?")[0].split("#")[0],
          title: document.title || "",
          text: (document.body?.innerText || "").slice(0, 4000),
          readyState: document.readyState,
          visibleImageCount: visibleImages.length,
          loadedVisibleImageCount: loadedVisibleImages.length,
          visibleLoaderCount: visibleLoaders.length
        };
      }
    });
    return result?.result || {};
  } catch {
    return {};
  }
}

function profileSnapshotReady(snapshot, expectedUrl, expectedName = "") {
  const expectedId = profileIdFromUrl(expectedUrl);
  const currentUrl = normalizeUrl(snapshot.url || "");
  const currentId = profileIdFromUrl(currentUrl);
  const text = snapshot.text || "";
  const hasTargetUrl = expectedId ? currentId === expectedId : currentUrl === expectedUrl;
  const hasProfileChrome = text.includes("抖音号") && (text.includes("作品") || text.includes("关注"));
  const hasExpectedName = expectedName ? (text.includes(expectedName) || (snapshot.title || "").includes(expectedName)) : true;
  const visibleImageCount = Number(snapshot.visibleImageCount || 0);
  const loadedVisibleImageCount = Number(snapshot.loadedVisibleImageCount || 0);
  const visibleLoaderCount = Number(snapshot.visibleLoaderCount || 0);
  const imageRatio = visibleImageCount ? loadedVisibleImageCount / visibleImageCount : 0;
  const imageReady = visibleImageCount >= 3 && imageRatio >= 0.82;
  const coreReady = snapshot.readyState === "complete" || imageReady;
  const loaderReady = visibleLoaderCount === 0 || imageRatio >= 0.9;
  return hasTargetUrl
    && hasProfileChrome
    && hasExpectedName
    && coreReady
    && imageReady
    && loaderReady;
}

function profileSnapshotUsable(snapshot, expectedUrl, expectedName = "") {
  const expectedId = profileIdFromUrl(expectedUrl);
  const currentUrl = normalizeUrl(snapshot.url || "");
  const currentId = profileIdFromUrl(currentUrl);
  const text = snapshot.text || "";
  const hasTargetUrl = expectedId ? currentId === expectedId : currentUrl === expectedUrl;
  const hasProfileChrome = text.includes("抖音号") && (text.includes("作品") || text.includes("关注"));
  const hasExpectedName = expectedName ? (text.includes(expectedName) || (snapshot.title || "").includes(expectedName)) : true;
  const visibleImageCount = Number(snapshot.visibleImageCount || 0);
  const loadedVisibleImageCount = Number(snapshot.loadedVisibleImageCount || 0);
  const imageRatio = visibleImageCount ? loadedVisibleImageCount / visibleImageCount : 0;
  return hasTargetUrl
    && hasProfileChrome
    && hasExpectedName
    && visibleImageCount >= 3
    && imageRatio >= 0.82;
}

async function waitForProfileRendered(tabId, expectedUrl, expectedName = "", timeoutMs = PROFILE_RENDER_TIMEOUT_MS) {
  const expectedId = profileIdFromUrl(expectedUrl);
  const startedAt = Date.now();
  let latest = {};

  while (Date.now() - startedAt < timeoutMs) {
    if (autoCaptureState.stopped || autoCaptureState.paused) return latest;
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    latest = await readTabProfileSnapshot(tabId);
    latest.url = latest.url || tab?.url || "";

    if (profileSnapshotReady(latest, expectedUrl, expectedName)) {
      return latest;
    }
    await sleep(500);
  }

  if (profileSnapshotUsable(latest, expectedUrl, expectedName)) {
    return latest;
  }

  const currentUrl = normalizeUrl(latest.url || "");
  const currentId = profileIdFromUrl(currentUrl);
  const hasTargetUrl = expectedId ? currentId === expectedId : currentUrl === expectedUrl;
  const detail = [
    hasTargetUrl ? "" : "URL 未匹配",
    latest.readyState === "complete" ? "" : `readyState=${latest.readyState || "unknown"}`,
    `首屏图片 ${Number(latest.loadedVisibleImageCount || 0)}/${Number(latest.visibleImageCount || 0)}`,
    Number(latest.visibleLoaderCount || 0) ? `仍有 ${latest.visibleLoaderCount} 个加载标记` : ""
  ].filter(Boolean).join("，");
  throw new Error(`主页 35 秒内未完整加载，已跳过。${detail}`);
}

async function setCaptureStatus(patch) {
  autoCaptureState = {
    ...autoCaptureState,
    ...patch,
    updatedAt: new Date().toISOString()
  };
  await chrome.storage.local.set({ douyinAutoCapture: autoCaptureState });
  await broadcastCaptureState(autoCaptureState);
}

async function waitWhilePaused() {
  while (autoCaptureState.paused && !autoCaptureState.stopped) {
    await setCaptureStatus({
      running: true,
      phase: "paused",
      message: "已中途停止，点击继续运行会从当前进度继续。"
    });
    await sleep(600);
  }
}

async function appendCaptureFailure(user, phase, error, meta = {}) {
  const {
    douyinAutoCaptureFailures = [],
    douyinAutoCaptureLogs = []
  } = await chrome.storage.local.get(["douyinAutoCaptureFailures", "douyinAutoCaptureLogs"]);
  const failure = {
    at: new Date().toISOString(),
    type: "failure",
    name: user.name || "",
    url: normalizeUrl(user.url || ""),
    profileKey: profileKeyForUser(user),
    phase,
    error: errorMessage(error),
    ...meta
  };
  await chrome.storage.local.set({
    douyinAutoCaptureFailures: [failure, ...douyinAutoCaptureFailures].slice(0, 500),
    douyinAutoCaptureLogs: [failure, ...douyinAutoCaptureLogs].slice(0, 1000)
  });
  return failure;
}

async function appendCaptureSuccess(user, url, profileKey, meta = {}) {
  const { douyinAutoCaptureLogs = [] } = await chrome.storage.local.get("douyinAutoCaptureLogs");
  const log = {
    at: new Date().toISOString(),
    type: "success",
    name: user.name || "",
    url,
    profileKey,
    phase: "saved",
    message: meta.mode === "range-recapture" ? "指定范围主页截图已覆盖缓存" : "主页截图已缓存",
    ...meta
  };
  await chrome.storage.local.set({
    douyinAutoCaptureLogs: [log, ...douyinAutoCaptureLogs].slice(0, 1000)
  });
  return log;
}

async function appendCaptureSummary(summary) {
  const { douyinAutoCaptureLogs = [] } = await chrome.storage.local.get("douyinAutoCaptureLogs");
  const log = {
    at: new Date().toISOString(),
    type: "summary",
    name: summary.batchLabel || "截图任务汇总",
    phase: "idle",
    message: summary.message || "",
    ...summary
  };
  await chrome.storage.local.set({
    douyinAutoCaptureLogs: [log, ...douyinAutoCaptureLogs].slice(0, 1000)
  });
  return log;
}

function uniqueUsersForCapture(users, limit = 9999) {
  const seen = new Set();
  return users.filter((user) => {
    if (!user.url) return false;
    const url = normalizeUrl(user.url);
    const profileKey = profileKeyForUser({ ...user, url });
    if (!url.includes("douyin.com/user/") || !profileKey || seen.has(profileKey)) return false;
    seen.add(profileKey);
    return true;
  }).slice(0, limit);
}

function usersFromRange(users, startName = "", count = 1) {
  const keyword = String(startName || "").trim().toLowerCase();
  const startIndex = users.findIndex((user) => String(user.name || "").toLowerCase().includes(keyword));
  if (startIndex < 0) {
    return { queue: [], startIndex: -1, matchedName: "" };
  }
  const queue = uniqueUsersForCapture(users.slice(startIndex), count);
  return {
    queue,
    startIndex,
    matchedName: users[startIndex]?.name || ""
  };
}

async function getCaptureQueue(options = {}) {
  const { douyinUsers = [], douyinScreenshots = {} } = await chrome.storage.local.get([
    "douyinUsers",
    "douyinScreenshots"
  ]);
  const migrated = migrateScreenshotBindings(douyinUsers, douyinScreenshots);
  await chrome.storage.local.set({
    douyinUsers: migrated.users,
    douyinScreenshots: migrated.screenshots
  });
  const mode = options.mode || "missing";
  const limit = Number(options.limit || 9999);
  const count = Math.max(1, Number(options.count || limit || 1));
  let queue = [];
  let rangeMeta = {};
  if (mode === "range-recapture") {
    const range = usersFromRange(migrated.users, options.startName || "", count);
    queue = range.queue;
    rangeMeta = {
      startName: options.startName || "",
      matchedName: range.matchedName,
      rangeStartIndex: range.startIndex,
      requestedCount: count
    };
  } else {
    queue = uniqueUsersWithMissingScreenshots(migrated.users, migrated.screenshots, limit);
  }
  return {
    queue,
    stats: {
      collectedCount: migrated.users.length,
      screenshotCount: Object.keys(migrated.screenshots).length,
      missingCount: queue.length,
      skippedExistingCount: mode === "range-recapture" ? 0 : Math.max(0, migrated.users.length - queue.length),
      captureMode: mode,
      ...rangeMeta
    }
  };
}

async function captureOne(user, index, total, delayMs, renderTimeoutMs, runMeta = {}) {
  const url = normalizeUrl(user.url);
  const profileKey = profileKeyForUser({ ...user, url });
  let tab = null;
  let phase = "rendering";
  const startedAt = Date.now();
  await setCaptureStatus({
    phase,
    currentName: user.name || url,
    currentUrl: url,
    done: index,
    total,
    message: "等待页面加载完全"
  });

  try {
    tab = await chrome.tabs.create({ url, active: true });
    const tabReady = await waitForTabReady(tab.id, url, renderTimeoutMs);
    if (!tabReady) {
      throw new Error("主页 35 秒内未完成打开，已跳过。");
    }
    if (autoCaptureState.stopped) return "ended";
    if (autoCaptureState.paused) return "paused";

    phase = "rendering";
    await setCaptureStatus({
      phase,
      message: "等待页面加载完全"
    });
    const remainingMs = Math.max(0, renderTimeoutMs - (Date.now() - startedAt));
    if (!remainingMs) {
      throw new Error("主页 35 秒内未完整加载，已跳过。");
    }
    const pageSnapshot = await waitForProfileRendered(tab.id, url, user.name || "", remainingMs);
    const ready = await interruptibleSleep(delayMs);
    if (autoCaptureState.stopped) return "ended";
    if (!ready || autoCaptureState.paused) return "paused";

    phase = "capturing";
    await setCaptureStatus({
      phase,
      message: "正在缓存当前可见主页截图..."
    });
    await chrome.tabs.update(tab.id, { active: true });
    await sleep(120);
    const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" });
    const saved = await saveProfileScreenshotLikePopup({
      tabId: tab.id,
      fallbackUser: user,
      url,
      dataUrl,
      pageSnapshot,
      source: "background-auto-profile"
    });
    const logMeta = {
      mode: runMeta.mode || "missing",
      batchLabel: runMeta.batchLabel || "",
      overwritten: true,
      itemIndex: index + 1,
      total
    };
    await appendCaptureSuccess(saved.user || user, url, saved.profileKey || profileKey, logMeta);
    await setCaptureStatus({
      phase: "saved",
      done: index + 1,
      currentName: saved.user?.name || user.name || url,
      currentUrl: saved.user?.url || url,
      message: `缓存【${saved.user?.name || user.name || url}】主页成功`
    });
    return "success";
  } catch (error) {
    const failure = await appendCaptureFailure(user, phase, error, {
      mode: runMeta.mode || "missing",
      batchLabel: runMeta.batchLabel || "",
      itemIndex: index + 1,
      total
    });
    await setCaptureStatus({
      phase: "item-error",
      error: failure.error,
      done: index + 1,
      failedCount: (autoCaptureState.failedCount || 0) + 1,
      lastFailedName: user.name || url,
      lastFailedUrl: url,
      message: `跳过失败账号：${user.name || url}。${failure.error}`
    });
    return "failure";
  } finally {
    if (tab?.id) {
      if (autoCaptureState.paused) {
        await setCaptureStatus({
          phase: "paused",
          message: `已中途停止，当前主页会关闭：${user.name || url}`
        });
      }
      await chrome.tabs.remove(tab.id).catch(() => {});
    }
  }
}

async function startAutoCapture(options = {}) {
  if (autoCaptureState.running) {
    return { ok: true, state: autoCaptureState };
  }

  const mode = options.mode || "missing";
  const limit = Number(options.limit || 9999);
  const delayMs = Number(options.delayMs || 800);
  const renderTimeoutMs = Number(options.renderTimeoutMs || PROFILE_RENDER_TIMEOUT_MS);
  const { queue, stats } = await getCaptureQueue({ ...options, limit });
  if (!queue.length) {
    const emptyMessage = mode === "range-recapture"
      ? `没有找到从「${options.startName || ""}」开始可重截的主页。`
      : "没有待补截图的主页。";
    await setCaptureStatus({
      running: false,
      stopped: false,
      paused: false,
      total: 0,
      done: 0,
      currentName: "",
      currentUrl: "",
      phase: "idle",
      error: "",
      failedCount: 0,
      lastFailedName: "",
      lastFailedUrl: "",
      ...stats,
      message: emptyMessage
    });
    return { ok: true, state: autoCaptureState };
  }

  const batchLabel = mode === "range-recapture"
    ? `指定重截：${stats.matchedName || options.startName || ""} 起，${queue.length}/${stats.requestedCount || queue.length} 个`
    : "仅补缺失截图";
  await setCaptureStatus({
    running: true,
    stopped: false,
    paused: false,
    total: queue.length,
    done: 0,
    currentName: "",
    currentUrl: "",
    phase: "queued",
    error: "",
    failedCount: 0,
    lastFailedName: "",
    lastFailedUrl: "",
    ...stats,
    batchLabel,
    message: mode === "range-recapture"
      ? `${batchLabel} 已开始。`
      : `自动补缺失截图已开始：待处理 ${queue.length} 个主页。`
  });

  let openerTabId = null;
  try {
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    openerTabId = activeTab?.id || null;

    let sameErrorCount = 0;
    let previousError = "";
    for (let index = 0; index < queue.length;) {
      if (autoCaptureState.stopped) break;
      if (autoCaptureState.paused) {
        await waitWhilePaused();
        continue;
      }

      const result = await captureOne(queue[index], index, queue.length, delayMs, renderTimeoutMs, {
        mode,
        batchLabel
      });
      if (result === "paused") {
        await waitWhilePaused();
        continue;
      }
      if (result === "ended") break;

      if (result === "success") {
        sameErrorCount = 0;
        previousError = "";
      } else if (result === "failure" && autoCaptureState.error && autoCaptureState.error === previousError) {
        sameErrorCount += 1;
      } else {
        previousError = autoCaptureState.error || "";
        sameErrorCount = previousError ? 1 : 0;
      }
      index += 1;

      if (sameErrorCount >= 3) {
        await setCaptureStatus({
          paused: true,
          phase: "paused",
          message: "连续 3 个账号失败，已中途停止，请查看日志后可继续运行。"
        });
        await waitWhilePaused();
      }
      await interruptibleSleep(500);
    }

    const failedCount = autoCaptureState.failedCount || 0;
    const doneCount = autoCaptureState.done || 0;
    const successCount = Math.max(0, doneCount - failedCount);
    const finishedMessage = autoCaptureState.stopped
      ? "已结束自动补截图。"
      : `${batchLabel} 完成，成功 ${successCount} 个，失败 ${failedCount} 个。`;
    await appendCaptureSummary({
      mode,
      batchLabel,
      total: queue.length,
      done: doneCount,
      successCount,
      failedCount,
      stopped: Boolean(autoCaptureState.stopped),
      message: finishedMessage
    });
    await setCaptureStatus({
      running: false,
      paused: false,
      phase: "idle",
      message: finishedMessage
    });
  } catch (error) {
    await setCaptureStatus({
      running: false,
      phase: "error",
      error: errorMessage(error),
      message: "自动补截图失败，请查看日志。"
    });
  } finally {
    if (openerTabId) {
      await chrome.tabs.update(openerTabId, { active: true }).catch(() => {});
    }
  }

  return { ok: true, state: autoCaptureState };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "DOUYIN_AUTO_CAPTURE_START") {
    startAutoCapture(message.options || {}).then(sendResponse);
    return true;
  }

  if (message?.type === "DOUYIN_AUTO_CAPTURE_STOP") {
    setCaptureStatus({
      paused: !autoCaptureState.paused,
      phase: autoCaptureState.paused ? "queued" : "paused",
      message: autoCaptureState.paused ? "继续运行自动补截图。" : "已中途停止，当前主页会关闭..."
    }).then(() => {
      sendResponse({ ok: true, state: autoCaptureState });
    });
    return true;
  }

  if (message?.type === "DOUYIN_AUTO_CAPTURE_END") {
    setCaptureStatus({
      stopped: true,
      paused: false,
      phase: "stopping",
      message: "正在结束自动补截图，当前主页会关闭..."
    }).then(() => {
      sendResponse({ ok: true, state: autoCaptureState });
    });
    return true;
  }

  if (message?.type === "DOUYIN_AUTO_CAPTURE_STATUS") {
    sendResponse({ ok: true, state: autoCaptureState });
    return false;
  }

  return false;
});
