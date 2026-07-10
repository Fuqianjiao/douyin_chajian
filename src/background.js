async function blobToDataUrl(blob) {
  const buffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return `data:${blob.type || "image/png"};base64,${btoa(binary)}`;
}

async function cropDataUrl(dataUrl, crop) {
  if (!crop || !crop.width || !crop.height || !crop.viewportWidth || !crop.viewportHeight) return dataUrl;
  const sourceBlob = await (await fetch(dataUrl)).blob();
  const bitmap = await createImageBitmap(sourceBlob);
  const scaleX = bitmap.width / crop.viewportWidth;
  const scaleY = bitmap.height / crop.viewportHeight;
  const sx = Math.max(0, Math.floor(crop.x * scaleX));
  const sy = Math.max(0, Math.floor(crop.y * scaleY));
  const sw = Math.min(bitmap.width - sx, Math.floor(crop.width * scaleX));
  const sh = Math.min(bitmap.height - sy, Math.floor(crop.height * scaleY));
  if (sw <= 0 || sh <= 0) return dataUrl;
  const canvas = new OffscreenCanvas(sw, sh);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(bitmap, sx, sy, sw, sh, 0, 0, sw, sh);
  const croppedBlob = await canvas.convertToBlob({ type: "image/png" });
  return blobToDataUrl(croppedBlob);
}

async function captureActiveTab(tab, crop) {
  const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" });
  const screenshotDataUrl = await cropDataUrl(dataUrl, crop);
  return {
    title: tab.title || "当前界面",
    url: tab.url || "",
    screenshotDataUrl,
    capturedAt: new Date().toISOString(),
    crop: crop || null
  };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "DOUYIN_GALLERY_CAPTURE_ACTIVE_TAB") {
    captureActiveTab(message.tab, message.crop)
      .then((shot) => sendResponse({ ok: true, shot }))
      .catch((error) => sendResponse({ ok: false, error: error.message || String(error) }));
    return true;
  }

  return false;
});
