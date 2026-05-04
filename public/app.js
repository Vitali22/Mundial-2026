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
const scheduleContainer = document.querySelector("#schedule-container");
const updateHistory = document.querySelector("#update-history");
const matchModal = document.querySelector("#match-modal");
const matchModalContent = document.querySelector("#match-modal-content");

let activeTournament = "worldcup";
const selectedTableIndexes = {};
const tableFilters = {};
const bracketRoundIndexes = {};
const scheduleFilters = {};
let currentData = null;

navButtons.forEach((button) => {
  button.addEventListener("click", () => {
    activeTournament = button.dataset.tournament;
    navButtons.forEach((item) => item.classList.toggle("active", item === button));
    loadTournament(activeTournament);
  });
});

window.addEventListener("resize", () => {
  if (currentData) renderFinals(currentData.bracket || [], currentData);
});

document.addEventListener("click", (event) => {
  const matchButton = event.target.closest("[data-match-id]");
  if (matchButton && currentData) {
    const match = findMatchById(currentData, matchButton.dataset.matchId);
    if (match) openMatchModal(match);
    return;
  }

  const roundButton = event.target.closest("[data-round-step]");
  if (roundButton && currentData) {
    bracketRoundIndexes[currentData.key] = Number(roundButton.dataset.roundStep);
    renderFinals(currentData.bracket || [], currentData);
    return;
  }

  const scheduleButton = event.target.closest("[data-schedule-filter]");
  if (scheduleButton && currentData) {
    scheduleFilters[currentData.key] = scheduleButton.dataset.scheduleFilter;
    renderSchedule(currentData);
    return;
  }

  if (event.target.closest("[data-close-modal]")) {
    closeMatchModal();
  }
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
    saveUpdateHistory(activeTournament, result.message || "Actualizado");
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
  currentData = data;
  eyebrow.textContent = `${data.label} / ${formatProvider(data.source)}`;
  title.textContent = `${data.format?.tableLabel || "Tabla"} y ${data.format?.finalLabel || "fase final"}`;
  refreshButton.textContent = `Actualizar ${data.label}`;
  lastUpdate.textContent = data.updatedAt
    ? `Ultima actualizacion: ${formatDate(data.updatedAt)}`
    : "Ultima actualizacion: sin datos reales";

  formatNotes.innerHTML = (data.format?.notes || [])
    .map((note) => `<article class="metric-card"><p>${escapeHtml(note)}</p></article>`)
    .join("");

  renderUpdateHistory();
  renderTables(data);
  renderFinals(data.bracket || [], data);
  renderSchedule(data);
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
  const filteredGroups = groups.map((rows) => applyTableFilter(data, rows));
  const visibleGroups = data.key === "worldcup" ? [filteredGroups[activeIndex]] : filteredGroups;

  tableContainer.innerHTML = `
    ${renderTableControls(data)}
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

  document.querySelectorAll("[data-table-filter]").forEach((button) => {
    button.addEventListener("click", () => {
      tableFilters[data.key] = button.dataset.tableFilter;
      renderTables(data);
    });
  });
}

function renderTableControls(data) {
  const active = tableFilters[data.key] || "all";
  const options = getTableFilterOptions(data.key);
  return `
    <div class="table-controls">
      <div class="filter-pills" aria-label="Filtros de tabla">
        ${options
          .map(
            (option) => `
              <button class="${active === option.key ? "active" : ""}" type="button" data-table-filter="${option.key}">
                ${escapeHtml(option.label)}
              </button>
            `
          )
          .join("")}
      </div>
      <p>${escapeHtml(getUpdateSummary(data))}</p>
    </div>
  `;
}

function getTableFilterOptions(key) {
  if (key === "worldcup") {
    return [
      { key: "all", label: "Todos" },
      { key: "qualified", label: "Clasificados" },
      { key: "thirds", label: "Mejores terceros" }
    ];
  }

  if (key === "champions") {
    return [
      { key: "all", label: "Todos" },
      { key: "qualified", label: "Top 8" },
      { key: "playoff", label: "Play-off" },
      { key: "eliminated", label: "Eliminados" }
    ];
  }

  return [
    { key: "all", label: "Todos" },
    { key: "qualified", label: "Liguilla" },
    { key: "eliminated", label: "Fuera" }
  ];
}

function applyTableFilter(data, rows) {
  const filter = tableFilters[data.key] || "all";
  if (filter === "all") return rows;

  return rows.filter((row) => {
    const zone = getRowZone(data.key, row.rank);
    if (filter === "qualified") return zone === "qualified";
    if (filter === "playoff") return zone === "playoff";
    if (filter === "thirds") return row.rank === 3;
    if (filter === "eliminated") return zone === "eliminated";
    return true;
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
    <div class="team-bar-row ${getZoneClass(activeTournament, row.rank)}">
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
                <tr class="${getZoneClass(activeTournament, row.rank)}">
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

function renderFinals(rounds, data = currentData) {
  if (!rounds.length) {
    finalsContainer.innerHTML = `<p class="empty-state">No hay fase final disponible todavia.</p>`;
    return;
  }

  const maxMatches = Math.max(...rounds.map((round) => round.matches.length), 1);
  const activeRound = bracketRoundIndexes[data.key] || 0;
  const visibleRounds = isMobileViewport() ? [rounds[Math.min(activeRound, rounds.length - 1)]] : rounds;

  finalsContainer.innerHTML = `
    ${renderRoundStepper(rounds, activeRound)}
    <div class="finals-stage">
      ${visibleRounds
    .map(
      (round, index) => `
        <section class="bracket-column ${round === rounds.at(-1) ? "final-round" : ""}" style="--max-matches: ${maxMatches}; --matches: ${round.matches.length};">
          <div class="round-heading">
            <span>${rounds.indexOf(round) + 1}</span>
            <h3>${escapeHtml(round.label)}</h3>
          </div>
          <div class="bracket-lane">
            ${round.matches.map((match, matchIndex) => renderMatchCard(match, matchIndex)).join("")}
          </div>
        </section>
      `
    )
    .join("")}
    </div>
  `;
}

function renderRoundStepper(rounds, activeRound) {
  return `
    <div class="round-stepper" aria-label="Rondas">
      ${rounds
        .map(
          (round, index) => `
            <button class="${index === activeRound ? "active" : ""}" type="button" data-round-step="${index}">
              ${escapeHtml(round.label)}
            </button>
          `
        )
        .join("")}
    </div>
  `;
}

function renderMatchCard(match, index) {
  const hasAggregate =
    match.aggregateHomeGoals !== undefined &&
    match.aggregateHomeGoals !== null &&
    match.aggregateAwayGoals !== null;
  const aggregateText = hasAggregate
    ? `${formatGoal(match.aggregateHomeGoals)} - ${formatGoal(match.aggregateAwayGoals)}`
    : null;
  const metaLine = buildMatchMeta(match, aggregateText);

  return `
    <article class="bracket-card ${match.placeholder ? "placeholder" : ""}" data-match-id="${escapeHtml(match.id)}">
      <div class="match-topline">
        <span>Llave ${index + 1}</span>
        <span class="status ${match.status}">${formatStatus(match.status)}</span>
      </div>
      <div class="match-teams">
        <div class="match-team">
          ${renderBracketTeam(match.homeTeam, match.homeLogo)}
          <span class="score">${formatGoal(match.homeGoals)}</span>
        </div>
        <div class="match-team">
          ${renderBracketTeam(match.awayTeam, match.awayLogo)}
          <span class="score">${formatGoal(match.awayGoals)}</span>
        </div>
      </div>
      ${metaLine}
      ${renderAdvancement(match)}
      ${renderScoreFormula(match)}
    </article>
  `;
}

function renderAdvancement(match) {
  if (match.placeholder) return "";
  const winner = getAdvancingTeam(match);
  if (!winner) return `<p class="advance-note">Empate global</p>`;
  return `<p class="advance-note">Si termina asi, avanza <strong>${escapeHtml(winner)}</strong></p>`;
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
      ${aggregateText ? `<strong>Serie ${aggregateText}</strong>` : `<strong>Serie en juego</strong>`}
      <span>${escapeHtml(match.legLabel || "")}</span>
      <span>${match.matchTime ? formatDate(match.matchTime) : "Por definir"}</span>
    </div>
  `;
}

function renderScoreFormula(match) {
  if (match.placeholder) return "";

  const legs = match.legs || [];
  if (!legs.length) return "";

  if (legs.length <= 1) {
    const leg = legs[0];
    return `
      <div class="score-formula single">
        ${renderFormulaBox("Partido", `${formatGoal(leg.homeGoals)} - ${formatGoal(leg.awayGoals)}`, leg.matchTime)}
      </div>
    `;
  }

  return `
    <div class="score-formula" aria-label="Marcador global por equipo">
      ${renderTeamFormulaRow(match, match.homeTeam)}
      ${renderTeamFormulaRow(match, match.awayTeam)}
    </div>
  `;
}

function renderTeamFormulaRow(match, team) {
  const legs = match.legs || [];
  const firstLeg = legs[0];
  const secondLeg = legs[1];
  const firstLegGoals = getTeamGoalsInLeg(team, firstLeg);
  const secondLegGoals = getTeamGoalsInLeg(team, secondLeg);
  const aggregate =
    team === match.homeTeam ? match.aggregateHomeGoals : match.aggregateAwayGoals;

  return `
    <div class="formula-row">
      <span class="formula-team">${escapeHtml(team)}</span>
      ${renderFormulaBox("Ida", formatGoal(firstLegGoals), firstLeg?.matchTime)}
      <span class="formula-symbol">+</span>
      ${renderFormulaBox("Vuelta", formatGoal(secondLegGoals), secondLeg?.matchTime)}
      <span class="formula-symbol">=</span>
      ${renderFormulaBox("Global", formatGoal(aggregate), null, true)}
    </div>
  `;
}

function renderFormulaBox(label, value, date, strong = false) {
  const dateText = value === "-" && date ? formatShortDate(date) : "";
  return `
    <span class="formula-box ${strong ? "strong" : ""}">
      <small>${escapeHtml(label)}</small>
      <strong>${escapeHtml(value)}</strong>
      ${dateText ? `<em>${escapeHtml(dateText)}</em>` : ""}
    </span>
  `;
}

function getTeamGoalsInLeg(team, leg) {
  if (!leg) return null;
  if (leg.homeGoals === null || leg.homeGoals === undefined) return null;
  if (leg.awayGoals === null || leg.awayGoals === undefined) return null;
  return leg.homeTeam === team ? leg.homeGoals : leg.awayGoals;
}

function renderSchedule(data) {
  const fixtures = [...(data.nextFixtures || []), ...getBracketMatches(data)]
    .filter((match) => match.matchTime)
    .sort((a, b) => new Date(a.matchTime) - new Date(b.matchTime));

  const filteredFixtures = applyScheduleFilter(data.key, fixtures);
  const upcoming = filteredFixtures.filter((match) => new Date(match.matchTime) >= new Date()).slice(0, 12);
  const items = upcoming.length ? upcoming : filteredFixtures.slice(0, 12);

  scheduleContainer.innerHTML = `
    <section class="schedule-board">
      <div class="panel-heading">
        <h3>Calendario</h3>
        <span>${items.length} partidos</span>
      </div>
      ${renderScheduleControls(data)}
      <div class="fixture-list">
        ${
          items.length
            ? items
          .map(
            (match) => `
              <button class="fixture-row" type="button" data-match-id="${escapeHtml(match.id)}">
                <span>${escapeHtml(match.round || "Partido")}</span>
                <strong>${renderTeamName(match.homeTeam, match.homeLogo)} ${formatGoal(match.homeGoals)} - ${formatGoal(match.awayGoals)} ${renderTeamName(match.awayTeam, match.awayLogo)}</strong>
                <p>${formatDate(match.matchTime)} - ${formatStatus(match.status)}</p>
              </button>
            `
          )
          .join("")
            : `<p class="empty-state schedule-empty">No hay partidos para este filtro.</p>`
        }
      </div>
    </section>
  `;
}

function renderScheduleControls(data) {
  const active = scheduleFilters[data.key] || "all";
  const options = [
    { key: "all", label: "Todos" },
    { key: "today", label: "Hoy" },
    { key: "week", label: "Esta semana" },
    { key: "next", label: "Proximos juegos" }
  ];

  return `
    <div class="schedule-controls">
      ${options
        .map(
          (option) => `
            <button class="${active === option.key ? "active" : ""}" type="button" data-schedule-filter="${option.key}">
              ${escapeHtml(option.label)}
            </button>
          `
        )
        .join("")}
    </div>
  `;
}

function applyScheduleFilter(key, fixtures) {
  const filter = scheduleFilters[key] || "all";
  const now = new Date();
  const endOfWeek = new Date(now);
  endOfWeek.setDate(now.getDate() + 7);

  return fixtures.filter((match) => {
    const date = new Date(match.matchTime);
    if (filter === "today") return date.toDateString() === now.toDateString();
    if (filter === "week") return date >= now && date <= endOfWeek;
    if (filter === "next") return date >= now;
    return true;
  });
}

function openMatchModal(match) {
  matchModalContent.innerHTML = `
    <p class="eyebrow">${escapeHtml(match.round || "Partido")}</p>
    <h3 id="match-modal-title">${escapeHtml(match.homeTeam)} vs ${escapeHtml(match.awayTeam)}</h3>
    <div class="modal-score">
      ${renderTeamName(match.homeTeam, match.homeLogo)}
      <strong>${formatGoal(match.homeGoals)} - ${formatGoal(match.awayGoals)}</strong>
      ${renderTeamName(match.awayTeam, match.awayLogo)}
    </div>
    <div class="match-meta modal-meta">
      <span>${match.matchTime ? formatDate(match.matchTime) : "Por definir"}</span>
      <span>${formatStatus(match.status)}</span>
      <span>${escapeHtml(match.legLabel || "Partido")}</span>
    </div>
    ${renderAdvancement(match)}
    ${renderScoreFormula(match)}
  `;
  matchModal.hidden = false;
}

function closeMatchModal() {
  matchModal.hidden = true;
}

function findMatchById(data, id) {
  return [...getBracketMatches(data), ...(data.nextFixtures || []), ...(data.fixtures || [])].find(
    (match) => String(match.id) === String(id)
  );
}

function getBracketMatches(data) {
  return (data.bracket || []).flatMap((round) =>
    (round.matches || []).map((match) => ({ ...match, round: match.round || round.label }))
  );
}

function getAdvancingTeam(match) {
  const home =
    match.aggregateHomeGoals !== null && match.aggregateHomeGoals !== undefined
      ? match.aggregateHomeGoals
      : match.homeGoals;
  const away =
    match.aggregateAwayGoals !== null && match.aggregateAwayGoals !== undefined
      ? match.aggregateAwayGoals
      : match.awayGoals;

  if (home === null || home === undefined || away === null || away === undefined) return null;
  if (home === away) return null;
  return home > away ? match.homeTeam : match.awayTeam;
}

function saveUpdateHistory(tournament, message) {
  const history = loadUpdateHistory();
  const next = [
    {
      tournament,
      message,
      at: new Date().toISOString()
    },
    ...history
  ].slice(0, 5);
  localStorage.setItem("footballUpdateHistory", JSON.stringify(next));
}

function loadUpdateHistory() {
  try {
    return JSON.parse(localStorage.getItem("footballUpdateHistory") || "[]");
  } catch (error) {
    return [];
  }
}

function renderUpdateHistory() {
  const history = loadUpdateHistory();
  updateHistory.innerHTML = history.length
    ? `
      <p>Historial</p>
      ${history
        .map(
          (item) => `
            <span>${escapeHtml(getTournamentLabel(item.tournament))} - ${formatShortDate(item.at)}</span>
          `
        )
        .join("")}
    `
    : `<p>Sin historial</p>`;
}

function getTournamentLabel(key) {
  const labels = {
    worldcup: "Mundial",
    champions: "Champions",
    ligamx: "Liga MX"
  };
  return labels[key] || key;
}

function getZoneClass(key, rank) {
  const zone = getRowZone(key, rank);
  return zone ? `zone-${zone}` : "";
}

function getRowZone(key, rank) {
  if (key === "worldcup") {
    if (rank <= 2) return "qualified";
    if (rank === 3) return "playoff";
    return "eliminated";
  }
  if (key === "champions") {
    if (rank <= 8) return "qualified";
    if (rank <= 24) return "playoff";
    return "eliminated";
  }
  if (rank <= 8) return "qualified";
  return "eliminated";
}

function getUpdateSummary(data) {
  const source = formatProvider(data.source);
  const quality = data.dataQuality === "verified-snapshot" ? "snapshot verificado" : "API/cache";
  return `${source} · ${quality}`;
}

function isMobileViewport() {
  return window.matchMedia("(max-width: 900px)").matches;
}

function renderBracketTeam(name, logo) {
  return `
    <span class="bracket-team-cell">
      ${renderTeamIcon(name, logo)}
      <strong>${escapeHtml(name || "Por definir")}</strong>
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
  return `<span class="team-cell">${renderTeamIcon(name, logo)}${escapeHtml(name || "Por definir")}</span>`;
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

function formatShortDate(value) {
  return new Intl.DateTimeFormat("es-MX", {
    day: "numeric",
    month: "short"
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
