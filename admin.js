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
  leads: [],
  leadAssignees: [],
  selectedRoleId: null,
};

const ADMIN_PAGE_ACCESS = {
  overview: { href: "admin", permission: "access_admin_console" },
  users: { href: "admin-users", permission: "view_users" },
  groups: { href: "admin-groups", permission: "view_roles" },
  leads: { href: "admin-leads", permission: "view_leads" },
};

const adminPage = document.body.dataset.adminPage || "overview";
const adminLoginShell = document.getElementById("adminLoginShell");
const adminApp = document.getElementById("adminApp");
const adminSummary = document.getElementById("adminSummary");
const adminRoleBadge = document.getElementById("adminRoleBadge");
const refreshButton = document.getElementById("refreshButton");
const logoutButton = document.getElementById("logoutButton");
const overviewGrid = document.getElementById("overviewGrid");
const usersTableBody = document.getElementById("usersTableBody");
const auditTableBody = document.getElementById("auditTableBody");
const leadsTableBody = document.getElementById("leadsTableBody");
const userSearchInput = document.getElementById("userSearchInput");
const leadSearchInput = document.getElementById("leadSearchInput");
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
const adminLoginForm = document.getElementById("adminLoginForm");
const adminLoginMessage = document.getElementById("adminLoginMessage");
const adminViewButtons = [...document.querySelectorAll("[data-admin-view-button]")];
const adminToggle = document.getElementById("adminToggle");
const adminMenuList = document.getElementById("adminMenuList");

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

function finishAdminBoot() {
  document.body.dataset.adminLoading = "false";
}

function canAccessAdminPage(page) {
  const config = ADMIN_PAGE_ACCESS[page];
  return config ? can(config.permission) : false;
}

function firstAllowedAdminPage() {
  return Object.entries(ADMIN_PAGE_ACCESS).find(([page]) => canAccessAdminPage(page))?.[1] || ADMIN_PAGE_ACCESS.overview;
}

function enforceCurrentPageAccess() {
  if (canAccessAdminPage(adminPage)) return true;
  const fallback = firstAllowedAdminPage();
  if (fallback.href && !window.location.pathname.endsWith(`/${fallback.href}`)) {
    window.location.replace(fallback.href);
  }
  return false;
}

function syncAdminNav() {
  adminViewButtons.forEach((button) => {
    const page = button.dataset.adminViewButton;
    const allowed = canAccessAdminPage(page);
    button.hidden = !allowed;
    const active = allowed && page === adminPage;
    button.classList.toggle("active", active);
    button.setAttribute("aria-current", active ? "page" : "false");
  });
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
  if (!container) return;
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
  if (!container) return [];
  return [...container.querySelectorAll("[data-permission-key]")].filter((input) => input.checked).map((input) => input.dataset.permissionKey);
}

