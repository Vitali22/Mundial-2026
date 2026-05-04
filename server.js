const fs = require("fs");
const http = require("http");
const path = require("path");
const { DatabaseSync } = require("node:sqlite");

loadEnvFile();

const publicDir = path.join(__dirname, "public");
const db = new DatabaseSync(path.join(__dirname, "database.db"));

const PORT = Number(process.env.PORT || 3000);
const MATCH_DURATION_MINUTES = Number(process.env.MATCH_DURATION_MINUTES || 120);
const REFRESH_GRACE_MINUTES = Number(process.env.REFRESH_GRACE_MINUTES || 30);
const MOCK_SEED_VERSION = "world-cup-2026-v2";

initDatabase();
seedMockDataIfNeeded();

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  try {
    if (req.method === "GET" && url.pathname === "/api/groups") {
      const teams = getTeams();
      const matches = getGroupMatches();
      sendJson(res, 200, buildGroupTables(teams, matches));
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/bracket") {
      const matches = getKnockoutMatches();
      sendJson(res, 200, groupBracketByRound(matches));
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/meta") {
      const row = db
        .prepare("SELECT MAX(last_api_update) AS lastUpdate FROM matches")
        .get();

      sendJson(res, 200, {
        provider: process.env.DATA_PROVIDER || "mock",
        apiConfigured: Boolean(process.env.API_FOOTBALL_KEY),
        tournament: "FIFA World Cup 2026",
        lastUpdate: row.lastUpdate || null
      });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/refresh") {
      await readBody(req);
      const result = await refreshMatches();
      sendJson(res, 200, result);
      return;
    }

    if (req.method === "GET") {
      serveStaticFile(res, url.pathname);
      return;
    }

    sendJson(res, 405, { message: "Metodo no permitido." });
  } catch (error) {
    console.error(error);
    sendJson(res, 500, {
      message: "No se pudo actualizar la informacion.",
      detail: error.message
    });
  }
});

server.listen(PORT, () => {
  console.log(`Mundial Dashboard listo en http://localhost:${PORT}`);
});

function loadEnvFile() {
  const envPath = path.join(__dirname, ".env");
  if (!fs.existsSync(envPath)) return;

  const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
  lines.forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return;

    const separator = trimmed.indexOf("=");
    if (separator === -1) return;

    const key = trimmed.slice(0, separator).trim();
    const value = trimmed.slice(separator + 1).trim();
    if (!process.env[key]) process.env[key] = value;
  });
}

function sendJson(res, statusCode, data) {
  const body = JSON.stringify(data);
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body)
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) reject(new Error("Solicitud demasiado grande."));
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

function serveStaticFile(res, pathname) {
  const safePath = pathname === "/" ? "/index.html" : pathname;
  const filePath = path.normalize(path.join(publicDir, safePath));

  if (!filePath.startsWith(publicDir)) {
    sendJson(res, 403, { message: "Ruta no permitida." });
    return;
  }

  const target = fs.existsSync(filePath)
    ? filePath
    : path.join(publicDir, "index.html");

  const contentTypes = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8"
  };

  res.writeHead(200, {
    "Content-Type": contentTypes[path.extname(target)] || "application/octet-stream"
  });
  fs.createReadStream(target).pipe(res);
}

function initDatabase() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS teams (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      group_name TEXT,
      flag TEXT
    );

    CREATE TABLE IF NOT EXISTS matches (
      id TEXT PRIMARY KEY,
      stage TEXT NOT NULL,
      group_name TEXT,
      home_team_id TEXT,
      away_team_id TEXT,
      home_goals INTEGER,
      away_goals INTEGER,
      match_time TEXT NOT NULL,
      status TEXT NOT NULL,
      last_api_update TEXT,
      FOREIGN KEY(home_team_id) REFERENCES teams(id),
      FOREIGN KEY(away_team_id) REFERENCES teams(id)
    );

    CREATE TABLE IF NOT EXISTS app_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);
}

