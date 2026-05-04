const fs = require("fs");
const http = require("http");
const path = require("path");
const { DatabaseSync } = require("node:sqlite");

loadEnvFile();

const publicDir = path.join(__dirname, "public");
const db = new DatabaseSync(path.join(__dirname, "database.db"));

const PORT = Number(process.env.PORT || 3000);
const COMPETITION_CACHE_MINUTES = Number(process.env.COMPETITION_CACHE_MINUTES || 180);
const MOCK_SEED_VERSION = "world-cup-2026-v2";
const TOURNAMENTS = {
  worldcup: {
    key: "worldcup",
    label: "Mundial 2026",
    type: "worldcup",
    sportsDbIdEnv: "THESPORTSDB_WORLD_CUP_LEAGUE_ID",
    seasonEnv: "WORLD_CUP_SEASON",
    defaultSportsDbId: "4429",
    defaultSeason: "2026"
  },
  champions: {
    key: "champions",
    label: "Champions League",
    type: "champions",
    seasonEnv: "CHAMPIONS_SEASON",
    sportsDbIdEnv: "THESPORTSDB_CHAMPIONS_LEAGUE_ID",
    defaultSeason: "2025-2026",
    defaultSportsDbId: "4480"
  },
  ligamx: {
    key: "ligamx",
    label: "Liga MX",
    type: "ligamx",
    seasonEnv: "LIGA_MX_SEASON",
    sportsDbIdEnv: "THESPORTSDB_LIGA_MX_LEAGUE_ID",
    defaultSeason: "2025-2026",
    defaultSportsDbId: "4350"
  }
};
const COMPETITIONS = TOURNAMENTS;

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
        provider: "thesportsdb",
        apiConfigured: Boolean(process.env.THESPORTSDB_KEY),
        tournament: "FIFA World Cup 2026",
        lastUpdate: row.lastUpdate || null
      });
      return;
    }

    if (req.method === "GET" && url.pathname.startsWith("/api/competition/")) {
      const key = url.pathname.split("/").pop();
      const competition = TOURNAMENTS[key];

      if (!competition) {
        sendJson(res, 404, { message: "Competicion no encontrada." });
        return;
      }

      const data = await getCompetitionData(competition);
      sendJson(res, 200, data);
      return;
    }

    if (req.method === "GET" && url.pathname.startsWith("/api/tournament/")) {
      const key = url.pathname.split("/").pop();
      const tournament = TOURNAMENTS[key];

      if (!tournament) {
        sendJson(res, 404, { message: "Torneo no encontrado." });
        return;
      }

      const data = await getCompetitionData(tournament);
      sendJson(res, 200, data);
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

    CREATE TABLE IF NOT EXISTS api_cache (
      key TEXT PRIMARY KEY,
      payload TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
}

function seedMockDataIfNeeded() {
  const count = db.prepare("SELECT COUNT(*) AS total FROM teams").get().total;
  const seedVersion = db
    .prepare("SELECT value FROM app_meta WHERE key = 'mock_seed_version'")
    .get();

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
  return refreshFromExternalApi();
}

async function refreshFromExternalApi() {
  const results = [];
  let refreshed = 0;
  const provider = new TheSportsDbProvider();

  for (const competition of Object.values(TOURNAMENTS)) {
    try {
      await fetchAndCacheCompetitionData(competition, provider);
      refreshed += 1;
      results.push(competition.label);
    } catch (error) {
      results.push(`${competition.label} sin cambios (${error.message})`);
    }
  }

  return {
    checkedAt: new Date().toISOString(),
    refreshed,
    skipped: Object.keys(TOURNAMENTS).length - refreshed,
    message: `Revision terminada: ${results.join(", ")}.`
  };
}

async function getCompetitionData(competition) {
  const cacheKey = getCompetitionCacheKey(competition);
  const cached = getCache(cacheKey);
  if (cached && !isCacheExpired(cached.updatedAt)) {
    return {
      ...JSON.parse(cached.payload),
      source: "cache",
      updatedAt: cached.updatedAt
    };
  }

  try {
    return await fetchAndCacheCompetitionData(competition, new TheSportsDbProvider());
  } catch (error) {
    if (cached) {
      return {
        ...JSON.parse(cached.payload),
        source: "cache",
        updatedAt: cached.updatedAt,
        warning: "No se pudo consultar la API; se muestran datos guardados."
      };
    }

    return {
      ...buildCompetitionMockData(competition),
      warning: `No se pudo consultar la API: ${error.message}`
    };
  }
}

async function fetchAndCacheCompetitionData(competition, provider) {
  const config = getCompetitionConfig(competition);
  const apiData = await provider.fetchCompetition(config);
  const payload = {
    key: competition.key,
    label: competition.label,
    season: config.season,
    sportsDbId: config.sportsDbId,
    sportsDbSeason: config.sportsDbSeason,
    source: "thesportsdb",
    format: buildTournamentFormat(competition),
    standings: apiData.standings,
    nextFixtures: apiData.nextFixtures,
    fixtures: apiData.fixtures,
    bracket: buildFinalPhase(competition, apiData)
  };
  const updatedAt = new Date().toISOString();

  setCache(getCompetitionCacheKey(competition), JSON.stringify(payload), updatedAt);
  return { ...payload, updatedAt };
}

function getCompetitionConfig(competition) {
  return {
    season: process.env[competition.seasonEnv] || competition.defaultSeason,
    sportsDbId:
      process.env[competition.sportsDbIdEnv] || competition.defaultSportsDbId,
    sportsDbSeason: process.env[competition.seasonEnv] || competition.defaultSeason
  };
}

function getCompetitionCacheKey(competition) {
  const config = getCompetitionConfig(competition);
  return `competition:thesportsdb:${competition.key}:${config.sportsDbId}:${config.sportsDbSeason}`;
}

function getCache(key) {
  const row = db
    .prepare("SELECT payload, updated_at AS updatedAt FROM api_cache WHERE key = ?")
    .get(key);
  return row || null;
}

function setCache(key, payload, updatedAt) {
  db.prepare(`
    INSERT INTO api_cache (key, payload, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET
      payload = excluded.payload,
      updated_at = excluded.updated_at
  `).run(key, payload, updatedAt);
}

function createCompetitionProvider() {
  return new TheSportsDbProvider();
}

function isCacheExpired(updatedAt) {
  const updated = new Date(updatedAt).getTime();
  const expiresAt = updated + COMPETITION_CACHE_MINUTES * 60 * 1000;
  return Date.now() >= expiresAt;
}

function normalizeStandings(response) {
  return response.flatMap((item) =>
    (item.league.standings || []).map((groupRows) =>
      groupRows.map((row) => ({
        rank: row.rank,
        team: row.team.name,
        logo: row.team.logo,
        played: row.all.played,
        won: row.all.win,
        drawn: row.all.draw,
        lost: row.all.lose,
        goalsFor: row.all.goals.for,
        goalsAgainst: row.all.goals.against,
        goalDifference: row.goalsDiff,
        points: row.points,
        form: row.form || "",
        group: row.group || item.league.name
      }))
    )
  );
}

function normalizeFixtures(fixtures) {
  return fixtures
    .map((item) => ({
      id: String(item.fixture.id),
      round: item.league.round,
      homeTeam: item.teams.home.name,
      awayTeam: item.teams.away.name,
      homeLogo: item.teams.home.logo,
      awayLogo: item.teams.away.logo,
      homeGoals: item.goals.home,
      awayGoals: item.goals.away,
      matchTime: item.fixture.date,
      status: normalizeApiFootballStatus(item.fixture.status.short)
    }))
    .sort((a, b) => new Date(a.matchTime) - new Date(b.matchTime));
}

function buildCompetitionMockData(competition) {
  const config = getCompetitionConfig(competition);
  const isChampions = competition.key === "champions";
  const teams = isChampions
    ? ["Real Madrid", "Manchester City", "Bayern Munich", "Paris Saint-Germain", "Barcelona", "Inter"]
    : ["America", "Cruz Azul", "Tigres", "Monterrey", "Toluca", "Pumas"];

  return {
    key: competition.key,
    label: competition.label,
    season: config.season,
    sportsDbId: config.sportsDbId,
    sportsDbSeason: config.sportsDbSeason,
    source: "mock",
    updatedAt: null,
    format: buildTournamentFormat(competition),
    standings: [
      teams.map((team, index) => ({
        rank: index + 1,
        team,
        logo: null,
        played: Math.max(0, 6 - index),
        won: Math.max(0, 4 - index),
        drawn: index % 2,
        lost: Math.floor(index / 3),
        goalsFor: 12 - index,
        goalsAgainst: 5 + index,
        goalDifference: 7 - index * 2,
        points: 13 - index * 2,
        form: index < 3 ? "W W D" : "D L W",
        group: isChampions ? "Fase liga" : "Tabla general"
      }))
    ],
    fixtures: teams.slice(0, 4).map((team, index) => ({
      id: `${competition.key}-mock-${index + 1}`,
      round: isChampions ? "League Stage" : "Jornada",
      homeTeam: team,
      awayTeam: teams[index + 2],
      homeLogo: null,
      awayLogo: null,
      homeGoals: null,
      awayGoals: null,
      matchTime: new Date(Date.now() + (index + 1) * 86400000).toISOString(),
      status: "pendiente"
    })),
    nextFixtures: teams.slice(0, 4).map((team, index) => ({
      id: `${competition.key}-next-${index + 1}`,
      round: isChampions ? "Proximo partido" : "Proxima jornada",
      homeTeam: team,
      awayTeam: teams[index + 2],
      homeLogo: null,
      awayLogo: null,
      homeGoals: null,
      awayGoals: null,
      matchTime: new Date(Date.now() + (index + 1) * 86400000).toISOString(),
      status: "pendiente"
    })),
    bracket: buildFinalPhase(competition, {
      standings: [
        teams.map((team, index) => ({
          rank: index + 1,
          team,
          points: 13 - index * 2
        }))
      ],
      fixtures: []
    })
  };
}

class TheSportsDbProvider {
  async fetchCompetition(config) {
    const seasonPayload = await this.request(
      `/eventsseason.php?id=${config.sportsDbId}&s=${encodeURIComponent(config.sportsDbSeason)}`,
      { optional: true }
    );
    const nextPayload = await this.request(
      `/eventsnextleague.php?id=${config.sportsDbId}`
    );
    const standingsPayload = await this.request(
      `/lookuptable.php?l=${config.sportsDbId}&s=${config.sportsDbSeason}`,
      { optional: true }
    );

    const seasonFixtures = normalizeTheSportsDbFixtures(seasonPayload.events || []);
    const nextFixtures = normalizeTheSportsDbFixtures(nextPayload.events || []).sort(
      (a, b) => new Date(a.matchTime) - new Date(b.matchTime)
    );

    return {
      standings: normalizeTheSportsDbStandings(standingsPayload.table || []),
      fixtures: seasonFixtures,
      nextFixtures
    };
  }

  async request(endpoint) {
    const key = process.env.THESPORTSDB_KEY || "123";
    const baseUrl =
      process.env.THESPORTSDB_BASE_URL || "https://www.thesportsdb.com/api/v1/json";
    const response = await fetch(`${baseUrl}/${key}${endpoint}`);

    if (!response.ok) {
      throw new Error(`TheSportsDB respondio con estado ${response.status}.`);
    }

    const body = await response.text();
    if (!body.trim()) {
      return {};
    }

    try {
      return JSON.parse(body);
    } catch (error) {
      if (options.optional) {
        return {};
      }

      throw new Error(
        `TheSportsDB no devolvio JSON para ${endpoint}. Revisa que THESPORTSDB_KEY sea solo el numero, por ejemplo 123.`
      );
    }
  }
}

function normalizeTheSportsDbStandings(rows) {
  if (!rows.length) return [];

  return [
    rows.map((row, index) => ({
      rank: Number(row.intRank || index + 1),
      team: row.strTeam,
      logo: row.strTeamBadge || null,
      played: Number(row.intPlayed || 0),
      won: Number(row.intWin || 0),
      drawn: Number(row.intDraw || 0),
      lost: Number(row.intLoss || 0),
      goalsFor: Number(row.intGoalsFor || 0),
      goalsAgainst: Number(row.intGoalsAgainst || 0),
      goalDifference: Number(row.intGoalDifference || 0),
      points: Number(row.intPoints || 0),
      form: row.strForm || "",
      group: row.strLeague || "Tabla"
    }))
  ];
}

function normalizeTheSportsDbFixtures(events) {
  return events
    .map((event) => {
      const homeGoals = parseNullableNumber(event.intHomeScore);
      const awayGoals = parseNullableNumber(event.intAwayScore);

      return {
        id: String(event.idEvent),
        round: event.intRound ? `Ronda ${event.intRound}` : event.strLeague,
        homeTeam: event.strHomeTeam,
        awayTeam: event.strAwayTeam,
        homeLogo: event.strHomeTeamBadge || null,
        awayLogo: event.strAwayTeamBadge || null,
        homeGoals,
        awayGoals,
        matchTime: buildTheSportsDbDate(event),
        status: homeGoals === null || awayGoals === null ? "pendiente" : "terminado"
      };
    })
    .sort((a, b) => new Date(b.matchTime) - new Date(a.matchTime));
}

function buildTheSportsDbDate(event) {
  const date = event.dateEvent || new Date().toISOString().slice(0, 10);
  const time = event.strTimestamp
    ? event.strTimestamp
    : `${date}T${event.strTime || "00:00:00"}Z`;

  return new Date(time).toISOString();
}

function parseNullableNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  return Number(value);
}

