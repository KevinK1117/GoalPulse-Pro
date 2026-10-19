import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const FOOTBALL_API = 'https://v3.football.api-sports.io';
const HOCKEY_API = 'https://v1.hockey.api-sports.io';
const NHL_API = 'https://api-web.nhle.com/v1';
const FOOTBALL_LEAGUES = [39, 40, 78, 79, 140, 61, 135, 307, 203, 2, 3];
const CACHE_SECONDS = 900;
const RESPONSE_SECONDS = 300;
const cache = new Map();
const pending = new Map();
const responseCache = new Map();
const responsePending = new Map();

function berlinDate(value) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(new Date(value));
}
function shift(date, days) {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
function seasonStart(date) {
  const year = Number(date.slice(0, 4));
  return Number(date.slice(5, 7)) >= 7 ? year : year - 1;
}
function nhlSeason(date) {
  const y = seasonStart(date);
  return `${y}${y + 1}`;
}
function sameDay(value, date) {
  return Boolean(value) && berlinDate(value) === date;
}
function numberOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}
function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}
function probability(lambda) {
  return 1 - Math.exp(-Math.max(0, lambda));
}
function smoothRate(goals, games, priorRate, priorGames) {
  return (goals + priorRate * priorGames) / (games + priorGames);
}
function rateLimit(error) {
  return /429|too many requests|ratelimit|requests per minute/i.test(String(error?.message || error));
}
function friendlyError(error, source) {
  return rateLimit(error)
    ? `${source}: API-Limit erreicht. Zusatzdaten sind vorübergehend nicht verfügbar.`
    : `${source}: Daten derzeit nicht vollständig verfügbar.`;
}
function trimCache() {
  if (cache.size > 300) cache.delete(cache.keys().next().value);
}
async function cachedRequest(url, headers = {}) {
  const key = `${url}|${headers['x-apisports-key'] || ''}`;
  const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) return hit.data;
  if (pending.has(key)) return pending.get(key);
  const job = (async () => {
    const response = await fetch(url, {
      headers,
      next: { revalidate: CACHE_SECONDS },
      signal: AbortSignal.timeout(12000)
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    const errors = data?.errors;
    if (errors && (Array.isArray(errors) ? errors.length : Object.keys(errors).length)) {
      throw new Error(JSON.stringify(errors));
    }
    cache.set(key, { data, expires: Date.now() + CACHE_SECONDS * 1000 });
    trimCache();
    return data;
  })();
  pending.set(key, job);
  try { return await job; } finally { pending.delete(key); }
}
async function apiSports(base, key, path) {
  const data = await cachedRequest(base + path, { 'x-apisports-key': key });
  return data.response || [];
}
async function nhlRequest(path) {
  return cachedRequest(NHL_API + path);
}
function localized(value) {
  return typeof value === 'string' ? value : (value?.default || value?.en || '');
}
function teamName(team) {
  const name = `${localized(team?.placeName)} ${localized(team?.commonName)}`.trim();
  return name || localized(team?.name) || team?.abbrev || 'Unbekannt';
}
function normalizeGame(raw, sport) {
  const fixture = raw.fixture || raw;
  return {
    id: fixture.id ?? raw.id,
    sport,
    league: raw.league?.name || '',
    leagueId: raw.league?.id ?? null,
    home: raw.teams?.home?.name || 'Heim',
    away: raw.teams?.away?.name || 'Gast',
    homeId: raw.teams?.home?.id ?? null,
    awayId: raw.teams?.away?.id ?? null,
    time: fixture.date || raw.date,
    status: fixture.status?.short || raw.status?.short || ''
  };
}
function upcoming(game) {
  return !['FT', 'AET', 'PEN', 'PST', 'CANC', 'ABD', 'AW', 'AOT', 'AP'].includes(game.status);
}

// Football: shots are an additional, capped signal, not a substitute for xG.
function footballPick(item, game) {
  const player = item.player || {};
  const stats = (item.statistics || []).find(s => s.league?.id === game.leagueId);
  if (!stats) return null;
  const team = stats.team || {};
  if (team.id !== game.homeId && team.id !== game.awayId) return null;
  const appearances = numberOrNull(stats.games?.appearences ?? stats.games?.appearances);
  const goals = numberOrNull(stats.goals?.total);
  const totalMinutes = numberOrNull(stats.games?.minutes);
  const shots = numberOrNull(stats.shots?.total);
  const shotsOn = numberOrNull(stats.shots?.on);
  if (!player.id || appearances === null || appearances < 5 || goals === null || goals < 0) return null;
  const avgMinutes = totalMinutes !== null && totalMinutes > 0
    ? clamp(totalMinutes / appearances, 0, 95) : null;
  const seasonRate = smoothRate(goals, appearances, 0.12, 10);
  const shotsPerGame = shots === null ? null : shots / appearances;
  const shotsOnPerGame = shotsOn === null ? null : shotsOn / appearances;
  const shotFactor = shotsOnPerGame !== null
    ? clamp(0.91 + 0.12 * shotsOnPerGame, 0.91, 1.14)
    : shotsPerGame !== null
      ? clamp(0.93 + 0.055 * shotsPerGame, 0.93, 1.12)
      : 1;
  // Appearance-based goal rate already incorporates time on the bench.
  // Avoid multiplying by playing time again.
  const lambda = seasonRate * shotFactor;
  const dataQuality = appearances >= 15 && avgMinutes !== null && (shots !== null || shotsOn !== null)
    ? 'hoch' : appearances >= 10 && avgMinutes !== null ? 'mittel' : 'niedrig';
  return {
    id: `football-${game.id}-${player.id}`,
    playerId: player.id,
    name: player.name || 'Spieler',
    photo: player.photo || null,
    team: team.name || '',
    opponent: team.id === game.homeId ? game.away : game.home,
    league: game.league,
    sport: 'Fußball',
    fixtureId: game.id,
    time: game.time,
    probability: probability(lambda),
    shots,
    shotsOn,
    shotsPerGame,
    goals,
    appearances,
    minutes: avgMinutes === null ? null : Math.round(avgMinutes),
    form: null,
    formGames: [],
    model: 'GoalPulse 3.0 – Saison + Schüsse',
    lineupConfirmed: false,
    dataQuality
  };
}
async function loadFootball(date, key, errors) {
  const fixtures = await apiSports(FOOTBALL_API, key, `/fixtures?date=${date}`);
  const games = fixtures
    .filter(g => FOOTBALL_LEAGUES.includes(g.league?.id))
    .map(g => normalizeGame(g, 'Fußball'))
    .filter(g => sameDay(g.time, date) && upcoming(g));
  const byLeague = new Map();
  for (const game of games) {
    if (!byLeague.has(game.leagueId)) byLeague.set(game.leagueId, []);
    byLeague.get(game.leagueId).push(game);
  }
  const picks = [];
  for (const [leagueId, leagueGames] of byLeague) {
    try {
      const scorers = await apiSports(
        FOOTBALL_API, key,
        `/players/topscorers?league=${leagueId}&season=${seasonStart(date)}`
      );
      for (const game of leagueGames) {
        for (const item of scorers) {
          const pick = footballPick(item, game);
          if (pick) picks.push(pick);
        }
      }
    } catch (error) {
      errors.push(friendlyError(error, `Fußball Liga ${leagueId}`));
      if (rateLimit(error)) break;
    }
  }
  return { games, picks };
}
function normalizeNhlGame(raw) {
  return {
    id: `nhl-${raw.id}`,
    nhlGameId: raw.id,
    sport: 'Eishockey',
    league: 'NHL',
    home: teamName(raw.homeTeam),
    away: teamName(raw.awayTeam),
    homeAbbr: raw.homeTeam?.abbrev || '',
    awayAbbr: raw.awayTeam?.abbrev || '',
    time: raw.startTimeUTC,
    status: raw.gameState || '',
    gameType: raw.gameType || 2
  };
}
async function loadNhlSchedule(date) {
  const results = await Promise.allSettled(
    [shift(date, -1), date, shift(date, 1)].map(d => nhlRequest(`/score/${d}`))
  );
  const games = [];
  const seen = new Set();
  for (const result of results) {
    if (result.status !== 'fulfilled') continue;
    for (const raw of result.value.games || []) {
      if (!sameDay(raw.startTimeUTC, date) || !['FUT', 'PRE'].includes(raw.gameState) || seen.has(raw.id)) continue;
      seen.add(raw.id);
      games.push(normalizeNhlGame(raw));
    }
  }
  return games;
}
function nhlPick(player, game, abbr, season) {
  const playerId = player.playerId;
  const goals = numberOrNull(player.goals);
  const played = numberOrNull(player.gamesPlayed);
  const shots = numberOrNull(player.shots);
  if (!playerId || goals === null || played === null || played < 5) return null;
  const seasonRate = smoothRate(goals, played, 0.12, 10);
  const shotsPerGame = shots === null ? null : shots / played;
  const shotFactor = shotsPerGame === null ? 1 : clamp(0.87 + 0.075 * shotsPerGame, 0.87, 1.18);
  const lambda = seasonRate * shotFactor;
  const isHome = abbr === game.homeAbbr;
  return {
    id: `nhl-${game.nhlGameId}-${playerId}`,
    playerId,
    name: `${localized(player.firstName)} ${localized(player.lastName)}`.trim() || player.name || 'NHL-Spieler',
    photo: `https://assets.nhle.com/mugs/nhl/${season}/${abbr}/${playerId}.png`,
    team: isHome ? game.home : game.away,
    opponent: isHome ? game.away : game.home,
    league: 'NHL',
    sport: 'Eishockey',
    fixtureId: game.id,
    time: game.time,
    probability: probability(lambda),
    shots,
    shotsPerGame,
    goals,
    appearances: played,
    minutes: null,
    form: null,
    formShots: null,
    formGames: [],
    model: 'GoalPulse 3.0 – Saison + Schüsse',
    lineupConfirmed: false,
    dataQuality: played >= 15 && shots !== null ? 'mittel' : 'niedrig',
    _baseLambda: lambda
  };
}
function parseIceTime(value) {
  if (typeof value !== 'string') return null;
  const parts = value.split(':').map(Number);
  if (parts.length !== 2 || !parts.every(Number.isFinite)) return null;
  return parts[0] + parts[1] / 60;
}
async function loadNhl(date, errors) {
  const games = await loadNhlSchedule(date);
  const picks = [];
  if (!games.length) return { games, picks };
  const season = nhlSeason(date);
  const teams = new Map();
  for (const game of games) {
    if (game.gameType !== 2) continue;
    if (game.homeAbbr) teams.set(game.homeAbbr, game);
    if (game.awayAbbr) teams.set(game.awayAbbr, game);
  }
  const entries = [...teams.entries()];
  const results = await Promise.allSettled(entries.map(async ([abbr, game]) => {
    const data = await nhlRequest(`/club-stats/${abbr}/${season}/2`);
    return (data.skaters || []).map(p => nhlPick(p, game, abbr, season)).filter(Boolean);
  }));
  results.forEach((result, i) => {
    if (result.status === 'fulfilled') picks.push(...result.value);
    else errors.push(friendlyError(result.reason, `NHL ${entries[i][0]}`));
  });
  // Limit detailed game logs to control API load.
  const selected = [...picks].sort((a, b) => b.probability - a.probability).slice(0, 24);
  const logs = await Promise.allSettled(selected.map(p =>
    nhlRequest(`/player/${p.playerId}/game-log/${season}/2`)
  ));
  logs.forEach((result, i) => {
    if (result.status !== 'fulfilled') return;
    const pick = selected[i];
    const previous = (result.value.gameLog || [])
      .filter(g => typeof g.gameDate === 'string' && g.gameDate < date)
      .sort((a, b) => b.gameDate.localeCompare(a.gameDate))
      .slice(0, 5);
    const formGames = previous
      .filter(g => numberOrNull(g.goals) !== null)
      .map(g => ({
        date: g.gameDate,
        goals: Number(g.goals),
        shots: numberOrNull(g.shots)
      }));
    pick.formGames = formGames;
    pick.form = formGames.length ? formGames.reduce((sum, g) => sum + g.goals, 0) : null;
    const recentShots = previous.map(g => numberOrNull(g.shots)).filter(n => n !== null);
    pick.formShots = recentShots.length ? recentShots.reduce((a, b) => a + b, 0) : null;
    const iceTimes = previous.map(g => parseIceTime(g.toi)).filter(n => n !== null);
    if (iceTimes.length) pick.minutes = Math.round(iceTimes.reduce((a, b) => a + b, 0) / iceTimes.length);
    let factor = 1;
    if (recentShots.length >= 3 && pick.shotsPerGame !== null) {
      const recentRate = pick.formShots / recentShots.length;
      factor *= clamp((recentRate + 1) / (pick.shotsPerGame + 1), 0.88, 1.12);
    }
    if (formGames.length >= 3) {
      const recentRate = pick.form / formGames.length;
      const seasonRate = pick.goals / pick.appearances;
      factor *= clamp(0.9 + 0.1 * ((recentRate + 0.12) / (seasonRate + 0.12)), 0.9, 1.12);
    }
    pick.probability = probability(pick._baseLambda * clamp(factor, 0.82, 1.22));
    pick.model = 'GoalPulse 3.0 – Saison + Schüsse + Form';
    if (pick.appearances >= 15 && pick.shots !== null && recentShots.length >= 3 && iceTimes.length >= 3) {
      pick.dataQuality = 'hoch';
    }
  });
  for (const pick of picks) delete pick._baseLambda;
  return { games, picks };
}
async function loadDel(date, key, errors) {
  const leagues = await apiSports(HOCKEY_API, key, '/leagues');
  const del = leagues.find(l => (l.name || '').trim().toUpperCase() === 'DEL');
  if (!del) {
    errors.push('DEL: Liga derzeit nicht verfügbar.');
    return { games: [], picks: [] };
  }
  const raw = await apiSports(
    HOCKEY_API, key,
    `/games?date=${date}&league=${del.id}&season=${seasonStart(date)}`
  );
  return {
    games: raw.map(g => normalizeGame(g, 'Eishockey'))
      .filter(g => sameDay(g.time, date) && upcoming(g)),
    picks: []
  };
}
async function buildResponse(date) {
  const errors = [];
  const games = [];
  const picks = [];
  const tasks = [];
  const footballKey = process.env.APISPORTS_FOOTBALL_KEY;
  const hockeyKey = process.env.APISPORTS_HOCKEY_KEY;
  if (footballKey) {
    tasks.push(loadFootball(date, footballKey, errors)
      .then(r => { games.push(...r.games); picks.push(...r.picks); })
      .catch(e => errors.push(friendlyError(e, 'Fußball'))));
  } else errors.push('Fußball: API-Schlüssel fehlt.');
  tasks.push(loadNhl(date, errors)
    .then(r => { games.push(...r.games); picks.push(...r.picks); })
    .catch(e => errors.push(friendlyError(e, 'NHL'))));
  if (hockeyKey) {
    tasks.push(loadDel(date, hockeyKey, errors)
      .then(r => { games.push(...r.games); picks.push(...r.picks); })
      .catch(e => errors.push(friendlyError(e, 'DEL'))));
  } else errors.push('DEL: API-Schlüssel fehlt.');
  await Promise.all(tasks);
  games.sort((a, b) => new Date(a.time) - new Date(b.time));
  picks.sort((a, b) => b.probability - a.probability);
  return {
    date, games, picks, errors: [...new Set(errors)],
    model: 'GoalPulse Analyse 3.0',
    notice: 'GoalPulse 3.0: unkalibrierte Modellschätzungen. xG, Gegnerstärke und bestätigte Aufstellungen sind nicht eingerechnet. DEL-Spielerstatistiken fehlen noch.',
    updatedAt: new Date().toISOString()
  };
}
export async function GET(request) {
  const today = berlinDate(new Date());
  const date = new URL(request.url).searchParams.get('date') || today;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date)) || date < today || date > shift(today, 7)) {
    return NextResponse.json({ error: 'Bitte ein Datum innerhalb der nächsten sieben Tage auswählen.' }, { status: 400 });
  }
  const hit = responseCache.get(date);
  if (hit && hit.expires > Date.now()) {
    return NextResponse.json(hit.data, {
      headers: { 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=300' }
    });
  }
  if (!responsePending.has(date)) {
    const job = buildResponse(date).then(data => {
      responseCache.set(date, { data, expires: Date.now() + RESPONSE_SECONDS * 1000 });
      if (responseCache.size > 10) responseCache.delete(responseCache.keys().next().value);
      return data;
    }).finally(() => responsePending.delete(date));
    responsePending.set(date, job);
  }
  const data = await responsePending.get(date);
  return NextResponse.json(data, {
    headers: { 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=300' }
  });
}