function seedMockDataIfNeeded() {
  const count = db.prepare("SELECT COUNT(*) AS total FROM teams").get().total;
  const seedVersion = db
    .prepare("SELECT value FROM app_meta WHERE key = 'mock_seed_version'")
    .get();

  if (process.env.DATA_PROVIDER === "api-football" && count > 0) return;
  if (seedVersion && seedVersion.value === MOCK_SEED_VERSION) return;

  const now = new Date().toISOString();
  const insertTeam = db.prepare(`
    INSERT INTO teams (id, name, group_name, flag)
    VALUES (@id, @name, @group, @flag)
  `);
  const insertMatch = db.prepare(`
    INSERT INTO matches (
      id, stage, group_name, home_team_id, away_team_id, home_goals,
      away_goals, match_time, status, last_api_update
    )
    VALUES (
      @id, @stage, @group, @home, @away, @homeGoals,
      @awayGoals, @time, @status, @lastUpdate
    )
  `);

  const { teams, matches } = buildWorldCup2026MockData();

  const seed = () => runInTransaction(() => {
    db.exec("DELETE FROM matches; DELETE FROM teams;");
    teams.forEach((team) => insertTeam.run(team));
    matches.forEach((match) => insertMatch.run({ ...match, lastUpdate: now }));
    db.prepare(`
      INSERT INTO app_meta (key, value)
      VALUES ('mock_seed_version', ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `).run(MOCK_SEED_VERSION);
  });

  seed();
}

function buildWorldCup2026MockData() {
  const groups = {
    A: [
      ["mex", "Mexico", "MX"],
      ["kor", "Corea del Sur", "KR"],
      ["rsa", "Sudafrica", "ZA"],
      ["cze", "Chequia", "CZ"]
    ],
    B: [
      ["can", "Canada", "CA"],
      ["sui", "Suiza", "CH"],
      ["qat", "Qatar", "QA"],
      ["bih", "Bosnia y Herzegovina", "BA"]
    ],
    C: [
      ["bra", "Brasil", "BR"],
      ["mar", "Marruecos", "MA"],
      ["sco", "Escocia", "SCT"],
      ["hai", "Haiti", "HT"]
    ],
    D: [
      ["usa", "Estados Unidos", "US"],
      ["par", "Paraguay", "PY"],
      ["aus", "Australia", "AU"],
      ["tur", "Turquia", "TR"]
    ],
    E: [
      ["ger", "Alemania", "DE"],
      ["ecu", "Ecuador", "EC"],
      ["civ", "Costa de Marfil", "CI"],
      ["cuw", "Curazao", "CW"]
    ],
    F: [
      ["ned", "Paises Bajos", "NL"],
      ["jpn", "Japon", "JP"],
      ["tun", "Tunez", "TN"],
      ["swe", "Suecia", "SE"]
    ],
    G: [
      ["bel", "Belgica", "BE"],
      ["irn", "Iran", "IR"],
      ["egy", "Egipto", "EG"],
      ["nzl", "Nueva Zelanda", "NZ"]
    ],
    H: [
      ["esp", "Espana", "ES"],
      ["uru", "Uruguay", "UY"],
      ["ksa", "Arabia Saudita", "SA"],
      ["cpv", "Cabo Verde", "CV"]
    ],
    I: [
      ["fra", "Francia", "FR"],
      ["sen", "Senegal", "SN"],
      ["nor", "Noruega", "NO"],
      ["irq", "Irak", "IQ"]
    ],
    J: [
      ["arg", "Argentina", "AR"],
      ["aut", "Austria", "AT"],
      ["alg", "Argelia", "DZ"],
      ["jor", "Jordania", "JO"]
    ],
    K: [
      ["por", "Portugal", "PT"],
      ["col", "Colombia", "CO"],
      ["uzb", "Uzbekistan", "UZ"],
      ["cod", "RD Congo", "CD"]
    ],
    L: [
      ["eng", "Inglaterra", "ENG"],
      ["cro", "Croacia", "HR"],
      ["pan", "Panama", "PA"],
      ["gha", "Ghana", "GH"]
    ]
  };

  const teams = Object.entries(groups).flatMap(([group, groupTeams]) =>
    groupTeams.map(([id, name, flag]) => ({ id, name, group, flag }))
  );

  const pairings = [
    [0, 1],
    [2, 3],
    [0, 2],
    [1, 3],
    [0, 3],
    [1, 2]
  ];
  const groupDates = [
    "2026-06-11T18:00:00-06:00",
    "2026-06-12T18:00:00-06:00",
    "2026-06-16T18:00:00-06:00",
    "2026-06-17T18:00:00-06:00",
    "2026-06-23T18:00:00-06:00",
    "2026-06-24T18:00:00-06:00"
  ];

  const matches = Object.entries(groups).flatMap(([group, groupTeams], groupIndex) =>
    pairings.map(([homeIndex, awayIndex], matchIndex) => {
      const baseDate = new Date(groupDates[matchIndex]);
      baseDate.setDate(baseDate.getDate() + Math.floor(groupIndex / 3));

      return groupMatch(
        `2026-${group}-${matchIndex + 1}`,
        group,
        groupTeams[homeIndex][0],
        groupTeams[awayIndex][0],
        null,
        null,
        baseDate.toISOString(),
        "pendiente"
      );
    })
  );

  return {
    teams: [...teams, ...buildPlaceholderTeams()],
    matches: [...matches, ...buildKnockoutPlaceholders()]
  };
}

