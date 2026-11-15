/**
 * BLOKZ — Tab & App Locker
 * Zero-Flash Content Script Shield (run_at: document_start)
 * Clean lock screen with 4-digit PIN + first-time "What is your cat's name?" setup
 * (No copyright tags on the lock screen)
 */

(() => {
  if (window.__BLOKZ_INJECTED__) return;
  window.__BLOKZ_INJECTED__ = true;

  let isLocked = false;
  let hasPinConfigured = true;
  let awaitingCatSetup = false;
  let currentHostname = location.hostname.replace(/^www\./, "");
  let enteredPin = "";
  let shadowHost = null;
  let shadowRoot = null;
  let pageHideStyle = null;
  let originalTitle = "";
  let originalFavicons = [];
  let lockoutTimerInterval = null;

  const LOCK_FAVICON_DATA_URI =
    "data:image/svg+xml," +
    encodeURIComponent(
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
        <rect width="64" height="64" rx="16" fill="#0F172A"/>
        <path d="M22 28V20a10 10 0 0 1 20 0v8" fill="none" stroke="#6366F1" stroke-width="5" stroke-linecap="round"/>
        <rect x="16" y="28" width="32" height="24" rx="6" fill="#6366F1"/>
        <circle cx="32" cy="40" r="3.5" fill="#FFFFFF"/>
      </svg>`
    );

  function injectPrecheckCurtain() {
    if (pageHideStyle) return;
    pageHideStyle = document.createElement("style");
    pageHideStyle.id = "blokz-shield-curtain";
    pageHideStyle.textContent = `
      html.blokz-locked-html > body {
        filter: blur(28px) brightness(0.15) !important;
        pointer-events: none !important;
        user-select: none !important;
        overflow: hidden !important;
        transition: none !important;
      }
      html.blokz-locked-html {
        overflow: hidden !important;
        background: #070B14 !important;
      }
    `;
    (document.head || document.documentElement).appendChild(pageHideStyle);
  }

  function pauseAllMedia() {
    try {
      document.querySelectorAll("video, audio").forEach((media) => {
        if (!media.paused) {
          media.pause();
        }
      });
    } catch {
      // Ignore
    }
  }

  function applyTabDisguise(mask) {
    if (mask) {
      if (document.title && document.title !== "🔒 Locked — BLOKZ") {
        originalTitle = document.title;
      }
      document.title = "🔒 Locked — BLOKZ";

      const links = Array.from(document.querySelectorAll("link[rel*='icon']"));
      if (links.length > 0 && originalFavicons.length === 0) {
        originalFavicons = links.map((l) => ({ el: l, href: l.href }));
      }
      if (links.length > 0) {
        links.forEach((l) => {
          l.href = LOCK_FAVICON_DATA_URI;
        });
      }
    } else {
      if (originalTitle && document.title === "🔒 Locked — BLOKZ") {
        document.title = originalTitle;
      }
      if (originalFavicons.length > 0) {
        originalFavicons.forEach(({ el, href }) => {
          if (el && href) el.href = href;
        });
        originalFavicons = [];
      }
    }
  }

  function mountLockOverlay(state) {
    injectPrecheckCurtain();
    document.documentElement.classList.add("blokz-locked-html");
    pauseAllMedia();

    if (state.hideTabTitleAndFavicon !== false) {
      applyTabDisguise(true);
    }

    if (shadowHost && document.documentElement.contains(shadowHost)) {
      updateOverlayUI(state);
      return;
    }

    shadowHost = document.createElement("div");
    shadowHost.id = "blokz-lock-root";
    shadowHost.style.cssText =
      "position:fixed !important;inset:0 !important;width:100vw !important;height:100vh !important;z-index:2147483647 !important;display:block !important;pointer-events:auto !important;";

    shadowRoot = shadowHost.attachShadow({ mode: "closed" });

    shadowRoot.innerHTML = `
      <style>
        * {
          box-sizing: border-box;
          margin: 0;
          padding: 0;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, Roboto, sans-serif;
          -webkit-font-smoothing: antialiased;
        }
        .blokz-backdrop {
          position: fixed;
          inset: 0;
          width: 100vw;
          height: 100vh;
          background:
            radial-gradient(circle at 20% 20%, rgba(99, 102, 241, 0.18), transparent 45%),
            radial-gradient(circle at 80% 80%, rgba(139, 92, 246, 0.16), transparent 45%),
            rgba(7, 11, 20, 0.96);
          backdrop-filter: blur(24px);
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          color: #F8FAFC;
          z-index: 2147483647;
          user-select: none;
        }
        .blokz-card {
          width: 380px;
          max-width: 92vw;
          background: rgba(15, 23, 42, 0.85);
          border: 1px solid rgba(148, 163, 184, 0.16);
          border-radius: 28px;
          padding: 34px 28px 28px;
          box-shadow:
            0 25px 60px -15px rgba(0, 0, 0, 0.75),
            0 0 0 1px rgba(99, 102, 241, 0.15) inset;
          text-align: center;
          animation: blokzFadeIn 0.22s cubic-bezier(0.16, 1, 0.3, 1);
        }
        @keyframes blokzFadeIn {
          from { opacity: 0; transform: scale(0.95) translateY(8px); }
          to { opacity: 1; transform: scale(1) translateY(0); }
        }
        @keyframes blokzShake {
          0%, 100% { transform: translateX(0); }
          20%, 60% { transform: translateX(-9px); }
          40%, 80% { transform: translateX(9px); }
        }
        .blokz-card.shake {
          animation: blokzShake 0.36s ease-in-out;
        }
        .blokz-logo-wrap {
          width: 62px;
          height: 62px;
          margin: 0 auto 14px;
          border-radius: 20px;
          background: linear-gradient(135deg, #6366F1 0%, #8B5CF6 100%);
          display: flex;
          align-items: center;
          justify-content: center;
          box-shadow: 0 12px 28px rgba(99, 102, 241, 0.4);
        }
        .blokz-logo-wrap svg {
          width: 30px;
          height: 30px;
          stroke: #FFFFFF;
        }
        .blokz-brand {
          font-size: 11px;
          font-weight: 800;
          letter-spacing: 0.22em;
          text-transform: uppercase;
          color: #818CF8;
          margin-bottom: 5px;
        }
        .blokz-title {
          font-size: 21px;
          font-weight: 700;
          color: #F8FAFC;
          margin-bottom: 6px;
        }
        .blokz-subtitle {
          font-size: 12.5px;
          color: #94A3B8;
          margin-bottom: 18px;
          line-height: 1.45;
        }
        .blokz-domain-pill {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 5px 12px;
          border-radius: 999px;
          background: rgba(99, 102, 241, 0.12);
          border: 1px solid rgba(99, 102, 241, 0.3);
          color: #C7D2FE;
          font-size: 12px;
          font-weight: 600;
          margin-bottom: 14px;
        }
        .blokz-dots {
          display: flex;
          justify-content: center;
          gap: 16px;
          margin: 4px 0 16px;
        }
        .blokz-dot {
          width: 15px;
          height: 15px;
          border-radius: 50%;
          border: 2px solid #475569;
          background: transparent;
          transition: all 0.15s cubic-bezier(0.4, 0, 0.2, 1);
        }
        .blokz-dot.filled {
          background: #6366F1;
          border-color: #818CF8;
          transform: scale(1.15);
          box-shadow: 0 0 14px rgba(99, 102, 241, 0.75);
        }
        .blokz-dot.error {
          background: #EF4444;
          border-color: #F87171;
          box-shadow: 0 0 14px rgba(239, 68, 68, 0.75);
        }
        .blokz-dot.success {
          background: #10B981;
          border-color: #34D399;
          box-shadow: 0 0 14px rgba(16, 185, 129, 0.75);
        }
        .blokz-status {
          min-height: 18px;
          font-size: 12px;
          font-weight: 500;
          color: #F87171;
          margin-bottom: 12px;
        }
        .blokz-status.info {
          color: #A5B4FC;
        }
        .blokz-keypad {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 10px;
          max-width: 260px;
          margin: 0 auto 6px;
        }
        .blokz-key {
          height: 52px;
          border-radius: 15px;
          border: 1px solid rgba(148, 163, 184, 0.14);
          background: rgba(30, 41, 59, 0.65);
          color: #F8FAFC;
          font-size: 19px;
          font-weight: 600;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: all 0.12s ease;
        }
        .blokz-key:hover {
          background: rgba(99, 102, 241, 0.22);
          border-color: rgba(129, 140, 248, 0.45);
          transform: translateY(-1px);
        }
        .blokz-key:active {
          transform: scale(0.95);
          background: rgba(99, 102, 241, 0.38);
        }
        .blokz-key.action-key {
          font-size: 12.5px;
          font-weight: 600;
          color: #94A3B8;
        }
        .hidden {
          display: none !important;
        }
        .cat-setup-box {
          display: flex;
          flex-direction: column;
          gap: 12px;
          margin-top: 8px;
          text-align: left;
        }
        .cat-label {
          font-size: 14px;
          font-weight: 700;
          color: #E0E7FF;
          text-align: center;
        }
        .cat-input {
          width: 100%;
          padding: 12px 14px;
          border-radius: 12px;
          border: 1px solid rgba(129, 140, 248, 0.4);
          background: rgba(15, 23, 42, 0.95);
          color: #F8FAFC;
          font-size: 15px;
          text-align: center;
          outline: none;
        }
        .cat-input:focus {
          border-color: #6366F1;
          box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.25);
        }
        .cat-hint {
          font-size: 11.5px;
          color: #94A3B8;
          text-align: center;
        }
        .cat-submit-btn {
          width: 100%;
          padding: 12px;
          border: none;
          border-radius: 12px;
          background: linear-gradient(135deg, #6366F1 0%, #8B5CF6 100%);
          color: #FFFFFF;
          font-size: 14px;
          font-weight: 700;
          cursor: pointer;
        }
      </style>
      <div class="blokz-backdrop" id="backdrop">
        <div class="blokz-card" id="card">
          <div class="blokz-logo-wrap">
            <svg viewBox="0 0 24 24" fill="none" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
              <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
            </svg>
          </div>
          <div class="blokz-brand">BLOKZ</div>
          <h1 class="blokz-title" id="titleText">Tab Locked</h1>
          <div class="blokz-domain-pill" id="domainPill">🔒 photos.google.com</div>
          <p class="blokz-subtitle" id="subtitleText">Enter your 4-digit PIN to unlock this tab.</p>

          <!-- Step 1: 4-Digit PIN Section -->
          <div id="pinSection">
            <div class="blokz-dots" id="dotsContainer">
              <div class="blokz-dot"></div>
              <div class="blokz-dot"></div>
              <div class="blokz-dot"></div>
              <div class="blokz-dot"></div>
            </div>

            <div class="blokz-status" id="statusMsg"></div>

            <div class="blokz-keypad" id="keypad">
              <button class="blokz-key" data-digit="1">1</button>
              <button class="blokz-key" data-digit="2">2</button>
              <button class="blokz-key" data-digit="3">3</button>
              <button class="blokz-key" data-digit="4">4</button>
              <button class="blokz-key" data-digit="5">5</button>
              <button class="blokz-key" data-digit="6">6</button>
              <button class="blokz-key" data-digit="7">7</button>
              <button class="blokz-key" data-digit="8">8</button>
              <button class="blokz-key" data-digit="9">9</button>
              <button class="blokz-key action-key" data-action="clear">CLR</button>
              <button class="blokz-key" data-digit="0">0</button>
              <button class="blokz-key action-key" data-action="back">⌫</button>
            </div>
          </div>

          <!-- Step 2 (Only on initial setup): "What is your cat's name?" -->
          <form id="catSetupForm" class="cat-setup-box hidden">
            <div class="cat-label">What is your cat's name?</div>
            <input
              type="text"
              id="catNameInput"
              class="cat-input"
              maxlength="10"
              placeholder="Max 10 characters"
              autocomplete="off"
              required
            />
            <div class="cat-hint">Asked only when trying to remove or disable BLOKZ.</div>
            <div class="blokz-status" id="catStatusMsg"></div>
            <button type="submit" class="cat-submit-btn">Save & Unlock Tab</button>
          </form>
        </div>
      </div>
    `;

    const keypad = shadowRoot.getElementById("keypad");
    keypad.addEventListener("click", (e) => {
      const btn = e.target.closest("button");
      if (!btn) return;
      const digit = btn.getAttribute("data-digit");
      const action = btn.getAttribute("data-action");
      if (digit !== null) {
        handleDigitInput(digit);
      } else if (action === "clear") {
        enteredPin = "";
        renderDots();
      } else if (action === "back") {
        enteredPin = enteredPin.slice(0, -1);
        renderDots();
      }
    });

    const catSetupForm = shadowRoot.getElementById("catSetupForm");
    const catNameInput = shadowRoot.getElementById("catNameInput");
    const catStatusMsg = shadowRoot.getElementById("catStatusMsg");

    catSetupForm.addEventListener("submit", (e) => {
      e.preventDefault();
      const val = catNameInput.value.trim();
      if (!val || val.length > 10) {
        catStatusMsg.textContent = "Enter 1 to 10 characters.";
        return;
      }
      chrome.runtime.sendMessage(
        {
          type: "BLOKZ_SAVE_CAT_NAME",
          catName: val,
          unlockTabAfter: true,
          url: location.href
        },
        (res) => {
          if (res && res.success) {
            awaitingCatSetup = false;
            unmountLockOverlay();
          } else if (catStatusMsg) {
            catStatusMsg.textContent = (res && res.error) || "Error saving answer.";
          }
        }
      );
    });

    document.documentElement.appendChild(shadowHost);
    updateOverlayUI(state);
  }

  function showCatQuestionStep() {
    if (!shadowRoot) return;
    awaitingCatSetup = true;
    const titleEl = shadowRoot.getElementById("titleText");
    const subEl = shadowRoot.getElementById("subtitleText");
    const pinSection = shadowRoot.getElementById("pinSection");
    const catSetupForm = shadowRoot.getElementById("catSetupForm");
    const catNameInput = shadowRoot.getElementById("catNameInput");

    titleEl.textContent = "Security Question";
    subEl.textContent = "Set your recovery & anti-uninstall answer (max 10 characters).";
    pinSection.classList.add("hidden");
    catSetupForm.classList.remove("hidden");
    setTimeout(() => catNameInput && catNameInput.focus(), 50);
  }

  function updateOverlayUI(state) {
    if (!shadowRoot) return;
    hasPinConfigured = Boolean(state.hasPin);
    currentHostname = state.hostname || location.hostname.replace(/^www\./, "");

    const titleEl = shadowRoot.getElementById("titleText");
    const subEl = shadowRoot.getElementById("subtitleText");
    const pillEl = shadowRoot.getElementById("domainPill");
    const statusEl = shadowRoot.getElementById("statusMsg");

    if (pillEl) {
      pillEl.textContent = `🔒 ${currentHostname || "Protected Tab"}`;
    }

    if (!hasPinConfigured) {
      titleEl.textContent = "Create Your 4-Digit PIN";
      subEl.textContent = "Step 1: Enter a 4-digit PIN to lock your protected domains.";
      statusEl.textContent = "";
      statusEl.className = "blokz-status info";
    } else if (!awaitingCatSetup) {
      titleEl.textContent = "Tab Locked";
      subEl.textContent = "Enter your 4-digit PIN to unlock this tab.";
      statusEl.textContent = "";
      statusEl.className = "blokz-status";
    }

    if (state.lockoutUntil && state.lockoutUntil > Date.now()) {
      startLockoutCountdown(state.lockoutUntil);
    }
  }

  function startLockoutCountdown(lockoutUntil) {
    if (lockoutTimerInterval) clearInterval(lockoutTimerInterval);
    const statusEl = shadowRoot ? shadowRoot.getElementById("statusMsg") : null;
    const tick = () => {
      const rem = Math.ceil((lockoutUntil - Date.now()) / 1000);
      if (rem <= 0) {
        clearInterval(lockoutTimerInterval);
        if (statusEl) statusEl.textContent = "";
      } else if (statusEl) {
        statusEl.className = "blokz-status";
        statusEl.textContent = `Too many wrong tries. Wait ${rem}s...`;
      }
    };
    tick();
    lockoutTimerInterval = setInterval(tick, 500);
  }

  function renderDots(stateClass = "") {
    if (!shadowRoot) return;
    const dots = shadowRoot.querySelectorAll(".blokz-dot");
    dots.forEach((dot, idx) => {
      dot.className = "blokz-dot";
      if (idx < enteredPin.length) {
        dot.classList.add("filled");
      }
      if (stateClass) {
        dot.classList.add(stateClass);
      }
    });
  }

  function handleDigitInput(digit) {
    if (!isLocked || awaitingCatSetup || enteredPin.length >= 4) return;
    enteredPin += String(digit);
    renderDots();

    if (enteredPin.length === 4) {
      const pinToVerify = enteredPin;
      chrome.runtime.sendMessage(
        {
          type: "BLOKZ_VERIFY_PIN",
          pin: pinToVerify,
          url: location.href
        },
        (res) => {
          if (chrome.runtime.lastError || !res) {
            enteredPin = "";
            renderDots();
            return;
          }
          if (res.success) {
            renderDots("success");
            setTimeout(() => {
              if (res.needsCatQuestionSetup) {
                enteredPin = "";
                showCatQuestionStep();
              } else {
                unmountLockOverlay();
              }
            }, 140);
          } else {
            renderDots("error");
            const card = shadowRoot ? shadowRoot.getElementById("card") : null;
            const statusEl = shadowRoot ? shadowRoot.getElementById("statusMsg") : null;
            if (card) {
              card.classList.remove("shake");
              void card.offsetWidth;
              card.classList.add("shake");
            }
            if (statusEl && res.error) {
              statusEl.className = "blokz-status";
              statusEl.textContent = res.error;
            }
            if (res.lockedOut && res.remainingSec) {
              startLockoutCountdown(Date.now() + res.remainingSec * 1000);
            }
            setTimeout(() => {
              enteredPin = "";
              renderDots();
            }, 380);
          }
        }
      );
    }
  }

  function unmountLockOverlay() {
    isLocked = false;
    awaitingCatSetup = false;
    enteredPin = "";
    document.documentElement.classList.remove("blokz-locked-html");
    applyTabDisguise(false);
    if (shadowHost && shadowHost.parentNode) {
      shadowHost.parentNode.removeChild(shadowHost);
    }
    shadowHost = null;
    shadowRoot = null;
  }

  function applyLockState(state) {
    if (!state) return;
    if (state.shouldLock) {
      isLocked = true;
      mountLockOverlay(state);
    } else {
      unmountLockOverlay();
    }
  }

  window.addEventListener(
    "keydown",
    (e) => {
      if (!isLocked) return;
      // Allow typing in the "What is your cat's name?" input when visible
      if (awaitingCatSetup) {
        e.stopPropagation();
        return;
      }

      if (/^[0-9]$/.test(e.key)) {
        e.preventDefault();
        e.stopPropagation();
        handleDigitInput(e.key);
        return;
      }
      if (e.key === "Backspace") {
        e.preventDefault();
        e.stopPropagation();
        enteredPin = enteredPin.slice(0, -1);
        renderDots();
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        enteredPin = "";
        renderDots();
        return;
      }

      e.preventDefault();
      e.stopPropagation();
    },
    true
  );

  const observer = new MutationObserver(() => {
    if (!isLocked) return;
    if (!document.documentElement.classList.contains("blokz-locked-html")) {
      document.documentElement.classList.add("blokz-locked-html");
    }
    if (shadowHost && !document.documentElement.contains(shadowHost)) {
      document.documentElement.appendChild(shadowHost);
    }
    if (document.title !== "🔒 Locked — BLOKZ") {
      applyTabDisguise(true);
    }
    pauseAllMedia();
  });

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true
  });

  chrome.runtime.onMessage.addListener((message) => {
    if (message && message.type === "BLOKZ_STATE_UPDATE") {
      applyLockState(message.payload);
    }
  });

  chrome.runtime.sendMessage(
    {
      type: "BLOKZ_CHECK_TAB",
      url: location.href
    },
    (state) => {
      if (!chrome.runtime.lastError && state) {
        applyLockState(state);
      }
    }
  );
})();
