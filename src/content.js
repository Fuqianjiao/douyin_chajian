(() => {
  if (globalThis.__DOUYIN_GALLERY_CONTENT_READY__) return;
  globalThis.__DOUYIN_GALLERY_CONTENT_READY__ = true;

  const USER_URL_PATTERNS = [
    /https:\/\/www\.douyin\.com\/user\/[^/?#\s"]+/i,
    /\/user\/[^/?#\s"]+/i
  ];

  function normalizeText(value) {
    return (value || "").replace(/\s+/g, " ").trim();
  }

  function absoluteUrl(url) {
    try {
      return new URL(url, location.href).href;
    } catch {
      return "";
    }
  }

  function isVisible(element) {
    if (!element) return false;
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return rect.width > 20 && rect.height > 20 && style.visibility !== "hidden" && style.display !== "none";
  }

  function nearestAccountBlock(anchor) {
    let current = anchor;
    for (let i = 0; i < 7 && current; i += 1) {
      const rect = current.getBoundingClientRect();
      if (rect.width >= 180 && rect.height >= 48) return current;
      current = current.parentElement;
    }
    return anchor;
  }

  function pickAvatar(block) {
    const images = [...block.querySelectorAll("img")].filter(isVisible);
    const scored = images
      .map((img) => {
        const rect = img.getBoundingClientRect();
        const src = img.currentSrc || img.src || "";
        const score = Math.min(rect.width, rect.height) + (/(avatar|aweme|douyin|pstatp)/i.test(src) ? 20 : 0);
        return { src, score };
      })
      .filter((item) => item.src);
    scored.sort((a, b) => b.score - a.score);
    return scored[0]?.src || "";
  }

  function textCandidates(block) {
    const nodes = [...block.querySelectorAll("span, div, p, h1, h2, h3, strong")].filter(isVisible);
    return nodes
      .map((node) => normalizeText(node.innerText || node.textContent))
      .filter((text) => text && text.length <= 120)
      .filter((text, index, arr) => arr.indexOf(text) === index);
  }

  function extractDouyinId(texts) {
    const joined = texts.join(" ");
    const explicit = joined.match(/(?:抖音号|Douyin ID|ID)[:：\s]*([A-Za-z0-9_.-]{3,32})/i);
    if (explicit) return explicit[1];
    const candidate = texts.find((text) => /^[A-Za-z0-9_.-]{5,32}$/.test(text));
    return candidate || "";
  }

  function pickNickname(anchor, texts) {
    const title = normalizeText(anchor.getAttribute("title") || anchor.getAttribute("aria-label"));
    if (title && !title.includes("关注") && title.length <= 40) return title;
    return texts.find((text) => {
      if (text.includes("粉丝") || text.includes("获赞") || text.includes("关注")) return false;
      if (/抖音号|Douyin ID/i.test(text)) return false;
      return text.length > 0 && text.length <= 32;
    }) || "未命名账号";
  }

  function pickBio(texts, nickname, douyinId) {
    return texts.find((text) => {
      if (text === nickname || text === douyinId) return false;
      if (/抖音号|粉丝|关注|获赞|私信|作品/i.test(text)) return false;
      return text.length >= 4 && text.length <= 80;
    }) || "";
  }

  function looksLikeUserAnchor(anchor) {
    const href = anchor.getAttribute("href") || "";
    return USER_URL_PATTERNS.some((pattern) => pattern.test(href)) && isVisible(anchor);
  }

  function collectVisibleAccounts() {
    const anchors = [...document.querySelectorAll("a[href]")].filter(looksLikeUserAnchor);
    const seen = new Map();

    for (const anchor of anchors) {
      const homeUrl = absoluteUrl(anchor.getAttribute("href"));
      if (!homeUrl || seen.has(homeUrl)) continue;

      const block = nearestAccountBlock(anchor);
      const texts = textCandidates(block);
      const nickname = pickNickname(anchor, texts);
      const douyinId = extractDouyinId(texts);
      const bio = pickBio(texts, nickname, douyinId);
      const avatar = pickAvatar(block);

      seen.set(homeUrl, {
        id: crypto.randomUUID(),
        nickname,
        bio,
        avatar,
        homeUrl,
        douyinId,
        rawTexts: texts,
        collectedAt: new Date().toISOString()
      });
    }

    return [...seen.values()];
  }

  function wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function scrollMetrics(scroller) {
    if (scroller === document.scrollingElement || scroller === document.documentElement || scroller === document.body) {
      return {
        top: window.scrollY || document.documentElement.scrollTop || 0,
        height: window.innerHeight,
        scrollHeight: Math.max(document.documentElement.scrollHeight, document.body.scrollHeight)
      };
    }
    return {
      top: scroller.scrollTop,
      height: scroller.clientHeight,
      scrollHeight: scroller.scrollHeight
    };
  }

  function scrollByPage(scroller) {
    const metrics = scrollMetrics(scroller);
    const distance = Math.max(220, Math.floor(metrics.height * 0.82));
    if (scroller === document.scrollingElement || scroller === document.documentElement || scroller === document.body) {
      window.scrollBy({ top: distance, behavior: "smooth" });
    } else {
      scroller.scrollBy({ top: distance, behavior: "smooth" });
    }
  }

  function isAtBottom(scroller) {
    const metrics = scrollMetrics(scroller);
    return metrics.top + metrics.height >= metrics.scrollHeight - 12;
  }

  function visibleScrollableElements() {
    const nodes = [document.scrollingElement, ...document.querySelectorAll("div, section, main, aside")].filter(Boolean);
    return nodes.filter((node) => {
      if (node !== document.scrollingElement && !isVisible(node)) return false;
      const metrics = scrollMetrics(node);
      return metrics.scrollHeight > metrics.height + 80 && metrics.height > 160;
    });
  }

  function scoreScroller(element) {
    if (element === document.scrollingElement) return 1;
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    const text = normalizeText(element.innerText || "").slice(0, 500);
    let score = rect.width * rect.height;

    if (/关注/.test(text)) score += 500000;
    if (/粉丝/.test(text)) score += 160000;
    if (/搜索用户|搜索.*抖音号|已关注/.test(text)) score += 140000;
    if (style.position === "fixed" || style.position === "absolute") score += 90000;
    if (rect.width < window.innerWidth * 0.88 && rect.height < window.innerHeight * 0.95) score += 70000;
    if (rect.top > 20 && rect.left > 20) score += 30000;

    return score;
  }

  function findBestScroller() {
    const candidates = visibleScrollableElements();
    candidates.sort((a, b) => scoreScroller(b) - scoreScroller(a));
    return candidates[0] || document.scrollingElement;
  }

  function broadcastProgress(payload) {
    chrome.runtime.sendMessage({
      type: "DOUYIN_GALLERY_SCROLL_PROGRESS",
      ...payload
    }).catch(() => {});
  }

  async function collectWaterfallAccounts(options = {}) {
    const maxRounds = Number(options.maxRounds || 120);
    const settleMs = Number(options.settleMs || 850);
    const idleLimit = Number(options.idleLimit || 5);
    const seen = new Map();
    let idleRounds = 0;
    let stopReason = "达到最大滚动次数";
    const scroller = findBestScroller();

    for (let round = 0; round < maxRounds; round += 1) {
      const before = scrollMetrics(scroller);
      const visibleAccounts = collectVisibleAccounts();
      let added = 0;

      for (const account of visibleAccounts) {
        if (!seen.has(account.homeUrl)) {
          seen.set(account.homeUrl, account);
          added += 1;
        }
      }

      idleRounds = added > 0 ? 0 : idleRounds + 1;
      broadcastProgress({
        round: round + 1,
        total: seen.size,
        added,
        atBottom: isAtBottom(scroller)
      });

      if (isAtBottom(scroller) && idleRounds >= 2) {
        stopReason = "已滚动到底";
        break;
      }

      if (idleRounds >= idleLimit) {
        stopReason = "连续多次没有发现新账号";
        break;
      }

      scrollByPage(scroller);
      await wait(settleMs);

      const after = scrollMetrics(scroller);
      if (Math.abs(after.top - before.top) < 2 && added === 0) {
        idleRounds += 1;
      }
    }

    return {
      accounts: [...seen.values()],
      stopReason,
      scrollTop: scrollMetrics(scroller).top,
      scrollHeight: scrollMetrics(scroller).scrollHeight
    };
  }

  globalThis.__DOUYIN_GALLERY_COLLECT_VISIBLE__ = collectVisibleAccounts;
  globalThis.__DOUYIN_GALLERY_RUN_WATERFALL__ = collectWaterfallAccounts;

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === "DOUYIN_GALLERY_COLLECT_WATERFALL") {
      collectWaterfallAccounts(message.options || {})
        .then((result) => sendResponse({
          ok: true,
          url: location.href,
          title: document.title,
          ...result
        }))
        .catch((error) => sendResponse({ ok: false, error: error.message || String(error) }));
      return true;
    }

    if (message?.type !== "DOUYIN_GALLERY_COLLECT_VISIBLE") return false;
    try {
      sendResponse({
        ok: true,
        url: location.href,
        title: document.title,
        accounts: collectVisibleAccounts()
      });
    } catch (error) {
      sendResponse({ ok: false, error: error.message || String(error) });
    }
    return true;
  });
})();