function buildPlaceholderTeams() {
  const stages = [
    ["dieciseisavos", 16, "D32"],
    ["octavos", 8, "OCT"],
    ["cuartos", 4, "QF"],
    ["semifinal", 2, "SF"],
    ["tercer_lugar", 1, "3P"],
    ["final", 1, "F"]
  ];

  return stages.flatMap(([stage, count, prefix]) =>
    Array.from({ length: count }, (_, index) => {
      const id = `${stage}-${index + 1}`;
      return [
        {
          id: `placeholder-home-${id}`,
          name: `${prefix} local ${index + 1}`,
          group: null,
          flag: null
        },
        {
          id: `placeholder-away-${id}`,
          name: `${prefix} visitante ${index + 1}`,
          group: null,
          flag: null
        }
      ];
    }).flat()
  );
}

function buildKnockoutPlaceholders() {
  const rounds = [
    ["dieciseisavos", 16, "2026-06-28T18:00:00-06:00", "D32"],
    ["octavos", 8, "2026-07-04T18:00:00-06:00", "OCT"],
    ["cuartos", 4, "2026-07-09T18:00:00-06:00", "QF"],
    ["semifinal", 2, "2026-07-14T18:00:00-06:00", "SF"],
    ["tercer_lugar", 1, "2026-07-18T18:00:00-06:00", "3P"],
    ["final", 1, "2026-07-19T18:00:00-06:00", "F"]
  ];

  return rounds.flatMap(([stage, count, startTime, prefix]) =>
    Array.from({ length: count }, (_, index) => {
      const id = `${stage}-${index + 1}`;
      const home = `placeholder-home-${id}`;
      const away = `placeholder-away-${id}`;
      const date = new Date(startTime);
      date.setDate(date.getDate() + Math.floor(index / 4));

      return {
        id,
        stage,
        group: null,
        home,
        away,
        homeGoals: null,
        awayGoals: null,
        time: date.toISOString(),
        status: "pendiente"
      };
    })
  );
}

function groupMatch(id, group, home, away, homeGoals, awayGoals, time, status) {
  return {
    id,
    stage: "grupo",
    group,
    home,
    away,
    homeGoals,
    awayGoals,
    time,
    status
  };
}

function knockoutMatch(id, stage, homeName, awayName, homeGoals, awayGoals, time, status) {
  const home = `custom-home-${id}`;
  const away = `custom-away-${id}`;

  db.prepare(`
    INSERT OR IGNORE INTO teams (id, name, group_name, flag)
    VALUES (?, ?, NULL, NULL), (?, ?, NULL, NULL)
  `).run(home, homeName, away, awayName);

  return {
    id,
    stage,
    group: null,
    home,
    away,
    homeGoals,
    awayGoals,
    time,
    status
  };
}