function buildTournamentFormat(competition) {
  if (competition.type === "worldcup") {
    return {
      tableLabel: "Grupos A-L",
      finalLabel: "Fase eliminatoria",
      notes: [
        "48 selecciones en 12 grupos de cuatro.",
        "Avanzan los dos primeros de cada grupo y los ocho mejores terceros.",
        "La eliminatoria va de dieciseisavos a final, con partido por tercer lugar."
      ]
    };
  }

  if (competition.type === "champions") {
    return {
      tableLabel: "Fase liga",
      finalLabel: "Knockout",
      notes: [
        "36 clubes compiten en una sola tabla.",
        "Los puestos 1-8 avanzan directo a octavos.",
        "Los puestos 9-24 juegan un play-off a doble partido por los otros lugares."
      ]
    };
  }

  return {
    tableLabel: "Tabla general",
    finalLabel: "Liguilla",
    notes: [
      "Liga MX usa torneos cortos con tabla general.",
      "En Clausura 2026 el formato se simplifica: los ocho mejores pasan directo a cuartos.",
      "Cuartos, semifinales y final se juegan a ida y vuelta."
    ]
  };
}

function buildFinalPhase(competition, apiData) {
  const fixtures = (apiData.fixtures || []).filter((fixture) =>
    isFinalPhaseRound(competition, fixture.round)
  );

  if (fixtures.length) {
    return groupFixturesByRound(fixtures);
  }

  const rows = apiData.standings?.[0] || [];
  if (competition.type === "champions") {
    return buildChampionsProjection(rows);
  }

  if (competition.type === "ligamx") {
    return buildLigaMxProjection(rows);
  }

  return buildWorldCupProjection();
}

