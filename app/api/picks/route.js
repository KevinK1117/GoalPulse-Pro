
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const FOOTBALL_BASE =
  process.env.FOOTBALL_API_BASE ||
  'https://v3.football.api-sports.io';

const HOCKEY_BASE =
  process.env.HOCKEY_API_BASE ||
  'https://v1.hockey.api-sports.io';

const FOOTBALL_LEAGUES = [
  39,  // Premier League
  40,  // Championship (England)
  78,  // Bundesliga
  79,  // 2. Bundesliga
  140, // La Liga
  61,  // Ligue 1
  135, // Serie A
  307, // Saudi Pro League
  203, // Süper Lig
  2,   // Champions League
  3    // Europa League
];

const HOCKEY_LEAGUES = ['NHL', 'DEL'];

function berlinDate(value) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Berlin',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(new Date(value));
}

function addDays(date, days) {
  const d = new Date(date + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function validDate(date) {
  return /^\d{4}-\d{2}-\d{2}$/.test(date) &&
    !Number.isNaN(Date.parse(date)) &&
    new Date(date + 'T12:00:00Z')
      .toISOString().slice(0, 10) === date;
}

function sameDay(value, date) {
  if (!value) return false;

  try {
    return berlinDate(value) === date;
  } catch {
    return false;
  }
}

async function apiRequest(base, key, path) {
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
    throw new Error('HTTP ' + response.status);
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
    throw new Error(
      'API-Fehler: ' + JSON.stringify(json.errors)
    );
  }

  return json.response || [];
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
    time: fixture.date || game.date || null,
    status:
      fixture.status?.short ||
      game.status?.short ||
      ''
  };
}

function isUpcoming(game) {
  const excluded = [
    'FT',
    'AET',
    'PEN',
    'CANC',
    'PST',
    'POST',
    'ABD',
    'AW',
    'AOT',
    'AP'
  ];

  return !excluded.includes(game.status);
}

function seasonFor(date, leagueId) {
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7));

  // Saudi Pro League and most European competitions
  // run across two calendar years.
  // All configured football leagues use this convention.
  return month >= 7 ? year : year - 1;
}

function poissonAtLeastOne(lambda) {
  return 1 - Math.exp(-lambda);
}

function makeFootballPick(item, game) {
  const player = item.player || {};
  const stats = (item.statistics || []).find(
    s => s.league?.id === game.leagueId
  ) || item.statistics?.[0];

  if (!stats) return null;

  const team = stats.team || {};
  const appearances = Number(
    stats.games?.appearences ??
    stats.games?.appearances
  );

  const goals = Number(stats.goals?.total);
  const minutes = Number(stats.games?.minutes);
  const shots = stats.shots?.total == null
    ? null
    : Number(stats.shots.total);

  if (
    !Number.isFinite(appearances) ||
    appearances < 5 ||
    !Number.isFinite(goals) ||
    goals < 0
  ) {
    return null;
  }

  if (
    team.id !== game.homeId &&
    team.id !== game.awayId
  ) {
    return null;
  }

  const opponent =
    team.id === game.homeId
      ? game.away
      : game.home;

  // Basic descriptive model, NOT a calibrated
  // prediction model.
  //
  // The small prior prevents extreme estimates
  // from very small samples.
  const goalsPerMatch =
    (goals + 0.5) / (appearances + 2);

  const expectedMinutes =
    Number.isFinite(minutes) && minutes > 0
      ? Math.min(minutes / appearances, 90)
      : null;

  // Expected involvement adjustment.
  // Does not confirm tomorrow's lineup.
  const playingTimeFactor =
    expectedMinutes === null
      ? 0.85
      : Math.max(
          0.35,
          Math.min(expectedMinutes / 90, 1)
        );

  const lambda = goalsPerMatch * playingTimeFactor;

  const probability = poissonAtLeastOne(lambda);

  if (
    !Number.isFinite(probability) ||
    probability <= 0
  ) {
    return null;
  }

  return {
    id: 'football-' + game.id + '-' + player.id,
    playerId: player.id,
    name: player.name || 'Unbekannter Spieler',
    team: team.name || '',
    opponent,
    league: game.league,
    sport: 'Fußball',
    fixtureId: game.id,
    time: game.time,
    probability,
    shots,
    goals,
    appearances,
    minutes: expectedMinutes === null
      ? null
      : Math.round(expectedMinutes),
    form: null,
    model: 'Poisson-Basismodell',
    confidence: 'Nicht kalibriert',
    lineupConfirmed: false,
    explanation:
      'Schätzung aus Saisontoren, Einsätzen und ' +
      'durchschnittlicher Einsatzzeit. ' +
      'Keine bestätigte Aufstellung oder ' +
      'validierte Prognose.'
  };
}

