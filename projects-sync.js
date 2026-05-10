function getUserEmail() {
  try {
    const raw = localStorage.getItem("nimbusUser");
    if (!raw) return "";
    const user = JSON.parse(raw);
    return (user.email || "").trim().toLowerCase();
  } catch (_error) {
    return "";
  }
}

async function apiGet(url) {
  const response = await fetch(url);
  return response.json();
}

async function apiPost(url, payload) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return response.json();
}

function getStoredUser() {
  try {
    return JSON.parse(localStorage.getItem("nimbusUser") || "{}");
  } catch (_error) {
    return {};
  }
}

function setStoredUser(user) {
  localStorage.setItem("nimbusUser", JSON.stringify(user));
  const myProfileLink = document.getElementById("myProfileLink");
  const profileEmail = document.getElementById("profileEmail");
  if (myProfileLink) myProfileLink.textContent = user.fullName ? `My Account (${user.fullName})` : "My Account";
  if (profileEmail) profileEmail.textContent = user.email || "user@nimbusx.com";
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

async function loadProjectsState() {
  const email = getUserEmail();
  if (!email) return { ok: false, message: "User not found. Please log in again." };
  return apiGet(`/api/projects?email=${encodeURIComponent(email)}`);
}

async function setActiveProject(projectId) {
  const email = getUserEmail();
  return apiPost("/api/projects/set-active", { email, projectId: Number(projectId) });
}

async function createProject(name) {
  const email = getUserEmail();
  return apiPost("/api/projects/create", { email, name: (name || "").trim() });
}

async function setDefaultProject(projectId) {
  const email = getUserEmail();
  return apiPost("/api/projects/set-default", { email, projectId: Number(projectId) });
}

async function deleteProject(projectId) {
  const email = getUserEmail();
  return apiPost("/api/projects/delete", { email, projectId: Number(projectId) });
}

async function editProject(projectId, nextName) {
  const email = getUserEmail();
  return apiPost("/api/projects/edit", { email, projectId: Number(projectId), name: (nextName || "").trim() });
}

function getActiveProject(state) {
  return (
    state.projects.find((project) => project.id === state.activeProjectId) ||
    state.projects.find((project) => project.isDefault) ||
    state.projects[0]
  );
}

function renderProjectList({ state, listElement, activeNameElement, query = "" }) {
  const activeProject = getActiveProject(state);
  if (activeNameElement && activeProject) activeNameElement.textContent = activeProject.name;
  if (!listElement) return;

  const lowered = query.trim().toLowerCase();
  const filtered = state.projects.filter((project) => project.name.toLowerCase().includes(lowered));
  listElement.innerHTML = filtered
    .map((project) => {
      const classes = ["project-option"];
      if (activeProject && project.id === activeProject.id) classes.push("active");
      return `<button class="${classes.join(" ")}" data-project-id="${project.id}" type="button">
        ${project.name}${project.isDefault ? ' <span class="chip">Default</span>' : ""}
      </button>`;
    })
    .join("");
}

function renderProjectsTable(state, tableBodyElement) {
  if (!tableBodyElement) return;
  tableBodyElement.innerHTML = state.projects
    .map((project) => {
      const rowClass = project.id === state.activeProjectId ? "projects-row active" : "projects-row";
      return `<div class="${rowClass}" data-project-id="${project.id}">
        <span>${project.name}${project.isDefault ? ' <span class="chip">Default</span>' : ""}</span>
        <span>${project.description}</span>
        <span class="row-menu">
          <button class="row-menu-trigger" type="button" aria-label="Project actions">⋮</button>
          <div class="row-menu-dropdown">
            <button type="button" data-action="edit">Edit</button>
            <button type="button" data-action="set-default">Make default project</button>
            <button type="button" class="danger" data-action="delete">Delete</button>
          </div>
        </span>
      </div>`;
    })
    .join("");
}

function openProjectNameModal({
  title = "Create Project",
  placeholder = "Enter project name",
  initialValue = "",
  confirmText = "Create",
} = {}) {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "project-modal-overlay";
    overlay.innerHTML = `
      <div class="project-modal" role="dialog" aria-modal="true" aria-label="${title}">
        <h3>${title}</h3>
        <input id="projectModalInput" type="text" placeholder="${placeholder}" value="${initialValue}" />
        <div class="project-modal-actions">
          <button type="button" class="project-modal-btn ghost" data-action="cancel">Cancel</button>
          <button type="button" class="project-modal-btn primary" data-action="confirm">${confirmText}</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    const input = overlay.querySelector("#projectModalInput");
    const close = (value) => {
      overlay.remove();
      resolve(value);
    };

    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) close(null);
    });

    overlay.querySelector('[data-action="cancel"]').addEventListener("click", () => close(null));
    overlay.querySelector('[data-action="confirm"]').addEventListener("click", () => close(input.value.trim()));
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") close(input.value.trim());
      if (event.key === "Escape") close(null);
    });
    input.focus();
    input.select();
  });
}

function openConfirmModal({
  title = "Confirm",
  message = "Are you sure?",
  confirmText = "Confirm",
} = {}) {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "project-modal-overlay";
    overlay.innerHTML = `
      <div class="project-modal" role="dialog" aria-modal="true" aria-label="${title}">
        <h3>${title}</h3>
        <p class="project-modal-message">${message}</p>
        <div class="project-modal-actions">
          <button type="button" class="project-modal-btn ghost" data-action="cancel">Cancel</button>
          <button type="button" class="project-modal-btn primary danger" data-action="confirm">${confirmText}</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    const close = (value) => {
      overlay.remove();
      resolve(value);
    };

    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) close(false);
    });

    overlay.querySelector('[data-action="cancel"]').addEventListener("click", () => close(false));
    overlay.querySelector('[data-action="confirm"]').addEventListener("click", () => close(true));
  });
}

