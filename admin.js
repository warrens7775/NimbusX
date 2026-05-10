const PERMISSIONS = [
  ["access_admin_console", "Access admin console"],
  ["view_dashboard", "View overview"],
  ["view_users", "View users"],
  ["manage_users", "Manage users"],
  ["impersonate_users", "Login as user"],
  ["view_projects", "View projects"],
  ["manage_projects", "Manage projects"],
  ["view_resources", "View resources"],
  ["manage_resources", "Manage resources"],
  ["view_leads", "View leads"],
  ["manage_leads", "Manage leads"],
  ["view_billing", "View billing"],
  ["manage_billing", "Manage billing"],
  ["view_content", "View content"],
  ["manage_content", "Manage content"],
  ["view_roles", "View groups"],
  ["manage_roles", "Create and edit groups"],
  ["manage_permissions", "Edit group permissions"],
  ["view_audit_logs", "View audit logs"],
  ["restart_service", "Restart service"],
];

const state = {
  admin: null,
  permissions: new Set(),
  overview: null,
  users: [],
  roles: [],
  audit: [],
  selectedRoleId: null,
};

const adminLoginShell = document.getElementById("adminLoginShell");
const adminApp = document.getElementById("adminApp");
const adminSummary = document.getElementById("adminSummary");
const adminRoleBadge = document.getElementById("adminRoleBadge");
const refreshButton = document.getElementById("refreshButton");
const logoutButton = document.getElementById("logoutButton");
const overviewGrid = document.getElementById("overviewGrid");
const usersTableBody = document.getElementById("usersTableBody");
const auditTableBody = document.getElementById("auditTableBody");
const userSearchInput = document.getElementById("userSearchInput");
const groupSearchInput = document.getElementById("groupSearchInput");
const groupPermissionGrid = document.getElementById("groupPermissionGrid");
const groupCreateForm = document.getElementById("groupCreateForm");
const groupName = document.getElementById("groupName");
const groupDescription = document.getElementById("groupDescription");
const groupListRail = document.getElementById("groupListRail");
const groupCountLabel = document.getElementById("groupCountLabel");
const selectedGroupTitle = document.getElementById("selectedGroupTitle");
const selectedGroupDescription = document.getElementById("selectedGroupDescription");
const selectedGroupContent = document.getElementById("selectedGroupContent");
const groupsJumpButton = document.getElementById("groupsJumpButton");
const adminLoginForm = document.getElementById("adminLoginForm");
const adminLoginMessage = document.getElementById("adminLoginMessage");
const groupsSection = document.getElementById("groupsSection");

function can(permission) {
  return state.permissions.has(permission);
}

async function api(path, method = "GET", payload) {
  const options = { method, credentials: "same-origin" };
  if (payload !== undefined) {
    options.headers = { "Content-Type": "application/json" };
    options.body = JSON.stringify(payload);
  }
  const response = await fetch(path, options);
  return response.json();
}

function setVisible(loggedIn) {
  adminLoginShell.hidden = loggedIn;
  adminApp.hidden = !loggedIn;
}