function renderOverview() {
  if (!overviewGrid) return;
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
  if (!usersTableBody) return;
  if (!can("view_users")) {
    usersTableBody.innerHTML = `<tr><td colspan="5"><div class="admin-empty">This role cannot view user accounts.</div></td></tr>`;
    return;
  }
  const query = (userSearchInput?.value || "").trim().toLowerCase();
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
  if (!auditTableBody) return;
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

function renderLeads() {
  if (!leadsTableBody) return;
  if (!can("view_leads")) {
    leadsTableBody.innerHTML = `<tr><td colspan="10"><div class="admin-empty">This role cannot view leads.</div></td></tr>`;
    return;
  }
  const query = (leadSearchInput?.value || "").trim().toLowerCase();
  const filtered = state.leads.filter((lead) => {
    const haystack = `${lead.email} ${lead.company} ${lead.phone} ${lead.service} ${lead.workload} ${lead.budget} ${lead.status} ${lead.assignedName} ${lead.assignedEmail} ${lead.message}`.toLowerCase();
    return haystack.includes(query);
  });
  if (!filtered.length) {
    leadsTableBody.innerHTML = `<tr><td colspan="10"><div class="admin-empty">No leads match this search.</div></td></tr>`;
    return;
  }
  leadsTableBody.innerHTML = filtered
    .map(
      (lead) => {
        const status = lead.status || "new";
        const assigneeOptions = state.leadAssignees
          .map((user) => {
            const selected = Number(lead.assignedUserId || 0) === Number(user.id) ? "selected" : "";
            return `<option value="${user.id}" ${selected}>${escapeHtml(user.fullName || user.email)} (${escapeHtml(user.roleName || "lead")})</option>`;
          })
          .join("");
        return `
        <tr>
          <td>
            <strong>${escapeHtml(lead.company || "-")}</strong>
            <div class="admin-note">ID ${escapeHtml(lead.id)}</div>
          </td>
          <td>
            <a href="mailto:${escapeHtml(lead.email)}">${escapeHtml(lead.email)}</a>
            <div class="admin-note">${escapeHtml(lead.phone || "")}</div>
          </td>
          <td>${escapeHtml(lead.service || "-")}</td>
          <td>${escapeHtml(lead.workload || "-")}</td>
          <td>${escapeHtml(lead.budget || "-")}</td>
          <td>
            <select data-lead-status="${lead.id}" ${can("manage_leads") ? "" : "disabled"}>
              <option value="new" ${status === "new" ? "selected" : ""}>New</option>
              <option value="inprogress" ${status === "inprogress" ? "selected" : ""}>In Progress</option>
              <option value="accept" ${status === "accept" ? "selected" : ""}>Accept</option>
              <option value="reject" ${status === "reject" ? "selected" : ""}>Reject</option>
            </select>
          </td>
          <td>
            <select data-lead-assignee="${lead.id}" ${can("manage_leads") ? "" : "disabled"}>
              <option value="">Unassigned</option>
              ${assigneeOptions}
            </select>
            <div class="admin-note">${escapeHtml(lead.assignedEmail || "")}</div>
          </td>
          <td>${escapeHtml(lead.message || "-")}</td>
          <td>${escapeHtml(lead.createdAt || "")}</td>
          <td>
            <div class="admin-inline-actions">
              <button class="admin-button danger" type="button" data-action="delete-lead" data-lead-id="${lead.id}" ${can("manage_leads") ? "" : "disabled"}>Delete</button>
            </div>
          </td>
        </tr>
      `;
      },
    )
    .join("");
}

function renderGroupCreatePermissions() {
  renderPermissionChecks(groupPermissionGrid, new Set());
}

function renderRoles() {
  if (!groupListRail || !selectedGroupContent) return;
  if (!can("view_roles")) {
    groupListRail.innerHTML = `<div class="admin-empty">This role cannot view groups.</div>`;
    selectedGroupContent.innerHTML = `<div class="admin-empty">This role cannot view groups.</div>`;
    return;
  }
  const query = (groupSearchInput?.value || "").trim().toLowerCase();
  const filtered = state.roles.filter((role) => `${role.name} ${role.description}`.toLowerCase().includes(query));
  if (groupCountLabel) groupCountLabel.textContent = String(filtered.length);

  if (!filtered.length) {
    groupListRail.innerHTML = `<div class="admin-empty">No groups match this search.</div>`;
    if (selectedGroupTitle) selectedGroupTitle.textContent = "Select a group";
    if (selectedGroupDescription) selectedGroupDescription.textContent = "Choose a group from the buttons on the left to edit it here.";
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

  if (selectedGroupTitle) selectedGroupTitle.textContent = role.name;
  if (selectedGroupDescription) selectedGroupDescription.textContent = role.description || "No description";
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
  if (adminSummary) adminSummary.textContent = `${state.admin.fullName} · ${state.admin.email}`;
  if (adminRoleBadge) adminRoleBadge.textContent = state.admin.roleName || "Admin";
}

async function refreshAll() {
  const [overviewRes, usersRes, rolesRes, auditRes, leadsRes] = await Promise.all([
    overviewGrid ? api("/api/admin/overview") : Promise.resolve(null),
    usersTableBody && can("view_users") ? api("/api/admin/users") : Promise.resolve(null),
    (usersTableBody || groupListRail) && can("view_roles") ? api("/api/admin/roles") : Promise.resolve(null),
    auditTableBody && can("view_audit_logs") ? api("/api/admin/audit") : Promise.resolve(null),
    leadsTableBody && can("view_leads") ? api("/api/admin/leads") : Promise.resolve(null),
  ]);
  if (overviewRes?.ok) state.overview = overviewRes.overview;
  state.users = can("view_users") && usersRes && usersRes.ok ? usersRes.users || [] : [];
  state.roles = can("view_roles") && rolesRes && rolesRes.ok ? rolesRes.roles || [] : [];
  state.audit = can("view_audit_logs") && auditRes && auditRes.ok ? auditRes.logs || [] : [];
  state.leads = can("view_leads") && leadsRes && leadsRes.ok ? leadsRes.leads || [] : [];
  state.leadAssignees = can("view_leads") && leadsRes && leadsRes.ok ? leadsRes.assignees || [] : [];
  renderOverview();
  renderUsers();
  renderRoles();
  renderAudit();
  renderLeads();
  renderGroupCreatePermissions();
}

async function loadSession() {
  try {
    const result = await api("/api/admin/me");
    if (!result.ok) {
      setVisible(false);
      return;
    }
    state.admin = result.admin;
    state.permissions = new Set(result.admin.permissions || []);
    syncHeader();
    setVisible(true);
    syncAdminNav();
    if (!enforceCurrentPageAccess()) return;
    if (groupCreateForm) {
      groupCreateForm.querySelectorAll("input, textarea, button").forEach((el) => {
        if (el.type === "submit") el.disabled = !can("manage_roles");
        else if (el.tagName !== "BUTTON") el.disabled = !can("manage_roles");
      });
    }
    finishAdminBoot();
    await refreshAll();
  } finally {
    finishAdminBoot();
  }
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

async function deleteLead(leadId) {
  const lead = state.leads.find((entry) => entry.id === Number(leadId));
  if (!lead) return;
  const confirmed = window.confirm(`Delete the lead from "${lead.company || lead.email}"?`);
  if (!confirmed) return;
  const result = await api("/api/admin/leads/delete", "POST", { leadId: Number(leadId) });
  if (!result.ok) {
    window.alert(result.message || "Unable to delete lead.");
    return;
  }
  await refreshAll();
}

async function updateLeadStatus(leadId, status) {
  if (!can("manage_leads")) return;
  const result = await api("/api/admin/leads/status", "POST", {
    leadId: Number(leadId),
    status,
  });
  if (!result.ok) {
    window.alert(result.message || "Unable to update lead status.");
    await refreshAll();
    return;
  }
  const lead = state.leads.find((entry) => entry.id === Number(leadId));
  if (lead) lead.status = status;
}

async function updateLeadAssignee(leadId, assigneeId) {
  if (!can("manage_leads")) return;
  const result = await api("/api/admin/leads/assign", "POST", {
    leadId: Number(leadId),
    assigneeId: assigneeId ? Number(assigneeId) : 0,
  });
  if (!result.ok) {
    window.alert(result.message || "Unable to update lead assignment.");
    await refreshAll();
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
  syncAdminNav();
  if (!enforceCurrentPageAccess()) return;
  finishAdminBoot();
  await refreshAll();
});

refreshButton?.addEventListener("click", refreshAll);

logoutButton?.addEventListener("click", async () => {
  await api("/api/admin/logout", "POST", {});
  window.location.reload();
});

userSearchInput?.addEventListener("input", renderUsers);
leadSearchInput?.addEventListener("input", renderLeads);
leadsTableBody?.addEventListener("change", async (event) => {
  const statusSelect = event.target.closest("[data-lead-status]");
  if (statusSelect) {
    await updateLeadStatus(statusSelect.dataset.leadStatus, statusSelect.value);
    return;
  }
  const assigneeSelect = event.target.closest("[data-lead-assignee]");
  if (assigneeSelect) {
    await updateLeadAssignee(assigneeSelect.dataset.leadAssignee, assigneeSelect.value);
  }
});
adminToggle?.addEventListener("click", () => {
  if (!adminMenuList) return;
  const open = adminMenuList.classList.toggle("open");
  adminToggle.setAttribute("aria-expanded", String(open));
});
groupSearchInput?.addEventListener("input", () => {
  state.selectedRoleId = null;
  renderRoles();
});

groupCreateForm?.addEventListener("submit", async (event) => {
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
    return;
  }

  const deleteLeadButton = event.target.closest('[data-action="delete-lead"][data-lead-id]');
  if (deleteLeadButton) {
    await deleteLead(deleteLeadButton.dataset.leadId);
  }
});

loadSession();
syncAdminNav();