function getQrCodeUrl(otpauthUri) {
  return `https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(otpauthUri)}`;
}

async function openTwoFactorModal() {
  const email = getUserEmail();
  if (!email) {
    window.alert("Please log in again before changing two-factor authentication.");
    return;
  }

  const status = await apiPost("/api/2fa/status", { email });
  if (!status.ok) {
    window.alert(status.message || "Unable to load two-factor authentication status.");
    return;
  }

  const overlay = document.createElement("div");
  overlay.className = "project-modal-overlay";
  document.body.appendChild(overlay);

  const close = () => overlay.remove();
  const renderEnabled = () => {
    overlay.innerHTML = `
      <div class="project-modal two-factor-modal" role="dialog" aria-modal="true" aria-label="Two-factor authentication">
        <h3>Two-Factor Authentication</h3>
        <p class="project-modal-message">Authenticator app verification is enabled for this account.</p>
        <label class="two-factor-field">
          6-digit code
          <input id="twoFactorDisableCode" inputmode="numeric" autocomplete="one-time-code" placeholder="123456" />
        </label>
        <div class="project-modal-actions">
          <button type="button" class="project-modal-btn ghost" data-action="cancel">Close</button>
          <button type="button" class="project-modal-btn primary danger" data-action="disable">Disable 2FA</button>
        </div>
      </div>
    `;
    overlay.querySelector('[data-action="cancel"]').addEventListener("click", close);
    overlay.querySelector('[data-action="disable"]').addEventListener("click", async () => {
      const code = overlay.querySelector("#twoFactorDisableCode").value.trim();
      const result = await apiPost("/api/2fa/disable", { email, code });
      if (!result.ok) {
        window.alert(result.message || "Unable to disable two-factor authentication.");
        return;
      }
      close();
    });
  };

  const renderSetup = async () => {
    const setup = await apiPost("/api/2fa/setup", { email });
    if (!setup.ok) {
      window.alert(setup.message || "Unable to start two-factor authentication setup.");
      close();
      return;
    }
    overlay.innerHTML = `
      <div class="project-modal two-factor-modal" role="dialog" aria-modal="true" aria-label="Set up two-factor authentication">
        <h3>Set Up Two-Factor Authentication</h3>
        <p class="project-modal-message">Scan the QR code with any authenticator app, or enter the setup key manually.</p>
        <div class="two-factor-qr">
          <img src="${getQrCodeUrl(setup.otpauthUri)}" alt="Authenticator app QR code" />
          <code>${setup.secret}</code>
        </div>
        <label class="two-factor-field">
          6-digit code
          <input id="twoFactorVerifyCode" inputmode="numeric" autocomplete="one-time-code" placeholder="123456" />
        </label>
        <div class="project-modal-actions">
          <button type="button" class="project-modal-btn ghost" data-action="cancel">Cancel</button>
          <button type="button" class="project-modal-btn primary" data-action="enable">Enable 2FA</button>
        </div>
      </div>
    `;
    overlay.querySelector('[data-action="cancel"]').addEventListener("click", close);
    overlay.querySelector('[data-action="enable"]').addEventListener("click", async () => {
      const code = overlay.querySelector("#twoFactorVerifyCode").value.trim();
      const result = await apiPost("/api/2fa/verify", { email, code });
      if (!result.ok) {
        window.alert(result.message || "Unable to enable two-factor authentication.");
        return;
      }
      close();
    });
    overlay.querySelector("#twoFactorVerifyCode").focus();
  };

  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) close();
  });

  if (status.enabled) {
    renderEnabled();
  } else {
    await renderSetup();
  }
}

