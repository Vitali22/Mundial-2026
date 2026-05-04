const groupsContainer = document.querySelector("#groups-container");
const bracketContainer = document.querySelector("#bracket-container");
const refreshButton = document.querySelector("#refresh-button");
const lastUpdate = document.querySelector("#last-update");
const providerStatus = document.querySelector("#provider-status");
const toast = document.querySelector("#toast");
const themeToggle = document.querySelector("#theme-toggle");
const navButtons = document.querySelectorAll(".nav-button");
const views = document.querySelectorAll(".view");

const savedTheme = localStorage.getItem("theme") || "light";
applyTheme(savedTheme);

themeToggle.addEventListener("click", () => {
  const nextTheme = document.body.dataset.theme === "dark" ? "light" : "dark";
  applyTheme(nextTheme);
  localStorage.setItem("theme", nextTheme);
});

navButtons.forEach((button) => {
  button.addEventListener("click", () => {
    const targetView = button.dataset.view;

    navButtons.forEach((item) => item.classList.toggle("active", item === button));
    views.forEach((view) => view.classList.toggle("active", view.id === targetView));
  });
});

refreshButton.addEventListener("click", async () => {
  refreshButton.disabled = true;
  refreshButton.textContent = "Revisando...";

  try {
    const response = await fetch("/api/refresh", { method: "POST" });
    const result = await response.json();
    showToast(result.message || "Revision completada.");
    await loadDashboard();
  } catch (error) {
    showToast("No se pudo actualizar. Revisa el backend.");
  } finally {
    refreshButton.disabled = false;
    refreshButton.textContent = "Actualizar datos";
  }
});

loadDashboard();

async function loadDashboard() {
  const [groupsResponse, bracketResponse, metaResponse] = await Promise.all([
    fetch("/api/groups"),
    fetch("/api/bracket"),
    fetch("/api/meta")
  ]);

  const groups = await groupsResponse.json();
  const bracket = await bracketResponse.json();
  const meta = await metaResponse.json();

  renderGroups(groups);
  renderBracket(bracket);
  renderMeta(meta);
}

function renderGroups(groups) {
  const entries = Object.entries(groups);

  if (entries.length === 0) {
    groupsContainer.innerHTML = `<p class="empty-state">Todavia no hay grupos guardados.</p>`;
    return;
  }

  groupsContainer.innerHTML = entries
    .map(
      ([group, rows]) => `
        <article class="group-card">
          <div class="group-heading">
            <div>
              <span class="group-label">Grupo</span>
              <h3>${escapeHtml(group)}</h3>
            </div>
            <span class="group-count">${rows.length} equipos</span>
          </div>
          <div class="team-bars">
            ${rows.map(renderTeamBar).join("")}
          </div>
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Pos</th>
                  <th>Equipo</th>
                  <th>PJ</th>
                  <th>G</th>
                  <th>E</th>
                  <th>P</th>
                  <th>GF</th>
                  <th>GC</th>
                  <th>DG</th>
                  <th>Pts</th>
                </tr>
              </thead>
              <tbody>
                ${rows.map(renderGroupRow).join("")}
              </tbody>
            </table>
          </div>
        </article>
      `
    )
    .join("");
}

function renderTeamBar(row) {
  const maxPoints = 9;
  const percent = Math.max(8, Math.round((row.points / maxPoints) * 100));

  return `
    <div class="team-bar-row">
      <div class="team-bar-meta">
        <span class="position-badge">${row.position}</span>
        <span class="flag">${escapeHtml(row.flag || "--")}</span>
        <strong>${escapeHtml(row.team)}</strong>
      </div>
      <div class="bar-track" aria-hidden="true">
        <span style="width: ${percent}%"></span>
      </div>
      <span class="points-pill">${row.points} pts</span>
    </div>
  `;
}

function renderGroupRow(row) {
  return `
    <tr>
      <td>${row.position}</td>
      <td>
        <span class="team-cell">
          <span class="flag">${escapeHtml(row.flag || "--")}</span>
          ${escapeHtml(row.team)}
        </span>
      </td>
      <td>${row.played}</td>
      <td>${row.won}</td>
      <td>${row.drawn}</td>
      <td>${row.lost}</td>
      <td>${row.goalsFor}</td>
      <td>${row.goalsAgainst}</td>
      <td>${row.goalDifference}</td>
      <td><strong>${row.points}</strong></td>
    </tr>
  `;
}

function renderBracket(rounds) {
  if (!rounds.length) {
    bracketContainer.innerHTML = `<p class="empty-state">Todavia no hay partidos de eliminatoria guardados.</p>`;
    return;
  }

  bracketContainer.innerHTML = rounds
    .map(
      (round, roundIndex) => `
        <section class="round">
          <div class="round-heading">
            <span>${roundIndex + 1}</span>
            <h3>${escapeHtml(round.label)}</h3>
          </div>
          <div class="round-matches">
            ${
              round.matches.length
                ? round.matches.map((match, index) => renderMatchCard(match, index)).join("")
                : `<p class="empty-state">Sin partidos</p>`
            }
          </div>
        </section>
      `
    )
    .join("");
}

function renderMatchCard(match, index) {
  const statusClass = match.status.replace(" ", "-");
  const scoreText = `${formatGoal(match.homeGoals)} - ${formatGoal(match.awayGoals)}`;

  return `
    <article class="match-card">
      <div class="match-topline">
        <span>Partido ${index + 1}</span>
        <span class="status ${statusClass}">${formatStatus(match.status)}</span>
      </div>
      <div class="match-teams">
        <div class="match-team">
          <span>${escapeHtml(match.homeTeamName || "Por definir")}</span>
          <span class="score">${formatGoal(match.homeGoals)}</span>
        </div>
        <div class="match-team">
          <span>${escapeHtml(match.awayTeamName || "Por definir")}</span>
          <span class="score">${formatGoal(match.awayGoals)}</span>
        </div>
      </div>
      <div class="match-meta">
        <strong>${scoreText}</strong>
        <span>${formatDate(match.matchTime)}</span>
      </div>
    </article>
  `;
}

function renderMeta(meta) {
  const updateText = meta.lastUpdate
    ? formatDate(meta.lastUpdate)
    : "sin actualizaciones";

  const providerText =
    meta.provider === "api-football" && meta.apiConfigured
      ? "Modo: API-FOOTBALL"
      : "Modo: datos de ejemplo";

  providerStatus.textContent = providerText;
  lastUpdate.textContent = `Ultima actualizacion: ${updateText}`;
}

function formatGoal(value) {
  return value === null || value === undefined ? "-" : value;
}

function formatDate(value) {
  return new Intl.DateTimeFormat("es-MX", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));
}

function formatStatus(status) {
  const labels = {
    pendiente: "Pendiente",
    "en vivo": "En vivo",
    terminado: "Terminado"
  };

  return labels[status] || status;
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("show");
  window.setTimeout(() => toast.classList.remove("show"), 3200);
}

function applyTheme(theme) {
  document.body.dataset.theme = theme;
  themeToggle.textContent = theme === "dark" ? "Modo claro" : "Modo oscuro";
  themeToggle.setAttribute("aria-pressed", theme === "dark" ? "true" : "false");
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