function getTeams() {
  return db.prepare(`
    SELECT id, name, group_name AS groupName, flag
    FROM teams
    ORDER BY group_name, name
  `).all();
}

function getGroupMatches() {
  return getMatchesByWhere("m.stage = 'grupo'");
}

function getKnockoutMatches() {
  return getMatchesByWhere("m.stage != 'grupo'");
}

function getMatchesByWhere(whereSql) {
  return db.prepare(`
    SELECT
      m.id,
      m.stage,
      m.group_name AS groupName,
      m.home_team_id AS homeTeamId,
      home.name AS homeTeamName,
      m.away_team_id AS awayTeamId,
      away.name AS awayTeamName,
      m.home_goals AS homeGoals,
      m.away_goals AS awayGoals,
      m.match_time AS matchTime,
      m.status,
      m.last_api_update AS lastApiUpdate
    FROM matches m
    LEFT JOIN teams home ON home.id = m.home_team_id
    LEFT JOIN teams away ON away.id = m.away_team_id
    WHERE ${whereSql}
    ORDER BY m.match_time
  `).all();
}

function buildGroupTables(teams, matches) {
  const tables = {};

  teams
    .filter((team) => team.groupName)
    .forEach((team) => {
      if (!tables[team.groupName]) tables[team.groupName] = [];
      tables[team.groupName].push({
        teamId: team.id,
        team: team.name,
        flag: team.flag,
        played: 0,
        won: 0,
        drawn: 0,
        lost: 0,
        goalsFor: 0,
        goalsAgainst: 0,
        goalDifference: 0,
        points: 0
      });
    });

  const byTeamId = Object.fromEntries(
    Object.values(tables).flat().map((row) => [row.teamId, row])
  );

  matches
    .filter((match) => match.status === "terminado")
    .filter((match) => match.homeGoals !== null && match.awayGoals !== null)
    .forEach((match) => {
      const home = byTeamId[match.homeTeamId];
      const away = byTeamId[match.awayTeamId];
      if (!home || !away) return;

      applyResult(home, match.homeGoals, match.awayGoals);
      applyResult(away, match.awayGoals, match.homeGoals);
    });

  return Object.fromEntries(
    Object.entries(tables).map(([group, rows]) => [
      group,
      rows
        .map((row) => ({
          ...row,
          goalDifference: row.goalsFor - row.goalsAgainst
        }))
        .sort(compareGroupRows)
        .map((row, index) => ({ position: index + 1, ...row }))
    ])
  );
}

function applyResult(row, goalsFor, goalsAgainst) {
  row.played += 1;
  row.goalsFor += goalsFor;
  row.goalsAgainst += goalsAgainst;

  if (goalsFor > goalsAgainst) {
    row.won += 1;
    row.points += 3;
  } else if (goalsFor === goalsAgainst) {
    row.drawn += 1;
    row.points += 1;
  } else {
    row.lost += 1;
  }
}

function compareGroupRows(a, b) {
  return (
    b.points - a.points ||
    b.goalDifference - a.goalDifference ||
    b.goalsFor - a.goalsFor ||
    a.team.localeCompare(b.team)
  );
}

function groupBracketByRound(matches) {
  const roundNames = {
    dieciseisavos: "Dieciseisavos",
    octavos: "Octavos de final",
    cuartos: "Cuartos de final",
    semifinal: "Semifinales",
    tercer_lugar: "Tercer lugar",
    final: "Final"
  };

  return Object.entries(roundNames).map(([stage, label]) => ({
    stage,
    label,
    matches: matches.filter((match) => match.stage === stage)
  }));
}