async function openAccountModal() {
  const email = getUserEmail();
  if (!email) {
    window.alert("Please log in again to view account settings.");
    return;
  }

  const storedUser = getStoredUser();
  const status = await apiPost("/api/account/status", { email });
  const account = status.ok
    ? status.account
    : { fullName: storedUser.fullName || "", email, twoFactorEnabled: false };

  const overlay = document.createElement("div");
  overlay.className = "project-modal-overlay";
  overlay.innerHTML = `
    <div class="project-modal account-modal" role="dialog" aria-modal="true" aria-label="My account">
      <div class="account-modal-head">
        <div>
          <h3>My Account</h3>
          <p class="project-modal-message">${escapeHtml(account.email)}</p>
        </div>
        <span class="account-status">${account.twoFactorEnabled ? "2FA Enabled" : "2FA Off"}</span>
      </div>

      <section class="account-section">
        <h4>Profile</h4>
        <div class="account-grid">
          <label>
            Full name
            <input id="accountFullName" type="text" value="${escapeHtml(account.fullName)}" />
          </label>
          <label>
            Work email
            <input id="accountEmail" type="email" value="${escapeHtml(account.email)}" disabled />
          </label>
        </div>
        <button type="button" class="project-modal-btn primary" data-action="save-profile">Save Profile</button>
      </section>

      <section class="account-section">
        <h4>Security</h4>
        <div class="account-grid">
          <label>
            Current password
            <input id="accountCurrentPassword" type="password" autocomplete="current-password" />
          </label>
          <label>
            New password
            <input id="accountNewPassword" type="password" autocomplete="new-password" />
          </label>
          <label>
            Confirm new password
            <input id="accountConfirmPassword" type="password" autocomplete="new-password" />
          </label>
        </div>
        <div class="account-actions-row">
          <button type="button" class="project-modal-btn" data-action="change-password">Change Password</button>
          <button type="button" class="project-modal-btn" data-action="manage-2fa">Manage 2FA</button>
        </div>
      </section>

      <section class="account-section">
        <h4>Account Links</h4>
        <div class="account-link-grid">
          <a href="projects">Projects</a>
          <a href="billing-history">Billing History</a>
          <a href="teams">Teams</a>
        </div>
      </section>

      <p id="accountMessage" class="account-message"></p>
      <div class="project-modal-actions">
        <button type="button" class="project-modal-btn ghost" data-action="close">Close</button>
        <button type="button" class="project-modal-btn primary danger" data-action="sign-out">Sign Out</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  const close = () => overlay.remove();
  const message = overlay.querySelector("#accountMessage");
  const setMessage = (text, isError = false) => {
    message.textContent = text;
    message.classList.toggle("error", isError);
  };

  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) close();
  });
  overlay.querySelector('[data-action="close"]').addEventListener("click", close);
  overlay.querySelector('[data-action="sign-out"]').addEventListener("click", () => {
    localStorage.removeItem("nimbusUser");
    window.location.href = "login";
  });
  overlay.querySelector('[data-action="manage-2fa"]').addEventListener("click", async () => {
    close();
    await openTwoFactorModal();
  });
  overlay.querySelector('[data-action="save-profile"]').addEventListener("click", async () => {
    const fullName = overlay.querySelector("#accountFullName").value.trim();
    const result = await apiPost("/api/account/update-profile", { email, fullName });
    if (!result.ok) {
      setMessage(result.message || "Unable to save profile.", true);
      return;
    }
    setStoredUser(result.user);
    setMessage("Profile saved.");
  });
  overlay.querySelector('[data-action="change-password"]').addEventListener("click", async () => {
    const currentPassword = overlay.querySelector("#accountCurrentPassword").value;
    const newPassword = overlay.querySelector("#accountNewPassword").value;
    const confirmPassword = overlay.querySelector("#accountConfirmPassword").value;
    if (newPassword !== confirmPassword) {
      setMessage("New passwords do not match.", true);
      return;
    }
    const result = await apiPost("/api/account/change-password", { email, currentPassword, newPassword });
    if (!result.ok) {
      setMessage(result.message || "Unable to change password.", true);
      return;
    }
    overlay.querySelector("#accountCurrentPassword").value = "";
    overlay.querySelector("#accountNewPassword").value = "";
    overlay.querySelector("#accountConfirmPassword").value = "";
    setMessage("Password changed.");
  });
}

function initTwoFactorControls() {
  const link = document.getElementById("twoFactorLink");
  if (!link) return;
  link.addEventListener("click", (event) => {
    event.preventDefault();
    openTwoFactorModal();
  });
}

function initAccountControls() {
  const link = document.getElementById("myProfileLink");
  if (!link) return;
  link.addEventListener("click", (event) => {
    event.preventDefault();
    openAccountModal();
  });
}

window.NimbusProjects = {
  loadProjectsState,
  renderProjectList,
  renderProjectsTable,
  setActiveProject,
  createProject,
  setDefaultProject,
  deleteProject,
  editProject,
  openProjectNameModal,
  openConfirmModal,
  openTwoFactorModal,
  openAccountModal,
};

initTwoFactorControls();
initAccountControls();
