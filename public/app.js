const refreshButton = document.querySelector("#refresh-button");
const lastUpdate = document.querySelector("#last-update");
const toast = document.querySelector("#toast");
const navButtons = document.querySelectorAll(".nav-button");
const viewTabs = document.querySelectorAll(".view-tab");
const panels = document.querySelectorAll(".tournament-panel");
const title = document.querySelector("#tournament-title");
const eyebrow = document.querySelector("#tournament-eyebrow");
const formatNotes = document.querySelector("#format-notes");
const tableContainer = document.querySelector("#table-container");
const finalsContainer = document.querySelector("#finals-container");

let activeTournament = "worldcup";

navButtons.forEach((button) => {
  button.addEventListener("click", () => {
    activeTournament = button.dataset.tournament;
    navButtons.forEach((item) => item.classList.toggle("active", item === button));
    loadTournament(activeTournament);
  });
});

viewTabs.forEach((button) => {
  button.addEventListener("click", () => {
    const target = button.dataset.panel;
    viewTabs.forEach((item) => item.classList.toggle("active", item === button));
    panels.forEach((panel) => panel.classList.toggle("active", panel.id === target));
  });
});

refreshButton.addEventListener("click", async () => {
  refreshButton.disabled = true;
  refreshButton.textContent = "Revisando...";

  try {
    const response = await fetch("/api/refresh", { method: "POST" });
    const result = await response.json();
    showToast(result.message || "Revision completada.");
    await loadTournament(activeTournament);
  } catch (error) {
    showToast("No se pudo actualizar. Revisa el backend.");
  } finally {
    refreshButton.disabled = false;
    refreshButton.textContent = "Actualizar datos";
  }
});

loadTournament(activeTournament);

async function loadTournament(key) {
  tableContainer.innerHTML = `<p class="empty-state">Cargando tabla...</p>`;
  finalsContainer.innerHTML = `<p class="empty-state">Cargando fase final...</p>`;

  try {
    const response = await fetch(`/api/tournament/${key}`);
    const data = await response.json();
    renderTournament(data);
  } catch (error) {
    tableContainer.innerHTML = `<p class="empty-state">No se pudo cargar el torneo.</p>`;
    finalsContainer.innerHTML = "";
  }
}

function renderTournament(data) {
  eyebrow.textContent = `${data.label} / ${formatProvider(data.source)}`;
  title.textContent = `${data.format?.tableLabel || "Tabla"} y ${data.format?.finalLabel || "fase final"}`;
  lastUpdate.textContent = data.updatedAt
    ? `Ultima actualizacion: ${formatDate(data.updatedAt)}`
    : "Ultima actualizacion: sin datos reales";

  formatNotes.innerHTML = (data.format?.notes || [])
    .map((note) => `<article class="metric-card"><p>${escapeHtml(note)}</p></article>`)
    .join("");

  renderTables(data);
  renderFinals(data.bracket || []);
}

function renderTables(data) {
  const groups = data.standings || [];
  if (!groups.length) {
    tableContainer.innerHTML = `<p class="empty-state">No hay tabla disponible todavia.</p>`;
    return;
  }

  tableContainer.innerHTML = `
    <div class="groups-grid">
      ${groups
        .map(
          (rows, index) => `
            <article class="group-card">
              <div class="group-heading">
                <div>
                  <span class="group-label">${escapeHtml(rows[0]?.group || "Tabla")}</span>
                  <h3>${data.key === "worldcup" ? groupLetter(index) : index + 1}</h3>
                </div>
                <span class="group-count">${rows.length} equipos</span>
              </div>
              <div class="team-bars">
                ${rows.slice(0, 8).map(renderTeamBar).join("")}
              </div>
              ${renderCompetitionTable(rows)}
            </article>
          `
        )
        .join("")}
    </div>
  `;
}

function renderTeamBar(row) {
  const maxPoints = Math.max(1, row.played * 3 || 9);
  const percent = Math.max(8, Math.round((row.points / maxPoints) * 100));

  return `
    <div class="team-bar-row">
      <div class="team-bar-meta">
        <span class="position-badge">${row.rank}</span>
        ${renderTeamName(row.team, row.logo)}
      </div>
      <div class="bar-track" aria-hidden="true">
        <span style="width: ${percent}%"></span>
      </div>
      <span class="points-pill">${row.points || 0} pts</span>
    </div>
  `;
}

function renderCompetitionTable(rows) {
  return `
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
          ${rows
            .map(
              (row) => `
                <tr>
                  <td>${row.rank}</td>
                  <td>${renderTeamName(row.team, row.logo)}</td>
                  <td>${row.played || 0}</td>
                  <td>${row.won || 0}</td>
                  <td>${row.drawn || 0}</td>
                  <td>${row.lost || 0}</td>
                  <td>${row.goalsFor || 0}</td>
                  <td>${row.goalsAgainst || 0}</td>
                  <td>${row.goalDifference || 0}</td>
                  <td><strong>${row.points || 0}</strong></td>
                </tr>
              `
            )
            .join("")}
        </tbody>
      </table>
    </div>
  `;
}

function renderFinals(rounds) {
  if (!rounds.length) {
    finalsContainer.innerHTML = `<p class="empty-state">No hay fase final disponible todavia.</p>`;
    return;
  }

  finalsContainer.innerHTML = rounds
    .map(
      (round, index) => `
        <section class="round">
          <div class="round-heading">
            <span>${index + 1}</span>
            <h3>${escapeHtml(round.label)}</h3>
          </div>
          <div class="round-matches">
            ${round.matches.map((match, matchIndex) => renderMatchCard(match, matchIndex)).join("")}
          </div>
        </section>
      `
    )
    .join("");
}

function renderMatchCard(match, index) {
  return `
    <article class="match-card">
      <div class="match-topline">
        <span>Partido ${index + 1}</span>
        <span class="status ${match.status}">${formatStatus(match.status)}</span>
      </div>
      <div class="match-teams">
        <div class="match-team">
          ${renderTeamName(match.homeTeam, match.homeLogo)}
          <span class="score">${formatGoal(match.homeGoals)}</span>
        </div>
        <div class="match-team">
          ${renderTeamName(match.awayTeam, match.awayLogo)}
          <span class="score">${formatGoal(match.awayGoals)}</span>
        </div>
      </div>
      <div class="match-meta">
        <strong>${formatGoal(match.homeGoals)} - ${formatGoal(match.awayGoals)}</strong>
        <span>${match.matchTime ? formatDate(match.matchTime) : "Por definir"}</span>
      </div>
    </article>
  `;
}

function renderTeamName(name, logo) {
  const image = logo
    ? `<img class="team-logo" src="${escapeHtml(logo)}" alt="" loading="lazy" />`
    : `<span class="flag">--</span>`;

  return `<span class="team-cell">${image}${escapeHtml(name || "Por definir")}</span>`;
}

function groupLetter(index) {
  return String.fromCharCode(65 + index);
}

function formatProvider(source) {
  return source === "thesportsdb" || source === "cache" ? "TheSportsDB" : "Ejemplo";
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
  window.setTimeout(() => toast.classList.remove("show"), 3600);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