async function refreshMatches() {
  if (process.env.DATA_PROVIDER === "api-football") {
    return refreshFromExternalApi();
  }

  if (!process.env.API_FOOTBALL_KEY) {
    return {
      checkedAt: new Date().toISOString(),
      refreshed: 0,
      skipped: db.prepare("SELECT COUNT(*) AS total FROM matches").get().total,
      message:
        "La app esta en modo ejemplo. Para consultar la API real, configura DATA_PROVIDER=api-football y API_FOOTBALL_KEY en .env."
    };
  }

  const matches = db.prepare("SELECT * FROM matches ORDER BY match_time").all();
  const dueMatches = matches.filter((match) => shouldRefreshMatch(match));

  if (dueMatches.length === 0) {
    return {
      checkedAt: new Date().toISOString(),
      refreshed: 0,
      skipped: matches.length,
      message: "Los datos guardados siguen vigentes."
    };
  }

  const provider = createDataProvider();
  const updates = await provider.fetchMatches(dueMatches);
  saveMatchUpdates(updates);

  return {
    checkedAt: new Date().toISOString(),
    refreshed: updates.length,
    skipped: matches.length - dueMatches.length,
    message: updates.length
      ? "Se actualizaron los partidos necesarios."
      : "No hubo datos nuevos para guardar."
  };
}

async function refreshFromExternalApi() {
  const matches = db.prepare("SELECT * FROM matches ORDER BY match_time").all();
  const dueMatches = matches.filter((match) => shouldRefreshMatch(match));

  // Si la base solo tiene datos mock, esta ruta permite importar el torneo real.
  const hasApiFixtures = matches.some((match) => /^\d+$/.test(String(match.id)));
  if (dueMatches.length === 0 && hasApiFixtures) {
    return {
      checkedAt: new Date().toISOString(),
      refreshed: 0,
      skipped: matches.length,
      message: "Los datos guardados siguen vigentes."
    };
  }

  const provider = new ApiFootballProvider();
  const tournamentData = await provider.fetchTournament();
  saveTournamentData(tournamentData);

  return {
    checkedAt: new Date().toISOString(),
    refreshed: tournamentData.matches.length,
    skipped: hasApiFixtures ? matches.length - dueMatches.length : 0,
    message: "Se sincronizaron datos desde la API externa."
  };
}

function shouldRefreshMatch(match) {
  if (match.status === "en vivo") return true;

  const now = Date.now();
  const start = new Date(match.match_time).getTime();
  const refreshAfter =
    start + (MATCH_DURATION_MINUTES + REFRESH_GRACE_MINUTES) * 60 * 1000;
  const lastUpdate = match.last_api_update
    ? new Date(match.last_api_update).getTime()
    : 0;

  return now >= refreshAfter && lastUpdate < refreshAfter;
}

function createDataProvider() {
  if (process.env.DATA_PROVIDER === "api-football") {
    return new ApiFootballProvider();
  }

  return new MockProvider();
}

class MockProvider {
  async fetchMatches(matches) {
    const now = new Date().toISOString();
    return matches.map((match) => ({
      id: match.id,
      homeGoals: match.home_goals,
      awayGoals: match.away_goals,
      status: match.status === "pendiente" ? "terminado" : match.status,
      lastApiUpdate: now
    }));
  }
}

class ApiFootballProvider {
  async fetchTournament() {
    const fixtures = await this.fetchFixtures();
    const now = new Date().toISOString();
    const teamsById = new Map();

    fixtures.forEach((item) => {
      const home = item.teams.home;
      const away = item.teams.away;

      teamsById.set(String(home.id), {
        id: String(home.id),
        name: home.name,
        group: inferGroupName(item.league.round),
        flag: home.code || null
      });

      teamsById.set(String(away.id), {
        id: String(away.id),
        name: away.name,
        group: inferGroupName(item.league.round),
        flag: away.code || null
      });
    });

    return {
      teams: [...teamsById.values()],
      matches: fixtures.map((item) => ({
        id: String(item.fixture.id),
        stage: inferStage(item.league.round),
        group: inferGroupName(item.league.round),
        home: String(item.teams.home.id),
        away: String(item.teams.away.id),
        homeGoals: item.goals.home,
        awayGoals: item.goals.away,
        time: item.fixture.date,
        status: normalizeApiFootballStatus(item.fixture.status.short),
        lastApiUpdate: now
      }))
    };
  }