function setGroupsVisible(visible) {
  groupsSection.hidden = !visible;
  groupsJumpButton.setAttribute("aria-expanded", String(visible));
  groupsJumpButton.textContent = visible ? "Hide groups" : "Groups";
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatDetails(details) {
  if (!details) return "-";
  try {
    const parsed = JSON.parse(details);
    if (typeof parsed === "string") return parsed;
    if (Array.isArray(parsed)) return parsed.join(", ");
    return Object.entries(parsed)
      .map(([key, value]) => `${key}: ${Array.isArray(value) ? value.join(", ") : value}`)
      .join("; ");
  } catch (_error) {
    return details;
  }
}

function renderPermissionChecks(container, selected = new Set(), prefix = "perm") {
  container.innerHTML = PERMISSIONS.map(([key, label]) => {
    const checked = selected.has(key) ? "checked" : "";
    return `
      <label class="permission-item">
        <input type="checkbox" data-permission-key="${escapeHtml(key)}" ${checked} />
        <span>${escapeHtml(label)}</span>
      </label>
    `;
  }).join("");
}

function selectedPermissions(container) {
  return [...container.querySelectorAll("[data-permission-key]")].filter((input) => input.checked).map((input) => input.dataset.permissionKey);
}

function renderOverview() {
  const overview = state.overview || {};
  const counts = overview.counts || {};
  const stats = [
    ["Users", counts.users || 0],
    ["Active users", counts.activeUsers || 0],
    ["Projects", counts.projects || 0],
    ["Resources", counts.resources || 0],
    ["VMs", counts.vms || 0],
    ["Leads", counts.leads || 0],
    ["Groups", counts.roles || 0],
    ["Audit logs", (overview.recentAudit || []).length || 0],
  ];
  overviewGrid.innerHTML = stats
    .map(
      ([label, value]) => `
        <div class="admin-stat">
          <div class="label">${escapeHtml(label)}</div>
          <div class="value">${escapeHtml(value)}</div>
        </div>
      `,
    )
    .join("");
}

function renderUsers() {
  if (!can("view_users")) {
    usersTableBody.innerHTML = `<tr><td colspan="5"><div class="admin-empty">This role cannot view user accounts.</div></td></tr>`;
    return;
  }
  const query = (userSearchInput.value || "").trim().toLowerCase();
  const roleOptions = state.roles
    .map((role) => `<option value="${role.id}">${escapeHtml(role.name)}</option>`)
    .join("");
  const filtered = state.users.filter((user) => {
    const haystack = `${user.fullName} ${user.email} ${user.roleName}`.toLowerCase();
    return haystack.includes(query);
  });
  if (!filtered.length) {
    usersTableBody.innerHTML = `<tr><td colspan="5"><div class="admin-empty">No users match this search.</div></td></tr>`;
    return;
  }
  usersTableBody.innerHTML = filtered
    .map((user) => {
      const disabled = user.isActive ? "" : "inactive";
      const statusLabel = user.isActive ? "Active" : "Disabled";
      const toggleLabel = user.isActive ? "Disable" : "Enable";
      const editDisabled = can("manage_roles") ? "" : "disabled";
      const roleSelect = `
        <select data-user-role="${user.id}" ${editDisabled}>
          ${roleOptions}
        </select>
      `;
      return `
        <tr data-user-row="${user.id}">
          <td>
            <strong>${escapeHtml(user.fullName)}</strong>
            <div class="admin-note">ID ${escapeHtml(user.id)}</div>
          </td>
          <td>${escapeHtml(user.email)}</td>
          <td>
            ${roleSelect}
            <div class="admin-note">${escapeHtml(user.roleDescription || "")}</div>
          </td>
          <td><span class="admin-chip ${disabled}">${escapeHtml(statusLabel)}</span></td>
          <td>
            <div class="admin-inline-actions">
              <button class="admin-button" type="button" data-action="save-role" data-user-id="${user.id}" ${can("manage_roles") ? "" : "disabled"}>Save role</button>
              <button class="admin-button" type="button" data-action="impersonate" data-user-id="${user.id}" ${can("impersonate_users") ? "" : "disabled"}>Login as</button>
              <button class="admin-button ${user.isActive ? "danger" : ""}" type="button" data-action="toggle-active" data-user-id="${user.id}" ${can("manage_users") ? "" : "disabled"}>${escapeHtml(toggleLabel)}</button>
            </div>
          </td>
        </tr>
      `;
    })
    .join("");

  filtered.forEach((user) => {
    const select = usersTableBody.querySelector(`[data-user-role="${user.id}"]`);
    if (select) select.value = String(user.roleId || state.roles[0]?.id || "");
  });
}

function renderAudit() {
  if (!can("view_audit_logs")) {
    auditTableBody.innerHTML = `<tr><td colspan="5"><div class="admin-empty">This role cannot view audit logs.</div></td></tr>`;
    return;
  }
  const rows = state.audit;
  if (!rows.length) {
    auditTableBody.innerHTML = `<tr><td colspan="5"><div class="admin-empty">No audit log entries yet.</div></td></tr>`;
    return;
  }
  auditTableBody.innerHTML = rows
    .map(
      (entry) => `
        <tr>
          <td><strong>${escapeHtml(entry.action)}</strong></td>
          <td>${escapeHtml(entry.adminName || "-")}</td>
          <td>${escapeHtml(entry.targetName || entry.targetRoleName || "-")}</td>
          <td>${escapeHtml(formatDetails(entry.details))}</td>
          <td>${escapeHtml(entry.createdAt || "")}</td>
        </tr>
      `,
    )
    .join("");
}

function renderGroupCreatePermissions() {
  renderPermissionChecks(groupPermissionGrid, new Set());
}

function renderRoles() {
  if (!can("view_roles")) {
    groupListRail.innerHTML = `<div class="admin-empty">This role cannot view groups.</div>`;
    selectedGroupContent.innerHTML = `<div class="admin-empty">This role cannot view groups.</div>`;
    return;
  }
  const query = (groupSearchInput.value || "").trim().toLowerCase();
  const filtered = state.roles.filter((role) => `${role.name} ${role.description}`.toLowerCase().includes(query));
  groupCountLabel.textContent = String(filtered.length);

  if (!filtered.length) {
    groupListRail.innerHTML = `<div class="admin-empty">No groups match this search.</div>`;
    selectedGroupTitle.textContent = "Select a group";
    selectedGroupDescription.textContent = "Choose a group from the buttons on the left to edit it here.";
    selectedGroupContent.innerHTML = `<div class="admin-empty">No group selected.</div>`;
    return;
  }

  groupListRail.innerHTML = filtered
    .map(
      (role) => `
        <button type="button" class="group-list-button ${state.selectedRoleId === role.id ? "active" : ""}" data-group-select="${role.id}">
          <strong>${escapeHtml(role.name)}</strong>
          <span>${escapeHtml(role.description || "")}</span>
        </button>
      `,
    )
    .join("");

  if (!state.selectedRoleId || !filtered.some((role) => role.id === state.selectedRoleId)) {
    state.selectedRoleId = filtered[0].id;
  }

  const role = state.roles.find((entry) => entry.id === state.selectedRoleId);
  if (!role) {
    selectedGroupContent.innerHTML = `<div class="admin-empty">No group selected.</div>`;
    return;
  }

  selectedGroupTitle.textContent = role.name;
  selectedGroupDescription.textContent = role.description || "No description";
  selectedGroupContent.innerHTML = `
    <div class="admin-form">
      <label>
        Group name
        ${role.isSystem ? `<input type="text" value="${escapeHtml(role.name)}" disabled />` : `<input type="text" value="${escapeHtml(role.name)}" data-role-name="${role.id}" />`}
      </label>
      <label>
        Description
        <textarea data-role-description="${role.id}">${escapeHtml(role.description || "")}</textarea>
      </label>
      <div>
        <div class="admin-muted">Permissions</div>
        <div class="permission-grid" id="role-perms-${role.id}"></div>
      </div>
      <div class="admin-form-actions">
        <button class="admin-button primary" type="button" data-action="save-role" data-role-id="${role.id}" ${can("manage_permissions") && (!role.isSystem ? can("manage_roles") : true) ? "" : "disabled"}>Save group</button>
        <button class="admin-button danger" type="button" data-action="delete-role" data-role-id="${role.id}" ${role.isSystem || !can("manage_roles") ? "disabled" : ""}>Delete</button>
      </div>
    </div>
  `;

  const permContainer = document.getElementById(`role-perms-${role.id}`);
  if (permContainer) renderPermissionChecks(permContainer, new Set(role.permissions || []));
}

function syncHeader() {
  if (!state.admin) return;
  adminSummary.textContent = `${state.admin.fullName} · ${state.admin.email}`;
  adminRoleBadge.textContent = state.admin.roleName || "Admin";
}

async function refreshAll() {
  const requests = [api("/api/admin/overview")];
  if (can("view_users")) requests.push(api("/api/admin/users"));
  if (can("view_roles")) requests.push(api("/api/admin/roles"));
  if (can("view_audit_logs")) requests.push(api("/api/admin/audit"));

  const [overviewRes, usersRes, rolesRes, auditRes] = await Promise.all(requests);
  if (overviewRes.ok) state.overview = overviewRes.overview;
  state.users = can("view_users") && usersRes && usersRes.ok ? usersRes.users || [] : [];
  state.roles = can("view_roles") && rolesRes && rolesRes.ok ? rolesRes.roles || [] : [];
  state.audit = can("view_audit_logs") && auditRes && auditRes.ok ? auditRes.logs || [] : [];
  renderOverview();
  renderUsers();
  renderRoles();
  renderAudit();
  renderGroupCreatePermissions();
}

async function loadSession() {
  const result = await api("/api/admin/me");
  if (!result.ok) {
    setVisible(false);
    return;
  }
  state.admin = result.admin;
  state.permissions = new Set(result.admin.permissions || []);
  syncHeader();
  setVisible(true);
  groupCreateForm.querySelectorAll("input, textarea, button").forEach((el) => {
    if (el.type === "submit") el.disabled = !can("manage_roles");
    else if (el.tagName !== "BUTTON") el.disabled = !can("manage_roles");
  });
  await refreshAll();
}

async function saveUserRole(userId) {
  if (!can("manage_roles")) return;
  const select = usersTableBody.querySelector(`[data-user-role="${userId}"]`);
  if (!select) return;
  const result = await api("/api/admin/users/assign-role", "POST", {
    userId: Number(userId),
    roleId: Number(select.value),
  });
  if (!result.ok) {
    window.alert(result.message || "Unable to update role.");
    return;
  }
  await refreshAll();
}

async function toggleUserActive(userId) {
  const user = state.users.find((entry) => entry.id === Number(userId));
  if (!user) return;
  const result = await api("/api/admin/users/toggle-active", "POST", {
    userId: Number(userId),
    isActive: !user.isActive,
  });
  if (!result.ok) {
    window.alert(result.message || "Unable to update account status.");
    return;
  }
  await refreshAll();
}

async function impersonateUser(userId) {
  const result = await api("/api/admin/users/impersonate", "POST", {
    userId: Number(userId),
  });
  if (!result.ok) {
    window.alert(result.message || "Unable to open user dashboard.");
    return;
  }
  localStorage.setItem("nimbusUser", JSON.stringify(result.user));
  window.location.href = "dashboard";
}

async function saveRole(roleId) {
  const role = state.roles.find((entry) => entry.id === Number(roleId));
  if (!role) return;
  const panel = selectedGroupContent;
  const nextName = panel.querySelector(`[data-role-name="${roleId}"]`);
  const nextDescription = panel.querySelector(`[data-role-description="${roleId}"]`);
  const permissions = selectedPermissions(panel.querySelector(".permission-grid"));

  if (role.isSystem && !can("manage_permissions")) return;

  if (!role.isSystem) {
    const updateRes = await api("/api/admin/roles/update", "POST", {
      roleId: Number(roleId),
      name: nextName ? nextName.value.trim() : role.name,
      description: nextDescription ? nextDescription.value.trim() : role.description,
    });
    if (!updateRes.ok) {
      window.alert(updateRes.message || "Unable to update group.");
      return;
    }
  }

  const permRes = await api("/api/admin/roles/permissions", "POST", {
    roleId: Number(roleId),
    permissions,
  });
  if (!permRes.ok) {
    window.alert(permRes.message || "Unable to save permissions.");
    return;
  }
  await refreshAll();
}

async function deleteRole(roleId) {
  const role = state.roles.find((entry) => entry.id === Number(roleId));
  if (!role) return;
  const confirmed = window.confirm(`Delete the group "${role.name}"?`);
  if (!confirmed) return;
  const result = await api("/api/admin/roles/delete", "POST", { roleId: Number(roleId) });
  if (!result.ok) {
    window.alert(result.message || "Unable to delete group.");
    return;
  }
  await refreshAll();
}

adminLoginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const email = document.getElementById("adminEmail").value.trim();
  const password = document.getElementById("adminPassword").value;
  const result = await api("/api/admin/login", "POST", { email, password });
  adminLoginMessage.textContent = result.message || "Login failed";
  if (!result.ok) return;
  state.admin = result.admin;
  state.permissions = new Set(result.admin.permissions || []);
  syncHeader();
  setVisible(true);
  await refreshAll();
});