function isFinalPhaseRound(competition, round = "") {
  const value = String(round).toLowerCase();
  if (competition.type === "worldcup") {
    return /round of 32|round of 16|quarter|semi|third|final|dieciseis|octavos|cuartos|semifinal/.test(value);
  }

  if (competition.type === "champions") {
    return /play.?off|round of 16|quarter|semi|final|knockout|octavos|cuartos|semifinal/.test(value);
  }

  return /play.?in|reclassification|quarter|semi|final|cuartos|semifinal|liguilla/.test(value);
}

function groupFixturesByRound(fixtures) {
  const groups = new Map();
  fixtures.forEach((fixture) => {
    const round = fixture.round || "Fase final";
    if (!groups.has(round)) groups.set(round, []);
    groups.get(round).push(fixture);
  });

  return [...groups.entries()].map(([label, matches]) => ({
    label,
    matches: matches.sort((a, b) => new Date(a.matchTime) - new Date(b.matchTime))
  }));
}

function buildChampionsProjection(rows) {
  const byRank = Object.fromEntries(rows.map((row) => [row.rank, row]));
  return [
    {
      label: "Directos a octavos",
      matches: Array.from({ length: 8 }, (_, index) =>
        placeholderMatch(`Seed ${index + 1}`, byRank[index + 1]?.team || `Puesto ${index + 1}`)
      )
    },
    {
      label: "Play-off 9-24",
      matches: Array.from({ length: 8 }, (_, index) =>
        placeholderMatch(
          byRank[9 + index]?.team || `Puesto ${9 + index}`,
          byRank[24 - index]?.team || `Puesto ${24 - index}`
        )
      )
    },
    {
      label: "Octavos a final",
      matches: [
        placeholderMatch("Ganador play-off", "Top 8 sembrado"),
        placeholderMatch("Ganador semifinal 1", "Ganador semifinal 2")
      ]
    }
  ];
}

