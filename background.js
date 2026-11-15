/**
 * BLOKZ — Tab & App Locker (v1.4.0)
 * Background Service Worker (Manifest V3)
 * Handles synced configuration, SHA-256 4-digit PIN verification,
 * "What is your cat's name?" (max 10 chars) anti-uninstall security question,
 * popup PIN gate, and continuous Brave/Chrome extension manager guard.
 */

const DEFAULT_SETTINGS = {
  pinHash: null, // SHA-256 hash of 4-digit PIN
  catNameHash: null, // SHA-256 hash of "What is your cat's name?" (max 10 chars)
  pinSalt: "BLOKZ_V1_SALT",
  enabled: true,
  lockedDomains: [
    "photos.google.com",
    "web.whatsapp.com",
    "drive.google.com"
  ],
  autoRelockOnTabSwitch: true,
  autoRelockMinutes: 5,
  hideTabTitleAndFavicon: true,
  failedAttempts: 0,
  lockoutUntil: 0
};

const tabSessionState = new Map();
let extensionManagerUnlockedUntil = 0;

async function hashSecret(value, salt) {
  const encoder = new TextEncoder();
  const data = encoder.encode(`${salt}:${value}`);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

function normalizeCatName(input) {
  return String(input || "").trim().toLowerCase();
}

async function getSettings() {
  try {
    const data = await chrome.storage.sync.get(DEFAULT_SETTINGS);
    return { ...DEFAULT_SETTINGS, ...data };
  } catch {
    const data = await chrome.storage.local.get(DEFAULT_SETTINGS);
    return { ...DEFAULT_SETTINGS, ...data };
  }
}

async function saveSettings(partial) {
  try {
    await chrome.storage.sync.set(partial);
  } catch {
    // Fallback to local
  }
  await chrome.storage.local.set(partial);
}

/**
 * Detect any browser extension management URL (Brave, Chrome, Edge, Opera, Vivaldi)
 */
function isExtensionManagerUrl(urlStr) {
  if (!urlStr) return false;
  const lower = urlStr.toLowerCase();
  return (
    lower.startsWith("chrome://extensions") ||
    lower.startsWith("brave://extensions") ||
    lower.startsWith("edge://extensions") ||
    lower.startsWith("opera://extensions") ||
    lower.startsWith("vivaldi://extensions") ||
    lower.startsWith("chrome://settings/extensions") ||
    lower.startsWith("brave://settings/extensions")
  );
}

/**
 * Redirect any unauthorized attempt to open brave://extensions or chrome://extensions
 * to guard.html ("What is your cat's name?")
 */
async function enforceExtensionManagerGuard(tabId, urlStr) {
  if (!isExtensionManagerUrl(urlStr)) return false;
  const settings = await getSettings();
  // Guard whenever PIN is set OR Cat Name is set
  if (!settings.pinHash && !settings.catNameHash) return false;

  if (Date.now() < extensionManagerUnlockedUntil) {
    return false;
  }

  const guardUrl = chrome.runtime.getURL(`guard.html?target=${encodeURIComponent(urlStr)}`);
  try {
    await chrome.tabs.update(tabId, { url: guardUrl });
    return true;
  } catch {
    return false;
  }
}

/**
 * Scan all open tabs and immediately lock any open brave://extensions tab
 */
async function guardAllOpenExtensionTabs() {
  try {
    const tabs = await chrome.tabs.query({});
    for (const t of tabs) {
      const url = t.pendingUrl || t.url || "";
      if (t.id && isExtensionManagerUrl(url)) {
        await enforceExtensionManagerGuard(t.id, url);
      }
    }
  } catch {
    // Ignore
  }
}

function extractHostname(urlStr) {
  try {
    const url = new URL(urlStr);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

function isDomainProtected(hostname, lockedDomains = []) {
  if (!hostname) return false;
  return lockedDomains.some((domain) => {
    const clean = domain.toLowerCase().trim().replace(/^www\./, "");
    if (!clean) return false;
    return hostname === clean || hostname.endsWith(`.${clean}`);
  });
}

async function evaluateTabLockState(tabId, urlStr) {
  const settings = await getSettings();
  const hostname = extractHostname(urlStr);
  if (!hostname) {
    return {
      shouldLock: false,
      hasPin: Boolean(settings.pinHash),
      hasCatName: Boolean(settings.catNameHash),
      hostname: null,
      settings
    };
  }

  const session = tabSessionState.get(tabId) || {
    unlocked: false,
    unlockedAt: 0,
    manualLock: false
  };

  if (session.unlocked && settings.autoRelockMinutes > 0) {
    const elapsedMs = Date.now() - session.unlockedAt;
    if (elapsedMs > settings.autoRelockMinutes * 60 * 1000) {
      session.unlocked = false;
      tabSessionState.set(tabId, session);
    }
  }

  const domainMatched = settings.enabled && isDomainProtected(hostname, settings.lockedDomains);
  const needsProtection = domainMatched || session.manualLock;
  const shouldLock = needsProtection && !session.unlocked;

  return {
    shouldLock,
    needsProtection,
    domainMatched,
    manualLock: session.manualLock,
    hasPin: Boolean(settings.pinHash),
    hasCatName: Boolean(settings.catNameHash),
    hostname,
    hideTabTitleAndFavicon: settings.hideTabTitleAndFavicon,
    lockoutUntil: settings.lockoutUntil || 0
  };
}

async function notifyTabState(tabId, urlStr) {
  try {
    const state = await evaluateTabLockState(tabId, urlStr);
    await chrome.tabs.sendMessage(tabId, {
      type: "BLOKZ_STATE_UPDATE",
      payload: state
    });
    await updateBadgeForTab(tabId, state);
  } catch {
    // Content script not running on internal pages
  }
}

async function updateBadgeForTab(tabId, state) {
  try {
    if (state.shouldLock) {
      await chrome.action.setBadgeText({ tabId, text: "LOCK" });
      await chrome.action.setBadgeBackgroundColor({ tabId, color: "#EF4444" });
    } else if (state.needsProtection) {
      await chrome.action.setBadgeText({ tabId, text: "OPEN" });
      await chrome.action.setBadgeBackgroundColor({ tabId, color: "#10B981" });
    } else {
      await chrome.action.setBadgeText({ tabId, text: "" });
    }
  } catch {
    // Ignore
  }
}

chrome.runtime.onInstalled.addListener(async () => {
  const current = await getSettings();
  await saveSettings(current);
  await guardAllOpenExtensionTabs();
});

chrome.runtime.onStartup.addListener(async () => {
  await guardAllOpenExtensionTabs();
});

let lastActiveTabId = null;
chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  const settings = await getSettings();
  if (settings.autoRelockOnTabSwitch && lastActiveTabId !== null && lastActiveTabId !== tabId) {
    const prevSession = tabSessionState.get(lastActiveTabId);
    if (prevSession && prevSession.unlocked) {
      prevSession.unlocked = false;
      tabSessionState.set(lastActiveTabId, prevSession);
      try {
        const prevTab = await chrome.tabs.get(lastActiveTabId);
        if (prevTab && prevTab.url) {
          await notifyTabState(lastActiveTabId, prevTab.url);
        }
      } catch {
        // Tab closed
      }
    }
  }
  lastActiveTabId = tabId;
  try {
    const tab = await chrome.tabs.get(tabId);
    const url = (tab && (tab.pendingUrl || tab.url)) || "";
    if (await enforceExtensionManagerGuard(tabId, url)) return;
    if (url) {
      await notifyTabState(tabId, url);
    }
  } catch {
    // Ignore
  }
});

chrome.tabs.onCreated.addListener(async (tab) => {
  const url = tab.pendingUrl || tab.url || "";
  if (tab.id && url) {
    await enforceExtensionManagerGuard(tab.id, url);
  }
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  const url = changeInfo.url || tab.pendingUrl || tab.url || "";
  if (url && (await enforceExtensionManagerGuard(tabId, url))) {
    return;
  }
  if (changeInfo.status === "loading" || changeInfo.url) {
    if (url) {
      await notifyTabState(tabId, url);
    }
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  tabSessionState.delete(tabId);
  if (lastActiveTabId === tabId) {
    lastActiveTabId = null;
  }
});

chrome.commands.onCommand.addListener(async (command) => {
  if (command === "lock-current-tab") {
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!activeTab || !activeTab.id) return;
    tabSessionState.set(activeTab.id, {
      unlocked: false,
      unlockedAt: 0,
      manualLock: true
    });
    await notifyTabState(activeTab.id, activeTab.url || "");
  } else if (command === "panic-lock-all") {
    for (const [tId, sess] of tabSessionState.entries()) {
      sess.unlocked = false;
      tabSessionState.set(tId, sess);
    }
    const tabs = await chrome.tabs.query({});
    for (const t of tabs) {
      if (t.id && t.url) {
        await notifyTabState(t.id, t.url);
      }
    }
  }
});

async function checkPinWithCooldown(candidatePin, settings) {
  const now = Date.now();
  if (settings.lockoutUntil && now < settings.lockoutUntil) {
    const remainingSec = Math.ceil((settings.lockoutUntil - now) / 1000);
    return {
      success: false,
      lockedOut: true,
      remainingSec,
      error: `Too many attempts. Wait ${remainingSec}s.`
    };
  }

  const cleanPin = String(candidatePin || "").trim();
  if (!/^\d{4}$/.test(cleanPin)) {
    return { success: false, error: "Enter a 4-digit PIN." };
  }

  const candidateHash = await hashSecret(cleanPin, settings.pinSalt);
  if (candidateHash === settings.pinHash) {
    await saveSettings({ failedAttempts: 0, lockoutUntil: 0 });
    return { success: true };
  }

  const attempts = (settings.failedAttempts || 0) + 1;
  let lockoutUntil = 0;
  if (attempts >= 5) {
    lockoutUntil = Date.now() + 30 * 1000;
  }
  await saveSettings({
    failedAttempts: attempts >= 5 ? 0 : attempts,
    lockoutUntil
  });
  return {
    success: false,
    lockedOut: lockoutUntil > 0,
    remainingSec: lockoutUntil > 0 ? 30 : 0,
    attemptsLeft: Math.max(0, 5 - attempts),
    error:
      lockoutUntil > 0
        ? "5 failed attempts. Locked for 30 seconds."
        : `Incorrect PIN (${5 - attempts} tries left)`
  };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    const tabId = message.tabId || (sender.tab && sender.tab.id);
    const tabUrl = message.url || (sender.tab && sender.tab.url) || "";

    switch (message.type) {
      case "BLOKZ_CHECK_TAB": {
        if (!tabId) {
          sendResponse({ shouldLock: false });
          return;
        }
        const state = await evaluateTabLockState(tabId, tabUrl);
        await updateBadgeForTab(tabId, state);
        sendResponse(state);
        return;
      }

      case "BLOKZ_VERIFY_PIN": {
        const settings = await getSettings();
        const candidatePin = String(message.pin || "").trim();

        if (!settings.pinHash) {
          if (!/^\d{4}$/.test(candidatePin)) {
            sendResponse({ success: false, error: "Enter a 4-digit PIN." });
            return;
          }
          const newHash = await hashSecret(candidatePin, settings.pinSalt);
          await saveSettings({
            pinHash: newHash,
            failedAttempts: 0,
            lockoutUntil: 0
          });
          await guardAllOpenExtensionTabs();
          sendResponse({
            success: true,
            needsCatQuestionSetup: !settings.catNameHash
          });
          return;
        }

        const result = await checkPinWithCooldown(candidatePin, settings);
        if (!result.success) {
          sendResponse(result);
          return;
        }

        if (!settings.catNameHash && !message.skipTabUnlock) {
          sendResponse({
            success: true,
            needsCatQuestionSetup: true
          });
          return;
        }

        if (tabId && !message.skipTabUnlock) {
          const currentSession = tabSessionState.get(tabId) || { manualLock: false };
          tabSessionState.set(tabId, {
            ...currentSession,
            unlocked: true,
            unlockedAt: Date.now()
          });
          await notifyTabState(tabId, tabUrl);
        }

        sendResponse({
          success: true,
          needsCatQuestionSetup: !settings.catNameHash
        });
        return;
      }

      case "BLOKZ_SAVE_CAT_NAME": {
        const settings = await getSettings();
        const rawAnswer = String(message.catName || "").trim();
        if (!rawAnswer) {
          sendResponse({ success: false, error: "Please enter your cat's name." });
          return;
        }
        if (rawAnswer.length > 10) {
          sendResponse({ success: false, error: "Maximum 10 characters allowed." });
          return;
        }
        const normalized = normalizeCatName(rawAnswer);
        const catHash = await hashSecret(normalized, settings.pinSalt);
        await saveSettings({ catNameHash: catHash });
        await guardAllOpenExtensionTabs();

        if (tabId && message.unlockTabAfter) {
          const currentSession = tabSessionState.get(tabId) || { manualLock: false };
          tabSessionState.set(tabId, {
            ...currentSession,
            unlocked: true,
            unlockedAt: Date.now()
          });
          await notifyTabState(tabId, tabUrl);
        }

        sendResponse({ success: true });
        return;
      }

      case "BLOKZ_VERIFY_UNINSTALL_GUARD": {
        const settings = await getSettings();
        const rawAnswer = String(message.catName || "").trim();
        if (!rawAnswer || rawAnswer.length > 10) {
          sendResponse({
            success: false,
            error: "Enter your cat's name (max 10 characters)."
          });
          return;
        }

        if (message.pin !== undefined && settings.pinHash) {
          const pinCheck = await checkPinWithCooldown(message.pin, settings);
          if (!pinCheck.success) {
            sendResponse(pinCheck);
            return;
          }
        }

        // If catNameHash was never set yet, save it now if PIN matched
        if (!settings.catNameHash) {
          const newCatHash = await hashSecret(normalizeCatName(rawAnswer), settings.pinSalt);
          await saveSettings({ catNameHash: newCatHash });
        } else {
          const candidateCatHash = await hashSecret(normalizeCatName(rawAnswer), settings.pinSalt);
          if (candidateCatHash !== settings.catNameHash) {
            sendResponse({
              success: false,
              error: "Wrong answer to \"What is your cat's name?\""
            });
            return;
          }
        }

        // Grant 90 seconds of access to brave://extensions or allow disabling protection
        extensionManagerUnlockedUntil = Date.now() + 90 * 1000;

        if (typeof message.setEnabled === "boolean") {
          await saveSettings({ enabled: message.setEnabled });
          const tabs = await chrome.tabs.query({});
          for (const t of tabs) {
            if (t.id && t.url) await notifyTabState(t.id, t.url);
          }
        }

        if (message.uninstallSelf) {
          sendResponse({ success: true });
          try {
            await chrome.management.uninstallSelf({ showConfirmDialog: true });
          } catch {
            // Fallback
          }
          return;
        }

        sendResponse({
          success: true,
          unlockedUntil: extensionManagerUnlockedUntil
        });
        return;
      }

      case "BLOKZ_SET_NEW_PIN": {
        const settings = await getSettings();
        const { currentPin, newPin, catName } = message;

        if (!/^\d{4}$/.test(String(newPin || ""))) {
          sendResponse({ success: false, error: "PIN must be exactly 4 digits." });
          return;
        }

        if (settings.pinHash) {
          const currentHash = await hashSecret(String(currentPin || ""), settings.pinSalt);
          if (currentHash !== settings.pinHash) {
            sendResponse({ success: false, error: "Current PIN is incorrect." });
            return;
          }
        }

        const updates = {
          pinHash: await hashSecret(String(newPin), settings.pinSalt),
          failedAttempts: 0,
          lockoutUntil: 0
        };

        if (catName !== undefined && String(catName).trim()) {
          const cleanCat = String(catName || "").trim();
          if (cleanCat.length > 10) {
            sendResponse({
              success: false,
              error: "Cat's name max 10 characters."
            });
            return;
          }
          updates.catNameHash = await hashSecret(normalizeCatName(cleanCat), settings.pinSalt);
        }

        await saveSettings(updates);
        await guardAllOpenExtensionTabs();

        const tabs = await chrome.tabs.query({});
        for (const t of tabs) {
          if (t.id && t.url) await notifyTabState(t.id, t.url);
        }
        sendResponse({
          success: true,
          needsCatQuestionSetup: !Boolean(updates.catNameHash || settings.catNameHash)
        });
        return;
      }

      case "BLOKZ_LOCK_TAB_NOW": {
        if (!tabId) {
          sendResponse({ success: false });
          return;
        }
        tabSessionState.set(tabId, {
          unlocked: false,
          unlockedAt: 0,
          manualLock: true
        });
        await notifyTabState(tabId, tabUrl);
        sendResponse({ success: true });
        return;
      }

      case "BLOKZ_RELOCK_ALL": {
        for (const [tId, sess] of tabSessionState.entries()) {
          sess.unlocked = false;
          tabSessionState.set(tId, sess);
        }
        const tabs = await chrome.tabs.query({});
        for (const t of tabs) {
          if (t.id && t.url) await notifyTabState(t.id, t.url);
        }
        sendResponse({ success: true });
        return;
      }

      case "BLOKZ_TOGGLE_DOMAIN": {
        const settings = await getSettings();
        const domain = String(message.domain || "").toLowerCase().trim().replace(/^www\./, "");
        if (!domain) {
          sendResponse({ success: false });
          return;
        }
        const list = Array.isArray(settings.lockedDomains) ? [...settings.lockedDomains] : [];
        const idx = list.indexOf(domain);
        let added = false;
        if (idx >= 0) {
          list.splice(idx, 1);
        } else {
          list.push(domain);
          added = true;
        }
        await saveSettings({ lockedDomains: list });

        const tabs = await chrome.tabs.query({});
        for (const t of tabs) {
          if (t.id && t.url) {
            if (added) {
              const h = extractHostname(t.url);
              if (h && isDomainProtected(h, [domain])) {
                const sess = tabSessionState.get(t.id) || { manualLock: false };
                tabSessionState.set(t.id, { ...sess, unlocked: false });
              }
            }
            await notifyTabState(t.id, t.url);
          }
        }

        sendResponse({ success: true, lockedDomains: list, added });
        return;
      }

      case "BLOKZ_UPDATE_PREFS": {
        const allowed = {};
        if (typeof message.enabled === "boolean") allowed.enabled = message.enabled;
        if (typeof message.autoRelockOnTabSwitch === "boolean") {
          allowed.autoRelockOnTabSwitch = message.autoRelockOnTabSwitch;
        }
        if (typeof message.hideTabTitleAndFavicon === "boolean") {
          allowed.hideTabTitleAndFavicon = message.hideTabTitleAndFavicon;
        }
        if (typeof message.autoRelockMinutes === "number") {
          allowed.autoRelockMinutes = message.autoRelockMinutes;
        }
        await saveSettings(allowed);
        const tabs = await chrome.tabs.query({});
        for (const t of tabs) {
          if (t.id && t.url) await notifyTabState(t.id, t.url);
        }
        sendResponse({ success: true });
        return;
      }

      case "BLOKZ_GET_POPUP_DATA": {
        const settings = await getSettings();
        let tabState = null;
        if (tabId) {
          tabState = await evaluateTabLockState(tabId, tabUrl);
        }
        sendResponse({
          settings: {
            hasPin: Boolean(settings.pinHash),
            hasCatName: Boolean(settings.catNameHash),
            enabled: settings.enabled,
            lockedDomains: settings.lockedDomains,
            autoRelockOnTabSwitch: settings.autoRelockOnTabSwitch,
            autoRelockMinutes: settings.autoRelockMinutes,
            hideTabTitleAndFavicon: settings.hideTabTitleAndFavicon,
            lockoutUntil: settings.lockoutUntil || 0
          },
          tabState
        });
        return;
      }

      default:
        sendResponse({ ok: false });
    }
  })();
  return true;
});
