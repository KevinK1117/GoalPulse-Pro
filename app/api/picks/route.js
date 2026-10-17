




import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const FOOTBALL_API = 'https://v3.football.api-sports.io';
const HOCKEY_API = 'https://v1.hockey.api-sports.io';
const NHL_API = 'https://api-web.nhle.com/v1';

const FOOTBALL_LEAGUES = [
  39, 40, 78, 79, 140, 61,
  135, 307, 203, 2, 3
];

const CACHE_SECONDS = 900;

// Maximal vier Mannschaften für zusätzliche
// Fußball-Formdaten pro Anfrage.
const MAX_FORM_TEAMS = 4;

// Höchstens drei vergangene Spiele je Team.
// Die Anzeige bleibt "letzte 5", wenn Daten
// vorhanden sind; sonst wird nur die
// verfügbare Teilmenge verwendet.
const MAX_FORM_FIXTURES = 3;

const memoryCache = new Map();

function berlinDate(value) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Berlin',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(new Date(value));
}

function shift(date, days) {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function seasonStart(date) {
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7));
  return month >= 7 ? year : year - 1;
}

function nhlSeason(date) {
  const start = seasonStart(date);
  return `${start}${start + 1}`;
}

function sameDay(value, date) {
  try {
    return berlinDate(value) === date;
  } catch {
    return false;
  }
}

function isRateLimit(error) {
  const message = String(error?.message || error);
  return /rateLimit|too many requests|429/i.test(message);
}

function friendlyError(error, source) {
  if (isRateLimit(error)) {
    return `${source}: API-Limit erreicht. Einige Zusatzstatistiken sind vorübergehend nicht verfügbar.`;
  }

  return `${source}: Daten derzeit nicht vollständig verfügbar.`;
}

