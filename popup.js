// popup.js — YT Spam Blocker popup controller

(function () {
  // ── State ──────────────────────────────────────────────────────────────────
  let config = {
    enabled: true,
    maxMessagesPerMinute: 5,
    maxRepeatRatio: 0.7,
    keywords: [],
    blockedUsers: [],
    showBadge: true,
  };

  // ── DOM refs ───────────────────────────────────────────────────────────────
  const toggleEnabled  = document.getElementById("toggleEnabled");
  const rateSlider     = document.getElementById("rateLimit");
  const rateVal        = document.getElementById("rateVal");
  const repeatSlider   = document.getElementById("repeatRatio");
  const repeatVal      = document.getElementById("repeatVal");
  const kwInput        = document.getElementById("kwInput");
  const kwAdd          = document.getElementById("kwAdd");
  const kwTags         = document.getElementById("kwTags");
  const userInput      = document.getElementById("userInput");
  const userAdd        = document.getElementById("userAdd");
  const userTags       = document.getElementById("userTags");
  const btnReset       = document.getElementById("btnReset");
  const statBlocked    = document.getElementById("statBlocked");
  const statUsers      = document.getElementById("statUsers");
  const statRate       = document.getElementById("statRate");
  const statusDot      = document.getElementById("statusDot");
  const statusTxt      = document.getElementById("statusTxt");

  // ── Load config ────────────────────────────────────────────────────────────
  chrome.storage.sync.get("spamConfig", (data) => {
    if (data.spamConfig) config = { ...config, ...data.spamConfig };
    renderAll();
  });

  function renderAll() {
    toggleEnabled.checked  = config.enabled;
    rateSlider.value       = config.maxMessagesPerMinute;
    rateVal.textContent    = config.maxMessagesPerMinute;
    repeatSlider.value     = Math.round(config.maxRepeatRatio * 100);
    repeatVal.textContent  = Math.round(config.maxRepeatRatio * 100) + "%";
    statRate.textContent   = config.maxMessagesPerMinute + "/min";
    renderTags(kwTags, config.keywords, "kw");
    renderTags(userTags, config.blockedUsers, "user");
    updateStatus();
  }

  function updateStatus() {
    if (config.enabled) {
      statusDot.classList.remove("off");
      statusTxt.textContent = "monitoring chat";
    } else {
      statusDot.classList.add("off");
      statusTxt.textContent = "paused";
    }
  }

  // ── Save & push to content script ─────────────────────────────────────────
  function save() {
    chrome.storage.sync.set({ spamConfig: config });
    // Push to active tab
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]?.id) {
        chrome.tabs.sendMessage(tabs[0].id, { type: "CONFIG_UPDATE", config });
      }
    });
    updateStatus();
  }

  // ── Tag rendering ─────────────────────────────────────────────────────────
  function renderTags(container, list, type) {
    container.innerHTML = "";
    list.forEach((item, i) => {
      const tag = document.createElement("div");
      tag.className = "tag" + (type === "user" ? " blocked" : "");
      tag.innerHTML = `<span>${escHtml(item)}</span><span class="tag-del" data-i="${i}" data-type="${type}">×</span>`;
      container.appendChild(tag);
    });
  }

  function escHtml(s) {
    return s.replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]));
  }

  // ── Tag deletion via delegation ────────────────────────────────────────────
  document.addEventListener("click", (e) => {
    const del = e.target.closest(".tag-del");
    if (!del) return;
    const i = parseInt(del.dataset.i);
    const type = del.dataset.type;
    if (type === "kw") {
      config.keywords.splice(i, 1);
      renderTags(kwTags, config.keywords, "kw");
    } else {
      config.blockedUsers.splice(i, 1);
      renderTags(userTags, config.blockedUsers, "user");
    }
    save();
  });

  // ── Controls ───────────────────────────────────────────────────────────────
  toggleEnabled.addEventListener("change", () => {
    config.enabled = toggleEnabled.checked;
    save();
  });

  rateSlider.addEventListener("input", () => {
    const v = parseInt(rateSlider.value);
    rateVal.textContent = v;
    statRate.textContent = v + "/min";
    config.maxMessagesPerMinute = v;
    save();
  });

  repeatSlider.addEventListener("input", () => {
    const v = parseInt(repeatSlider.value);
    repeatVal.textContent = v + "%";
    config.maxRepeatRatio = v / 100;
    save();
  });

  // Keyword add
  function addKeyword() {
    const v = kwInput.value.trim();
    if (!v || config.keywords.includes(v)) { kwInput.value = ""; return; }
    config.keywords.push(v);
    kwInput.value = "";
    renderTags(kwTags, config.keywords, "kw");
    save();
  }
  kwAdd.addEventListener("click", addKeyword);
  kwInput.addEventListener("keydown", (e) => { if (e.key === "Enter") addKeyword(); });

  // User block add
  function addUser() {
    const v = userInput.value.trim();
    if (!v || config.blockedUsers.includes(v)) { userInput.value = ""; return; }
    config.blockedUsers.push(v);
    userInput.value = "";
    renderTags(userTags, config.blockedUsers, "user");
    save();
  }
  userAdd.addEventListener("click", addUser);
  userInput.addEventListener("keydown", (e) => { if (e.key === "Enter") addUser(); });

  // Reset stats
  btnReset.addEventListener("click", () => {
    statBlocked.textContent = "0";
    statUsers.textContent   = "0";
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]?.id) chrome.tabs.sendMessage(tabs[0].id, { type: "RESET_STATS" });
    });
  });

  // ── Poll stats from content script ────────────────────────────────────────
  function pollStats() {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (!tabs[0]?.id) return;
      chrome.tabs.sendMessage(tabs[0].id, { type: "GET_STATS" }, (resp) => {
        if (chrome.runtime.lastError || !resp) return;
        // stats are pushed via onMessage below
      });
    });
  }

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === "STATS") {
      statBlocked.textContent = msg.blockedCount || 0;
      const flagged = Object.values(msg.userMap || {}).filter(u => u.blocked).length;
      statUsers.textContent = flagged;
    }
  });

  // Poll every 2 seconds while popup is open
  setInterval(pollStats, 2000);
  pollStats();
})();
