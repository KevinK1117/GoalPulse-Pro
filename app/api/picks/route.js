


import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const F =
  process.env.FOOTBALL_API_BASE ||
  'https://v3.football.api-sports.io';

const H =
  process.env.HOCKEY_API_BASE ||
  'https://v1.hockey.api-sports.io';

const NHL = 'https://api-web.nhle.com/v1';

const FOOTBALL_LEAGUES = [
  39, 40, 78, 79, 140, 61,
  135, 307, 203, 2, 3
];

const berlinDate = value =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Berlin',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(new Date(value));

function shift(date, days) {
  const d = new Date(date + 'T12:00:00Z');
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

async function apiSports(base, key, path) {
  const response = await fetch(base + path, {
    headers: {
      'x-apisports-key': key
    },
    next: {
      revalidate: 900
    },
    signal: AbortSignal.timeout(12000)
  });

  if (!response.ok) {
    throw new Error(`API-SPORTS HTTP ${response.status}`);
  }

  const json = await response.json();

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
  const response = await fetch(NHL + path, {
    next: {
      revalidate: 900
    },
    signal: AbortSignal.timeout(12000)
  });

  if (!response.ok) {
    throw new Error(`NHL HTTP ${response.status}`);
  }

  return response.json();
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

  // Ein einfaches, unkalibriertes Poisson-Modell.
  // Kleine Glättung für die Saison-Torquote.
  const lambda =
    ((goals + 0.5) / (games + 2)) * factor;

  return 1 - Math.exp(-lambda);
}

// ---------------------------------------
// FUSSBALL
// ---------------------------------------

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
    F,
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

  const results = await Promise.allSettled(
    groups.map(async ([leagueId, leagueGames]) => {
      const scorers = await apiSports(
        F,
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
        `Fußball Liga ${groups[index][0]}: ` +
        result.reason.message
      );
    }
  });

  // Nur für die stärksten 24 Kandidaten
  // zusätzliche Formdaten abrufen.
  const selected = [...picks]
    .sort((a, b) => b.probability - a.probability)
    .slice(0, 24);

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

  const teamGroups = [...teams.entries()].slice(0, 10);

  await Promise.allSettled(
    teamGroups.map(async ([teamId, teamPicks]) => {
      try {
        const previous = await apiSports(
          F,
          key,
          `/fixtures?team=${teamId}&last=8`
        );

        const completed = previous
          .filter(g =>
            ['FT', 'AET', 'PEN'].includes(
              g.fixture?.status?.short
            )
          )
          .filter(g =>
            new Date(g.fixture.date).getTime() <
            new Date(date + 'T00:00:00Z').getTime()
          )
          .sort(
            (a, b) =>
              new Date(b.fixture.date) -
              new Date(a.fixture.date)
          )
          .slice(0, 5);

        const logs = await Promise.allSettled(
          completed.map(g =>
            apiSports(
              F,
              key,
              `/fixtures/players?fixture=${g.fixture.id}`
            )
          )
        );

        for (const pick of teamPicks) {
          const formGames = [];

          logs.forEach((result, index) => {
            if (result.status !== 'fulfilled') {
              return;
            }

            const entry = result.value
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
                date: completed[index].fixture.date,
                goals: Number(goals)
              });
            }
          });

          pick.formGames = formGames;

          pick.form = formGames.length
            ? formGames.reduce(
                (sum, game) => sum + game.goals,
                0
              )
            : null;
        }
      } catch (error) {
        errors.push(
          `Fußball-Form ${teamId}: ${error.message}`
        );
      }
    })
  );

  return { games, picks };
}

// ---------------------------------------
// NHL
// ---------------------------------------

