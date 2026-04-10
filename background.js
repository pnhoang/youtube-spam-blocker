// Background service worker — manages badge and relays messages

chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg.type === "BADGE_UPDATE") {
    const count = msg.count;
    const text = count > 0 ? (count > 999 ? "999+" : String(count)) : "";
    chrome.action.setBadgeText({ text, tabId: sender.tab?.id });
    chrome.action.setBadgeBackgroundColor({ color: "#e53e3e" });
  }
});