async function cachedRequest(url, headers = {}) {
  const key = `${url}|${headers['x-apisports-key'] || ''}`;
  const now = Date.now();
  const existing = memoryCache.get(key);

  if (existing && existing.expires > now) {
    return existing.data;
  }

  const response = await fetch(url, {
    headers,
    next: { revalidate: CACHE_SECONDS },
    signal: AbortSignal.timeout(12000)
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  const data = await response.json();

  memoryCache.set(key, {
    data,
    expires: now + CACHE_SECONDS * 1000
  });

  // Verhindert unbegrenztes Wachstum innerhalb
  // einer warmen Serverinstanz.
  if (memoryCache.size > 250) {
    const first = memoryCache.keys().next().value;
    memoryCache.delete(first);
  }

  return data;
}

async function apiSports(base, key, path) {
  const json = await cachedRequest(base + path, {
    'x-apisports-key': key
  });

  if (
    json.errors &&
    (
      Array.isArray(json.errors)
        ? json.errors.length > 0
        : Object.keys(json.errors).length > 0
    )
  ) {
    throw new Error(JSON.stringify(json.errors));
  }

  return json.response || [];
}

async function nhlRequest(path) {
  return cachedRequest(NHL_API + path);
}

function localizedName(value) {
  if (!value) return '';
  if (typeof value === 'string') return value;
  return value.default || value.en || '';
}

const NHL_NAMES = {
  ANA: 'Anaheim Ducks',
  BOS: 'Boston Bruins',
  BUF: 'Buffalo Sabres',
  CAR: 'Carolina Hurricanes',
  CBJ: 'Columbus Blue Jackets',
  CGY: 'Calgary Flames',
  CHI: 'Chicago Blackhawks',
  COL: 'Colorado Avalanche',
  DAL: 'Dallas Stars',
  DET: 'Detroit Red Wings',
  EDM: 'Edmonton Oilers',
  FLA: 'Florida Panthers',
  LAK: 'Los Angeles Kings',
  MIN: 'Minnesota Wild',
  MTL: 'Montréal Canadiens',
  NJD: 'New Jersey Devils',
  NSH: 'Nashville Predators',
  NYI: 'New York Islanders',
  NYR: 'New York Rangers',
  OTT: 'Ottawa Senators',
  PHI: 'Philadelphia Flyers',
  PIT: 'Pittsburgh Penguins',
  SEA: 'Seattle Kraken',
  SJS: 'San Jose Sharks',
  STL: 'St. Louis Blues',
  TBL: 'Tampa Bay Lightning',
  TOR: 'Toronto Maple Leafs',
  UTA: 'Utah Mammoth',
  VAN: 'Vancouver Canucks',
  VGK: 'Vegas Golden Knights',
  WPG: 'Winnipeg Jets',
  WSH: 'Washington Capitals'
};

function teamName(team) {
  const place = localizedName(team.placeName);
  const common = localizedName(team.commonName);
  const full = `${place} ${common}`.trim();

  return (
    full ||
    localizedName(team.name) ||
    NHL_NAMES[team.abbrev] ||
    team.abbrev ||
    'Unbekannt'
  );
}

function normalizeGame(game, sport) {
  const fixture = game.fixture || game;
  const teams = game.teams || {};

  return {
    id: fixture.id ?? game.id,
    sport,
    league: game.league?.name || '',
    leagueId: game.league?.id ?? null,
    home: teams.home?.name || 'Heim',
    away: teams.away?.name || 'Gast',
    homeId: teams.home?.id ?? null,
    awayId: teams.away?.id ?? null,
    time: fixture.date || game.date,
    status:
      fixture.status?.short ||
      game.status?.short ||
      ''
  };
}

function upcoming(game) {
  return ![
    'FT', 'AET', 'PEN', 'PST',
    'CANC', 'ABD', 'AW', 'AOT', 'AP'
  ].includes(game.status);
}

function probabilityFromRate(goals, games, factor = 1) {
  if (
    !Number.isFinite(goals) ||
    !Number.isFinite(games) ||
    games < 5
  ) {
    return null;
  }

  const lambda =
    ((goals + 0.5) / (games + 2)) * factor;

  return 1 - Math.exp(-lambda);
}

// =====================================
// FUSSBALL
// =====================================

function footballPick(item, game) {
  const player = item.player || {};

  const stats =
    (item.statistics || []).find(
      s => s.league?.id === game.leagueId
    ) ||
    item.statistics?.[0];

  if (!stats) return null;

  const team = stats.team || {};

  if (
    team.id !== game.homeId &&
    team.id !== game.awayId
  ) {
    return null;
  }

  const appearances = Number(
    stats.games?.appearences ??
    stats.games?.appearances
  );

  const goals = Number(stats.goals?.total);
  const totalMinutes = Number(stats.games?.minutes);

  if (
    !Number.isFinite(appearances) ||
    appearances < 5 ||
    !Number.isFinite(goals)
  ) {
    return null;
  }

  const minutes =
    Number.isFinite(totalMinutes) &&
    totalMinutes > 0
      ? Math.round(
          Math.min(90, totalMinutes / appearances)
        )
      : null;

  const factor =
    minutes === null
      ? 0.85
      : Math.max(0.35, minutes / 90);

  const probability = probabilityFromRate(
    goals,
    appearances,
    factor
  );

  if (probability === null) return null;

  return {
    id: `football-${game.id}-${player.id}`,
    playerId: player.id,
    name: player.name || 'Spieler',
    photo: player.photo || null,
    team: team.name || '',
    opponent:
      team.id === game.homeId
        ? game.away
        : game.home,
    league: game.league,
    sport: 'Fußball',
    fixtureId: game.id,
    time: game.time,
    probability,
    shots: stats.shots?.total ?? null,
    goals,
    appearances,
    minutes,
    form: null,
    formGames: [],
    model: 'Poisson-Basismodell',
    lineupConfirmed: false
  };
}

async function loadFootball(date, key, errors) {
  const fixtures = await apiSports(
    FOOTBALL_API,
    key,
    `/fixtures?date=${date}`
  );

  const games = fixtures
    .filter(g =>
      FOOTBALL_LEAGUES.includes(g.league?.id)
    )
    .map(g => normalizeGame(g, 'Fußball'))
    .filter(g => sameDay(g.time, date))
    .filter(upcoming);

  const leagueMap = new Map();

  for (const game of games) {
    if (!leagueMap.has(game.leagueId)) {
      leagueMap.set(game.leagueId, []);
    }

    leagueMap.get(game.leagueId).push(game);
  }

  const groups = [...leagueMap.entries()];

  // Die Topscorer-Daten werden je Liga nur
  // einmal geladen.
  const results = await Promise.allSettled(
    groups.map(async ([leagueId, leagueGames]) => {
      const scorers = await apiSports(
        FOOTBALL_API,
        key,
        `/players/topscorers?league=${leagueId}` +
        `&season=${seasonStart(date)}`
      );

      return leagueGames.flatMap(game =>
        scorers
          .map(item => footballPick(item, game))
          .filter(Boolean)
      );
    })
  );

  const picks = [];

  results.forEach((result, index) => {
    if (result.status === 'fulfilled') {
      picks.push(...result.value);
    } else {
      errors.push(
        friendlyError(
          result.reason,
          `Fußball Liga ${groups[index][0]}`
        )
      );
    }
  });

  // Zusatzdaten nur für die besten Spieler.
  const selected = [...picks]
    .sort((a, b) => b.probability - a.probability)
    .slice(0, 12);

  const teams = new Map();

  for (const pick of selected) {
    const game = games.find(
      g => g.id === pick.fixtureId
    );

    if (!game) continue;

    const teamId =
      game.home === pick.team
        ? game.homeId
        : game.away === pick.team
          ? game.awayId
          : null;

    if (!teamId) continue;

    if (!teams.has(teamId)) {
      teams.set(teamId, []);
    }

    teams.get(teamId).push(pick);
  }

  const teamGroups = [...teams.entries()]
    .slice(0, MAX_FORM_TEAMS);

  // Bewusst nacheinander statt parallel:
  // deutlich weniger Anfragespitzen.
  for (const [teamId, teamPicks] of teamGroups) {
    try {
      const previous = await apiSports(
        FOOTBALL_API,
        key,
        `/fixtures?team=${teamId}&last=6`
      );

      const completed = previous
        .filter(g =>
          ['FT', 'AET', 'PEN'].includes(
            g.fixture?.status?.short
          )
        )
        .filter(g =>
          new Date(g.fixture.date).getTime() <
          new Date(`${date}T00:00:00Z`).getTime()
        )
        .sort(
          (a, b) =>
            new Date(b.fixture.date) -
            new Date(a.fixture.date)
        )
        .slice(0, MAX_FORM_FIXTURES);

      const logs = [];

      for (const fixture of completed) {
        try {
          const result = await apiSports(
            FOOTBALL_API,
            key,
            `/fixtures/players?fixture=${fixture.fixture.id}`
          );

          logs.push({
            date: fixture.fixture.date,
            players: result
          });
        } catch (error) {
          if (isRateLimit(error)) {
            throw error;
          }
        }
      }

      for (const pick of teamPicks) {
        const formGames = [];

        for (const log of logs) {
          const entry = log.players
            .flatMap(t => t.players || [])
            .find(p =>
              p.player?.id === pick.playerId
            );

          const goals =
            entry?.statistics?.[0]?.goals?.total;

          if (
            goals !== null &&
            goals !== undefined &&
            Number.isFinite(Number(goals))
          ) {
            formGames.push({
              date: log.date,
              goals: Number(goals)
            });
          }
        }

        pick.formGames = formGames;

        pick.form = formGames.length
          ? formGames.reduce(
              (sum, g) => sum + g.goals,
              0
            )
          : null;
      }
    } catch (error) {
      errors.push(
        friendlyError(
          error,
          'Fußball-Form'
        )
      );

      // Bei Minutenlimit keine weiteren
      // Formdaten-Anfragen senden.
      if (isRateLimit(error)) {
        break;
      }
    }
  }

  return { games, picks };
}

// =====================================
// NHL
// =====================================

function normalizeNhlGame(game) {
  const home = game.homeTeam || {};
  const away = game.awayTeam || {};

  return {
    id: `nhl-${game.id}`,
    nhlGameId: game.id,
    sport: 'Eishockey',
    league: 'NHL',
    home: teamName(home),
    away: teamName(away),
    homeAbbr: home.abbrev || '',
    awayAbbr: away.abbrev || '',
    time: game.startTimeUTC,
    status: game.gameState || '',
    gameType: game.gameType || 2
  };
}

async function loadNhlSchedule(date) {
  const dates = [
    shift(date, -1),
    date,
    shift(date, 1)
  ];

  const results = await Promise.allSettled(
    dates.map(d =>
      nhlRequest(`/score/${d}`)
    )
  );

  const seen = new Set();
  const games = [];

  for (const result of results) {
    if (result.status !== 'fulfilled') continue;

    for (const raw of result.value.games || []) {
      if (
        !sameDay(raw.startTimeUTC, date) ||
        !['FUT', 'PRE'].includes(raw.gameState)
      ) {
        continue;
      }

      if (seen.has(raw.id)) continue;

      seen.add(raw.id);
      games.push(normalizeNhlGame(raw));
    }
  }

  return games;
}

async function loadNhlTeamStats(
  abbreviation,
  season,
  gameType
) {
  const json = await nhlRequest(
    `/club-stats/${abbreviation}/${season}/${gameType}`
  );

  return json.skaters || [];
}

async function loadNhlPlayerLog(
  playerId,
  season,
  gameType
) {
  const json = await nhlRequest(
    `/player/${playerId}/game-log/${season}/${gameType}`
  );

  return json.gameLog || [];
}

function parseIceTime(value) {
  if (typeof value !== 'string') return null;

  const parts = value.split(':').map(Number);

  if (
    parts.length !== 2 ||
    !parts.every(Number.isFinite)
  ) {
    return null;
  }

  return parts[0] + parts[1] / 60;
}

function nhlPick(player, game, abbreviation) {
  const playerId = player.playerId;

  if (!playerId) return null;

  const goals = Number(player.goals);
  const gamesPlayed = Number(player.gamesPlayed);
  const shots = Number(player.shots);

  if (
    !Number.isFinite(goals) ||
    !Number.isFinite(gamesPlayed) ||
    gamesPlayed < 5
  ) {
    return null;
  }

  const probability = probabilityFromRate(
    goals,
    gamesPlayed
  );

  if (probability === null) return null;

  const firstName = localizedName(player.firstName);
  const lastName = localizedName(player.lastName);

  const name =
    `${firstName} ${lastName}`.trim() ||
    player.name ||
    'NHL-Spieler';

  const isHome =
    abbreviation === game.homeAbbr;

  return {
    id: `nhl-${game.nhlGameId}-${playerId}`,
    playerId,
    name,
    photo:
      `https://assets.nhle.com/mugs/nhl/` +
      `${nhlSeason(game.time.slice(0, 10))}/` +
      `${abbreviation}/${playerId}.png`,
    team: isHome ? game.home : game.away,
    opponent: isHome ? game.away : game.home,
    league: 'NHL',
    sport: 'Eishockey',
    fixtureId: game.id,
    time: game.time,
    probability,
    shots: Number.isFinite(shots) ? shots : null,
    goals,
    appearances: gamesPlayed,
    minutes: null,
    form: null,
    formGames: [],
    model: 'Poisson-Basismodell',
    lineupConfirmed: false
  };
}

async function loadNhl(date, errors) {
  const games = await loadNhlSchedule(date);
  const picks = [];

  if (!games.length) {
    return { games, picks };
  }

  const season = nhlSeason(date);
  const teams = new Map();

  for (const game of games) {
    if (game.gameType !== 2) continue;

    if (game.homeAbbr) {
      teams.set(game.homeAbbr, game);
    }

    if (game.awayAbbr) {
      teams.set(game.awayAbbr, game);
    }
  }

  const entries = [...teams.entries()].slice(0, 12);

  const results = await Promise.allSettled(
    entries.map(async ([abbr, game]) => {
      const skaters = await loadNhlTeamStats(
        abbr,
        season,
        2
      );

      return skaters
        .map(player =>
          nhlPick(player, game, abbr)
        )
        .filter(Boolean);
    })
  );

  results.forEach((result, index) => {
    if (result.status === 'fulfilled') {
      picks.push(...result.value);
    } else {
      errors.push(
        friendlyError(
          result.reason,
          `NHL ${entries[index][0]}`
        )
      );
    }
  });

  const selected = [...picks]
    .sort((a, b) =>
      b.probability - a.probability
    )
    .slice(0, 24);

  const logs = await Promise.allSettled(
    selected.map(pick =>
      loadNhlPlayerLog(
        pick.playerId,
        season,
        2
      )
    )
  );

  logs.forEach((result, index) => {
    if (result.status !== 'fulfilled') return;

    const pick = selected[index];

    const previousGames = result.value
      .filter(g =>
        typeof g.gameDate === 'string' &&
        g.gameDate < date
      )
      .sort((a, b) =>
        b.gameDate.localeCompare(a.gameDate)
      )
      .slice(0, 5);

    const formGames = previousGames
      .filter(g =>
        Number.isFinite(Number(g.goals))
      )
      .map(g => ({
        date: g.gameDate,
        goals: Number(g.goals)
      }));

    pick.formGames = formGames;

    pick.form = formGames.length
      ? formGames.reduce(
          (sum, g) => sum + g.goals,
          0
        )
      : null;

    const minutes = previousGames
      .map(g => parseIceTime(g.toi))
      .filter(Number.isFinite);

    if (minutes.length) {
      pick.minutes = Math.round(
        minutes.reduce(
          (sum, n) => sum + n,
          0
        ) / minutes.length
      );
    }
  });

  return { games, picks };
}

// =====================================
// DEL
// =====================================

async function loadDel(date, key, errors) {
  const leagues = await apiSports(
    HOCKEY_API,
    key,
    '/leagues'
  );

  const del = leagues.find(
    league =>
      (league.name || '').trim().toUpperCase() ===
      'DEL'
  );

  if (!del) {
    errors.push(
      'DEL: Liga derzeit nicht verfügbar.'
    );

    return { games: [], picks: [] };
  }

  const raw = await apiSports(
    HOCKEY_API,
    key,
    `/games?date=${date}` +
    `&league=${del.id}` +
    `&season=${seasonStart(date)}`
  );

  const games = raw
    .map(g => normalizeGame(g, 'Eishockey'))
    .filter(g => sameDay(g.time, date))
    .filter(upcoming);

  return { games, picks: [] };
}

// =====================================
// HAUPT-API
// =====================================

export async function GET(request) {
  const today = berlinDate(new Date());

  const date =
    new URL(request.url).searchParams.get('date') ||
    today;

  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
    Number.isNaN(Date.parse(date)) ||
    date < today ||
    date > shift(today, 7)
  ) {
    return NextResponse.json(
      {
        error:
          'Bitte ein Datum innerhalb der nächsten ' +
          'sieben Tage auswählen.'
      },
      { status: 400 }
    );
  }

  const errors = [];
  const games = [];
  const picks = [];
  const tasks = [];

  const footballKey =
    process.env.APISPORTS_FOOTBALL_KEY;

  const hockeyKey =
    process.env.APISPORTS_HOCKEY_KEY;

  if (footballKey) {
    tasks.push(
      loadFootball(date, footballKey, errors)
        .then(result => {
          games.push(...result.games);
          picks.push(...result.picks);
        })
        .catch(error => {
          errors.push(
            friendlyError(error, 'Fußball')
          );
        })
    );
  } else {
    errors.push(
      'Fußball: API-Schlüssel fehlt.'
    );
  }

  tasks.push(
    loadNhl(date, errors)
      .then(result => {
        games.push(...result.games);
        picks.push(...result.picks);
      })
      .catch(error => {
        errors.push(
          friendlyError(error, 'NHL')
        );
      })
  );

  if (hockeyKey) {
    tasks.push(
      loadDel(date, hockeyKey, errors)
        .then(result => {
          games.push(...result.games);
          picks.push(...result.picks);
        })
        .catch(error => {
          errors.push(
            friendlyError(error, 'DEL')
          );
        })
    );
  } else {
    errors.push(
      'DEL: API-Schlüssel fehlt.'
    );
  }

  await Promise.all(tasks);

  games.sort(
    (a, b) =>
      new Date(a.time) - new Date(b.time)
  );

  picks.sort(
    (a, b) =>
      b.probability - a.probability
  );

  // Gleiche Hinweise nicht mehrfach anzeigen.
  const uniqueErrors = [...new Set(errors)];

  return NextResponse.json(
    {
      date,
      games,
      picks,
      errors: uniqueErrors,
      notice:
        'Unkalibrierte Poisson-Modellschätzungen ' +
        'aus verfügbaren Saisonstatistiken. ' +
        'Formdaten können bei API-Limits fehlen.',
      updatedAt: new Date().toISOString()
    },
    {
      headers: {
        'Cache-Control': 'no-store'
      }
    }
  );
}