function localizedName(value) {
  if (!value) return '';

  if (typeof value === 'string') {
    return value;
  }

  return value.default || value.en || '';
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

function normalizeNhlGame(game) {
  const home = game.homeTeam || {};
  const away = game.awayTeam || {};

  return {
    id: `nhl-${game.id}`,
    nhlGameId: game.id,
    sport: 'Eishockey',
    league: 'NHL',
    home:
      localizedName(home.placeName) +
      ' ' +
      localizedName(home.commonName),
    away:
      localizedName(away.placeName) +
      ' ' +
      localizedName(away.commonName),
    homeAbbr: home.abbrev || '',
    awayAbbr: away.abbrev || '',
    time: game.startTimeUTC,
    status: game.gameState || '',
    gameType: game.gameType || 2
  };
}

async function loadNhlSchedule(date) {
  // Spiele kurz nach Mitternacht in Deutschland
  // können zum vorherigen NHL-Kalendertag gehören.
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
    if (result.status !== 'fulfilled') {
      continue;
    }

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

function nhlPick(player, game, abbreviation, opponent) {
  const playerId = player.playerId;

  if (!playerId) return null;

  const goals = Number(player.goals);
  const gamesPlayed = Number(player.gamesPlayed);

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

  const shots = Number(player.shots);

  return {
    id: `nhl-${game.nhlGameId}-${playerId}`,
    playerId,
    name,
    photo:
      `https://assets.nhle.com/mugs/nhl/` +
      `${nhlSeason(game.time.slice(0, 10))}/` +
      `${abbreviation}/${playerId}.png`,
    team:
      abbreviation === game.homeAbbr
        ? game.home.trim()
        : game.away.trim(),
    opponent,
    league: 'NHL',
    sport: 'Eishockey',
    fixtureId: game.id,
    time: game.time,
    probability,
    shots:
      Number.isFinite(shots)
        ? shots
        : null,
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

  // Höchstens 12 Teams pro Anfrage.
  const teams = new Map();

  for (const game of games) {
    if (game.gameType !== 2) continue;

    if (game.homeAbbr) {
      teams.set(game.homeAbbr, {
        game,
        opponent: game.away.trim()
      });
    }

    if (game.awayAbbr) {
      teams.set(game.awayAbbr, {
        game,
        opponent: game.home.trim()
      });
    }
  }

  const entries = [...teams.entries()].slice(0, 12);

  const results = await Promise.allSettled(
    entries.map(async ([abbr, info]) => {
      const skaters = await loadNhlTeamStats(
        abbr,
        season,
        2
      );

      return skaters
        .map(player =>
          nhlPick(
            player,
            info.game,
            abbr,
            info.opponent
          )
        )
        .filter(Boolean);
    })
  );

  results.forEach((result, index) => {
    if (result.status === 'fulfilled') {
      picks.push(...result.value);
    } else {
      errors.push(
        `NHL ${entries[index][0]}: ` +
        result.reason.message
      );
    }
  });

  // Spielprotokolle nur für die 24 stärksten
  // NHL-Kandidaten laden.
  const selected = [...picks]
    .sort((a, b) => b.probability - a.probability)
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
    if (result.status !== 'fulfilled') {
      return;
    }

    const pick = selected[index];

    const previousGames = result.value
      .filter(game => {
        const gameDate = game.gameDate;

        return (
          typeof gameDate === 'string' &&
          gameDate < date
        );
      })
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
          (sum, value) => sum + value,
          0
        ) / minutes.length
      );
    }
  });

  return { games, picks };
}

// ---------------------------------------
// DEL
// ---------------------------------------

async function loadDel(date, key, errors) {
  const leagues = await apiSports(
    H,
    key,
    '/leagues'
  );

  const del = leagues.find(
    league =>
      (league.name || '').trim().toUpperCase() ===
      'DEL'
  );

  if (!del) {
    errors.push('DEL-Liga nicht gefunden');
    return { games: [], picks: [] };
  }

  const raw = await apiSports(
    H,
    key,
    `/games?date=${date}` +
    `&league=${del.id}` +
    `&season=${seasonStart(date)}`
  );

  const games = raw
    .map(g => normalizeGame(g, 'Eishockey'))
    .filter(g => sameDay(g.time, date))
    .filter(upcoming);

  return {
    games,
    picks: []
  };
}

// ---------------------------------------
// HAUPT-API
// ---------------------------------------

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
            'Fußball: ' + error.message
          );
        })
    );
  } else {
    errors.push('Football-API-Key fehlt');
  }

  // NHL: öffentliche NHL-Datenquelle.
  tasks.push(
    loadNhl(date, errors)
      .then(result => {
        games.push(...result.games);
        picks.push(...result.picks);
      })
      .catch(error => {
        errors.push(
          'NHL: ' + error.message
        );
      })
  );

  // DEL: bisherige API-SPORTS-Anbindung.
  if (hockeyKey) {
    tasks.push(
      loadDel(date, hockeyKey, errors)
        .then(result => {
          games.push(...result.games);
          picks.push(...result.picks);
        })
        .catch(error => {
          errors.push(
            'DEL: ' + error.message
          );
        })
    );
  } else {
    errors.push('Hockey-API-Key fehlt');
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

  return NextResponse.json(
    {
      date,
      games,
      picks,
      errors,
      notice:
        'NHL und Fußball: unkalibrierte ' +
        'Poisson-Modellschätzungen aus echten ' +
        'Saisonstatistiken. Formdaten werden ' +
        'nur angezeigt, wenn sie verfügbar sind. ' +
        'DEL-Spielerstatistiken folgen.',
      updatedAt: new Date().toISOString()
    },
    {
      headers: {
        'Cache-Control': 'no-store'
      }
    }
  );
}
