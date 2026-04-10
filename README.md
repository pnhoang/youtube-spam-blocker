# YT Live Spam Blocker 🛡

A Chrome extension that automatically detects and hides spam messages in YouTube Live chat.

<img width="884" height="847" alt="Screenshot 2026-04-11 at 00 09 32" src="https://github.com/user-attachments/assets/77030180-fbb5-4940-af9a-63ebeeb5a615" />


## Features

- **Rate Limiting** — Hides messages from users who post more than N times per minute (configurable 2–30)
- **Repeat Detection** — Flags users copy-pasting the same message over and over
- **Keyword Filters** — Block any message containing specific words or phrases
- **Manual Block List** — Permanently hide all messages from named users
- **Live Stats** — See blocked count and flagged users in the popup
- **Badge Counter** — Red badge on the extension icon shows total blocked messages
- **Non-destructive** — Messages are hidden, not deleted; reset at any time

## Installation (Developer Mode)

1. Open Chrome and go to `chrome://extensions/`
2. Enable **Developer mode** (toggle in top-right)
3. Click **Load unpacked**
4. Select the `yt-spam-blocker` folder
5. Navigate to any YouTube Live stream — the extension activates automatically

## How It Works

The content script (`content.js`) attaches a `MutationObserver` to the YouTube Live chat container and inspects every new message as it appears. For each message it:

1. Checks the author against your manual block list
2. Scans the text for banned keywords
3. Tracks the author's message rate (timestamps in a 60-second sliding window)
4. Tracks recent message similarity to catch copy-paste spam

If any check fails, the `<yt-live-chat-text-message-renderer>` element is hidden via `display: none`.

## Configuration

| Setting | Default | Description |
|---|---|---|
| Messages/min limit | 5 | Hide users exceeding this rate |
| Repeat threshold | 70% | Hide if N% of last 10 msgs are identical |
| Keywords | (none) | Comma-free, one per add |
| Blocked users | (none) | Exact username match (case-insensitive) |

All settings sync via `chrome.storage.sync` and persist across sessions.

## Files

```
yt-spam-blocker/
├── manifest.json       Chrome extension manifest (v3)
├── content.js          Injected into YouTube — spam detection logic
├── background.js       Service worker — manages badge
├── popup.html          Extension popup UI
├── popup.js            Popup controller
└── icons/
    ├── icon16.png
    ├── icon48.png
    └── icon128.png
```
