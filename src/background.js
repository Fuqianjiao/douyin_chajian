function slugify(value, fallback = "account") {
  const clean = String(value || "")
    .trim()
    .replace(/[\\/:*?"<>|#%&{}$!'@+`=]/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 80);
  return clean || fallback;
}

async function downloadDataUrl(url, filename) {
  return chrome.downloads.download({
    url,
    filename,
    saveAs: false,
    conflictAction: "overwrite"
  });
}

async function captureActiveTab(tab) {
  const screenshot = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" });
  const safeTitle = slugify(tab.title || "当前界面", "当前界面");
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const filename = `data/gallery/screenshots/current/${stamp}-${safeTitle}.png`;
  await downloadDataUrl(screenshot, filename);
  return {
    title: tab.title || "当前界面",
    url: tab.url || "",
    screenshotPath: filename.replace(/^data\/gallery\//, ""),
    screenshotFile: filename,
    previewDataUrl: screenshot,
    capturedAt: new Date().toISOString()
  };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "DOUYIN_GALLERY_CAPTURE_ACTIVE_TAB") {
    captureActiveTab(message.tab)
      .then((shot) => sendResponse({ ok: true, shot }))
      .catch((error) => sendResponse({ ok: false, error: error.message || String(error) }));
    return true;
  }

  if (message?.type === "DOUYIN_GALLERY_DOWNLOAD") {
    downloadDataUrl(message.url, message.filename)
      .then((downloadId) => sendResponse({ ok: true, downloadId }))
      .catch((error) => sendResponse({ ok: false, error: error.message || String(error) }));
    return true;
  }

  return false;
});
