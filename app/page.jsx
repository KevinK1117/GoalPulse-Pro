
'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  Target, CalendarDays, Layers, Activity, RefreshCw,
  Trophy, House, Calendar, Star, Info, ChevronRight,
  ShieldCheck, AlertCircle, Clock3
} from 'lucide-react';

const tabs = [
  { name: 'Eishockey', icon: '🏒', sub: 'NHL & DEL' },
  { name: 'Fußball', icon: '⚽', sub: '11 Wettbewerbe' },
  { name: 'Gemischt', icon: '◈', sub: 'Beide Sportarten' }
];

const isoDE = d => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Berlin',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit'
}).format(d);

const shift = (date, n) => {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

const clock = d => {
  try {
    return d
      ? new Intl.DateTimeFormat('de-DE', {
          timeZone: 'Europe/Berlin',
          hour: '2-digit',
          minute: '2-digit'
        }).format(new Date(d))
      : '–';
  } catch {
    return '–';
  }
};

const shortDate = d => {
  try {
    return d
      ? new Date(
          d.length === 10 ? `${d}T12:00:00Z` : d
        ).toLocaleDateString('de-DE', {
          day: '2-digit',
          month: '2-digit',
          timeZone: 'Europe/Berlin'
        })
      : '–';
  } catch {
    return '–';
  }
};

const gameKey = p => `${p.sport}-${p.fixtureId}`;
const playerKey = p =>
  String(p.id || `${gameKey(p)}-${p.playerId}`);

const eligible = p =>
  Number.isFinite(p.probability) &&
  p.probability > 0 &&
  p.probability < 1 &&
  p.fixtureId != null;

const qualityWeight = p =>
  p.dataQuality === 'hoch'
    ? 1
    : p.dataQuality === 'mittel'
      ? 0.96
      : 0.87;

const score = p =>
  p.probability *
  qualityWeight(p) *
  (Number(p.appearances) >= 15 ? 1 : 0.93);

function buildCombo(picks, count) {
  const byGame = new Map();

  for (const p of picks.filter(eligible)) {
    const key = gameKey(p);

    if (
      !byGame.has(key) ||
      score(p) > score(byGame.get(key))
    ) {
      byGame.set(key, p);
    }
  }

  const ranked = [...byGame.values()].sort(
    (a, b) => score(b) - score(a)
  );

  const chosen = ranked.slice(0, count);

  return {
    chosen,
    availableGames: ranked.length,
    complete: chosen.length === count
  };
}

function Avatar({ photo, name }) {
  const [broken, setBroken] = useState(false);

  useEffect(() => {
    setBroken(false);
  }, [photo]);

  return (
    <div className="avatar">
      {photo && !broken ? (
        <img
          src={photo}
          alt={name}
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={() => setBroken(true)}
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            borderRadius: '50%'
          }}
        />
      ) : (
        '👤'
      )}
    </div>
  );
}

