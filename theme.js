(function () {
  const storageKey = "nimbusTheme";
  const root = document.body;

  function readSavedTheme() {
    try {
      const savedTheme = localStorage.getItem(storageKey);
      return savedTheme === "dark" || savedTheme === "light" ? savedTheme : "";
    } catch (_error) {
      return "";
    }
  }

  function writeSavedTheme(theme) {
    try {
      localStorage.setItem(storageKey, theme);
    } catch (_error) {
      // Theme still changes for the current page if storage is unavailable.
    }
  }

  function syncToggle(button, theme) {
    const dark = theme === "dark";
    button.setAttribute("aria-pressed", String(dark));
    button.setAttribute("aria-label", dark ? "Switch to light theme" : "Switch to dark theme");
    button.setAttribute("title", dark ? "Switch to light theme" : "Switch to dark theme");
    const icon = button.querySelector(".theme-toggle-icon");
    if (icon) icon.textContent = dark ? "☾" : "☀";
    const label = button.querySelector(".theme-toggle-label");
    if (label) label.textContent = dark ? "Moon" : "Sun";
  }

  function applyTheme(theme, options = {}) {
    const nextTheme = theme === "dark" ? "dark" : "light";
    root.dataset.theme = nextTheme;
    if (options.remember) writeSavedTheme(nextTheme);
    document.querySelectorAll("[data-theme-toggle]").forEach((button) => {
      syncToggle(button, nextTheme);
    });
  }

  function insertToggle() {
    const topbar = document.querySelector(".dash-topbar");
    if (!topbar || topbar.querySelector("[data-theme-toggle]")) return;
    const button = document.createElement("button");
    button.className = "theme-toggle";
    button.type = "button";
    button.dataset.themeToggle = "true";
    button.innerHTML = '<span class="theme-toggle-icon" aria-hidden="true"></span><span class="theme-toggle-label"></span>';
    button.addEventListener("click", () => {
      applyTheme(root.dataset.theme === "dark" ? "light" : "dark", { remember: true });
    });
    topbar.prepend(button);
    syncToggle(button, root.dataset.theme || "light");
  }

  applyTheme(readSavedTheme() || "light");
  insertToggle();
})();
