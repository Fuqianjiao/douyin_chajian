async function captureActiveTab(tab) {
  const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" });
  return {
    title: tab.title || "当前界面",
    url: tab.url || "",
    screenshotDataUrl: dataUrl,
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

  return false;
});