function Player({
  p,
  rank,
  action,
  selected,
  disabled
}) {
  return (
    <div className="player">
      <div className="playerhead">
        <span className="rank">{rank}</span>

        <Avatar photo={p.photo} name={p.name} />

        <div className="person">
          <b>{p.name}</b>
          <small>
            {p.team || 'Team nicht verfügbar'} · {p.league}
          </small>
          <small>
            {p.opponent || 'Gegner nicht verfügbar'} ·{' '}
            {clock(p.time)} Uhr
          </small>
        </div>

        <div className="prob">
          <strong>
            {Number.isFinite(p.probability)
              ? `${Math.round(p.probability * 100)}%`
              : '–'}
          </strong>
          <small>Schätzung</small>
        </div>
      </div>

      <div className="stats">
        <span>
          Schüsse Saison
          <b>{p.shots ?? '–'}</b>
        </span>
        <span>
          Tore letzte 5
          <b>{p.form ?? '–'}</b>
        </span>
        <span>
          Ø Minuten
          <b>{p.minutes ?? '–'}</b>
        </span>
      </div>

      {p.formShots != null && (
        <p
          className="muted"
          style={{ fontSize: 12, margin: '9px 0 0' }}
        >
          Schüsse letzte 5 Spiele: <b>{p.formShots}</b>
        </p>
      )}

      {p.formGames?.length > 0 && (
        <div
          style={{
            display: 'flex',
            gap: 6,
            marginTop: 12,
            flexWrap: 'wrap'
          }}
        >
          {p.formGames.map((g, i) => (
            <div
              key={i}
              style={{
                flex: '1 1 54px',
                minWidth: 54,
                padding: '8px 5px',
                borderRadius: 10,
                background: g.goals ? '#dff9ec' : '#f0f3f6',
                textAlign: 'center'
              }}
            >
              <div
                style={{
                  fontSize: 13,
                  fontWeight: 700
                }}
              >
                {g.goals}
                {g.goals === 1 ? ' Tor' : ' Tore'}
              </div>

              <div
                style={{
                  marginTop: 3,
                  fontSize: 10,
                  color: '#64748b'
                }}
              >
                {shortDate(g.date)}
              </div>
            </div>
          ))}
        </div>
      )}

      <p
        className="muted"
        style={{ fontSize: 11, margin: '10px 0 0' }}
      >
        {p.model || 'Unkalibriertes Prognosemodell'}
        {' · '}
        Datenqualität: {p.dataQuality || 'unbekannt'}
        {' · '}
        {p.lineupConfirmed
          ? 'Aufstellung bestätigt'
          : 'Aufstellung nicht bestätigt'}
      </p>

      {action && (
        <button
          type="button"
          disabled={disabled && !selected}
          onClick={() => action(p)}
          style={{
            marginTop: 10,
            padding: '9px 14px',
            borderRadius: 10,
            border: '1px solid #cbd5e1',
            background: selected ? '#e2e8f0' : '#e0f2fe',
            color: '#0f172a',
            fontWeight: 700,
            opacity: disabled && !selected ? 0.45 : 1
          }}
        >
          {selected ? '− Entfernen' : '+ Auswählen'}
        </button>
      )}
    </div>
  );
}

function Empty({ message }) {
  return (
    <div className="empty">
      <ShieldCheck size={30} />
      <b>Keine verfügbaren Spielerprognosen</b>
      <p>{message}</p>
    </div>
  );
}

