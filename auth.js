async function postJson(url, payload) {
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    return response.json();
  } catch (error) {
    return { ok: false, message: "Server connection failed. Please start app.py." };
  }
}

function openTwoFactorLoginModal() {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "project-modal-overlay";
    overlay.innerHTML = `
      <div class="project-modal two-factor-modal" role="dialog" aria-modal="true" aria-label="Authenticator code">
        <h3>Two-Factor Authentication</h3>
        <p class="project-modal-message">Enter the 6-digit code from your authenticator app.</p>
        <label class="two-factor-field">
          Authenticator code
          <input id="loginTwoFactorCode" inputmode="numeric" autocomplete="one-time-code" placeholder="123456" />
        </label>
        <div class="project-modal-actions">
          <button type="button" class="project-modal-btn ghost" data-action="cancel">Cancel</button>
          <button type="button" class="project-modal-btn primary" data-action="confirm">Verify</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    const input = overlay.querySelector("#loginTwoFactorCode");
    const close = (value) => {
      overlay.remove();
      resolve(value);
    };

    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) close("");
    });
    overlay.querySelector('[data-action="cancel"]').addEventListener("click", () => close(""));
    overlay.querySelector('[data-action="confirm"]').addEventListener("click", () => close(input.value.trim()));
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") close(input.value.trim());
      if (event.key === "Escape") close("");
    });
    input.focus();
  });
}

const registerForm = document.getElementById("registerForm");
if (registerForm) {
  registerForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const message = document.getElementById("formMessage");
    const fullName = document.getElementById("fullName").value.trim();
    const email = document.getElementById("email").value.trim();
    const password = document.getElementById("password").value;

    const result = await postJson("/api/register", { fullName, email, password });
    message.textContent = result.message || "Request failed";
    if (result.ok) {
      message.style.color = "#7de7c2";
      localStorage.setItem("nimbusUser", JSON.stringify(result.user || { fullName, email }));
      setTimeout(() => {
        window.location.href = "dashboard.html";
      }, 900);
    } else {
      message.style.color = "#ff9ea8";
    }
  });
}

const loginForm = document.getElementById("loginForm");
if (loginForm) {
  loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const message = document.getElementById("formMessage");
    const email = document.getElementById("email").value.trim();
    const password = document.getElementById("password").value;

    let result = await postJson("/api/login", { email, password });
    if (result.requires2FA) {
      const twoFactorCode = await openTwoFactorLoginModal();
      if (!twoFactorCode.trim()) {
        message.textContent = "Authenticator code is required";
        message.style.color = "#ff9ea8";
        return;
      }
      result = await postJson("/api/login", { email, password, twoFactorCode });
    }

    message.textContent = result.message || "Request failed";
    if (result.ok) {
      message.style.color = "#7de7c2";
      localStorage.setItem("nimbusUser", JSON.stringify(result.user || { email }));
      setTimeout(() => {
        window.location.href = "dashboard.html";
      }, 700);
    } else {
      message.style.color = "#ff9ea8";
    }
  });
}