  async fetchMatches(matches) {
    const fixtures = await this.fetchFixtures();
    const fixtureById = new Map(fixtures.map((item) => [String(item.fixture.id), item]));
    const now = new Date().toISOString();

    return matches
      .map((match) => {
        const fixture = fixtureById.get(String(match.id));
        if (!fixture) return null;

        return {
          id: match.id,
          homeGoals: fixture.goals.home,
          awayGoals: fixture.goals.away,
          status: normalizeApiFootballStatus(fixture.fixture.status.short),
          lastApiUpdate: now
        };
      })
      .filter(Boolean);
  }

  async fetchFixtures() {
    const apiKey = process.env.API_FOOTBALL_KEY;
    if (!apiKey) {
      throw new Error("Falta API_FOOTBALL_KEY en el archivo .env.");
    }

    const baseUrl = process.env.API_FOOTBALL_BASE_URL;
    const host = process.env.API_FOOTBALL_HOST;
    const league = process.env.WORLD_CUP_LEAGUE_ID;
    const season = process.env.WORLD_CUP_SEASON;

    const response = await fetch(
      `${baseUrl}/fixtures?league=${league}&season=${season}`,
      {
        headers: {
          "x-apisports-key": apiKey,
          "x-rapidapi-host": host
        }
      }
    );

    if (!response.ok) {
      throw new Error(`La API externa respondio con estado ${response.status}.`);
    }

    const payload = await response.json();
    return payload.response || [];
  }
}

function inferStage(round = "") {
  const value = round.toLowerCase();
  if (value.includes("round of 32") || value.includes("dieciseisavos")) {
    return "dieciseisavos";
  }
  if (value.includes("round of 16") || value.includes("octavos")) return "octavos";
  if (value.includes("quarter") || value.includes("cuartos")) return "cuartos";
  if (value.includes("semi")) return "semifinal";
  if (value.includes("3rd") || value.includes("third")) return "tercer_lugar";
  if (value.includes("final")) return "final";
  return "grupo";
}

function inferGroupName(round = "") {
  if (inferStage(round) !== "grupo") return null;
  const match = round.match(/group\s+([a-z0-9]+)/i);
  return match ? match[1].toUpperCase() : null;
}

function normalizeApiFootballStatus(status) {
  if (["1H", "HT", "2H", "ET", "BT", "P", "SUSP", "INT"].includes(status)) {
    return "en vivo";
  }

  if (["FT", "AET", "PEN"].includes(status)) {
    return "terminado";
  }

  return "pendiente";
}

function saveMatchUpdates(updates) {
  const update = db.prepare(`
    UPDATE matches
    SET
      home_goals = @homeGoals,
      away_goals = @awayGoals,
      status = @status,
      last_api_update = @lastApiUpdate
    WHERE id = @id
  `);

  const save = (items) => runInTransaction(() => {
    items.forEach((item) => update.run(item));
  });

  save(updates);
}

function saveTournamentData({ teams, matches }) {
  const upsertTeam = db.prepare(`
    INSERT INTO teams (id, name, group_name, flag)
    VALUES (@id, @name, @group, @flag)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      group_name = COALESCE(excluded.group_name, teams.group_name),
      flag = COALESCE(excluded.flag, teams.flag)
  `);

  const upsertMatch = db.prepare(`
    INSERT INTO matches (
      id, stage, group_name, home_team_id, away_team_id, home_goals,
      away_goals, match_time, status, last_api_update
    )
    VALUES (
      @id, @stage, @group, @home, @away, @homeGoals,
      @awayGoals, @time, @status, @lastApiUpdate
    )
    ON CONFLICT(id) DO UPDATE SET
      stage = excluded.stage,
      group_name = excluded.group_name,
      home_team_id = excluded.home_team_id,
      away_team_id = excluded.away_team_id,
      home_goals = excluded.home_goals,
      away_goals = excluded.away_goals,
      match_time = excluded.match_time,
      status = excluded.status,
      last_api_update = excluded.last_api_update
  `);

  const save = () => runInTransaction(() => {
    teams.forEach((team) => upsertTeam.run(team));
    matches.forEach((match) => upsertMatch.run(match));
  });

  save();
}

function runInTransaction(callback) {
  db.exec("BEGIN");
  try {
    callback();
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
