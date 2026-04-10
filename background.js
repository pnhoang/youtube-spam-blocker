// Background service worker — manages badge and per-tab stats (chat often runs in an iframe)

const tabSnapshots = new Map();

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "BADGE_UPDATE") {
    const tabId = sender.tab?.id;
    if (tabId != null) {
      tabSnapshots.set(tabId, {
        blockedCount: msg.count ?? 0,
        userMap: msg.userMap || {},
      });
    }
    const count = msg.count ?? 0;
    const show = msg.showBadge !== false;
    const text = show && count > 0 ? (count > 999 ? "999+" : String(count)) : "";
    if (tabId != null) {
      chrome.action.setBadgeText({ text, tabId });
      chrome.action.setBadgeBackgroundColor({ color: "#e53e3e" });
    }
  }

  if (msg.type === "POPUP_STATS") {
    const snap = tabSnapshots.get(msg.tabId);
    sendResponse({
      blockedCount: snap?.blockedCount ?? 0,
      userMap: snap?.userMap ?? {},
    });
    return true;
  }
});
