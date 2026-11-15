/**
 * BLOKZ — Anti-Uninstall Guard Controller
 * Verifies both the 4-digit PIN and "What is your cat's name?" (max 10 chars)
 * before allowing access to brave://extensions or chrome://extensions.
 */

document.addEventListener("DOMContentLoaded", () => {
  const guardForm = document.getElementById("guardForm");
  const pinInput = document.getElementById("pinInput");
  const catInput = document.getElementById("catInput");
  const guardError = document.getElementById("guardError");

  const params = new URLSearchParams(location.search);
  const targetUrl = params.get("target") || "chrome://extensions/";

  guardForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    guardError.textContent = "";

    const pin = pinInput.value.trim();
    const catName = catInput.value.trim();

    if (!/^\d{4}$/.test(pin)) {
      guardError.textContent = "Enter your 4-digit PIN.";
      return;
    }
    if (!catName || catName.length > 10) {
      guardError.textContent = "Enter your cat's name (max 10 characters).";
      return;
    }

    const res = await chrome.runtime.sendMessage({
      type: "BLOKZ_VERIFY_UNINSTALL_GUARD",
      pin,
      catName
    });

    if (res && res.success) {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab && tab.id) {
        await chrome.tabs.update(tab.id, { url: targetUrl });
      }
    } else {
      guardError.textContent = (res && res.error) || "Verification failed.";
    }
  });
});