export default function Home() {
  const [tab, setTab] = useState('Eishockey');
  const [page, setPage] = useState('Home');

  const [count, setCount] = useState(2);
  const [mode, setMode] = useState('auto');
  const [selectedIds, setSelectedIds] = useState([]);

  const [rasterCount, setRasterCount] = useState(4);
  const [rasterSelections, setRasterSelections] = useState([]);

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [date, setDate] = useState(() => isoDE(new Date()));

  async function load() {
    setLoading(true);

    try {
      const response = await fetch(
        `/api/picks?date=${encodeURIComponent(date)}`,
        { cache: 'no-store' }
      );

      const json = await response.json();

      if (!response.ok) {
        throw Error(json.error || 'Server antwortet nicht');
      }

      setData(json);
    } catch (error) {
      setData({
        games: [],
        picks: [],
        errors: [
          error.message || 'Verbindung fehlgeschlagen'
        ],
        notice: 'Verbindung nicht verfügbar.'
      });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, [date]);

  useEffect(() => {
    setSelectedIds([]);
    setRasterSelections([]);
  }, [date, tab]);

  const games = useMemo(
    () =>
      (data?.games || []).filter(
        g => tab === 'Gemischt' || g.sport === tab
      ),
    [data, tab]
  );

  const picks = useMemo(
    () =>
      (data?.picks || [])
        .filter(
          p => tab === 'Gemischt' || p.sport === tab
        )
        .sort(
          (a, b) => b.probability - a.probability
        ),
    [data, tab]
  );

  const combo = useMemo(
    () => buildCombo(picks, count),
    [picks, count]
  );

  const manualPicks = useMemo(() => {
    const byId = new Map(
      picks
        .filter(eligible)
        .map(p => [playerKey(p), p])
    );

    return selectedIds
      .map(id => byId.get(id))
      .filter(Boolean)
      .slice(0, count);
  }, [picks, selectedIds, count]);

  const candidates =
    mode === 'auto' ? combo.chosen : manualPicks;

  const chosenIds = new Set(
    manualPicks.map(playerKey)
  );

  const usedGames = new Set(
    manualPicks.map(gameKey)
  );

  const availableManual = picks
    .filter(eligible)
    .sort((a, b) => score(b) - score(a));

  const nav = [
    ['Home', House],
    ['Kombis', Layers],
    ['Raster', Target],
    ['Spiele', Calendar],
    ['Favoriten', Star],
    ['Infos', Info]
  ];

  // Alle auswählbaren Märkte
  const rasterMarkets = useMemo(() => {
    const list = [];

    for (const g of games) {
      const key = `${g.sport}-${g.id}`;
      const hockey = g.sport === 'Eishockey';

      const thresholds = hockey
        ? [4.5, 5.5, 6.5]
        : [1.5, 2.5, 3.5];

      const add = (
        market,
        label,
        player = null
      ) => {
        list.push({
          id: `${key}-${market}`,
          gameKey: key,
          sport: g.sport,
          game: `${g.home} – ${g.away}`,
          league: g.league,
          time: g.time,
          label,
          player,
          probability: player?.probability ?? null
        });
      };

      for (const threshold of thresholds) {
        add(
          `over-${threshold}`,
          `Über ${String(threshold).replace('.', ',')} Tore`
        );
      }

      add('home-win', `Sieg ${g.home}`);
      add('away-win', `Sieg ${g.away}`);

      add(
        'btts-yes',
        'Beide Teams treffen: Ja'
      );

      add(
        'btts-no',
        'Beide Teams treffen: Nein'
      );

      const gamePicks = picks.filter(
        p =>
          String(p.fixtureId) === String(g.id) &&
          p.sport === g.sport &&
          eligible(p)
      );

      for (const p of gamePicks) {
        add(
          `scorer-${p.playerId || p.id}`,
          `Torschütze: ${p.name}`,
          p
        );
      }
    }

    return list;
  }, [games, picks]);

  const selectedRaster = rasterSelections
    .map(id => rasterMarkets.find(m => m.id === id))
    .filter(Boolean)
    .slice(0, rasterCount);

  const rasterUsedGames = new Set(
    selectedRaster.map(m => m.gameKey)
  );

  function toggleRaster(market) {
    setRasterSelections(prev => {
      if (prev.includes(market.id)) {
        return prev.filter(id => id !== market.id);
      }

      const current = prev
        .map(id => rasterMarkets.find(m => m.id === id))
        .filter(Boolean);

      if (
        current.length >= rasterCount ||
        current.some(
          m => m.gameKey === market.gameKey
        )
      ) {
        return prev;
      }

      return [...prev, market.id];
    });
  }

  function togglePlayer(p) {
    const id = playerKey(p);

    if (selectedIds.includes(id)) {
      setSelectedIds(prev =>
        prev.filter(x => x !== id)
      );
      return;
    }

    if (
      manualPicks.length >= count ||
      usedGames.has(gameKey(p))
    ) {
      return;
    }

    setSelectedIds(prev => [...prev, id]);
  }

  return (
    <div className="shell">
      <header>
        <div className="brand">
          <div className="logo">
            <Target size={29} />
          </div>

          <div>
            <h1>
              GoalPulse <em>PRO</em>
            </h1>
            <p>Torschützen-Analysen nach Spieltag</p>
          </div>
        </div>

        <div className="date">
          <CalendarDays size={19} />

          <span>
            <select
              aria-label="Spieltag wählen"
              value={date}
              onChange={e => setDate(e.target.value)}
            >
              <option value={isoDE(new Date())}>
                Heute
              </option>

              <option value={shift(isoDE(new Date()), 1)}>
                Morgen
              </option>

              {Array.from({ length: 6 }, (_, i) => {
                const d = shift(
                  isoDE(new Date()),
                  i + 2
                );

                return (
                  <option key={d} value={d}>
                    {new Date(
                      `${d}T12:00:00Z`
                    ).toLocaleDateString('de-DE', {
                      day: '2-digit',
                      month: '2-digit',
                      year: 'numeric'
                    })}
                  </option>
                );
              })}
            </select>

            <strong>
              {new Date(
                `${date}T12:00:00Z`
              ).toLocaleDateString('de-DE', {
                day: '2-digit',
                month: 'long',
                year: 'numeric'
              })}
            </strong>
          </span>
        </div>
      </header>

      <div className="tabs">
        {tabs.map(t => (
          <button
            key={t.name}
            className={`tab ${tab === t.name ? 'active' : ''}`}
            onClick={() => setTab(t.name)}
          >
            <span className="tabicon">{t.icon}</span>

            <span>
              <b>{t.name}</b>
              <small>{t.sub}</small>
            </span>
          </button>
        ))}
      </div>

      <section className="metrics">
        <div>
          <span>🏟️</span>
          <b>{games.length}</b>
          <small>Spiele am Spieltag</small>
        </div>

        <div>
          <Target size={20} />
          <b>{picks.length}</b>
          <small>Spieler analysiert</small>
        </div>

        <div>
          <Clock3 size={20} />
          <b>
            {data?.updatedAt
              ? clock(data.updatedAt)
              : '–'}
          </b>
          <small>Letztes Update</small>
        </div>

        <div>
          <Activity size={20} />
          <b>{loading ? 'Lädt' : 'API'}</b>
          <small>
            {data?.errors?.length
              ? 'Prüfung nötig'
              : 'Verbunden'}
          </small>
        </div>
      </section>

      {data?.errors?.length > 0 && (
        <div className="warning">
          <AlertCircle size={18} />
          <span>{data.errors.join(' · ')}</span>
        </div>
      )}

      {page === 'Home' && (
        <>
          <div className="sectionhead">
            <div>
              <h2>
                <Trophy size={23} />
                Top-Torschützen
              </h2>
              <p>
                Modellschätzungen für den ausgewählten
                Spieltag
              </p>
            </div>

            <button
              className="tiny"
              onClick={load}
              aria-label="Aktualisieren"
            >
              <RefreshCw size={16} />
            </button>
          </div>

          {picks.length ? (
            picks.map((p, i) => (
              <Player
                key={playerKey(p)}
                p={p}
                rank={i + 1}
              />
            ))
          ) : (
            <Empty
              message={
                data?.notice ||
                'Keine Spielerdaten verfügbar.'
              }
            />
          )}

          <div className="combo">
            <div>
              <b>Kombi-Generator 3.2</b>
              <small>
                2–10 Spieler · automatisch oder manuell
              </small>
            </div>

            <button onClick={() => setPage('Kombis')}>
              Öffnen
              <ChevronRight size={17} />
            </button>
          </div>

          <div className="combo">
            <div>
              <b>Multi-Markt-Kombi-Raster</b>
              <small>
                Über-Tore · Siege · Beide treffen · Torschützen
              </small>
            </div>

            <button onClick={() => setPage('Raster')}>
              Öffnen
              <ChevronRight size={17} />
            </button>
          </div>
        </>
      )}

      {page === 'Kombis' && (
        <>
          <div className="sectionhead">
            <div>
              <h2>
                <Layers size={23} />
                Kombi-Generator 3.2
              </h2>
              <p>
                2–10 Spieler · maximal einer pro Partie
              </p>
            </div>
          </div>

          <div className="panel">
            <label htmlFor="count">
              Anzahl Spieler: <b>{count}</b>
            </label>

            <input
              id="count"
              type="range"
              min="2"
              max="10"
              value={count}
              onChange={e => {
                const next = Number(e.target.value);
                setCount(next);
                setSelectedIds(prev =>
                  prev.slice(0, next)
                );
              }}
            />

            <div
              style={{
                display: 'flex',
                gap: 8,
                marginTop: 15,
                flexWrap: 'wrap'
              }}
            >
              <button
                type="button"
                onClick={() => setMode('auto')}
                style={{
                  padding: '10px 12px',
                  borderRadius: 10,
                  fontWeight: 700,
                  border: '1px solid #cbd5e1',
                  background:
                    mode === 'auto'
                      ? '#dbeafe'
                      : '#fff'
                }}
              >
                Automatisch
              </button>

              <button
                type="button"
                onClick={() => setMode('manual')}
                style={{
                  padding: '10px 12px',
                  borderRadius: 10,
                  fontWeight: 700,
                  border: '1px solid #cbd5e1',
                  background:
                    mode === 'manual'
                      ? '#dbeafe'
                      : '#fff'
                }}
              >
                Selbst auswählen
              </button>
            </div>

            <div
              style={{
                display: 'grid',
                gap: 10,
                marginTop: 16
              }}
            >
              <div>
                <b>Ausgewählte Spieler: </b>
                {candidates.length} von {count}
              </div>

              <div>
                <b>Unterschiedliche Spiele: </b>
                {new Set(
                  candidates.map(gameKey)
                ).size}
              </div>

              <div>
                <b>Modus: </b>
                {mode === 'auto'
                  ? 'Automatische Qualitätsauswahl'
                  : 'Manuelle Spielerauswahl'}
              </div>

              {mode === 'auto' && !combo.complete && (
                <p
                  style={{
                    color: '#b45309',
                    fontWeight: 600,
                    fontSize: 13
                  }}
                >
                  Nur {combo.availableGames} unterschiedliche
                  Spiele mit geeigneten Torschützen verfügbar.
                </p>
              )}

              {mode === 'manual' && (
                <>
                  <p className="muted">
                    Wähle unten Spieler aus.
                    Ein zweiter Spieler derselben Partie
                    ist gesperrt.
                  </p>

                  <button
                    type="button"
                    onClick={() => setSelectedIds([])}
                    style={{
                      padding: '9px 12px',
                      borderRadius: 10,
                      border: '1px solid #cbd5e1',
                      background: '#fff',
                      fontWeight: 700
                    }}
                  >
                    Auswahl zurücksetzen
                  </button>
                </>
              )}

              <p className="muted">
                Alle Prozentwerte sind unkalibrierte
                Modellschätzungen. Keine verlässliche
                Kombi-Wahrscheinlichkeit und keine
                Gewinngarantie.
              </p>
            </div>
          </div>

          {candidates.length > 0 ? (
            candidates.map((p, i) => (
              <Player
                key={playerKey(p)}
                p={p}
                rank={i + 1}
                action={
                  mode === 'manual'
                    ? togglePlayer
                    : null
                }
                selected={mode === 'manual'}
              />
            ))
          ) : (
            <Empty
              message={
                mode === 'manual'
                  ? 'Wähle unten Spieler für deine Kombi aus.'
                  : 'Keine geeigneten Torschützen verfügbar.'
              }
            />
          )}

          {mode === 'manual' && (
            <>
              <div className="sectionhead">
                <div>
                  <h2>
                    <Target size={23} />
                    Spieler auswählen
                  </h2>
                  <p>
                    {manualPicks.length} von {count} ausgewählt
                    · pro Spiel nur ein Spieler
                  </p>
                </div>
              </div>

              {availableManual
                .filter(
                  p => !chosenIds.has(playerKey(p))
                )
                .map((p, i) => (
                  <Player
                    key={playerKey(p)}
                    p={p}
                    rank={i + 1}
                    action={togglePlayer}
                    selected={false}
                    disabled={
                      manualPicks.length >= count ||
                      usedGames.has(gameKey(p))
                    }
                  />
                ))}
            </>
          )}
        </>
      )}

      {page === 'Raster' && (
        <>
          <div className="sectionhead">
            <div>
              <h2>
                <Target size={23} />
                Multi-Markt-Kombi-Raster
              </h2>
              <p>
                Fußball, Eishockey oder gemischt ·
                Über-Tore, Siege, beide treffen und Torschützen
              </p>
            </div>
          </div>

          <div className="panel">
            <label htmlFor="rasterCount">
              Anzahl Tipps: <b>{rasterCount}</b>
            </label>

            <input
              id="rasterCount"
              type="range"
              min="2"
              max="10"
              value={rasterCount}
              onChange={e => {
                const next = Number(e.target.value);
                setRasterCount(next);
                setRasterSelections(prev =>
                  prev.slice(0, next)
                );
              }}
            />

            <div
              style={{
                display: 'grid',
                gap: 9,
                marginTop: 14
              }}
            >
              <div>
                <b>Auswahl:</b> {selectedRaster.length} von{' '}
                {rasterCount}
              </div>

              <div>
                <b>Sportfilter:</b> {tab}
                {' '}(oben umschalten)
              </div>

              <p className="muted">
                Ein Tipp pro Partie. Märkte ohne
                Prognosemodell sind manuelle
                Auswahlmöglichkeiten, keine Empfehlungen.
                Für Torschützen erscheinen nur
                unkalibrierte Modellschätzungen.
              </p>

              <button
                type="button"
                onClick={() => setRasterSelections([])}
                style={{
                  padding: '10px 12px',
                  borderRadius: 10,
                  background: '#fff',
                  border: '1px solid #cbd5e1',
                  fontWeight: 700
                }}
              >
                Raster zurücksetzen
              </button>
            </div>
          </div>

          <div className="sectionhead">
            <div>
              <h2>
                <Layers size={22} />
                Mein Kombi-Raster
              </h2>
            </div>
          </div>

          {selectedRaster.length ? (
            selectedRaster.map((m, i) => (
              <div className="fixture" key={m.id}>
                <div style={{ minWidth: 0 }}>
                  <b>
                    {i + 1}. {m.label}
                  </b>

                  <small>
                    {m.game} · {m.sport}
                  </small>

                  <small>
                    {m.probability != null
                      ? `Torschützen-Schätzung: ${Math.round(m.probability * 100)}%`
                      : 'Keine Markt-Wahrscheinlichkeit verfügbar'}
                  </small>
                </div>

                <button
                  type="button"
                  onClick={() => toggleRaster(m)}
                  aria-label={`${m.label} entfernen`}
                  style={{
                    border: '1px solid #cbd5e1',
                    borderRadius: 9,
                    padding: 8,
                    background: '#fff'
                  }}
                >
                  ✕
                </button>
              </div>
            ))
          ) : (
            <div className="panel">
              <p className="muted">
                Noch keine Tipps ausgewählt.
                Wähle unten einen Markt pro Spiel.
              </p>
            </div>
          )}

          {selectedRaster.length < rasterCount && (
            <p
              className="muted"
              style={{ margin: '12px 0' }}
            >
              Noch {rasterCount - selectedRaster.length}{' '}
              Tipp(s) möglich. Es stehen{' '}
              {new Set(
                rasterMarkets.map(m => m.gameKey)
              ).size}{' '}
              Spiele zur Verfügung.
            </p>
          )}

          <div className="sectionhead">
            <div>
              <h2>
                <Calendar size={22} />
                Märkte nach Spiel
              </h2>
              <p>
                Pro Partie kannst du genau einen
                Markt hinzufügen.
              </p>
            </div>
          </div>

          {games.length ? (
            games.map(g => {
              const key = `${g.sport}-${g.id}`;

              const options = rasterMarkets.filter(
                m => m.gameKey === key
              );

              const occupied = rasterUsedGames.has(key);

              return (
                <div
                  className="panel"
                  key={key}
                  style={{ marginBottom: 12 }}
                >
                  <b>
                    {g.home} – {g.away}
                  </b>

                  <p
                    className="muted"
                    style={{ margin: '5px 0 12px' }}
                  >
                    {g.league} · {g.sport} ·{' '}
                    {clock(g.time)} Uhr
                  </p>

                  <div
                    style={{
                      display: 'flex',
                      gap: 8,
                      flexWrap: 'wrap'
                    }}
                  >
                    {options.map(m => {
                      const active =
                        rasterSelections.includes(m.id);

                      const blocked =
                        !active &&
                        (
                          occupied ||
                          selectedRaster.length >=
                            rasterCount
                        );

                      return (
                        <button
                          key={m.id}
                          type="button"
                          disabled={blocked}
                          onClick={() => toggleRaster(m)}
                          style={{
                            padding: '9px 11px',
                            borderRadius: 10,
                            border: active
                              ? '2px solid #2563eb'
                              : '1px solid #cbd5e1',
                            background: active
                              ? '#dbeafe'
                              : '#fff',
                            opacity: blocked ? 0.42 : 1,
                            fontWeight: active ? 700 : 500,
                            textAlign: 'left'
                          }}
                        >
                          {active ? '✓ ' : ''}
                          {m.label}
                          {m.probability != null
                            ? ` · ${Math.round(m.probability * 100)}%*`
                            : ''}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })
          ) : (
            <Empty
              message="Keine Spiele für den ausgewählten Tag und Sportfilter verfügbar."
            />
          )}

          <p
            className="muted"
            style={{ fontSize: 12 }}
          >
            * Torschützen-Prozentwerte sind unkalibriert.
            Über-Tore, Sieger und Beide-treffen-Märkte
            haben noch keine berechneten Wahrscheinlichkeiten.
            Keine Gewinngarantie.
          </p>
        </>
      )}

      {page === 'Spiele' && (
        <>
          <div className="sectionhead">
            <div>
              <h2>
                <Calendar size={23} />
                Spiele am Spieltag
              </h2>
              <p>
                Spielzeiten in deutscher Zeitzone
              </p>
            </div>

            <button
              className="tiny"
              onClick={load}
              aria-label="Spiele aktualisieren"
            >
              <RefreshCw size={16} />
            </button>
          </div>

          {games.length ? (
            games.map((g, i) => (
              <div
                className="fixture"
                key={`${g.sport}-${g.id}-${i}`}
              >
                <div>
                  <b>
                    {g.home} – {g.away}
                  </b>
                  <small>
                    {g.league} · {g.sport}
                  </small>
                </div>

                <strong>{clock(g.time)}</strong>
              </div>
            ))
          ) : (
            <Empty
              message="Keine passenden Spiele gefunden."
            />
          )}
        </>
      )}

      {page === 'Favoriten' && (
        <Empty
          message="Favoriten folgen in einem späteren Update."
        />
      )}

      {page === 'Infos' && (
        <div className="panel info">
          <h2>Über GoalPulse</h2>

          <p>
            GoalPulse Analyse 3.0 berücksichtigt
            bei Fußball Saison-Torquote und
            verfügbare Schussdaten.
          </p>

          <p>
            Bei NHL fließen Saison-Torquote,
            Schüsse und bei ausgewählten Spielern
            aktuelle Schüsse und Form ein.
          </p>

          <p>
            DEL-Spiele werden angezeigt.
            DEL-Spielerprognosen sind noch
            nicht angebunden.
          </p>

          <p>
            Der Kombi-Generator 3.2 unterstützt
            2–10 Spieler, automatische und
            manuelle Auswahl und maximal einen
            Spieler pro Partie.
          </p>

          <p>
            Der Multi-Markt-Raster kombiniert
            manuell Über-Tore, Sieger, beide
            treffen und Torschützen.
            Für Spielmärkte fehlen noch
            belastbare Wahrscheinlichkeiten.
          </p>

          <p>
            xG, Gegnerstärke und bestätigte
            Aufstellungen sind derzeit nicht
            Bestandteil des Modells.
          </p>

          <p>
            Die angezeigten Prozentwerte sind
            nicht historisch kalibriert und
            keine verlässlichen Wettquoten.
          </p>
        </div>
      )}

      <div className="space" />

      <nav>
        {nav.map(([name, Icon]) => (
          <button
            key={name}
            className={
              page === name ? 'current' : ''
            }
            onClick={() => setPage(name)}
          >
            <Icon size={22} />
            <span>{name}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}
