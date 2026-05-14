(function () {
  const storageKey = "nimbusTheme";
  const root = document.body;
  const savedTheme = localStorage.getItem(storageKey);
  const initialTheme = savedTheme === "dark" ? "dark" : "light";

  function applyTheme(theme) {
    const nextTheme = theme === "dark" ? "dark" : "light";
    root.dataset.theme = nextTheme;
    localStorage.setItem(storageKey, nextTheme);
    document.querySelectorAll("[data-theme-toggle]").forEach((button) => {
      const dark = nextTheme === "dark";
      button.setAttribute("aria-pressed", String(dark));
      button.setAttribute("title", dark ? "Switch to light theme" : "Switch to dark theme");
      const icon = button.querySelector(".theme-toggle-icon");
      if (icon) icon.textContent = dark ? "☾" : "☀";
      const label = button.querySelector(".theme-toggle-label");
      if (label) label.textContent = dark ? "Moon" : "Sun";
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
      applyTheme(root.dataset.theme === "dark" ? "light" : "dark");
    });
    topbar.prepend(button);
  }

  applyTheme(initialTheme);
  insertToggle();
})();