async function loadFootball(date, key, errors) {
  const fixtures = await apiRequest(
    FOOTBALL_BASE,
    key,
    '/fixtures?date=' + date
  );

  const games = fixtures
    .filter(g => FOOTBALL_LEAGUES.includes(g.league?.id))
    .map(g => normalizeGame(g, 'Fußball'))
    .filter(g => sameDay(g.time, date))
    .filter(isUpcoming);

  const leagueGroups = new Map();

  for (const game of games) {
    if (!leagueGroups.has(game.leagueId)) {
      leagueGroups.set(game.leagueId, []);
    }

    leagueGroups.get(game.leagueId).push(game);
  }

  // One top-scorers request per competition,
  // not one request per player.
  const results = await Promise.allSettled(
    [...leagueGroups.entries()].map(
      async ([leagueId, leagueGames]) => {
        const season = seasonFor(date, leagueId);

        const scorers = await apiRequest(
          FOOTBALL_BASE,
          key,
          '/players/topscorers?league=' +
            leagueId +
            '&season=' +
            season
        );

        const picks = [];

        for (const game of leagueGames) {
          for (const scorer of scorers) {
            const pick = makeFootballPick(
              scorer,
              game
            );

            if (pick) picks.push(pick);
          }
        }

        return picks;
      }
    )
  );

  const picks = [];

  for (let i = 0; i < results.length; i++) {
    const result = results[i];

    if (result.status === 'fulfilled') {
      picks.push(...result.value);
    } else {
      const leagueId = [...leagueGroups.keys()][i];

      errors.push(
        'Fußball-Spielerdaten Liga ' +
        leagueId +
        ': ' +
        result.reason.message
      );
    }
  }

  return {
    games,
    picks
  };
}

async function loadHockey(date, key, errors) {
  const leagues = await apiRequest(
    HOCKEY_BASE,
    key,
    '/leagues'
  );

  const matches = leagues.filter(league => {
    const name = (league.name || '')
      .trim()
      .toUpperCase();

    return HOCKEY_LEAGUES.includes(name);
  });

  if (!matches.length) {
    errors.push(
      'NHL und DEL wurden in der Hockey-API ' +
      'nicht gefunden.'
    );
  }

  const results = await Promise.allSettled(
    matches.map(async league => {
      const seasonYear = Number(date.slice(0, 4));
      const season =
        Number(date.slice(5, 7)) >= 7
          ? seasonYear
          : seasonYear - 1;

      const response = await apiRequest(
        HOCKEY_BASE,
        key,
        '/games?date=' +
          date +
          '&league=' +
          league.id +
          '&season=' +
          season
      );

      return response
        .map(g => normalizeGame(g, 'Eishockey'))
        .filter(g => sameDay(g.time, date))
        .filter(isUpcoming);
    })
  );

  const games = [];

  for (let i = 0; i < results.length; i++) {
    const result = results[i];

    if (result.status === 'fulfilled') {
      games.push(...result.value);
    } else {
      errors.push(
        'Hockey ' +
        matches[i].name +
        ': ' +
        result.reason.message
      );
    }
  }

  // API-HOCKEY does not provide the same
  // documented season player-statistics endpoint
  // as API-FOOTBALL.
  // Do not invent NHL/DEL player scores.
  return {
    games,
    picks: []
  };
}

export async function GET(request) {
  const requested = new URL(request.url)
    .searchParams.get('date');

  const today = berlinDate(new Date());
  const date = requested || today;

  if (
    !validDate(date) ||
    date < today ||
    date > addDays(today, 7)
  ) {
    return NextResponse.json(
      {
        error:
          'Ungültiges Datum. Bitte einen Tag ' +
          'zwischen heute und sieben Tagen ' +
          'im Voraus wählen.'
      },
      {
        status: 400
      }
    );
  }

  const errors = [];
  const games = [];
  const picks = [];

  const footballKey =
    process.env.APISPORTS_FOOTBALL_KEY;

  const hockeyKey =
    process.env.APISPORTS_HOCKEY_KEY;

  const tasks = [];

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

  if (hockeyKey) {
    tasks.push(
      loadHockey(date, hockeyKey, errors)
        .then(result => {
          games.push(...result.games);
          picks.push(...result.picks);
        })
        .catch(error => {
          errors.push(
            'Hockey: ' + error.message
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
      modelStatus: {
        football:
          'Saisonbasiertes Poisson-Basismodell, ' +
          'nicht kalibriert',
        hockey:
          'Individuelle Spielerdatenquelle fehlt'
      },
      notice:
        'Fußball-Prozentwerte sind unkalibrierte ' +
        'Modellschätzungen aus Saisonstatistiken. ' +
        'Sie berücksichtigen keine bestätigten ' +
        'Aufstellungen, Verletzungen oder ' +
        'vollständigen Gegnerdaten. ' +
        'Für NHL und DEL sind noch keine ' +
        'Spielerprognosen verfügbar.',
      updatedAt: new Date().toISOString()
    },
    {
      headers: {
        'Cache-Control': 'no-store'
      }
    }
  );
}
