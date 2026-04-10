// YT Live Spam Blocker - Content Script
// Monitors YouTube Live chat and hides spam messages

(function () {
  "use strict";

  // ─── State ────────────────────────────────────────────────────────────────
  let config = {
    enabled: true,
    maxMessagesPerMinute: 5,
    maxRepeatRatio: 0.7,       // block if >70% of recent msgs are identical
    minMessageLength: 1,
    keywords: [],
    blockedUsers: [],
    showBadge: true,
  };

  // channelId → { timestamps: [], recentMessages: [], blocked: bool }
  const userMap = new Map();
  let blockedCount = 0;
  let observer = null;

  // ─── Load config from storage ─────────────────────────────────────────────
  function loadConfig() {
    chrome.storage.sync.get("spamConfig", (data) => {
      if (data.spamConfig) {
        config = { ...config, ...data.spamConfig };
      }
      startObserver();
    });
  }

  // Sync config from popup in every frame (sendMessage only hits the main frame by default)
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "sync" || !changes.spamConfig?.newValue) return;
    config = { ...config, ...changes.spamConfig.newValue };
    scanAll();
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || changes.spamResetNonce == null) return;
    blockedCount = 0;
    userMap.clear();
    unblockAll();
    updateBadge();
  });

  // Listen for config updates from popup
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === "CONFIG_UPDATE") {
      config = { ...config, ...msg.config };
      scanAll();
    }
    if (msg.type === "GET_STATS") {
      chrome.runtime.sendMessage({
        type: "STATS",
        blockedCount,
        userMap: serializeUserMap(),
      });
    }
    if (msg.type === "RESET_STATS") {
      blockedCount = 0;
      userMap.clear();
      unblockAll();
      updateBadge();
    }
  });

  function serializeUserMap() {
    const out = {};
    for (const [k, v] of userMap.entries()) {
      out[k] = { blocked: v.blocked, messageCount: v.timestamps.length };
    }
    return out;
  }

  // ─── Core spam detection ──────────────────────────────────────────────────
  function isSpam(authorName, messageText) {
    if (!config.enabled) return false;

    const now = Date.now();
    const windowMs = 60_000;

    // Manual block list
    if (config.blockedUsers.some(u => u.toLowerCase() === authorName.toLowerCase())) {
      return { spam: true, reason: "manually_blocked" };
    }

    // Keyword filter
    const lowerMsg = messageText.toLowerCase();
    for (const kw of config.keywords) {
      if (kw && lowerMsg.includes(kw.toLowerCase())) {
        return { spam: true, reason: "keyword" };
      }
    }

    // Rate & repeat tracking
    if (!userMap.has(authorName)) {
      userMap.set(authorName, { timestamps: [], recentMessages: [], blocked: false });
    }
    const user = userMap.get(authorName);

    if (user.blocked) return { spam: true, reason: "previously_blocked" };

    // Prune old timestamps
    user.timestamps = user.timestamps.filter(t => now - t < windowMs);
    user.timestamps.push(now);

    // Keep last 10 messages for repeat detection
    user.recentMessages.push(messageText);
    if (user.recentMessages.length > 10) user.recentMessages.shift();

    // Rate limit check
    if (user.timestamps.length > config.maxMessagesPerMinute) {
      user.blocked = true;
      return { spam: true, reason: "rate_limit" };
    }

    // Repeat message check
    if (user.recentMessages.length >= 3) {
      const freq = {};
      for (const m of user.recentMessages) freq[m] = (freq[m] || 0) + 1;
      const maxRepeat = Math.max(...Object.values(freq));
      if (maxRepeat / user.recentMessages.length >= config.maxRepeatRatio) {
        user.blocked = true;
        return { spam: true, reason: "repeat_message" };
      }
    }

    return { spam: false };
  }

  // ─── Shadow DOM: chat lives under closed trees; light-DOM querySelector misses ─
  function querySelectorDeep(root, selector) {
    if (!root) return null;
    function search(n) {
      if (!n) return null;
      if (n.nodeType === Node.DOCUMENT_FRAGMENT_NODE) {
        for (const c of n.children) {
          const r = search(c);
          if (r) return r;
        }
        return null;
      }
      if (n.nodeType !== Node.ELEMENT_NODE) return null;
      try {
        if (n.matches(selector)) return n;
      } catch (_) {}
      if (n.shadowRoot) {
        const r = search(n.shadowRoot);
        if (r) return r;
      }
      for (const c of n.children) {
        const r = search(c);
        if (r) return r;
      }
      return null;
    }
    return search(root);
  }

  function queryAllDeep(root, selector, out) {
    if (!root) return;
    if (root.nodeType === Node.DOCUMENT_FRAGMENT_NODE) {
      for (const c of root.children) queryAllDeep(c, selector, out);
      return;
    }
    if (root.nodeType !== Node.ELEMENT_NODE) return;
    try {
      if (root.matches(selector)) out.push(root);
    } catch (_) {}
    if (root.shadowRoot) queryAllDeep(root.shadowRoot, selector, out);
    for (const c of root.children) queryAllDeep(c, selector, out);
  }

  function findChatItemsContainer() {
    const fromDoc =
      querySelectorDeep(document.documentElement, "#items.yt-live-chat-item-list-renderer") ||
      querySelectorDeep(document.documentElement, "#items.style-scope.yt-live-chat-item-list-renderer");
    if (fromDoc) return fromDoc;
    const hosts = [];
    queryAllDeep(document.documentElement, "yt-live-chat-item-list-renderer", hosts);
    for (const host of hosts) {
      const items =
        querySelectorDeep(host, "#items.yt-live-chat-item-list-renderer") ||
        querySelectorDeep(host, "#items.style-scope.yt-live-chat-item-list-renderer") ||
        querySelectorDeep(host, "#items");
      if (items) return items;
    }
    return null;
  }

  // ─── DOM helpers ──────────────────────────────────────────────────────────
  function getAuthor(el) {
    const authorEl =
      querySelectorDeep(el, "#author-name") ||
      querySelectorDeep(el, "yt-live-chat-author-chip #author-name") ||
      querySelectorDeep(el, "yt-live-chat-author-chip");
    return authorEl ? authorEl.textContent.trim() : null;
  }

  function getMessage(el) {
    const msgEl =
      querySelectorDeep(el, "#message") ||
      querySelectorDeep(el, "yt-formatted-string#message") ||
      querySelectorDeep(el, "#content #message");
    return msgEl ? msgEl.textContent.trim() : null;
  }

  function hideMessage(el, reason) {
    el.setAttribute("data-spam-blocked", reason);
    el.style.cssText = "display:none!important";
    blockedCount++;
    updateBadge();
  }

  function unblockAll() {
    const blocked = [];
    queryAllDeep(document.documentElement, "[data-spam-blocked]", blocked);
    blocked.forEach((el) => {
      el.removeAttribute("data-spam-blocked");
      el.style.cssText = "";
    });
  }

  function updateBadge() {
    chrome.runtime.sendMessage({
      type: "BADGE_UPDATE",
      count: blockedCount,
      userMap: serializeUserMap(),
      showBadge: config.showBadge,
    });
  }

  // ─── Process a single chat item ───────────────────────────────────────────
  function processItem(el) {
    if (el.getAttribute("data-spam-blocked")) return;
    if (!el.matches("yt-live-chat-text-message-renderer")) return;

    const author = getAuthor(el);
    const message = getMessage(el);
    if (!author || message === null) return;

    const result = isSpam(author, message);
    if (result.spam) {
      hideMessage(el, result.reason);
    }
  }

  function scanAll() {
    const messages = [];
    queryAllDeep(document.documentElement, "yt-live-chat-text-message-renderer", messages);
    messages.forEach(processItem);
  }

  // ─── MutationObserver ─────────────────────────────────────────────────────
  function startObserver() {
    if (observer) observer.disconnect();

    const chatContainer = findChatItemsContainer();
    if (!chatContainer) {
      const delay = window.self === window.top ? 5000 : 2000;
      setTimeout(startObserver, delay);
      return;
    }

    observer = new MutationObserver((mutations) => {
      for (const mut of mutations) {
        for (const node of mut.addedNodes) {
          if (node.nodeType !== 1) continue;
          if (node.matches?.("yt-live-chat-text-message-renderer")) processItem(node);
          const nested = [];
          queryAllDeep(node, "yt-live-chat-text-message-renderer", nested);
          nested.forEach(processItem);
        }
      }
    });

    observer.observe(chatContainer, { childList: true, subtree: true });
    scanAll();
  }

  // ─── Watch for YouTube SPA navigation (top frame only; chat iframe URL is stable)
  if (window.self === window.top) {
    let lastUrl = location.href;
    new MutationObserver(() => {
      if (location.href !== lastUrl) {
        lastUrl = location.href;
        userMap.clear();
        blockedCount = 0;
        updateBadge();
        setTimeout(startObserver, 3000);
      }
    }).observe(document.body, { subtree: true, childList: true });
  }

  // ─── Init ─────────────────────────────────────────────────────────────────
  loadConfig();
})();
