const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");
const { DatabaseSync } = require("node:sqlite");

loadEnvFile();

const publicDir = path.join(__dirname, "public");
const db = new DatabaseSync(path.join(__dirname, "database.db"));

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || "0.0.0.0";
const COMPETITION_CACHE_MINUTES = Number(process.env.COMPETITION_CACHE_MINUTES || 180);
const MOCK_SEED_VERSION = "world-cup-2026-v2";
const API_CACHE_VERSION = "v11";
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
const VERIFIED_SNAPSHOTS = {
  worldcup: buildVerifiedWorldCupSnapshot(),
  ligamx: buildVerifiedLigaMxSnapshot(),
  champions: buildVerifiedChampionsSnapshot()
};

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

    if (req.method === "POST" && url.pathname.startsWith("/api/refresh/")) {
      await readBody(req);
      const key = url.pathname.split("/").pop();
      const tournament = TOURNAMENTS[key];

      if (!tournament) {
        sendJson(res, 404, { message: "Torneo no encontrado." });
        return;
      }

      const result = await refreshTournament(tournament);
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

server.listen(PORT, HOST, () => {
  const urls = [`http://localhost:${PORT}`];
  getLocalNetworkUrls(PORT).forEach((url) => urls.push(url));
  console.log(`Mundial Dashboard listo en ${urls.join(" | ")}`);
});

function getLocalNetworkUrls(port) {
  const interfaces = os.networkInterfaces();
  return Object.values(interfaces)
    .flat()
    .filter(Boolean)
    .filter((item) => item.family === "IPv4" && !item.internal)
    .map((item) => `http://${item.address}:${port}`);
}

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

async function refreshTournament(tournament) {
  const provider = new TheSportsDbProvider();

  try {
    await fetchAndCacheCompetitionData(tournament, provider);
    return {
      checkedAt: new Date().toISOString(),
      refreshed: 1,
      skipped: 0,
      message: `Revision terminada: ${tournament.label} actualizado.`
    };
  } catch (error) {
    return {
      checkedAt: new Date().toISOString(),
      refreshed: 0,
      skipped: 1,
      message: `${tournament.label} sin cambios (${error.message}).`
    };
  }
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

    const snapshot = VERIFIED_SNAPSHOTS[competition.key];
    if (snapshot) {
      return {
        key: competition.key,
        label: competition.label,
        season: getCompetitionConfig(competition).season,
        sportsDbId: getCompetitionConfig(competition).sportsDbId,
        sportsDbSeason: getCompetitionConfig(competition).sportsDbSeason,
        source: "verified-snapshot",
        format: buildTournamentFormat(competition),
        standings: snapshot.standings,
        nextFixtures: snapshot.nextFixtures,
        fixtures: snapshot.fixtures,
        bracket: buildFinalPhase(competition, snapshot),
        dataQuality: "verified-snapshot",
        warning: `No se pudo consultar TheSportsDB: ${error.message}`
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
  const standings = buildStandings(competition, apiData);
  const trustedData = applyVerifiedSnapshotIfNeeded(competition, {
    standings,
    fixtures: apiData.fixtures,
    nextFixtures: apiData.nextFixtures
  });
  const payload = {
    key: competition.key,
    label: competition.label,
    season: config.season,
    sportsDbId: config.sportsDbId,
    sportsDbSeason: config.sportsDbSeason,
    source: "thesportsdb",
    format: buildTournamentFormat(competition),
    standings: trustedData.standings,
    nextFixtures: trustedData.nextFixtures,
    fixtures: trustedData.fixtures,
    bracket: buildFinalPhase(competition, {
      ...trustedData
    }),
    dataQuality: trustedData.dataQuality || "api"
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
  return `competition:${API_CACHE_VERSION}:thesportsdb:${competition.key}:${config.sportsDbId}:${config.sportsDbSeason}`;
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

  async request(endpoint, options = {}) {
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
        round: event.strRound || (event.intRound ? `Ronda ${event.intRound}` : event.strLeague),
        rawRound: event.strRound || event.intRound || "",
        group: event.strGroup || null,
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

function buildStandings(competition, apiData) {
  const apiStandings = apiData.standings || [];
  const fixtureStandings = buildStandingsFromFixtures(
    competition,
    apiData.fixtures || []
  );

  if (competition.type === "worldcup") {
    return fixtureStandings.length ? fixtureStandings : apiStandings;
  }

  const apiRows = apiStandings.flat().length;
  const fixtureRows = fixtureStandings.flat().length;

  if (fixtureRows > apiRows || apiRows < getExpectedMinimumRows(competition)) {
    return fixtureStandings.length ? fixtureStandings : apiStandings;
  }

  return apiStandings;
}

function applyVerifiedSnapshotIfNeeded(competition, data) {
  const snapshot = VERIFIED_SNAPSHOTS[competition.key];
  if (!snapshot) {
    return { ...data, dataQuality: "api" };
  }

  if (competition.type === "worldcup") {
    const hasTwelveGroups = data.standings.length === 12;
    const everyGroupHasFour = data.standings.every((group) => group.length === 4);
    if (!hasTwelveGroups || !everyGroupHasFour) {
      return {
        ...snapshot,
        dataQuality: "verified-snapshot"
      };
    }
  }

  if (competition.type === "ligamx") {
    const rows = data.standings[0] || [];
    const topEight = rows.slice(0, 8).map((row) => row.team);
    const expectedTopEight = snapshot.standings[0].slice(0, 8).map((row) => row.team);
    const missingTopTeams = expectedTopEight.some((team) => !topEight.includes(team));
    if (rows.length < 18 || missingTopTeams) {
      return {
        ...snapshot,
        dataQuality: "verified-snapshot"
      };
    }
  }

  if (competition.type === "champions") {
    const rows = data.standings[0] || [];
    const topEight = rows.slice(0, 8).map((row) => row.team);
    const expectedTopEight = snapshot.standings[0].slice(0, 8).map((row) => row.team);
    const missingTopTeams = expectedTopEight.some((team) => !topEight.includes(team));
    if (rows.length < 36 || missingTopTeams) {
      return {
        ...snapshot,
        dataQuality: "verified-snapshot"
      };
    }
  }

  return { ...data, dataQuality: "api" };
}

function getExpectedMinimumRows(competition) {
  if (competition.type === "ligamx") return 8;
  if (competition.type === "champions") return 24;
  return 12;
}

function buildStandingsFromFixtures(competition, fixtures) {
  const regularFixtures = fixtures.filter(
    (fixture) => fixture.homeTeam && fixture.awayTeam && !isFinalPhaseRound(competition, fixture.round)
  );
  const rowsByGroup = new Map();

  regularFixtures.forEach((fixture) => {
    const group = getFixtureGroup(competition, fixture);
    if (!rowsByGroup.has(group)) rowsByGroup.set(group, new Map());
    const groupRows = rowsByGroup.get(group);

    ensureStandingRow(groupRows, fixture.homeTeam, fixture.homeLogo, group);
    ensureStandingRow(groupRows, fixture.awayTeam, fixture.awayLogo, group);

    if (fixture.homeGoals === null || fixture.awayGoals === null) return;

    applyStandingResult(
      groupRows.get(fixture.homeTeam),
      fixture.homeGoals,
      fixture.awayGoals
    );
    applyStandingResult(
      groupRows.get(fixture.awayTeam),
      fixture.awayGoals,
      fixture.homeGoals
    );
  });

  return [...rowsByGroup.entries()]
    .sort(([a], [b]) => a.localeCompare(b, "es"))
    .map(([, groupRows]) =>
      [...groupRows.values()]
        .map((row) => ({
          ...row,
          goalDifference: row.goalsFor - row.goalsAgainst
        }))
        .sort(compareStandingRows)
        .map((row, index) => ({ ...row, rank: index + 1 }))
    );
}

function ensureStandingRow(groupRows, team, logo, group) {
  if (groupRows.has(team)) return;

  groupRows.set(team, {
    rank: 0,
    team,
    logo,
    played: 0,
    won: 0,
    drawn: 0,
    lost: 0,
    goalsFor: 0,
    goalsAgainst: 0,
    goalDifference: 0,
    points: 0,
    form: "",
    group
  });
}

function applyStandingResult(row, goalsFor, goalsAgainst) {
  row.played += 1;
  row.goalsFor += goalsFor;
  row.goalsAgainst += goalsAgainst;

  if (goalsFor > goalsAgainst) {
    row.won += 1;
    row.points += 3;
    row.form += "W";
  } else if (goalsFor === goalsAgainst) {
    row.drawn += 1;
    row.points += 1;
    row.form += "D";
  } else {
    row.lost += 1;
    row.form += "L";
  }
}

function compareStandingRows(a, b) {
  return (
    b.points - a.points ||
    b.goalDifference - a.goalDifference ||
    b.goalsFor - a.goalsFor ||
    a.team.localeCompare(b.team, "es")
  );
}

function getFixtureGroup(competition, fixture) {
  if (competition.type === "worldcup") {
    return (
      fixture.group ||
      getWorldCupGroup(fixture.homeTeam) ||
      getWorldCupGroup(fixture.awayTeam) ||
      "Grupo"
    );
  }

  if (competition.type === "champions") return "Fase liga";
  return "Tabla general";
}

function getWorldCupGroup(team = "") {
  const normalized = normalizeTeamName(team);
  const groups = {
    A: ["mexico", "south africa", "south korea", "czech republic"],
    B: ["canada", "bosnia-herzegovina", "bosnia and herzegovina", "qatar", "switzerland"],
    C: ["brazil", "morocco", "haiti", "scotland"],
    D: ["usa", "united states", "paraguay", "australia", "turkey", "turkiye", "türkiye"],
    E: ["germany", "curacao", "curaçao", "ivory coast", "ecuador"],
    F: ["netherlands", "japan", "sweden", "tunisia"],
    G: ["belgium", "egypt", "iran", "new zealand"],
    H: ["spain", "cape verde", "saudi arabia", "uruguay"],
    I: ["france", "senegal", "iraq", "norway"],
    J: ["argentina", "algeria", "austria", "jordan"],
    K: ["portugal", "dr congo", "rd congo", "uzbekistan", "colombia"],
    L: ["england", "croatia", "ghana", "panama"]
  };

  for (const [group, teams] of Object.entries(groups)) {
    if (teams.some((item) => normalized.includes(item))) return group;
  }

  return null;
}

function normalizeTeamName(team) {
  return String(team)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
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

  const rows = apiData.standings?.[0] || [];
  if (fixtures.length) {
    return groupFixturesByRound(fixtures, competition, rows);
  }

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

function groupFixturesByRound(fixtures, competition, rows = []) {
  const groups = new Map();
  fixtures.forEach((fixture) => {
    const roundKey = normalizeBracketRoundKey(competition, fixture.round);
    if (!roundKey) return;
    if (!groups.has(roundKey)) groups.set(roundKey, []);
    groups.get(roundKey).push(fixture);
  });

  const schema = getBracketSchema(competition, [...groups.keys()]);

  return schema.map((round) => {
    const roundFixtures = groups.get(round.key) || [];
    const series = roundFixtures.length
      ? buildSeries(roundFixtures, competition, round.label, rows)
      : [];

    const matches = Array.from({ length: round.slots }, (_, index) =>
      series[index] || buildPlaceholderSeries(round, index, competition, rows)
    );

    return {
      key: round.key,
      label: round.label,
      matches
    };
  });
}

function buildSeries(fixtures, competition, roundLabel, rows = []) {
  const seriesByPair = new Map();
  const logosByTeam = Object.fromEntries(
    rows
      .filter((row) => row.logo)
      .map((row) => [normalizeTeamName(row.team), row.logo])
  );
  const sortedFixtures = fixtures.sort(
    (a, b) => new Date(a.matchTime || 0) - new Date(b.matchTime || 0)
  );

  sortedFixtures.forEach((fixture) => {
    const pairKey = getPairKey(fixture.homeTeam, fixture.awayTeam);
    if (!seriesByPair.has(pairKey)) {
      seriesByPair.set(pairKey, {
        id: pairKey,
        round: fixture.round,
        homeTeam: fixture.homeTeam,
        awayTeam: fixture.awayTeam,
        homeLogo: fixture.homeLogo || logosByTeam[normalizeTeamName(fixture.homeTeam)] || null,
        awayLogo: fixture.awayLogo || logosByTeam[normalizeTeamName(fixture.awayTeam)] || null,
        homeGoals: fixture.homeGoals,
        awayGoals: fixture.awayGoals,
        aggregateHomeGoals: 0,
        aggregateAwayGoals: 0,
        matchTime: fixture.matchTime,
        status: fixture.status,
        legs: []
      });
    }

    const series = seriesByPair.get(pairKey);
    series.legs.push(fixture);

    if (fixture.homeGoals !== null && fixture.awayGoals !== null) {
      if (fixture.homeTeam === series.homeTeam) {
        series.aggregateHomeGoals += fixture.homeGoals;
        series.aggregateAwayGoals += fixture.awayGoals;
      } else {
        series.aggregateHomeGoals += fixture.awayGoals;
        series.aggregateAwayGoals += fixture.homeGoals;
      }
    }

    const latestPlayed = [...series.legs]
      .filter((leg) => leg.homeGoals !== null && leg.awayGoals !== null)
      .at(-1);

    if (latestPlayed) {
      series.homeGoals =
        latestPlayed.homeTeam === series.homeTeam
          ? latestPlayed.homeGoals
          : latestPlayed.awayGoals;
      series.awayGoals =
        latestPlayed.awayTeam === series.awayTeam
          ? latestPlayed.awayGoals
          : latestPlayed.homeGoals;
      series.status = "terminado";
    }

    const nextLeg = series.legs.find(
      (leg) => leg.homeGoals === null || leg.awayGoals === null
    );
    if (nextLeg) {
      series.matchTime = nextLeg.matchTime;
      series.status = "pendiente";
    }

    series.expectedLegs = getExpectedLegs(competition, roundLabel);
    series.legLabel = getLegLabel(series, series.expectedLegs);
  });

  return [...seriesByPair.values()];
}

function getPairKey(homeTeam, awayTeam) {
  return [homeTeam, awayTeam].map(normalizeTeamName).sort().join("__");
}

function getExpectedLegs(competition, roundLabel = "") {
  const value = String(roundLabel).toLowerCase();
  if (competition.type === "worldcup") return 1;
  if (competition.type === "champions" && /\bfinal\b/.test(value) && !value.includes("semi")) {
    return 1;
  }
  return 2;
}

function getLegLabel(series, expectedLegs) {
  const played = series.legs.filter(
    (leg) => leg.homeGoals !== null && leg.awayGoals !== null
  ).length;

  if (expectedLegs <= 1) {
    return played ? "Partido unico jugado" : "Partido unico";
  }

  if (played === 0) return "Ida pendiente";
  if (played === 1) return "Ida jugada / vuelta pendiente";
  return "Serie completa";
}

function getBracketSchema(competition, existingRoundKeys = []) {
  const schemas = {
    worldcup: [
      { key: "dieciseisavos", label: "Dieciseisavos", slots: 16 },
      { key: "octavos", label: "Octavos de final", slots: 8 },
      { key: "cuartos", label: "Cuartos de final", slots: 4 },
      { key: "semifinal", label: "Semifinales", slots: 2 },
      { key: "final", label: "Final", slots: 1 },
      { key: "tercer_lugar", label: "Tercer lugar", slots: 1 }
    ],
    champions: [
      { key: "semifinal", label: "Semifinales", slots: 2 },
      { key: "final", label: "Final", slots: 1 }
    ],
    ligamx: [
      { key: "cuartos", label: "Cuartos de final", slots: 4 },
      { key: "semifinal", label: "Semifinales", slots: 2 },
      { key: "final", label: "Final", slots: 1 }
    ]
  };

  return schemas[competition.type] || [];
}

function normalizeBracketRoundKey(competition, round = "") {
  const value = String(round).toLowerCase();

  if (competition.type === "worldcup") {
    if (value.includes("round of 32") || value.includes("dieciseis")) return "dieciseisavos";
    if (value.includes("round of 16") || value.includes("octavos")) return "octavos";
    if (value.includes("quarter") || value.includes("cuartos")) return "cuartos";
    if (value.includes("semi")) return "semifinal";
    if (value.includes("3rd") || value.includes("third")) return "tercer_lugar";
    if (/\bfinal\b/.test(value)) return "final";
    return null;
  }

  if (value.includes("quarter") || value.includes("cuartos")) return "cuartos";
  if (value.includes("play-off") || value.includes("playoff") || value.includes("knockout round")) return "playoff";
  if (value.includes("round of 16") || value.includes("octavos")) return "octavos";
  if (value.includes("semi")) return "semifinal";
  if (/\bfinal\b/.test(value) && !value.includes("semi")) return "final";
  return null;
}

function buildPlaceholderSeries(round, index, competition = {}, rows = []) {
  const [home, away] = getPlaceholderTeamsForRound(round, index, competition, rows);
  return placeholderMatch(home, away, {
    round: round.label,
    status: "pendiente",
    legLabel: "Cruce por definir",
    placeholder: true
  });
}

function getPlaceholderTeamsForRound(round, index, competition = {}, rows = []) {
  const slot = index + 1;
  const byRank = Object.fromEntries(rows.map((row) => [row.rank, row]));

  if (competition.type === "champions") {
    if (round.key === "playoff") {
      return [
        teamSlot(byRank[9 + index], `Puesto ${9 + index}`),
        teamSlot(byRank[24 - index], `Puesto ${24 - index}`)
      ];
    }

    if (round.key === "octavos") {
      return [
        teamSlot(byRank[index + 1], `Clasificado ${index + 1}`),
        teamSlot(null, `Ganador play-off ${index + 1}`)
      ];
    }
  }

  if (competition.type === "ligamx" && round.key === "cuartos") {
    const pairs = [
      [1, 8],
      [2, 7],
      [3, 6],
      [4, 5]
    ];
    const [homeRank, awayRank] = pairs[index] || [];
    return [
      teamSlot(byRank[homeRank], `${homeRank || "?"}`),
      teamSlot(byRank[awayRank], `${awayRank || "?"}`)
    ];
  }

  const maps = {
    dieciseisavos: [`Clasificado ${slot * 2 - 1}`, `Clasificado ${slot * 2}`],
    octavos: [`Ganador D32 ${slot * 2 - 1}`, `Ganador D32 ${slot * 2}`],
    cuartos: [`Ganador llave ${slot * 2 - 1}`, `Ganador llave ${slot * 2}`],
    semifinal: [`Ganador llave ${slot * 2 - 1}`, `Ganador llave ${slot * 2}`],
    final: ["Ganador llave 1", "Ganador llave 2"],
    tercer_lugar: ["Perdedor semi 1", "Perdedor semi 2"]
  };

  if (round.key === "semifinal" && round.slots === 2) {
    const values = slot === 1
      ? ["Ganador llave 1", "Ganador llave 4"]
      : ["Ganador llave 2", "Ganador llave 3"];
    return values.map((team) => teamSlot(null, team));
  }

  return (maps[round.key] || ["Por definir", "Por definir"]).map((team) =>
    teamSlot(null, team)
  );
}

function teamSlot(row, fallback) {
  return {
    name: row?.team || fallback,
    logo: row?.logo || null
  };
}

function buildChampionsProjection(rows) {
  return getBracketSchema({ type: "champions" }).map((round) => ({
    key: round.key,
    label: round.label,
    matches: Array.from({ length: round.slots }, (_, index) =>
      buildPlaceholderSeries(round, index, { type: "champions" }, rows)
    )
  }));
}

function buildLigaMxProjection(rows) {
  return getBracketSchema({ type: "ligamx" }).map((round) => ({
    key: round.key,
    label: round.label,
    matches: Array.from({ length: round.slots }, (_, index) =>
      buildPlaceholderSeries(round, index, { type: "ligamx" }, rows)
    )
  }));
}

function buildWorldCupProjection() {
  return getBracketSchema({ type: "worldcup" }).map((round) => ({
    key: round.key,
    label: round.label,
    matches: Array.from({ length: round.slots }, (_, index) =>
      buildPlaceholderSeries(round, index, { type: "worldcup" })
    )
  }));
}

function placeholderMatch(homeTeam, awayTeam, overrides = {}) {
  return {
    id: `${getTeamSlotName(homeTeam)}-${getTeamSlotName(awayTeam)}`,
    round: "Proyeccion",
    homeTeam: getTeamSlotName(homeTeam),
    awayTeam: getTeamSlotName(awayTeam),
    homeLogo: homeTeam?.logo || null,
    awayLogo: awayTeam?.logo || null,
    homeGoals: null,
    awayGoals: null,
    matchTime: null,
    status: "pendiente",
    aggregateHomeGoals: null,
    aggregateAwayGoals: null,
    legs: [],
    placeholder: true,
    ...overrides
  };
}

function getTeamSlotName(team) {
  return typeof team === "string" ? team : team?.name || "Por definir";
}

function buildVerifiedWorldCupSnapshot() {
  const groups = {
    A: ["Mexico", "South Korea", "South Africa", "Czechia"],
    B: ["Canada", "Switzerland", "Qatar", "Bosnia-Herzegovina"],
    C: ["Brazil", "Morocco", "Scotland", "Haiti"],
    D: ["USA", "Paraguay", "Australia", "Turkiye"],
    E: ["Germany", "Ecuador", "Ivory Coast", "Curacao"],
    F: ["Netherlands", "Japan", "Tunisia", "Sweden"],
    G: ["Belgium", "Iran", "Egypt", "New Zealand"],
    H: ["Spain", "Uruguay", "Saudi Arabia", "Cape Verde"],
    I: ["France", "Senegal", "Norway", "Iraq"],
    J: ["Argentina", "Austria", "Algeria", "Jordan"],
    K: ["Portugal", "Colombia", "Uzbekistan", "DR Congo"],
    L: ["England", "Croatia", "Panama", "Ghana"]
  };

  return {
    standings: Object.entries(groups).map(([group, teams]) =>
      teams.map((team, index) => ({
        rank: index + 1,
        team,
        logo: getWorldCupFlagLogo(team),
        played: 0,
        won: 0,
        drawn: 0,
        lost: 0,
        goalsFor: 0,
        goalsAgainst: 0,
        goalDifference: 0,
        points: 0,
        form: "",
        group
      }))
    ),
    fixtures: [],
    nextFixtures: []
  };
}

function getWorldCupFlagLogo(team) {
  const countryCodes = {
    "Mexico": "mx",
    "South Korea": "kr",
    "South Africa": "za",
    "Czechia": "cz",
    "Canada": "ca",
    "Switzerland": "ch",
    "Qatar": "qa",
    "Bosnia-Herzegovina": "ba",
    "Brazil": "br",
    "Morocco": "ma",
    "Scotland": "gb-sct",
    "Haiti": "ht",
    "USA": "us",
    "Paraguay": "py",
    "Australia": "au",
    "Turkiye": "tr",
    "Germany": "de",
    "Ecuador": "ec",
    "Ivory Coast": "ci",
    "Curacao": "cw",
    "Netherlands": "nl",
    "Japan": "jp",
    "Tunisia": "tn",
    "Sweden": "se",
    "Belgium": "be",
    "Iran": "ir",
    "Egypt": "eg",
    "New Zealand": "nz",
    "Spain": "es",
    "Uruguay": "uy",
    "Saudi Arabia": "sa",
    "Cape Verde": "cv",
    "France": "fr",
    "Senegal": "sn",
    "Norway": "no",
    "Iraq": "iq",
    "Argentina": "ar",
    "Austria": "at",
    "Algeria": "dz",
    "Jordan": "jo",
    "Portugal": "pt",
    "Colombia": "co",
    "Uzbekistan": "uz",
    "DR Congo": "cd",
    "England": "gb-eng",
    "Croatia": "hr",
    "Panama": "pa",
    "Ghana": "gh"
  };

  const code = countryCodes[team];
  return code ? `https://flagcdn.com/w40/${code}.png` : null;
}

function buildVerifiedLigaMxSnapshot() {
  const rows = [
    row(1, "Pumas UNAM", 17, 10, 6, 1, 34, 17, 17, 36),
    row(2, "CD Guadalajara", 17, 11, 3, 3, 33, 17, 16, 36),
    row(3, "Cruz Azul", 17, 9, 6, 2, 31, 18, 13, 33),
    row(4, "Pachuca", 17, 9, 4, 4, 25, 19, 6, 31),
    row(5, "Toluca", 17, 8, 6, 3, 28, 16, 12, 30),
    row(6, "Atlas", 17, 7, 5, 5, 22, 24, -2, 26),
    row(7, "Tigres UANL", 17, 7, 4, 6, 26, 16, 10, 25),
    row(8, "Club America", 17, 7, 4, 6, 21, 18, 3, 25),
    row(9, "Club Tijuana", 17, 6, 5, 6, 24, 22, 2, 23),
    row(10, "Leon", 17, 6, 4, 7, 20, 30, -10, 22),
    row(11, "Queretaro", 17, 5, 5, 7, 18, 22, -4, 20),
    row(12, "Juarez", 17, 5, 4, 8, 18, 24, -6, 19),
    row(13, "Monterrey", 17, 5, 3, 9, 24, 26, -2, 18),
    row(14, "Atletico San Luis", 17, 5, 3, 9, 20, 23, -3, 18),
    row(15, "Necaxa", 17, 5, 3, 9, 18, 24, -6, 18),
    row(16, "Mazatlan", 17, 4, 3, 10, 16, 31, -15, 15),
    row(17, "Puebla", 17, 3, 4, 10, 17, 30, -13, 13),
    row(18, "Santos Laguna", 17, 3, 3, 11, 16, 34, -18, 12)
  ];

  return {
    standings: [rows],
    fixtures: [
      seriesFixture("liga-qf-1-leg1", "Cuartos de final", "Club America", "Pumas UNAM", 3, 3, "2026-05-03T20:25:00-06:00"),
      pendingFixture("liga-qf-1-leg2", "Cuartos de final", "Pumas UNAM", "Club America", "2026-05-11T20:00:00-06:00"),
      seriesFixture("liga-qf-2-leg1", "Cuartos de final", "Tigres UANL", "CD Guadalajara", 3, 1, "2026-05-03T18:00:00-06:00"),
      pendingFixture("liga-qf-2-leg2", "Cuartos de final", "CD Guadalajara", "Tigres UANL", "2026-05-10T20:00:00-06:00"),
      seriesFixture("liga-qf-3-leg1", "Cuartos de final", "Atlas", "Cruz Azul", 2, 3, "2026-05-03T22:15:00-06:00"),
      pendingFixture("liga-qf-3-leg2", "Cuartos de final", "Cruz Azul", "Atlas", "2026-05-10T22:00:00-06:00"),
      pendingFixture("liga-qf-4-leg1", "Cuartos de final", "Toluca", "Pachuca", "2026-05-04T21:15:00-06:00"),
      pendingFixture("liga-qf-4-leg2", "Cuartos de final", "Pachuca", "Toluca", "2026-05-11T21:00:00-06:00")
    ],
    nextFixtures: []
  };
}

function buildVerifiedChampionsSnapshot() {
  const rows = [
    row(1, "Arsenal", 8, 8, 0, 0, 0, 0, 19, 24, "Fase liga"),
    row(2, "Bayern Munich", 8, 7, 0, 1, 0, 0, 14, 21, "Fase liga"),
    row(3, "Liverpool", 8, 6, 0, 2, 0, 0, 12, 18, "Fase liga"),
    row(4, "Tottenham Hotspur", 8, 5, 2, 1, 0, 0, 10, 17, "Fase liga"),
    row(5, "Barcelona", 8, 5, 1, 2, 0, 0, 8, 16, "Fase liga"),
    row(6, "Chelsea", 8, 5, 1, 2, 0, 0, 7, 16, "Fase liga"),
    row(7, "Sporting CP", 8, 5, 1, 2, 0, 0, 6, 16, "Fase liga"),
    row(8, "Manchester City", 8, 5, 1, 2, 0, 0, 6, 16, "Fase liga"),
    row(9, "Real Madrid", 8, 5, 0, 3, 0, 0, 9, 15, "Fase liga"),
    row(10, "Inter Milan", 8, 5, 0, 3, 0, 0, 8, 15, "Fase liga"),
    row(11, "Paris Saint-Germain", 8, 4, 2, 2, 0, 0, 10, 14, "Fase liga"),
    row(12, "Newcastle United", 8, 4, 2, 2, 0, 0, 10, 14, "Fase liga"),
    row(13, "Juventus", 8, 3, 4, 1, 0, 0, 4, 13, "Fase liga"),
    row(14, "Atletico Madrid", 8, 4, 1, 3, 0, 0, 2, 13, "Fase liga"),
    row(15, "Atalanta", 8, 4, 1, 3, 0, 0, 0, 13, "Fase liga"),
    row(16, "Bayer Leverkusen", 8, 3, 3, 2, 0, 0, -1, 12, "Fase liga"),
    row(17, "Borussia Dortmund", 8, 3, 2, 3, 0, 0, 2, 11, "Fase liga"),
    row(18, "Olympiacos", 8, 3, 2, 3, 0, 0, -4, 11, "Fase liga"),
    row(19, "Club Brugge", 8, 3, 1, 4, 0, 0, -2, 10, "Fase liga"),
    row(20, "Galatasaray", 8, 3, 1, 4, 0, 0, -2, 10, "Fase liga"),
    row(21, "AS Monaco", 8, 2, 4, 2, 0, 0, -6, 10, "Fase liga"),
    row(22, "Qarabag", 8, 3, 1, 4, 0, 0, -8, 10, "Fase liga"),
    row(23, "Bodo/Glimt", 8, 2, 3, 3, 0, 0, -1, 9, "Fase liga"),
    row(24, "Benfica", 8, 3, 0, 5, 0, 0, -2, 9, "Fase liga"),
    row(25, "Marseille", 8, 3, 0, 5, 0, 0, -3, 9, "Fase liga"),
    row(26, "Pafos", 8, 2, 3, 3, 0, 0, -3, 9, "Fase liga"),
    row(27, "Union Saint-Gilloise", 8, 3, 0, 5, 0, 0, -9, 9, "Fase liga"),
    row(28, "PSV Eindhoven", 8, 2, 2, 4, 0, 0, 0, 8, "Fase liga"),
    row(29, "Athletic Bilbao", 8, 2, 2, 4, 0, 0, -5, 8, "Fase liga"),
    row(30, "Napoli", 8, 2, 2, 4, 0, 0, -6, 8, "Fase liga"),
    row(31, "Copenhagen", 8, 2, 2, 4, 0, 0, -9, 8, "Fase liga"),
    row(32, "Ajax", 8, 2, 0, 6, 0, 0, -13, 6, "Fase liga"),
    row(33, "Eintracht Frankfurt", 8, 1, 1, 6, 0, 0, -11, 4, "Fase liga"),
    row(34, "Slavia Prague", 8, 0, 3, 5, 0, 0, -14, 3, "Fase liga"),
    row(35, "Villarreal", 8, 0, 1, 7, 0, 0, -13, 1, "Fase liga"),
    row(36, "Kairat Almaty", 8, 0, 1, 7, 0, 0, -15, 1, "Fase liga")
  ];

  return {
    standings: [rows],
    fixtures: [
      seriesFixture("ucl-sf-1-leg1", "Semi-finals", "Paris Saint-Germain", "Bayern Munich", 5, 4, "2026-04-28T20:00:00+02:00"),
      pendingFixture("ucl-sf-1-leg2", "Semi-finals", "Bayern Munich", "Paris Saint-Germain", "2026-05-06T21:00:00+02:00"),
      seriesFixture("ucl-sf-2-leg1", "Semi-finals", "Atletico Madrid", "Arsenal", 1, 1, "2026-04-29T21:00:00+02:00"),
      pendingFixture("ucl-sf-2-leg2", "Semi-finals", "Arsenal", "Atletico Madrid", "2026-05-05T21:00:00+02:00")
    ],
    nextFixtures: []
  };
}

function row(rank, team, played, won, drawn, lost, goalsFor, goalsAgainst, goalDifference, points, group = "Tabla") {
  return {
    rank,
    team,
    logo: getClubLogo(team),
    played,
    won,
    drawn,
    lost,
    goalsFor,
    goalsAgainst,
    goalDifference,
    points,
    form: "",
    group
  };
}

function getClubLogo(team) {
  const domains = {
    "Pumas UNAM": "pumas.mx",
    "CD Guadalajara": "chivasdecorazon.com.mx",
    "Cruz Azul": "cruzazulfc.com.mx",
    "Pachuca": "tuzos.com.mx",
    "Toluca": "tolucafc.com",
    "Atlas": "atlasfc.com.mx",
    "Tigres UANL": "tigres.com.mx",
    "Club America": "clubamerica.com.mx",
    "Club Tijuana": "xolos.com.mx",
    "Leon": "clubleon.mx",
    "Queretaro": "clubqueretaro.com",
    "Juarez": "fcjuarez.com",
    "Monterrey": "rayados.com",
    "Atletico San Luis": "atleticodesanluis.mx",
    "Necaxa": "clubnecaxa.mx",
    "Mazatlan": "mazatlanfc.com",
    "Puebla": "clubpuebla.com",
    "Santos Laguna": "clubsantos.mx",
    "Arsenal": "arsenal.com",
    "Bayern Munich": "fcbayern.com",
    "Liverpool": "liverpoolfc.com",
    "Tottenham Hotspur": "tottenhamhotspur.com",
    "Barcelona": "fcbarcelona.com",
    "Chelsea": "chelseafc.com",
    "Sporting CP": "sporting.pt",
    "Manchester City": "mancity.com",
    "Real Madrid": "realmadrid.com",
    "Inter Milan": "inter.it",
    "Paris Saint-Germain": "psg.fr",
    "Newcastle United": "newcastleunited.com",
    "Juventus": "juventus.com",
    "Atletico Madrid": "atleticodemadrid.com",
    "Atalanta": "atalanta.it",
    "Bayer Leverkusen": "bayer04.de",
    "Borussia Dortmund": "bvb.de",
    "Olympiacos": "olympiacos.org",
    "Club Brugge": "clubbrugge.be",
    "Galatasaray": "galatasaray.org",
    "AS Monaco": "asmonaco.com",
    "Qarabag": "qarabagh.com",
    "Bodo/Glimt": "glimt.no",
    "Benfica": "slbenfica.pt",
    "Marseille": "om.fr",
    "Pafos": "pafosfc.com.cy",
    "Union Saint-Gilloise": "rusg.brussels",
    "PSV Eindhoven": "psv.nl",
    "Athletic Bilbao": "athletic-club.eus",
    "Napoli": "sscnapoli.it",
    "Copenhagen": "fck.dk",
    "Ajax": "ajax.nl",
    "Eintracht Frankfurt": "eintracht.de",
    "Slavia Prague": "slavia.cz",
    "Villarreal": "villarrealcf.es",
    "Kairat Almaty": "fckairat.com"
  };

  const domain = domains[team];
  return domain ? `https://www.google.com/s2/favicons?domain=${domain}&sz=64` : null;
}

function seriesFixture(id, round, homeTeam, awayTeam, homeGoals, awayGoals, matchTime) {
  return {
    id,
    round,
    rawRound: round,
    group: null,
    homeTeam,
    awayTeam,
    homeLogo: null,
    awayLogo: null,
    homeGoals,
    awayGoals,
    matchTime,
    status: "terminado"
  };
}

function pendingFixture(id, round, homeTeam, awayTeam, matchTime) {
  return {
    id,
    round,
    rawRound: round,
    group: null,
    homeTeam,
    awayTeam,
    homeLogo: null,
    awayLogo: null,
    homeGoals: null,
    awayGoals: null,
    matchTime,
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
