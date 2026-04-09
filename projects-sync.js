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
};