function buildLigaMxProjection(rows) {
  const byRank = Object.fromEntries(rows.map((row) => [row.rank, row]));
  return [
    {
      label: "Cuartos de final",
      matches: [
        placeholderMatch(byRank[1]?.team || "1°", byRank[8]?.team || "8°"),
        placeholderMatch(byRank[2]?.team || "2°", byRank[7]?.team || "7°"),
        placeholderMatch(byRank[3]?.team || "3°", byRank[6]?.team || "6°"),
        placeholderMatch(byRank[4]?.team || "4°", byRank[5]?.team || "5°")
      ]
    },
    {
      label: "Semifinales",
      matches: [
        placeholderMatch("Ganador QF 1", "Ganador QF 4"),
        placeholderMatch("Ganador QF 2", "Ganador QF 3")
      ]
    },
    {
      label: "Final",
      matches: [placeholderMatch("Ganador SF 1", "Ganador SF 2")]
    }
  ];
}

function buildWorldCupProjection() {
  return [
    {
      label: "Dieciseisavos",
      matches: Array.from({ length: 16 }, (_, index) =>
        placeholderMatch(`Clasificado ${index * 2 + 1}`, `Clasificado ${index * 2 + 2}`)
      )
    },
    {
      label: "Octavos",
      matches: Array.from({ length: 8 }, (_, index) =>
        placeholderMatch(`Ganador D32 ${index * 2 + 1}`, `Ganador D32 ${index * 2 + 2}`)
      )
    },
    {
      label: "Cuartos / Semis / Final",
      matches: [
        placeholderMatch("Ganador QF 1", "Ganador QF 2"),
        placeholderMatch("Ganador SF 1", "Ganador SF 2"),
        placeholderMatch("Perdedor SF 1", "Perdedor SF 2")
      ]
    }
  ];
}

function placeholderMatch(homeTeam, awayTeam) {
  return {
    id: `${homeTeam}-${awayTeam}`,
    round: "Proyeccion",
    homeTeam,
    awayTeam,
    homeLogo: null,
    awayLogo: null,
    homeGoals: null,
    awayGoals: null,
    matchTime: null,
    status: "pendiente"
  };
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