refreshButton.addEventListener("click", refreshAll);

logoutButton.addEventListener("click", async () => {
  await api("/api/admin/logout", "POST", {});
  window.location.reload();
});

userSearchInput.addEventListener("input", renderUsers);
groupSearchInput.addEventListener("input", () => {
  state.selectedRoleId = null;
  renderRoles();
});

groupsJumpButton.addEventListener("click", () => {
  const nextVisible = groupsSection.hidden;
  setGroupsVisible(nextVisible);
  if (nextVisible) {
    groupsSection.scrollIntoView({ behavior: "smooth", block: "start" });
  }
});

groupCreateForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const payload = {
    name: groupName.value.trim(),
    description: groupDescription.value.trim(),
    permissions: selectedPermissions(groupPermissionGrid),
  };
  const result = await api("/api/admin/roles/create", "POST", payload);
  if (!result.ok) {
    window.alert(result.message || "Unable to create group.");
    return;
  }
  groupName.value = "";
  groupDescription.value = "";
  await refreshAll();
});

document.addEventListener("click", async (event) => {
  const groupSelectButton = event.target.closest("[data-group-select]");
  if (groupSelectButton) {
    state.selectedRoleId = Number(groupSelectButton.dataset.groupSelect);
    renderRoles();
    return;
  }

  const saveUserButton = event.target.closest('[data-action="save-role"][data-user-id]');
  if (saveUserButton) {
    await saveUserRole(saveUserButton.dataset.userId);
    return;
  }

  const impersonateButton = event.target.closest('[data-action="impersonate"][data-user-id]');
  if (impersonateButton) {
    await impersonateUser(impersonateButton.dataset.userId);
    return;
  }

  const toggleButton = event.target.closest('[data-action="toggle-active"][data-user-id]');
  if (toggleButton) {
    await toggleUserActive(toggleButton.dataset.userId);
    return;
  }

  const saveRoleButton = event.target.closest('[data-action="save-role"][data-role-id]');
  if (saveRoleButton) {
    await saveRole(saveRoleButton.dataset.roleId);
    return;
  }

  const deleteRoleButton = event.target.closest('[data-action="delete-role"][data-role-id]');
  if (deleteRoleButton) {
    await deleteRole(deleteRoleButton.dataset.roleId);
  }
});

loadSession();
setGroupsVisible(false);
