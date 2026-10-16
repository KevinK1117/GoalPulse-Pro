

'use client';

import { useEffect, useMemo, useState } from 'react';

import {
  Target,
  CalendarDays,
  Layers,
  Activity,
  RefreshCw,
  Trophy,
  House,
  Calendar,
  Star,
  Info,
  ChevronRight,
  ShieldCheck,
  AlertCircle,
  Clock3
} from 'lucide-react';

const tabs = [
  { name: 'Eishockey', icon: '🏒', sub: 'NHL & DEL' },
  { name: 'Fußball', icon: '⚽', sub: '11 Wettbewerbe' },
  { name: 'Gemischt', icon: '◈', sub: 'Beide Sportarten' }
];

const isoDE = d =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Berlin',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(d);

const shift = (date, n) => {
  const d = new Date(date + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

const clock = d => {
  try {
    if (!d) return '–';

    return new Intl.DateTimeFormat('de-DE', {
      timeZone: 'Europe/Berlin',
      hour: '2-digit',
      minute: '2-digit'
    }).format(new Date(d));
  } catch {
    return '–';
  }
};

const shortDate = d => {
  if (!d) return '–';

  try {
    return new Date(
      d.length === 10 ? d + 'T12:00:00Z' : d
    ).toLocaleDateString('de-DE', {
      day: '2-digit',
      month: '2-digit',
      timeZone: 'Europe/Berlin'
    });
  } catch {
    return '–';
  }
};

function Avatar({ photo, name }) {
  const [broken, setBroken] = useState(false);

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

function Player({ p, rank }) {
  return (
    <div className="player">
      <div className="playerhead">
        <span className="rank">{rank}</span>

        <Avatar photo={p.photo} name={p.name} />

        <div className="person">
          <b>{p.name}</b>

          <small>
            {p.team || 'Team nicht verfügbar'}
            {' · '}
            {p.league}
          </small>

          <small>
            {p.opponent || 'Gegner nicht verfügbar'}
            {' · '}
            {clock(p.time)} Uhr
          </small>
        </div>

        <div className="prob">
          <strong>
            {Number.isFinite(p.probability)
              ? Math.round(p.probability * 100) + '%'
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
                background: g.goals
                  ? '#dff9ec'
                  : '#f0f3f6',
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
        style={{
          fontSize: 11,
          margin: '10px 0 0'
        }}
      >
        Unkalibriertes Poisson-Basismodell ·
        Aufstellung nicht bestätigt
      </p>
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
  const [count, setCount] = useState(6);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  const [date, setDate] = useState(
    () => isoDE(new Date())
  );

  async function load() {
    setLoading(true);

    try {
      const response = await fetch(
        '/api/picks?date=' + encodeURIComponent(date),
        { cache: 'no-store' }
      );

      const json = await response.json();

      if (!response.ok) {
        throw Error(
          json.error || 'Server antwortet nicht'
        );
      }

      setData(json);
    } catch (error) {
      setData({
        games: [],
        picks: [],
        errors: [error.message],
        notice: 'Verbindung nicht verfügbar.'
      });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, [date]);

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

  const candidates = picks.slice(0, count);

  const nav = [
    ['Home', House],
    ['Kombis', Layers],
    ['Spiele', Calendar],
    ['Favoriten', Star],
    ['Infos', Info]
  ];

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

              <option
                value={shift(isoDE(new Date()), 1)}
              >
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
                      d + 'T12:00:00Z'
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
                date + 'T12:00:00Z'
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
            className={
              'tab ' +
              (tab === t.name ? 'active' : '')
            }
            onClick={() => setTab(t.name)}
          >
            <span className="tabicon">
              {t.icon}
            </span>

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
          <span>
            {data.errors.join(' · ')}
          </span>
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
                Modellschätzungen für den
                ausgewählten Spieltag
              </p>
            </div>

            <button
              className="tiny"
              onClick={load}
            >
              <RefreshCw size={16} />
            </button>
          </div>

          {picks.length ? (
            picks.map((p, i) => (
              <Player
                key={p.id || i}
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
              <b>Kombi-Generator</b>
              <small>
                6–10 Spieler · ausgewählter Spieltag
              </small>
            </div>

            <button
              onClick={() => setPage('Kombis')}
            >
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
                Kombi-Generator
              </h2>
              <p>
                Nach Modellschätzung sortiert
              </p>
            </div>
          </div>

          <div className="panel">
            <label htmlFor="count">
              Anzahl Spieler:
              <b> {count}</b>
            </label>

            <input
              id="count"
              type="range"
              min="6"
              max="10"
              value={count}
              onChange={e =>
                setCount(Number(e.target.value))
              }
            />

            <p className="muted">
              Nur Spieler mit vorhandenen
              Saisonstatistiken.
              Keine Gewinngarantie.
            </p>
          </div>

          {candidates.length >= count ? (
            candidates.map((p, i) => (
              <Player
                key={p.id || i}
                p={p}
                rank={i + 1}
              />
            ))
          ) : (
            <Empty
              message={
                `Für ${count} Tipps stehen noch ` +
                `nicht genügend Spieler zur Verfügung.`
              }
            />
          )}
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

                <strong>
                  {clock(g.time)}
                </strong>
              </div>
            ))
          ) : (
            <Empty
              message={
                'Keine passenden Spiele gefunden.'
              }
            />
          )}
        </>
      )}

      {page === 'Favoriten' && (
        <Empty
          message={
            'Favoriten folgen in einem späteren Update.'
          }
        />
      )}

      {page === 'Infos' && (
        <div className="panel info">
          <h2>Über GoalPulse</h2>

          <p>
            NHL-Spielerstatistiken und Fotos
            werden über die öffentliche
            NHL-Datenquelle geladen.
          </p>

          <p>
            Fußball und DEL verwenden
            API-SPORTS. Für DEL-Spieler
            wird die Statistik-Anbindung
            noch ergänzt.
          </p>

          <p>
            Alle Prozentwerte sind
            unkalibrierte Modellschätzungen,
            keine bestätigten
            Torwahrscheinlichkeiten.
          </p>

          <p>
            Die Form zeigt Tore aus bis
            zu fünf verfügbaren Spielen.
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
