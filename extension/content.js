(() => {
  if (window.__douyinLearningBoardInjected) return;
  window.__douyinLearningBoardInjected = true;

  function escapeHtml(value = "") {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function dialogScore(node) {
    const rect = node.getBoundingClientRect();
    const text = node.innerText || "";
    const viewportArea = window.innerWidth * window.innerHeight;
    const area = rect.width * rect.height;
    const hasFollowerTabs = /关注\s*\(\d+\)/.test(text) && /粉丝\s*\(\d+\)/.test(text);
    const hasSearch = text.includes("搜索用户名或抖音号") || text.includes("搜索用户名字或抖音号");
    const hasSort = text.includes("综合排序");
    const hasClose = text.includes("×") || Boolean(node.querySelector('svg, [aria-label*="关闭"], [class*="close"]'));
    const containsProfileChrome = text.includes("抖音号") || text.includes("IP属地") || text.includes("作品") && text.includes("推荐");
    const tooLarge = area > viewportArea * 0.75;
    const modalLikeSize = rect.width >= 620
      && rect.width <= window.innerWidth * 0.78
      && rect.height >= 480
      && rect.height <= window.innerHeight * 0.96;
    const centered = rect.left > window.innerWidth * 0.08
      && rect.right < window.innerWidth * 0.92
      && rect.top < window.innerHeight * 0.22;

    let score = 0;
    if (hasFollowerTabs) score += 80;
    if (hasSearch) score += 80;
    if (hasSort) score += 60;
    if (hasClose) score += 15;
    if (modalLikeSize) score += 30;
    if (centered) score += 20;
    if (containsProfileChrome) score -= 80;
    if (tooLarge) score -= 120;
    score -= Math.abs(area - viewportArea * 0.38) / viewportArea * 20;

    return {
      node,
      score,
      rect,
      textLength: text.length,
      flags: {
        hasFollowerTabs,
        hasSearch,
        hasSort,
        hasClose,
        containsProfileChrome,
        tooLarge,
        modalLikeSize,
        centered
      }
    };
  }

  function getDialogRoot() {
    const scored = Array.from(document.querySelectorAll('[role="dialog"], div, section'))
      .filter((node) => {
        if (!isVisible(node)) return false;
        const rect = node.getBoundingClientRect();
        const text = node.innerText || "";
        return rect.width > 420
          && rect.height > 360
          && text.includes("关注")
          && (text.includes("粉丝") || text.includes("综合排序") || text.includes("搜索"));
      })
      .map(dialogScore)
      .filter((item) => item.score > 40)
      .sort((a, b) => b.score - a.score);
    return scored[0]?.node || null;
  }

  function getDialogDebug(root) {
    const candidates = Array.from(document.querySelectorAll('[role="dialog"], div, section'))
      .filter((node) => {
        const rect = node.getBoundingClientRect();
        const text = node.innerText || "";
        return rect.width > 420
          && rect.height > 360
          && text.includes("关注")
          && (text.includes("粉丝") || text.includes("综合排序") || text.includes("搜索"));
      })
      .map(dialogScore)
      .sort((a, b) => b.score - a.score)
      .slice(0, 8)
      .map((item, index) => ({
        index,
        selected: item.node === root,
        score: Math.round(item.score),
        rect: {
          x: Math.round(item.rect.x),
          y: Math.round(item.rect.y),
          width: Math.round(item.rect.width),
          height: Math.round(item.rect.height)
        },
        textLength: item.textLength,
        flags: item.flags
      }));

    return {
      found: Boolean(root),
      selectedRect: root ? (() => {
        const rect = root.getBoundingClientRect();
        return {
          x: Math.round(rect.x),
          y: Math.round(rect.y),
          width: Math.round(rect.width),
          height: Math.round(rect.height)
        };
      })() : null,
      candidates
    };
  }

  function getScrollableCollectors(root) {
    if (!root) return [document, window];
    const nodes = Array.from((root || document).querySelectorAll("div, section, main"))
      .filter((node) => {
        if (!isVisible(node)) return false;
        const rect = node.getBoundingClientRect();
        return node.scrollHeight > node.clientHeight + 80
          && rect.height > 160
          && rect.width > 320;
      })
      .sort((a, b) => {
        const scoreA = (a.scrollHeight - a.clientHeight) + a.getBoundingClientRect().height;
        const scoreB = (b.scrollHeight - b.clientHeight) + b.getBoundingClientRect().height;
        return scoreB - scoreA;
      });

    return Array.from(new Set([
      ...nodes.slice(0, 8),
      document,
      window
    ]));
  }

  function isVisible(node) {
    if (!node || !(node instanceof Element)) return false;
    const rect = node.getBoundingClientRect();
    const style = getComputedStyle(node);
    return rect.width > 0
      && rect.height > 0
      && style.visibility !== "hidden"
      && style.display !== "none";
  }

  function normalizeLines(text) {
    return (text || "")
      .split(/\n+/)
      .map((line) => line.trim())
      .filter(Boolean)
      .filter((line) => !["已关注", "关注", "粉丝"].includes(line))
      .filter((line) => !["直播中", "店铺账号"].includes(line))
      .filter((line) => !/^搜索用户/.test(line))
      .filter((line) => !/^综合排序$/.test(line));
  }

  function getUserUrl(scope) {
    const anchor = scope.querySelector('a[href*="/user/"], a[href*="douyin.com/user/"]');
    if (anchor?.href) return anchor.href.split("?")[0];
    const userLink = Array.from(scope.querySelectorAll("a[href]"))
      .map((node) => node.href)
      .find((href) => href.includes("/user/"));
    return userLink ? userLink.split("?")[0] : "";
  }

  function avatarKey(src = "") {
    return src
      .replace(/^https?:\/\//, "")
      .split(/[?#]/)[0]
      .slice(-80);
  }

  function currentProfileUrl() {
    return location.href.split("?")[0].split("#")[0];
  }

  function pickProfileName(lines) {
    return lines.find((line) => {
      return line.length >= 2
        && line.length <= 40
        && !line.includes("关注")
        && !line.includes("粉丝")
        && !line.includes("获赞")
        && !line.startsWith("抖音号")
        && !line.startsWith("IP属地")
        && !/^\d/.test(line);
    }) || document.title.replace(/ - 抖音$/, "").trim() || "未命名账号";
  }

  function collectCurrentProfile() {
    const profileRoot = Array.from(document.querySelectorAll("main, section, div"))
      .filter((node) => {
        const rect = node.getBoundingClientRect();
        const text = node.innerText || "";
        return rect.width > 500
          && rect.height > 160
          && text.includes("抖音号")
          && (text.includes("关注") || text.includes("粉丝"));
      })
      .sort((a, b) => {
        const rectA = a.getBoundingClientRect();
        const rectB = b.getBoundingClientRect();
        return (rectB.width * rectB.height) - (rectA.width * rectA.height);
      })[0] || document.body;

    const lines = normalizeLines(profileRoot.innerText)
      .filter((line) => !["作品", "推荐", "喜欢", "合集", "短剧"].includes(line));
    const name = pickProfileName(lines);
    const douyinId = (profileRoot.innerText.match(/抖音号[:：]\s*([^\s\n]+)/) || [])[1] || "";
    const bio = lines.find((line) => {
      return line !== name
        && !line.includes("关注")
        && !line.includes("粉丝")
        && !line.includes("获赞")
        && !line.startsWith("抖音号")
        && !line.startsWith("IP属地")
        && line.length >= 4;
    }) || "";
    const avatar = Array.from(profileRoot.querySelectorAll("img"))
      .filter((image) => isVisible(image))
      .sort((a, b) => {
        const rectA = a.getBoundingClientRect();
        const rectB = b.getBoundingClientRect();
        return (rectB.width * rectB.height) - (rectA.width * rectA.height);
      })[0]?.src || "";
    const url = currentProfileUrl();

    return {
      id: douyinId || url.split("/user/")[1]?.split(/[/?#]/)[0] || `${name}|${avatarKey(avatar)}`,
      name,
      bio,
      worksHint: "",
      url,
      avatar,
      douyinId,
      rawText: lines.join(" | ")
    };
  }

  function findAccountRowFromImage(image, root) {
    let node = image;
    for (let depth = 0; depth < 8 && node && node !== root; depth += 1) {
      node = node.parentElement;
      if (!node || !isVisible(node)) continue;

      const rect = node.getBoundingClientRect();
      const lines = normalizeLines(node.innerText);
      const hasAccountText = lines.length >= 2
        && lines.some((line) => /\d+个作品/.test(line) || line.includes("@") || line.length >= 2);
      const rowLike = rect.width >= 280
        && rect.height >= 52
        && rect.height <= 190
        && hasAccountText;

      if (rowLike) return node;
    }
    return null;
  }

  function climbToAccountRow(node, root) {
    let current = node;
    for (let depth = 0; depth < 10 && current && current !== root; depth += 1) {
      const text = current.innerText || "";
      const hasAvatar = current.querySelector?.("img");
      const hasFollowButton = text.includes("已关注") || text.includes("关注");
      const lines = normalizeLines(text);
      if (hasAvatar && hasFollowButton && lines.length >= 2) {
        return current;
      }
      current = current.parentElement;
    }
    return null;
  }

  function isFollowButton(node) {
    return node?.tagName === "BUTTON" && (node.innerText || "").includes("已关注");
  }

  function findAccountRowFromButton(button, root) {
    const buttonRect = button.getBoundingClientRect();
    const candidates = [];
    let current = button;

    for (let depth = 0; depth < 12 && current && current !== root; depth += 1) {
      current = current.parentElement;
      if (!current || !isVisible(current)) continue;

      const rect = current.getBoundingClientRect();
      const text = current.innerText || "";
      const lines = normalizeLines(text);
      const hasAvatar = Array.from(current.querySelectorAll("img"))
        .some((image) => isVisible(image) && image.getBoundingClientRect().width >= 28);
      const followButtonCount = Array.from(current.querySelectorAll("button"))
        .filter(isFollowButton).length;
      const rowLike = rect.width >= 360
        && rect.height >= 56
        && rect.height <= 230
        && rect.left < buttonRect.left
        && rect.right >= buttonRect.right
        && hasAvatar
        && followButtonCount >= 1
        && lines.length >= 2;

      if (rowLike) {
        candidates.push({
          node: current,
          score: rect.height + Math.max(0, followButtonCount - 1) * 120 + Math.max(0, lines.length - 5) * 8
        });
      }
    }

    return candidates.sort((a, b) => a.score - b.score)[0]?.node || climbToAccountRow(button, root);
  }

  function extractUserFromRow(row) {
    const lines = normalizeLines(row.innerText);
    if (!lines.length) return null;

    const userAnchors = Array.from(row.querySelectorAll('a[href*="/user/"]'));
    const nameFromLink = userAnchors
      .map((anchor) => normalizeLines(anchor.innerText).join(""))
      .find((text) => text && text.length <= 80);
    const worksHint = lines.find((line) => /\d+\+?个作品/.test(line)) || "";
    const name = nameFromLink || lines.find((line) => {
      return line !== worksHint
        && !/^\d+\+?个作品/.test(line)
        && !line.includes("喜欢的达人")
        && !line.includes("理想型")
        && !line.includes("好好吃饭")
        && !line.includes("好好睡觉")
        && line.length <= 60;
    }) || lines[0];
    if (!name || name.length > 80) return null;

    const avatar = row.querySelector("img")?.src || "";
    const url = getUserUrl(row);
    const bio = lines.find((line) => {
      return line !== name
        && line !== worksHint
        && !/^\d+\+?个作品/.test(line)
        && line !== "已关注";
    }) || "";

    return {
      id: url ? url.split("/user/")[1]?.split(/[/?#]/)[0] || url : `${name}|${avatarKey(avatar)}`,
      name,
      bio,
      worksHint,
      url,
      avatar,
      rawText: lines.join(" | ")
    };
  }

  function collectByKnownRows(root) {
    const rows = new Set(Array.from(root.querySelectorAll(".TtfqvVUt")));
    const followButtons = Array.from(root.querySelectorAll("button")).filter(isFollowButton);

    for (const button of followButtons) {
      const row = findAccountRowFromButton(button, root);
      if (row) rows.add(row);
    }

    for (const anchor of Array.from(root.querySelectorAll('a[href*="/user/"]'))) {
      const row = climbToAccountRow(anchor, root);
      if (row) rows.add(row);
    }

    const users = [];
    const seen = new Set();
    for (const row of rows) {
      const user = extractUserFromRow(row);
      if (!user) continue;
      const key = user.url || user.id;
      if (seen.has(key)) continue;
      seen.add(key);
      users.push(user);
    }

    return {
      users,
      diagnostics: {
        knownRowCount: rows.size,
        followButtonCount: followButtons.length
      }
    };
  }

  function getRowDebugSnapshot(root) {
    const knownRows = new Set(Array.from(root.querySelectorAll(".TtfqvVUt")));
    const followButtons = Array.from(root.querySelectorAll("button")).filter(isFollowButton);
    for (const button of followButtons) {
      const row = findAccountRowFromButton(button, root);
      if (row) knownRows.add(row);
    }

    return Array.from(knownRows).slice(0, 80).map((row, index) => {
      const rect = row.getBoundingClientRect();
      const user = extractUserFromRow(row);
      const lines = normalizeLines(row.innerText);
      return {
        index,
        visible: isVisible(row),
        rect: {
          x: Math.round(rect.x),
          y: Math.round(rect.y),
          width: Math.round(rect.width),
          height: Math.round(rect.height)
        },
        lineCount: lines.length,
        lines,
        hasAvatar: Boolean(row.querySelector("img")),
        linkCount: row.querySelectorAll('a[href*="/user/"]').length,
        buttonText: Array.from(row.querySelectorAll("button")).map((button) => button.innerText.trim()).filter(Boolean),
        parsedUser: user
      };
    });
  }

  function collectByRows(root) {
    const rows = new Set();
    const images = Array.from(root.querySelectorAll("img"))
      .filter((image) => isVisible(image) && image.getBoundingClientRect().width >= 28);

    for (const image of images) {
      const row = findAccountRowFromImage(image, root);
      if (row) rows.add(row);
    }

    const users = [];
    const seen = new Set();
    for (const row of rows) {
      const lines = normalizeLines(row.innerText);
      if (!lines.length) continue;

      const name = lines.find((line) => {
        return !/^\d+个作品/.test(line)
          && !line.includes("喜欢的达人")
          && !line.includes("理想型")
          && line.length <= 40;
      }) || lines[0];
      if (!name || name.length > 80) continue;

      const avatar = row.querySelector("img")?.src || "";
      const url = getUserUrl(row);
      const key = url || `${name}|${avatarKey(avatar)}`;
      if (seen.has(key)) continue;

      const worksHint = lines.find((line) => /\d+个作品/.test(line)) || "";
      const bio = lines.find((line) => line !== name && line !== worksHint && !/^\d+个作品/.test(line)) || "";
      seen.add(key);
      users.push({
        id: url ? url.split("/user/")[1]?.split(/[/?#]/)[0] || url : key,
        name,
        bio,
        worksHint,
        url,
        avatar,
        rawText: lines.join(" | ")
      });
    }

    return {
      users,
      diagnostics: {
        imageCount: images.length,
        rowCount: rows.size
      }
    };
  }

  function collectVisibleUsers() {
    const root = getDialogRoot();
    const dialogDebug = getDialogDebug(root);
    if (!root) {
      return {
        users: [],
        debugRows: [],
        diagnostics: {
          dialog: dialogDebug,
          anchorCount: 0,
          rootTextLength: 0,
          debugRowCount: 0
        }
      };
    }
    const anchors = Array.from(root.querySelectorAll('a[href*="/user/"]'));
    const users = [];
    const seen = new Set();

    const knownRowResult = collectByKnownRows(root);
    for (const user of knownRowResult.users) {
      const key = user.url || user.id;
      if (seen.has(key)) continue;
      seen.add(key);
      users.push(user);
    }

    const rowResult = collectByRows(root);
    for (const user of rowResult.users) {
      const key = user.url || user.id;
      if (seen.has(key)) continue;
      seen.add(key);
      users.push(user);
    }

    const debugRows = getRowDebugSnapshot(root);
    return {
      users,
      debugRows,
      diagnostics: {
        dialog: dialogDebug,
        ...knownRowResult.diagnostics,
        ...rowResult.diagnostics,
        anchorCount: anchors.length,
        rootTextLength: (root.innerText || "").length,
        debugRowCount: debugRows.length
      }
    };
  }

  function mergeUsers(existingUsers, incomingUsers) {
    const byKey = new Map((existingUsers || []).map((user) => {
      const key = user.url || user.id || `${user.name}|${user.avatar || ""}`;
      return [key, user];
    }));
    for (const user of incomingUsers || []) {
      const key = user.url || user.id || `${user.name}|${user.avatar || ""}`;
      byKey.set(key, {
        ...byKey.get(key),
        ...user,
        collectedAt: user.collectedAt || new Date().toISOString()
      });
    }
    return Array.from(byKey.values());
  }

  function isSelfUser(user, selfProfile) {
    if (!selfProfile?.name || !user?.name) return false;
    const sameName = user.name === selfProfile.name;
    const sameUrl = user.url && selfProfile.url && user.url === selfProfile.url;
    const noUserUrl = !user.url;
    return sameName && (sameUrl || noUserUrl);
  }

  async function persistVisibleUsers(reason = "manual") {
    const result = collectVisibleUsers();
    const selfProfile = collectCurrentProfile();
    result.users = result.users.filter((user) => !isSelfUser(user, selfProfile));
    const previousMeta = window.__douyinLearningBoardAutoMeta || {};
    window.__douyinLearningBoardAutoMeta = {
      ...previousMeta,
      lastTickAt: new Date().toISOString(),
      lastReason: reason,
      lastVisibleCount: result.users.length,
      lastDiagnostics: result.diagnostics
    };
    if (!result.users.length) return result;

    const { douyinUsers = [] } = await chrome.storage.local.get("douyinUsers");
    const merged = mergeUsers(douyinUsers, result.users);
    const addedCount = Math.max(0, merged.length - douyinUsers.length);
    window.__douyinLearningBoardAutoMeta = {
      ...window.__douyinLearningBoardAutoMeta,
      totalCount: merged.length,
      addedCount
    };
    await chrome.storage.local.set({
      douyinUsers: merged,
      douyinLastCollect: {
        at: new Date().toISOString(),
        reason,
        visibleCount: result.users.length,
        totalCount: merged.length,
        addedCount,
        diagnostics: result.diagnostics
      },
      douyinLastDebug: {
        at: new Date().toISOString(),
        reason,
        visibleUsers: result.users,
        debugRows: result.debugRows || [],
        diagnostics: result.diagnostics,
        totalCount: merged.length,
        addedCount
      }
    });
    return {
      ...result,
      totalCount: merged.length
    };
  }

  function startAutoCollect() {
    if (window.__douyinLearningBoardAutoCollect) {
      return persistVisibleUsers("already-running");
    }

    window.__douyinLearningBoardAutoCollect = true;
    window.__douyinLearningBoardAutoMeta = {
      startedAt: new Date().toISOString(),
      totalCount: 0,
      addedCount: 0
    };
    let timer = 0;
    const cleanupFns = [];
    const schedule = (reason = "event") => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        persistVisibleUsers(reason).catch(() => {});
      }, 120);
    };

    const attachScrollListeners = () => {
      const root = getDialogRoot();
      const targets = getScrollableCollectors(root);
      for (const target of targets) {
        const handler = () => schedule("scroll");
        target.addEventListener("scroll", handler, { capture: true, passive: true });
        cleanupFns.push(() => target.removeEventListener("scroll", handler, { capture: true }));
      }
      window.__douyinLearningBoardAutoMeta = {
        ...window.__douyinLearningBoardAutoMeta,
        scrollTargetCount: targets.length
      };
    };

    attachScrollListeners();
    const observer = new MutationObserver(() => schedule("mutation"));
    observer.observe(document.body, { childList: true, subtree: true });
    const interval = setInterval(() => {
      persistVisibleUsers("interval").catch(() => {});
    }, 700);
    const relinkInterval = setInterval(() => {
      for (const cleanup of cleanupFns.splice(0)) cleanup();
      attachScrollListeners();
      schedule("relink-scroll-targets");
    }, 5000);
    window.__douyinLearningBoardStopAutoCollect = () => {
      for (const cleanup of cleanupFns.splice(0)) cleanup();
      observer.disconnect();
      clearTimeout(timer);
      clearInterval(interval);
      clearInterval(relinkInterval);
      window.__douyinLearningBoardAutoCollect = false;
    };

    schedule("start");
    return persistVisibleUsers("start");
  }

  function capturePhaseText(phase = "") {
    return {
      queued: "排队中",
      opening: "等待页面加载完全",
      rendering: "等待页面加载完全",
      capturing: "正在缓存当前可见主页截图...",
      saved: "保存完成",
      closing: "关闭主页",
      "item-error": "单个失败",
      paused: "已中途停止",
      stopping: "正在停止",
      idle: "空闲",
      error: "出错"
    }[phase] || "处理中";
  }

  function captureToastTitle(state = {}) {
    if (state?.phase === "saved") {
      return `缓存【${state.currentName || state.currentUrl || "-"}】主页成功`;
    }
    return capturePhaseText(state?.phase);
  }

  function ensureCaptureToastStyle() {
    if (document.querySelector("#douyin-learning-capture-toast-style")) return;
    const style = document.createElement("style");
    style.id = "douyin-learning-capture-toast-style";
    style.textContent = `
      #douyin-learning-capture-toast {
        position: fixed;
        right: 24px;
        bottom: 24px;
        z-index: 2147483647;
        width: min(360px, calc(100vw - 32px));
        box-sizing: border-box;
        border: 1px solid rgba(255,255,255,.16);
        border-radius: 10px;
        background: rgba(24,26,32,.96);
        box-shadow: 0 18px 48px rgba(0,0,0,.38);
        padding: 14px 16px;
        color: #f5f5f4;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
      }
      #douyin-learning-capture-toast strong {
        display: block;
        font-size: 15px;
        line-height: 1.35;
      }
      #douyin-learning-capture-toast span {
        display: block;
        margin-top: 4px;
        color: #a8a29e;
        font-size: 13px;
        line-height: 1.45;
      }
      #douyin-learning-capture-toast .dlb-bar {
        height: 4px;
        margin-top: 10px;
        border-radius: 999px;
        background: rgba(255,255,255,.12);
        overflow: hidden;
      }
      #douyin-learning-capture-toast .dlb-bar i {
        display: block;
        height: 100%;
        width: var(--dlb-progress, 0%);
        background: #ff2f63;
      }
      #douyin-learning-capture-toast .dlb-actions {
        display: flex;
        gap: 8px;
        margin-top: 12px;
      }
      #douyin-learning-capture-toast button {
        flex: 1;
        height: 38px;
        border: 1px solid rgba(255,255,255,.14);
        border-radius: 8px;
        background: #181a20;
        color: #f5f5f4;
        font: inherit;
        font-size: 13px;
        cursor: pointer;
      }
      #douyin-learning-capture-toast button:first-child {
        border-color: transparent;
        background: #ff2f63;
        color: white;
        font-weight: 700;
      }
    `;
    document.documentElement.appendChild(style);
  }

  function getCaptureToast() {
    ensureCaptureToastStyle();
    let toast = document.querySelector("#douyin-learning-capture-toast");
    if (!toast) {
      toast = document.createElement("div");
      toast.id = "douyin-learning-capture-toast";
      toast.addEventListener("click", (event) => {
        if (event.target.closest("[data-dlb-capture-toggle]")) {
          chrome.runtime.sendMessage({ type: "DOUYIN_AUTO_CAPTURE_STOP" });
          return;
        }
        if (event.target.closest("[data-dlb-capture-end]")) {
          toast.remove();
          chrome.runtime.sendMessage({ type: "DOUYIN_AUTO_CAPTURE_END" });
        }
      });
      document.documentElement.appendChild(toast);
    }
    return toast;
  }

  function renderCaptureToast(state = null) {
    const active = Boolean(state?.running || state?.paused);
    if (!active || state?.stopped || state?.phase === "stopping") {
      document.querySelector("#douyin-learning-capture-toast")?.remove();
      return;
    }
    const total = Number(state.total || 0);
    const done = Number(state.done || 0);
    const progress = total ? Math.round(done / total * 100) : 0;
    const current = state.currentName || state.currentUrl || "-";
    const toast = getCaptureToast();
    toast.style.setProperty("--dlb-progress", `${progress}%`);
    toast.innerHTML = `
      <strong>${captureToastTitle(state)} ${total ? `${done}/${total}` : ""}</strong>
      <span>${escapeHtml(state.message || "")}</span>
      <span>当前：${escapeHtml(current)}</span>
      <div class="dlb-bar"><i></i></div>
      <div class="dlb-actions">
        <button data-dlb-capture-toggle type="button">${state.paused ? "继续运行" : "中途停止"}</button>
        <button data-dlb-capture-end type="button">结束运行</button>
      </div>
    `;
  }

  function startCaptureToastMonitor() {
    chrome.storage.local.get("douyinAutoCapture").then(({ douyinAutoCapture = null }) => {
      renderCaptureToast(douyinAutoCapture);
    }).catch(() => {});
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName === "local" && changes.douyinAutoCapture) {
        renderCaptureToast(changes.douyinAutoCapture.newValue);
      }
    });
  }

  startCaptureToastMonitor();

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === "DOUYIN_AUTO_CAPTURE_STATE") {
      renderCaptureToast(message.state || null);
      return;
    }
    if (message?.type === "DOUYIN_COLLECT_VISIBLE_USERS_V2") {
      persistVisibleUsers().then(sendResponse);
      return true;
    }
    if (message?.type === "DOUYIN_START_AUTO_COLLECT_V3") {
      startAutoCollect().then((result) => {
        sendResponse({
          ...result,
          autoCollect: true,
          autoMeta: window.__douyinLearningBoardAutoMeta || {}
        });
      });
      return true;
    }
    if (message?.type === "DOUYIN_GET_AUTO_COLLECT_STATUS_V1") {
      sendResponse({
        autoCollect: Boolean(window.__douyinLearningBoardAutoCollect),
        autoMeta: window.__douyinLearningBoardAutoMeta || {}
      });
      return true;
    }
    if (message?.type === "DOUYIN_DEBUG_SNAPSHOT_V1") {
      persistVisibleUsers("debug-snapshot").then((result) => {
        sendResponse({
          ok: true,
          ...result,
          autoCollect: Boolean(window.__douyinLearningBoardAutoCollect),
          autoMeta: window.__douyinLearningBoardAutoMeta || {}
        });
      }).catch((error) => {
        sendResponse({ ok: false, error: error?.message || String(error) });
      });
      return true;
    }
    if (message?.type === "DOUYIN_GET_PROFILE_V1") {
      sendResponse({ user: collectCurrentProfile() });
      return true;
    }
    return false;
  });
})();
