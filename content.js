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

  // Listen for config updates from popup
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === "CONFIG_UPDATE") {
      config = { ...config, ...msg.config };
      // Re-scan existing messages
      scanAll();
    }
    if (msg.type === "GET_STATS") {
      chrome.runtime.sendMessage({ type: "STATS", blockedCount, userMap: serializeUserMap() });
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

  // ─── DOM helpers ──────────────────────────────────────────────────────────
  function getAuthor(el) {
    const authorEl = el.querySelector("#author-name") || el.querySelector("yt-live-chat-author-chip");
    return authorEl ? authorEl.textContent.trim() : null;
  }

  function getMessage(el) {
    const msgEl = el.querySelector("#message") || el.querySelector(".yt-live-chat-text-message-renderer #message");
    return msgEl ? msgEl.textContent.trim() : null;
  }

  function hideMessage(el, reason) {
    el.setAttribute("data-spam-blocked", reason);
    el.style.cssText = "display:none!important";
    blockedCount++;
    updateBadge();
  }

  function unblockAll() {
    document.querySelectorAll("[data-spam-blocked]").forEach(el => {
      el.removeAttribute("data-spam-blocked");
      el.style.cssText = "";
    });
  }

  function updateBadge() {
    if (!config.showBadge) return;
    chrome.runtime.sendMessage({ type: "BADGE_UPDATE", count: blockedCount });
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
    document.querySelectorAll("yt-live-chat-text-message-renderer").forEach(processItem);
  }

  // ─── MutationObserver ─────────────────────────────────────────────────────
  function startObserver() {
    if (observer) observer.disconnect();

    const chatContainer = document.querySelector("#items.yt-live-chat-item-list-renderer");
    if (!chatContainer) {
      // Chat not loaded yet — retry
      setTimeout(startObserver, 2000);
      return;
    }

    observer = new MutationObserver((mutations) => {
      for (const mut of mutations) {
        for (const node of mut.addedNodes) {
          if (node.nodeType === 1) {
            if (node.matches("yt-live-chat-text-message-renderer")) {
              processItem(node);
            } else {
              node.querySelectorAll("yt-live-chat-text-message-renderer").forEach(processItem);
            }
          }
        }
      }
    });

    observer.observe(chatContainer, { childList: true, subtree: true });
    scanAll();
  }

  // ─── Watch for YouTube SPA navigation ────────────────────────────────────
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

  // ─── Init ─────────────────────────────────────────────────────────────────
  loadConfig();
})();
