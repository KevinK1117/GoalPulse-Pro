import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const FOOTBALL_API = 'https://v3.football.api-sports.io';
const HOCKEY_API = 'https://v1.hockey.api-sports.io';
const NHL_API = 'https://api-web.nhle.com/v1';
const FOOTBALL_LEAGUES = [39, 40, 78, 79, 140, 61, 135, 307, 203, 2, 3];
const TTL = 900;
const responseTTL = 300;
const cache = new Map();
const pending = new Map();
const responseCache = new Map();
const responsePending = new Map();

const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const num = x => x === null || x === undefined || x === '' ? null : Number.isFinite(Number(x)) ? Number(x) : null;
const smooth = (goals, games, prior, weight) => (goals + prior * weight) / (games + weight);
const poissonAtLeastOne = lambda => 1 - Math.exp(-Math.max(0, lambda));
function poissonCDF(k, lambda) {
  let term = Math.exp(-lambda);
  let sum = term;
  for (let i = 1; i <= k; i++) { term *= lambda / i; sum += term; }
  return clamp(sum, 0, 1);
}
const isoBerlin = d => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(d));
function shift(d, n) { const x = new Date(`${d}T12:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); }
function seasonStart(date) { const y = Number(date.slice(0, 4)); return Number(date.slice(5, 7)) >= 7 ? y : y - 1; }
const nhlSeason = d => `${seasonStart(d)}${seasonStart(d) + 1}`;
const sameDay = (time, date) => Boolean(time) && isoBerlin(time) === date;
const localized = v => typeof v === 'string' ? v : v?.default || v?.en || '';
const teamName = t => `${localized(t?.placeName)} ${localized(t?.commonName)}`.trim() || localized(t?.name) || t?.abbrev || 'Unbekannt';
const rateLimit = e => /429|too many requests|ratelimit|requests per minute/i.test(String(e?.message || e));
const friendlyError = (e, source) => rateLimit(e) ? `${source}: API-Limit erreicht.` : `${source}: Daten nicht vollständig verfügbar.`;

async function request(url, headers = {}) {
  const key = `${url}|${headers['x-apisports-key'] || ''}`;
  const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) return hit.data;
  if (pending.has(key)) return pending.get(key);
  const job = (async () => {
    const res = await fetch(url, { headers, next: { revalidate: TTL }, signal: AbortSignal.timeout(12000) });
    if (!res.ok) throw Error(`HTTP ${res.status}`);
    const json = await res.json();
    if (json?.errors && (Array.isArray(json.errors) ? json.errors.length : Object.keys(json.errors).length)) throw Error(JSON.stringify(json.errors));
    cache.set(key, { data: json, expires: Date.now() + TTL * 1000 });
    if (cache.size > 300) cache.delete(cache.keys().next().value);
    return json;
  })();
  pending.set(key, job);
  try { return await job; } finally { pending.delete(key); }
}
const football = (key, path) => request(`${FOOTBALL_API}${path}`, { 'x-apisports-key': key }).then(x => x.response || []);
const hockey = (key, path) => request(`${HOCKEY_API}${path}`, { 'x-apisports-key': key }).then(x => x.response || []);
const nhl = path => request(`${NHL_API}${path}`);

function gameFromApi(raw, sport) {
  const f = raw.fixture || raw;
  return { id: f.id ?? raw.id, sport, league: raw.league?.name || '', leagueId: raw.league?.id ?? null, home: raw.teams?.home?.name || 'Heim', away: raw.teams?.away?.name || 'Gast', homeId: raw.teams?.home?.id ?? null, awayId: raw.teams?.away?.id ?? null, time: f.date || raw.date, status: f.status?.short || raw.status?.short || '' };
}
const upcoming = g => !['FT','AET','PEN','PST','CANC','ABD','AW','AOT','AP'].includes(g.status);

function footballPick(item, game) {
  const player = item.player || {};
  const stats = (item.statistics || []).find(s => Number(s.league?.id) === Number(game.leagueId));
  if (!stats) return null;
  const team = stats.team || {};
  if (Number(team.id) !== Number(game.homeId) && Number(team.id) !== Number(game.awayId)) return null;
  const appearances = num(stats.games?.appearences ?? stats.games?.appearances);
  const goals = num(stats.goals?.total);
  if (!player.id || appearances === null || appearances < 5 || goals === null) return null;
  const shots = num(stats.shots?.total);
  const onTarget = num(stats.shots?.on);
  const minutesTotal = num(stats.games?.minutes);
  const minutes = minutesTotal && minutesTotal > 0 ? Math.round(clamp(minutesTotal / appearances, 0, 95)) : null;
  const shotsRate = onTarget !== null ? onTarget / appearances : shots !== null ? shots / appearances : null;
  const shotFactor = shotsRate === null ? 1 : clamp(0.92 + shotsRate * (onTarget !== null ? 0.105 : 0.055), 0.9, 1.15);
  return { id: `football-${game.id}-${player.id}`, playerId: player.id, name: player.name || 'Spieler', photo: player.photo || null, team: team.name || '', opponent: Number(team.id) === Number(game.homeId) ? game.away : game.home, league: game.league, sport: 'Fußball', fixtureId: game.id, time: game.time, probability: poissonAtLeastOne(smooth(goals, appearances, 0.12, 10) * shotFactor), shots, goals, appearances, minutes, form: null, formGames: [], model: 'GoalPulse 4.0 – Saison + Schüsse', lineupConfirmed: false, dataQuality: appearances >= 15 && shotsRate !== null && minutes !== null ? 'hoch' : appearances >= 10 ? 'mittel' : 'niedrig' };
}

// Fußball: Tabelle enthält Tore für/gegen je Team, optional Heim/Auswärts.
// Kein Ersatz durch erfundene Liga-Mittelwerte, wenn Tabelle fehlt.
function footballTeamRates(entry) {
  if (!entry) return null;
  const all = entry.all || {};
  const home = entry.home || {};
  const away = entry.away || {};
  const played = num(all.played);
  const gf = num(all.goals?.for);
  const ga = num(all.goals?.against);
  if (!played || played < 5 || gf === null || ga === null) return null;
  const rate = (section, type, fallback) => {
    const n = num(section.played);
    const g = num(section.goals?.[type]);
    return n >= 3 && g !== null ? smooth(g, n, fallback, 6) : fallback;
  };
  const avgFor = smooth(gf, played, 1.35, 8);
  const avgAgainst = smooth(ga, played, 1.35, 8);
  return { homeFor: rate(home, 'for', avgFor), homeAgainst: rate(home, 'against', avgAgainst), awayFor: rate(away, 'for', avgFor), awayAgainst: rate(away, 'against', avgAgainst), played };
}
function findFootballStandings(payload) {
  const list = payload?.[0]?.league?.standings;
  return Array.isArray(list) ? list.flat() : [];
}

// NHL /standings/now: league standings with goalsFor, goalsAgainst, gamesPlayed.
function nhlTeamRates(row) {
  const played = num(row?.gamesPlayed);
  const gf = num(row?.goalFor ?? row?.goalsFor);
  const ga = num(row?.goalAgainst ?? row?.goalsAgainst);
  if (!played || played < 5 || gf === null || ga === null) return null;
  return { for: smooth(gf, played, 3.05, 8), against: smooth(ga, played, 3.05, 8), played };
}

// Independent-Poisson approximation: no draw market for hockey, NHL regulation
// tie handled by an approximate equal split of tie probability. No OT edge asserted.
function marketPicks(game, lambdaHome, lambdaAway, quality) {
  const home = clamp(lambdaHome, 0.2, 6.5);
  const away = clamp(lambdaAway, 0.2, 6.5);
  const total = home + away;
  const hockeySport = game.sport === 'Eishockey';
  const maxGoals = hockeySport ? 18 : 13;
  const h = Array.from({ length: maxGoals + 1 }, (_, k) => k === 0 ? Math.exp(-home) : 0);
  const a = Array.from({ length: maxGoals + 1 }, (_, k) => k === 0 ? Math.exp(-away) : 0);
  for (let k = 1; k <= maxGoals; k++) { h[k] = h[k - 1] * home / k; a[k] = a[k - 1] * away / k; }
  let winH = 0, winA = 0, draw = 0;
  for (let i = 0; i <= maxGoals; i++) for (let j = 0; j <= maxGoals; j++) {
    const p = h[i] * a[j];
    if (i > j) winH += p;
    else if (j > i) winA += p;
    else draw += p;
  }
  const mk = (market, label, p) => ({ id: `market-${game.sport}-${game.id}-${market}`, fixtureId: game.id, sport: game.sport, league: game.league, time: game.time, game: `${game.home} – ${game.away}`, market, label, probability: clamp(p, 0, 1), dataQuality: quality, model: 'GoalPulse 4.0 – Teamtore / Poisson (nicht kalibriert)' });
  const result = [];
  for (const line of (hockeySport ? [4.5, 5.5, 6.5] : [1.5, 2.5, 3.5])) {
    result.push(mk(`over-${line}`, `Über ${String(line).replace('.', ',')} Tore`, 1 - poissonCDF(Math.floor(line), total)));
  }
  result.push(mk('home-win', `Sieg ${game.home}`, hockeySport ? winH + draw / 2 : winH));
  result.push(mk('away-win', `Sieg ${game.away}`, hockeySport ? winA + draw / 2 : winA));
  if (!hockeySport) result.push(mk('draw', 'Unentschieden', draw));
  const both = poissonAtLeastOne(home) * poissonAtLeastOne(away);
  result.push(mk('btts-yes', 'Beide Teams treffen: Ja', both));
  result.push(mk('btts-no', 'Beide Teams treffen: Nein', 1 - both));
  return result;
}

async function loadFootball(date, key, errors) {
  const fixtures = await football(key, `/fixtures?date=${date}`);
  const games = fixtures.filter(x => FOOTBALL_LEAGUES.includes(Number(x.league?.id))).map(x => gameFromApi(x, 'Fußball')).filter(x => sameDay(x.time, date) && upcoming(x));
  const byLeague = new Map();
  for (const g of games) { if (!byLeague.has(g.leagueId)) byLeague.set(g.leagueId, []); byLeague.get(g.leagueId).push(g); }
  const picks = [], markets = [];
  for (const [leagueId, leagueGames] of byLeague) {
    const season = seasonStart(date);
    // 2 Anfragen je Liga: Topscorer und Tabelle. Sequentiell gegen API-Spitzen.
    try {
      const scorers = await football(key, `/players/topscorers?league=${leagueId}&season=${season}`);
      for (const game of leagueGames) for (const item of scorers) { const pick = footballPick(item, game); if (pick) picks.push(pick); }
    } catch (e) { errors.push(friendlyError(e, `Fußball-Torschützen Liga ${leagueId}`)); if (rateLimit(e)) break; }
    try {
      const standings = findFootballStandings(await football(key, `/standings?league=${leagueId}&season=${season}`));
      const teams = new Map(standings.map(row => [Number(row.team?.id), footballTeamRates(row)]));
      for (const g of leagueGames) {
        const home = teams.get(Number(g.homeId)), away = teams.get(Number(g.awayId));
        if (!home || !away) continue;
        const lambdaHome = Math.sqrt(home.homeFor * away.awayAgainst) * 1.07;
        const lambdaAway = Math.sqrt(away.awayFor * home.homeAgainst) * 0.95;
        markets.push(...marketPicks(g, lambdaHome, lambdaAway, Math.min(home.played, away.played) >= 12 ? 'mittel' : 'niedrig'));
      }
    } catch (e) { errors.push(friendlyError(e, `Fußball-Teamstatistik Liga ${leagueId}`)); if (rateLimit(e)) break; }
  }
  return { games, picks, markets };
}

function normalizeNhlGame(raw) {
  return { id: `nhl-${raw.id}`, nhlGameId: raw.id, sport: 'Eishockey', league: 'NHL', home: teamName(raw.homeTeam), away: teamName(raw.awayTeam), homeAbbr: raw.homeTeam?.abbrev || '', awayAbbr: raw.awayTeam?.abbrev || '', time: raw.startTimeUTC, status: raw.gameState || '', gameType: raw.gameType || 2 };
}
async function loadNhlSchedule(date) {
  const responses = await Promise.allSettled([shift(date, -1), date, shift(date, 1)].map(d => nhl(`/score/${d}`)));
  const seen = new Set(), games = [];
  for (const r of responses) if (r.status === 'fulfilled') for (const g of r.value.games || []) {
    if (!sameDay(g.startTimeUTC, date) || !['FUT', 'PRE'].includes(g.gameState) || seen.has(g.id)) continue;
    seen.add(g.id); games.push(normalizeNhlGame(g));
  }
  return games;
}
function nhlPick(player, game, abbr, season) {
  const playerId = player.playerId, goals = num(player.goals), played = num(player.gamesPlayed), shots = num(player.shots);
  if (!playerId || goals === null || played === null || played < 5) return null;
  const shotsPerGame = shots === null ? null : shots / played;
  const lambda = smooth(goals, played, 0.12, 10) * (shotsPerGame === null ? 1 : clamp(0.87 + 0.075 * shotsPerGame, 0.87, 1.18));
  const isHome = abbr === game.homeAbbr;
  return { id: `nhl-${game.nhlGameId}-${playerId}`, playerId, name: `${localized(player.firstName)} ${localized(player.lastName)}`.trim() || player.name || 'NHL-Spieler', photo: `https://assets.nhle.com/mugs/nhl/${season}/${abbr}/${playerId}.png`, team: isHome ? game.home : game.away, opponent: isHome ? game.away : game.home, league: 'NHL', sport: 'Eishockey', fixtureId: game.id, time: game.time, probability: poissonAtLeastOne(lambda), shots, goals, appearances: played, minutes: null, form: null, formShots: null, formGames: [], model: 'GoalPulse 4.0 – Saison + Schüsse', lineupConfirmed: false, dataQuality: played >= 15 && shots !== null ? 'mittel' : 'niedrig', _lambda: lambda, _shotsPerGame: shotsPerGame };
}
function iceTime(value) { if (typeof value !== 'string') return null; const p = value.split(':').map(Number); return p.length === 2 && p.every(Number.isFinite) ? p[0] + p[1] / 60 : null; }
async function loadNhl(date, errors) {
  const games = await loadNhlSchedule(date), picks = [], markets = [];
  if (!games.length) return { games, picks, markets };
  const season = nhlSeason(date), teams = new Map();
  for (const g of games) if (g.gameType === 2) { if (g.homeAbbr) teams.set(g.homeAbbr, g); if (g.awayAbbr) teams.set(g.awayAbbr, g); }
  const entries = [...teams.entries()];
  const results = await Promise.allSettled(entries.map(async ([abbr, game]) => (await nhl(`/club-stats/${abbr}/${season}/2`)).skaters?.map(p => nhlPick(p, game, abbr, season)).filter(Boolean) || []));
  results.forEach((r, i) => { if (r.status === 'fulfilled') picks.push(...r.value); else errors.push(friendlyError(r.reason, `NHL ${entries[i][0]}`)); });
  const selected = [...picks].sort((a, b) => b.probability - a.probability).slice(0, 24);
  const logs = await Promise.allSettled(selected.map(p => nhl(`/player/${p.playerId}/game-log/${season}/2`)));
  logs.forEach((r, i) => {
    if (r.status !== 'fulfilled') return;
    const p = selected[i];
    const recent = (r.value.gameLog || []).filter(x => typeof x.gameDate === 'string' && x.gameDate < date).sort((a, b) => b.gameDate.localeCompare(a.gameDate)).slice(0, 5);
    p.formGames = recent.filter(x => num(x.goals) !== null).map(x => ({ date: x.gameDate, goals: Number(x.goals) }));
    p.form = p.formGames.length ? p.formGames.reduce((s, x) => s + x.goals, 0) : null;
    const shots = recent.map(x => num(x.shots)).filter(x => x !== null);
    p.formShots = shots.length ? shots.reduce((a, b) => a + b, 0) : null;
    const toi = recent.map(x => iceTime(x.toi)).filter(x => x !== null);
    if (toi.length) p.minutes = Math.round(toi.reduce((a, b) => a + b, 0) / toi.length);
    let factor = 1;
    if (shots.length >= 3 && p._shotsPerGame !== null) factor *= clamp((p.formShots / shots.length + 1) / (p._shotsPerGame + 1), 0.88, 1.12);
    if (p.formGames.length >= 3) factor *= clamp(0.9 + 0.1 * ((p.form / p.formGames.length + 0.12) / (p.goals / p.appearances + 0.12)), 0.9, 1.12);
    p.probability = poissonAtLeastOne(p._lambda * clamp(factor, 0.82, 1.22));
    p.model = 'GoalPulse 4.0 – Saison + Schüsse + Form';
    if (p.appearances >= 15 && shots.length >= 3 && toi.length >= 3) p.dataQuality = 'hoch';
  });
  for (const p of picks) { delete p._lambda; delete p._shotsPerGame; }
  // Team-level NHL standings: no made-up picks if unavailable.
  try {
    const standings = await nhl('/standings/now');
    const byAbbr = new Map((standings.standings || []).map(row => [row.teamAbbrev?.default || row.teamAbbrev, nhlTeamRates(row)]));
    for (const g of games) {
      if (g.gameType !== 2) continue;
      const h = byAbbr.get(g.homeAbbr), a = byAbbr.get(g.awayAbbr);
      if (!h || !a) continue;
      markets.push(...marketPicks(g, Math.sqrt(h.for * a.against) * 1.045, Math.sqrt(a.for * h.against) * 0.97, Math.min(h.played, a.played) >= 12 ? 'mittel' : 'niedrig'));
    }
  } catch (e) { errors.push(friendlyError(e, 'NHL-Teamstatistik')); }
  return { games, picks, markets };
}

async function loadDel(date, key, errors) {
  const leagues = await hockey(key, '/leagues');
  const del = leagues.find(l => (l.name || '').trim().toUpperCase() === 'DEL');
  if (!del) { errors.push('DEL: Liga nicht verfügbar.'); return { games: [], picks: [], markets: [] }; }
  const raw = await hockey(key, `/games?date=${date}&league=${del.id}&season=${seasonStart(date)}`);
  return { games: raw.map(x => gameFromApi(x, 'Eishockey')).filter(g => sameDay(g.time, date) && upcoming(g)), picks: [], markets: [] };
}

function addScorerMarkets(picks) {
  return picks.map(p => ({ id: `market-scorer-${p.id}`, fixtureId: p.fixtureId, sport: p.sport, league: p.league, time: p.time, game: `${p.team} – ${p.opponent}`, market: 'scorer', label: `Torschütze: ${p.name}`, probability: p.probability, dataQuality: p.dataQuality, model: p.model, playerId: p.playerId, photo: p.photo }));
}
async function buildResponse(date) {
  const games = [], picks = [], markets = [], errors = [], tasks = [];
  const fk = process.env.APISPORTS_FOOTBALL_KEY, hk = process.env.APISPORTS_HOCKEY_KEY;
  const collect = r => { games.push(...r.games); picks.push(...r.picks); markets.push(...r.markets); };
  if (fk) tasks.push(loadFootball(date, fk, errors).then(collect).catch(e => errors.push(friendlyError(e, 'Fußball'))));
  else errors.push('Fußball: API-Schlüssel fehlt.');
  tasks.push(loadNhl(date, errors).then(collect).catch(e => errors.push(friendlyError(e, 'NHL'))));
  if (hk) tasks.push(loadDel(date, hk, errors).then(collect).catch(e => errors.push(friendlyError(e, 'DEL'))));
  else errors.push('DEL: API-Schlüssel fehlt.');
  await Promise.all(tasks);
  markets.push(...addScorerMarkets(picks));
  games.sort((a, b) => new Date(a.time) - new Date(b.time));
  picks.sort((a, b) => b.probability - a.probability);
  markets.sort((a, b) => b.probability - a.probability);
  return { date, games, picks, markets, errors: [...new Set(errors)], model: 'GoalPulse 4.0', notice: 'Markt- und Torschützenwahrscheinlichkeiten sind vereinfachte, nicht kalibrierte Modellschätzungen. NHL-Siegmarkt berücksichtigt Overtime nur näherungsweise. DEL hat noch keine Marktprognosen. Fehlende Statistiken führen zu fehlenden Märkten, nicht zu erfundenen Werten.', updatedAt: new Date().toISOString() };
}
export async function GET(request) {
  const today = isoBerlin(new Date());
  const date = new URL(request.url).searchParams.get('date') || today;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(`${date}T12:00:00Z`)) || date < today || date > shift(today, 7)) return NextResponse.json({ error: 'Bitte ein Datum innerhalb der nächsten sieben Tage auswählen.' }, { status: 400 });
  const headers = { 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=300' };
  const hit = responseCache.get(date);
  if (hit && hit.expires > Date.now()) return NextResponse.json(hit.data, { headers });
  if (!responsePending.has(date)) {
    const job = buildResponse(date).then(data => { responseCache.set(date, { data, expires: Date.now() + responseTTL * 1000 }); if (responseCache.size > 10) responseCache.delete(responseCache.keys().next().value); return data; }).finally(() => responsePending.delete(date));
    responsePending.set(date, job);
  }
  return NextResponse.json(await responsePending.get(date), { headers });
}
