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
const selectedTableIndexes = {};

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
    const response = await fetch(`/api/refresh/${activeTournament}`, { method: "POST" });
    const result = await response.json();
    showToast(result.message || "Revision completada.");
    await loadTournament(activeTournament);
  } catch (error) {
    showToast("No se pudo actualizar. Revisa el backend.");
  } finally {
    refreshButton.disabled = false;
    refreshButton.textContent = "Actualizar torneo";
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
  refreshButton.textContent = `Actualizar ${data.label}`;
  lastUpdate.textContent = data.updatedAt
    ? `Ultima actualizacion: ${formatDate(data.updatedAt)}`
    : "Ultima actualizacion: sin datos reales";

  formatNotes.innerHTML = (data.format?.notes || [])
    .map((note) => `<article class="metric-card"><p>${escapeHtml(note)}</p></article>`)
    .join("");

  renderTables(data);
  renderFinals(data.bracket || [], data.standings || []);
}

function renderTables(data) {
  const groups = data.standings || [];
  if (!groups.length) {
    tableContainer.innerHTML = `<p class="empty-state">No hay tabla disponible todavia.</p>`;
    return;
  }

  const activeIndex = Math.min(
    selectedTableIndexes[data.key] || 0,
    groups.length - 1
  );
  const visibleGroups = data.key === "worldcup" ? [groups[activeIndex]] : groups;

  tableContainer.innerHTML = `
    ${
      data.key === "worldcup" && groups.length > 1
        ? renderGroupSelector(data, groups, activeIndex)
        : ""
    }
    <div class="groups-grid">
      ${visibleGroups
        .map((rows) => renderGroupCard(data, rows, groups.indexOf(rows)))
        .join("")}
    </div>
  `;

  document.querySelectorAll(".group-selector button").forEach((button) => {
    button.addEventListener("click", () => {
      selectedTableIndexes[data.key] = Number(button.dataset.groupIndex);
      renderTables(data);
    });
  });
}

function renderGroupSelector(data, groups, activeIndex) {
  return `
    <div class="group-selector" aria-label="Seleccionar grupo">
      ${groups
        .map(
          (rows, index) => `
            <button class="${index === activeIndex ? "active" : ""}" type="button" data-group-index="${index}">
              Grupo ${escapeHtml(rows[0]?.group || groupLetter(index))}
            </button>
          `
        )
        .join("")}
    </div>
  `;
}

function renderGroupCard(data, rows, index) {
  return `
    <article class="group-card">
      <div class="group-heading">
        <div>
          <span class="group-label">${escapeHtml(rows[0]?.group || "Tabla")}</span>
          <h3>${data.key === "worldcup" ? rows[0]?.group || groupLetter(index) : index + 1}</h3>
        </div>
        <span class="group-count">${rows.length} equipos</span>
      </div>
      <div class="team-bars">
        ${rows.slice(0, Math.min(8, rows.length)).map(renderTeamBar).join("")}
      </div>
      ${renderCompetitionTable(rows)}
    </article>
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

function renderFinals(rounds, standings = []) {
  if (!rounds.length) {
    finalsContainer.innerHTML = `<p class="empty-state">No hay fase final disponible todavia.</p>`;
    return;
  }

  const rankMap = buildRankMap(standings);
  const maxMatches = Math.max(...rounds.map((round) => round.matches.length), 1);

  finalsContainer.innerHTML = rounds
    .map(
      (round, index) => `
        <section class="bracket-column ${index === rounds.length - 1 ? "final-round" : ""}" style="--max-matches: ${maxMatches}; --matches: ${round.matches.length};">
          <div class="round-heading">
            <span>${index + 1}</span>
            <h3>${escapeHtml(round.label)}</h3>
          </div>
          <div class="bracket-lane">
            ${round.matches.map((match, matchIndex) => renderMatchCard(match, matchIndex, rankMap)).join("")}
          </div>
        </section>
      `
    )
    .join("");
}

function renderMatchCard(match, index, rankMap) {
  const hasAggregate =
    match.aggregateHomeGoals !== undefined &&
    match.aggregateHomeGoals !== null &&
    match.aggregateAwayGoals !== null;
  const aggregateText = hasAggregate
    ? `${formatGoal(match.aggregateHomeGoals)} - ${formatGoal(match.aggregateAwayGoals)}`
    : null;
  const metaLine = buildMatchMeta(match, aggregateText);

  return `
    <article class="bracket-card ${match.placeholder ? "placeholder" : ""}">
      <div class="match-topline">
        <span>Llave ${index + 1}</span>
        <span class="status ${match.status}">${formatStatus(match.status)}</span>
      </div>
      <div class="match-teams">
        <div class="match-team">
          ${renderBracketTeam(match.homeTeam, match.homeLogo, rankMap)}
          <span class="score">${formatGoal(match.homeGoals)}</span>
        </div>
        <div class="match-team">
          ${renderBracketTeam(match.awayTeam, match.awayLogo, rankMap)}
          <span class="score">${formatGoal(match.awayGoals)}</span>
        </div>
      </div>
      ${metaLine}
      ${renderLegs(match.legs || [])}
    </article>
  `;
}

function buildMatchMeta(match, aggregateText) {
  if (match.placeholder) {
    return `
      <div class="match-meta">
        <strong>Cruce pendiente</strong>
        <span>${escapeHtml(match.legLabel || "Por definir")}</span>
      </div>
    `;
  }

  return `
    <div class="match-meta">
      ${aggregateText ? `<strong>Global ${aggregateText}</strong>` : `<strong>Serie en juego</strong>`}
      <span>${escapeHtml(match.legLabel || "")}</span>
      <span>${match.matchTime ? formatDate(match.matchTime) : "Por definir"}</span>
    </div>
  `;
}

function renderLegs(legs) {
  if (!legs.length) return "";

  return `
    <details class="leg-list">
      <summary>Ida / vuelta</summary>
      ${legs
        .map(
          (leg, index) => `
            <div class="leg-row">
              <span>${index === 0 ? "Ida" : "Vuelta"}</span>
              <strong>${escapeHtml(leg.homeTeam)} ${formatGoal(leg.homeGoals)} - ${formatGoal(leg.awayGoals)} ${escapeHtml(leg.awayTeam)}</strong>
              <small>${leg.matchTime ? formatDate(leg.matchTime) : "Por definir"}</small>
            </div>
          `
        )
        .join("")}
    </details>
  `;
}

function buildRankMap(standings) {
  const rows = standings.flat ? standings.flat() : [];
  return Object.fromEntries(
    rows.map((row) => [normalizeText(row.team), row.rank]).filter(([, rank]) => rank)
  );
}

function renderBracketTeam(name, logo, rankMap) {
  const rank = rankMap[normalizeText(name)];
  const seed = rank ? `<span class="seed-badge">${rank}°</span>` : "";
  return `
    <span class="bracket-team-cell">
      ${renderTeamIcon(name, logo)}
      <strong>${escapeHtml(name || "Por definir")}</strong>
      ${seed}
    </span>
  `;
}

function renderTeamIcon(name, logo) {
  if (logo) {
    return `<img class="team-logo" src="${escapeHtml(logo)}" alt="" loading="lazy" />`;
  }

  const initials = String(name || "?")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();

  return `<span class="team-initials">${escapeHtml(initials || "?")}</span>`;
}

function renderTeamName(name, logo) {
  const image = logo
    ? `<img class="team-logo" src="${escapeHtml(logo)}" alt="" loading="lazy" />`
    : `<span class="flag">--</span>`;

  return `<span class="team-cell">${image}${escapeHtml(name || "Por definir")}</span>`;
}

function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
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
