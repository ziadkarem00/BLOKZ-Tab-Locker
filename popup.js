/**
 * BLOKZ — Tab & App Locker (v1.4.0)
 * Popup UI Controller
 * Enforces 4-Digit PIN entry before accessing domain rules or settings,
 * and asks "What is your cat's name?" (max 10 chars) right after initial PIN setup
 * or when trying to disable, manage, or uninstall BLOKZ.
 */

document.addEventListener("DOMContentLoaded", async () => {
  const popupAuthGate = document.getElementById("popupAuthGate");
  const gateTitle = document.getElementById("gateTitle");
  const gateSubtitle = document.getElementById("gateSubtitle");
  const gatePinStep = document.getElementById("gatePinStep");
  const gateDots = document.getElementById("gateDots");
  const gateError = document.getElementById("gateError");
  const gateKeypad = document.getElementById("gateKeypad");
  const quickLockFromGateBtn = document.getElementById("quickLockFromGateBtn");
  const gateCatStep = document.getElementById("gateCatStep");
  const gateCatInput = document.getElementById("gateCatInput");
  const gateCatError = document.getElementById("gateCatError");

  const popupMainContent = document.getElementById("popupMainContent");
  const masterToggle = document.getElementById("masterToggle");
  const disableGuardBox = document.getElementById("disableGuardBox");
  const guardActionLabel = document.getElementById("guardActionLabel");
  const disableCatInput = document.getElementById("disableCatInput");
  const disableCatError = document.getElementById("disableCatError");
  const cancelDisableBtn = document.getElementById("cancelDisableBtn");
  const openExtManagerBtn = document.getElementById("openExtManagerBtn");
  const uninstallBlokzBtn = document.getElementById("uninstallBlokzBtn");
  const currentHostnameEl = document.getElementById("currentHostname");
  const currentTabBadge = document.getElementById("currentTabBadge");
  const lockTabNowBtn = document.getElementById("lockTabNowBtn");
  const toggleSiteRuleBtn = document.getElementById("toggleSiteRuleBtn");
  const panicRelockBtn = document.getElementById("panicRelockBtn");
  const presetGrid = document.getElementById("presetGrid");
  const addDomainForm = document.getElementById("addDomainForm");
  const customDomainInput = document.getElementById("customDomainInput");
  const domainListEl = document.getElementById("domainList");
  const autoRelockSwitch = document.getElementById("autoRelockSwitch");
  const hideTitleSwitch = document.getElementById("hideTitleSwitch");
  const idleTimeoutSelect = document.getElementById("idleTimeoutSelect");
  const currentPinInput = document.getElementById("currentPinInput");
  const newPinInput = document.getElementById("newPinInput");
  const pinForm = document.getElementById("pinForm");
  const pinFeedback = document.getElementById("pinFeedback");

  let activeTab = null;
  let currentHostname = null;
  let popupUnlocked = false;
  let gatePin = "";
  let inCatSetupMode = false;
  let pendingGuardAction = "disable"; // "disable" | "open_extensions" | "uninstall"

  async function getActiveTab() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab || null;
  }

  function cleanDomainInput(raw) {
    const trimmed = String(raw || "").trim().toLowerCase();
    if (!trimmed) return "";
    try {
      if (trimmed.includes("://")) {
        return new URL(trimmed).hostname.replace(/^www\./, "");
      }
      return trimmed.split("/")[0].replace(/^www\./, "");
    } catch {
      return "";
    }
  }

  function renderGateDots(extraClass = "") {
    const dots = gateDots.querySelectorAll(".gate-dot");
    dots.forEach((d, idx) => {
      d.className = "gate-dot";
      if (idx < gatePin.length) d.classList.add("filled");
      if (extraClass) d.classList.add(extraClass);
    });
  }

  function showCatQuestionInGate() {
    inCatSetupMode = true;
    gateTitle.textContent = "Security Question";
    gateSubtitle.textContent = "Set your security answer to protect BLOKZ from unauthorized removal.";
    gatePinStep.classList.add("hidden");
    gateCatStep.classList.remove("hidden");
    setTimeout(() => gateCatInput.focus(), 50);
  }

  function unlockPopupView() {
    popupUnlocked = true;
    inCatSetupMode = false;
    popupAuthGate.classList.add("hidden");
    popupMainContent.classList.remove("hidden");
    refreshUI();
  }

  function handleGateDigit(digit) {
    if (popupUnlocked || inCatSetupMode || gatePin.length >= 4) return;
    gateError.textContent = "";
    gatePin += String(digit);
    renderGateDots();

    if (gatePin.length === 4) {
      const candidate = gatePin;
      chrome.runtime.sendMessage(
        {
          type: "BLOKZ_VERIFY_PIN",
          pin: candidate,
          skipTabUnlock: true
        },
        (res) => {
          if (!res || !res.success) {
            renderGateDots("error");
            gateError.textContent = (res && res.error) || "Incorrect PIN.";
            setTimeout(() => {
              gatePin = "";
              renderGateDots();
            }, 340);
            return;
          }

          if (res.needsCatQuestionSetup) {
            gatePin = "";
            showCatQuestionInGate();
          } else {
            unlockPopupView();
          }
        }
      );
    }
  }

  gateKeypad.addEventListener("click", (e) => {
    const btn = e.target.closest("button");
    if (!btn) return;
    const digit = btn.getAttribute("data-digit");
    const action = btn.getAttribute("data-action");
    if (digit !== null) {
      handleGateDigit(digit);
    } else if (action === "clear") {
      gatePin = "";
      renderGateDots();
    } else if (action === "back") {
      gatePin = gatePin.slice(0, -1);
      renderGateDots();
    }
  });

  window.addEventListener("keydown", (e) => {
    if (popupUnlocked || inCatSetupMode) return;
    if (/^[0-9]$/.test(e.key)) {
      e.preventDefault();
      handleGateDigit(e.key);
    } else if (e.key === "Backspace") {
      e.preventDefault();
      gatePin = gatePin.slice(0, -1);
      renderGateDots();
    } else if (e.key === "Escape") {
      e.preventDefault();
      gatePin = "";
      renderGateDots();
    }
  });

  gateCatStep.addEventListener("submit", (e) => {
    e.preventDefault();
    gateCatError.textContent = "";
    const val = gateCatInput.value.trim();
    if (!val || val.length > 10) {
      gateCatError.textContent = "Please enter 1 to 10 characters.";
      return;
    }
    chrome.runtime.sendMessage(
      {
        type: "BLOKZ_SAVE_CAT_NAME",
        catName: val,
        unlockTabAfter: false
      },
      (res) => {
        if (res && res.success) {
          unlockPopupView();
        } else {
          gateCatError.textContent = (res && res.error) || "Could not save answer.";
        }
      }
    );
  });

  quickLockFromGateBtn.addEventListener("click", async () => {
    activeTab = await getActiveTab();
    if (!activeTab || !activeTab.id) return;
    await chrome.runtime.sendMessage({
      type: "BLOKZ_LOCK_TAB_NOW",
      tabId: activeTab.id,
      url: activeTab.url || ""
    });
    window.close();
  });

  async function refreshUI() {
    activeTab = await getActiveTab();
    const res = await chrome.runtime.sendMessage({
      type: "BLOKZ_GET_POPUP_DATA",
      tabId: activeTab ? activeTab.id : null,
      url: activeTab ? activeTab.url : ""
    });

    if (!res || !res.settings) return;
    const { settings, tabState } = res;

    if (!popupUnlocked) {
      if (!settings.hasPin) {
        gateTitle.textContent = "Create Your 4-Digit PIN";
        gateSubtitle.textContent = "Step 1: Enter a 4-digit PIN to lock your domains & settings.";
      } else {
        gateTitle.textContent = "Enter 4-Digit PIN";
        gateSubtitle.textContent = "PIN required to view or edit locked domains & settings.";
      }
      return;
    }

    masterToggle.checked = Boolean(settings.enabled);
    autoRelockSwitch.checked = Boolean(settings.autoRelockOnTabSwitch);
    hideTitleSwitch.checked = Boolean(settings.hideTabTitleAndFavicon);
    idleTimeoutSelect.value = String(settings.autoRelockMinutes ?? 5);

    currentHostname = tabState && tabState.hostname ? tabState.hostname : null;
    if (currentHostname) {
      currentHostnameEl.textContent = currentHostname;
      lockTabNowBtn.disabled = false;
      toggleSiteRuleBtn.disabled = false;

      if (tabState.shouldLock) {
        currentTabBadge.textContent = "🔒 Locked";
        currentTabBadge.className = "status-badge locked";
      } else if (tabState.needsProtection) {
        currentTabBadge.textContent = "🔓 Unlocked Session";
        currentTabBadge.className = "status-badge protected";
      } else {
        currentTabBadge.textContent = "Unprotected";
        currentTabBadge.className = "status-badge";
      }

      if (tabState.domainMatched) {
        toggleSiteRuleBtn.textContent = "✓ Site Auto-Locked";
        toggleSiteRuleBtn.classList.add("active");
      } else {
        toggleSiteRuleBtn.textContent = "+ Always Lock Site";
        toggleSiteRuleBtn.classList.remove("active");
      }
    } else {
      currentHostnameEl.textContent = "System / Browser Page";
      currentTabBadge.textContent = "Exempt";
      currentTabBadge.className = "status-badge";
      lockTabNowBtn.disabled = true;
      toggleSiteRuleBtn.disabled = true;
    }

    const lockedSet = new Set((settings.lockedDomains || []).map((d) => d.toLowerCase()));
    presetGrid.querySelectorAll(".preset-chip").forEach((chip) => {
      const domain = chip.getAttribute("data-domain");
      const stateEl = chip.querySelector(".chip-state");
      if (lockedSet.has(domain)) {
        chip.classList.add("active");
        if (stateEl) stateEl.textContent = "LOCKED";
      } else {
        chip.classList.remove("active");
        if (stateEl) stateEl.textContent = "OFF";
      }
    });

    domainListEl.innerHTML = "";
    (settings.lockedDomains || []).forEach((domain) => {
      const tag = document.createElement("span");
      tag.className = "domain-tag";
      tag.innerHTML = `<span>🔒 ${domain}</span><button data-remove="${domain}" title="Remove">×</button>`;
      domainListEl.appendChild(tag);
    });
  }

  function promptCatQuestionForAction(actionType, labelText) {
    pendingGuardAction = actionType;
    guardActionLabel.textContent = labelText;
    disableCatInput.value = "";
    disableCatError.textContent = "";
    disableGuardBox.classList.remove("hidden");
    disableCatInput.focus();
  }

  masterToggle.addEventListener("change", async () => {
    if (masterToggle.checked) {
      disableGuardBox.classList.add("hidden");
      await chrome.runtime.sendMessage({
        type: "BLOKZ_UPDATE_PREFS",
        enabled: true
      });
      await refreshUI();
    } else {
      masterToggle.checked = true;
      promptCatQuestionForAction("disable", "ANSWER TO DISABLE BLOKZ PROTECTION");
    }
  });

  openExtManagerBtn.addEventListener("click", () => {
    promptCatQuestionForAction("open_extensions", "ANSWER TO UNLOCK WEB EXTENSIONS PAGE");
  });

  uninstallBlokzBtn.addEventListener("click", () => {
    promptCatQuestionForAction("uninstall", "ANSWER TO UNINSTALL BLOKZ");
  });

  cancelDisableBtn.addEventListener("click", () => {
    disableGuardBox.classList.add("hidden");
  });

  disableGuardBox.addEventListener("submit", async (e) => {
    e.preventDefault();
    disableCatError.textContent = "";
    const answer = disableCatInput.value.trim();
    if (!answer || answer.length > 10) {
      disableCatError.textContent = "Enter 1 to 10 characters.";
      return;
    }

    if (pendingGuardAction === "disable") {
      const res = await chrome.runtime.sendMessage({
        type: "BLOKZ_VERIFY_UNINSTALL_GUARD",
        catName: answer,
        setEnabled: false
      });
      if (res && res.success) {
        disableGuardBox.classList.add("hidden");
        await refreshUI();
      } else {
        disableCatError.textContent = (res && res.error) || "Incorrect answer.";
      }
    } else if (pendingGuardAction === "open_extensions") {
      const res = await chrome.runtime.sendMessage({
        type: "BLOKZ_VERIFY_UNINSTALL_GUARD",
        catName: answer
      });
      if (res && res.success) {
        disableGuardBox.classList.add("hidden");
        await chrome.tabs.create({ url: "chrome://extensions/" });
        window.close();
      } else {
        disableCatError.textContent = (res && res.error) || "Incorrect answer.";
      }
    } else if (pendingGuardAction === "uninstall") {
      const res = await chrome.runtime.sendMessage({
        type: "BLOKZ_VERIFY_UNINSTALL_GUARD",
        catName: answer,
        uninstallSelf: true
      });
      if (!res || !res.success) {
        disableCatError.textContent = (res && res.error) || "Incorrect answer.";
      }
    }
  });

  lockTabNowBtn.addEventListener("click", async () => {
    if (!activeTab || !activeTab.id) return;
    await chrome.runtime.sendMessage({
      type: "BLOKZ_LOCK_TAB_NOW",
      tabId: activeTab.id,
      url: activeTab.url || ""
    });
    await refreshUI();
    window.close();
  });

  toggleSiteRuleBtn.addEventListener("click", async () => {
    if (!currentHostname) return;
    await chrome.runtime.sendMessage({
      type: "BLOKZ_TOGGLE_DOMAIN",
      domain: currentHostname
    });
    await refreshUI();
  });

  panicRelockBtn.addEventListener("click", async () => {
    await chrome.runtime.sendMessage({ type: "BLOKZ_RELOCK_ALL" });
    await refreshUI();
    window.close();
  });

  presetGrid.addEventListener("click", async (e) => {
    const chip = e.target.closest(".preset-chip");
    if (!chip) return;
    const domain = chip.getAttribute("data-domain");
    await chrome.runtime.sendMessage({
      type: "BLOKZ_TOGGLE_DOMAIN",
      domain
    });
    await refreshUI();
  });

  addDomainForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const domain = cleanDomainInput(customDomainInput.value);
    if (!domain || !domain.includes(".")) return;
    customDomainInput.value = "";
    await chrome.runtime.sendMessage({
      type: "BLOKZ_TOGGLE_DOMAIN",
      domain
    });
    await refreshUI();
  });

  domainListEl.addEventListener("click", async (e) => {
    const btn = e.target.closest("button[data-remove]");
    if (!btn) return;
    const domain = btn.getAttribute("data-remove");
    await chrome.runtime.sendMessage({
      type: "BLOKZ_TOGGLE_DOMAIN",
      domain
    });
    await refreshUI();
  });

  autoRelockSwitch.addEventListener("change", async () => {
    await chrome.runtime.sendMessage({
      type: "BLOKZ_UPDATE_PREFS",
      autoRelockOnTabSwitch: autoRelockSwitch.checked
    });
  });

  hideTitleSwitch.addEventListener("change", async () => {
    await chrome.runtime.sendMessage({
      type: "BLOKZ_UPDATE_PREFS",
      hideTabTitleAndFavicon: hideTitleSwitch.checked
    });
  });

  idleTimeoutSelect.addEventListener("change", async () => {
    await chrome.runtime.sendMessage({
      type: "BLOKZ_UPDATE_PREFS",
      autoRelockMinutes: Number(idleTimeoutSelect.value)
    });
  });

  pinForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    pinFeedback.textContent = "";
    pinFeedback.className = "feedback-msg";

    const currentPin = currentPinInput.value.trim();
    const newPin = newPinInput.value.trim();

    if (!/^\d{4}$/.test(newPin)) {
      pinFeedback.textContent = "PIN must be 4 digits.";
      pinFeedback.className = "feedback-msg error";
      return;
    }

    const res = await chrome.runtime.sendMessage({
      type: "BLOKZ_SET_NEW_PIN",
      currentPin,
      newPin
    });

    if (res && res.success) {
      currentPinInput.value = "";
      newPinInput.value = "";
      pinFeedback.textContent = "✓ 4-digit PIN updated!";
      await refreshUI();
    } else {
      pinFeedback.textContent = (res && res.error) || "Could not update PIN.";
      pinFeedback.className = "feedback-msg error";
    }
  });

  await refreshUI();
});
