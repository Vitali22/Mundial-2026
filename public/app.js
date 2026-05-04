const groupsContainer = document.querySelector("#groups-container");
const bracketContainer = document.querySelector("#bracket-container");
const refreshButton = document.querySelector("#refresh-button");
const lastUpdate = document.querySelector("#last-update");
const providerStatus = document.querySelector("#provider-status");
const toast = document.querySelector("#toast");
const navButtons = document.querySelectorAll(".nav-button");
const views = document.querySelectorAll(".view");

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
          <h3>Grupo ${escapeHtml(group)}</h3>
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
      (round) => `
        <section class="round">
          <h3>${escapeHtml(round.label)}</h3>
          <div class="round-matches">
            ${
              round.matches.length
                ? round.matches.map(renderMatchCard).join("")
                : `<p class="empty-state">Sin partidos</p>`
            }
          </div>
        </section>
      `
    )
    .join("");
}

function renderMatchCard(match) {
  const statusClass = match.status.replace(" ", "-");

  return `
    <article class="match-card">
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
        <span>${formatDate(match.matchTime)}</span>
        <span class="status ${statusClass}">${formatStatus(match.status)}</span>
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

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
