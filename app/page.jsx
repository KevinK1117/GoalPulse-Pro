
'use client';

import { useEffect, useMemo, useState } from 'react';
import { Target, RefreshCw, Layers, CalendarDays, AlertCircle, House, Calendar, Info, Activity } from 'lucide-react';

const berlinDate = d => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
function shift(d, n) { const x = new Date(`${d}T12:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); }
function clock(s) { try { return new Intl.DateTimeFormat('de-DE', { timeZone: 'Europe/Berlin', hour: '2-digit', minute: '2-digit' }).format(new Date(s)); } catch { return '–'; } }
const keyGame = x => `${x.sport}-${x.fixtureId}`;
const quality = x => x.dataQuality === 'hoch' ? 1 : x.dataQuality === 'mittel' ? 0.96 : 0.88;
const rank = x => x.probability * quality(x);
const valid = x => Number.isFinite(x.probability) && x.probability > 0 && x.probability < 1 && x.fixtureId != null;

// Bis zu vier unterschiedliche Marktarten pro Partie.
// Eine Marktart pro Partie verhindert widerspruechliche Tipps
// (z.B. Heim- und Auswaertssieg oder mehrere Over-Linien).
const MAX_PER_GAME = 4;
function canAddMarket(m, chosen) {
  const same = chosen.filter(x => keyGame(x) === keyGame(m));
  return same.length < MAX_PER_GAME &&
    !same.some(x => category(x) === category(m));
}
function autoCombo(markets, count, strategy) {
  const eligible = markets.filter(valid).sort((a, b) => rank(b) - rank(a));
  const result = [];
  while (result.length < count) {
    const possible = eligible.filter(m => !result.some(x => x.id === m.id) && canAddMarket(m, result));
    if (!possible.length) break;
    const chosenCategories = new Set(result.map(category));
    possible.sort((a, b) => {
      const aSame = result.filter(x => keyGame(x) === keyGame(a)).length;
      const bSame = result.filter(x => keyGame(x) === keyGame(b)).length;
      const aBonus = strategy === 'mix' && !chosenCategories.has(category(a)) ? 0.12 : 0;
      const bBonus = strategy === 'mix' && !chosenCategories.has(category(b)) ? 0.12 : 0;
      // Leichte Diversifikation, keine Aenderung der angezeigten Wahrscheinlichkeiten.
      return (rank(b) + bBonus - bSame * 0.025) - (rank(a) + aBonus - aSame * 0.025);
    });
    result.push(possible[0]);
  }
  return result;
}
function category(x) {
  if (x.market === 'scorer') return 'scorer';
  if (x.market?.startsWith('over-')) return 'over';
  if (x.market === 'btts-yes' || x.market === 'btts-no') return 'btts';
  return 'win';
}
function catName(x) { return { scorer: 'Torschütze', over: 'Über-Tore', btts: 'Beide treffen', win: 'Sieger / Ergebnis' }[category(x)]; }

export default function Home() {
  const [date, setDate] = useState(() => berlinDate(new Date()));
  const [sport, setSport] = useState('Gemischt');
  const [page, setPage] = useState('Raster');
  const [count, setCount] = useState(4);
  const [strategy, setStrategy] = useState('mix');
  const [scorersOnly, setScorersOnly] = useState(false);
  const [manualIds, setManualIds] = useState([]);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let alive = true;
    const controller = new AbortController();
    setLoading(true);
    setError('');
    fetch(`/api/picks?date=${encodeURIComponent(date)}`, { cache: 'no-store', signal: controller.signal })
      .then(async r => { const json = await r.json(); if (!r.ok) throw Error(json.error || 'API-Fehler'); return json; })
      .then(json => { if (alive) setData(json); })
      .catch(e => { if (alive && e.name !== 'AbortError') { setError(e.message); setData(null); } })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; controller.abort(); };
  }, [date, reload]);

  useEffect(() => { setManualIds([]); }, [date, sport]);

  const games = useMemo(() => (data?.games || []).filter(g => sport === 'Gemischt' || g.sport === sport), [data, sport]);
  const picks = useMemo(() => (data?.picks || []).filter(p => sport === 'Gemischt' || p.sport === sport).sort((a, b) => rank(b) - rank(a)), [data, sport]);
  const markets = useMemo(() => (data?.markets || []).filter(m => (sport === 'Gemischt' || m.sport === sport) && valid(m)), [data, sport]);
  const automatic = useMemo(() => autoCombo(markets.filter(m => !scorersOnly || m.market === 'scorer'), count, strategy), [markets, count, strategy, scorersOnly]);
  const byId = useMemo(() => new Map(markets.map(m => [m.id, m])), [markets]);
  const manual = manualIds.map(id => byId.get(id)).filter(Boolean).slice(0, count);
  const manualGames = new Set(manual.map(keyGame));
  const [manualMode, setManualMode] = useState(false);
  const combo = manualMode ? manual : automatic;
  const comboComplete = combo.length === count;
  const uniqueGames = new Set(markets.map(keyGame)).size;
  const categories = ['Alle', 'Über-Tore', 'Sieger / Ergebnis', 'Beide treffen', 'Torschütze'];
  const [categoryFilter, setCategoryFilter] = useState('Alle');

  function toggleMarket(m) {
    setManualIds(old => {
      if (old.includes(m.id)) return old.filter(id => id !== m.id);
      const current = old.map(id => byId.get(id)).filter(Boolean);
      if (current.length >= count || !canAddMarket(m, current)) return old;
      return [...old, m.id];
    });
  }

  return (
    <div className="gp-shell">
      <style>{`
        .gp-shell{max-width:950px;margin:0 auto;padding:20px 15px 100px;color:#e8efff;font-family:system-ui,-apple-system,sans-serif}
        body{background:#081323}.gp-top{display:flex;justify-content:space-between;gap:12px;align-items:center;flex-wrap:wrap}
        .gp-title{font-size:25px;font-weight:850;margin:0}.gp-sub{color:#9fb0c9;font-size:12px;margin:5px 0 0}
        .gp-card{background:#11233b;border:1px solid #29405f;border-radius:16px;padding:16px;margin-top:13px}
        .gp-row{display:flex;align-items:center;gap:9px;flex-wrap:wrap}.gp-between{justify-content:space-between}
        .gp-btn{border:1px solid #365173;background:#182f4c;color:#e8efff;border-radius:11px;padding:10px 13px;font-size:13px;font-weight:650;cursor:pointer}
        .gp-btn:disabled{opacity:.36;cursor:not-allowed}.gp-btn.on{background:#1665c0;border-color:#56a3ff;color:#fff}
        .gp-muted{color:#a4b5ce;font-size:12px;line-height:1.55}.gp-section{font-size:18px;font-weight:750;margin:23px 0 10px}
        .gp-line{border-top:1px solid #2b405c;margin:13px 0}.gp-pct{font-size:22px;font-weight:850;color:#65dcb5}
        .gp-market{display:flex;justify-content:space-between;align-items:center;gap:10px;padding:12px 0;border-bottom:1px solid #253b58}
        .gp-market:last-child{border:0}.gp-market b{font-size:14px}.gp-market small{display:block;color:#a4b5ce;font-size:11px;margin-top:5px}
        .gp-nav{position:fixed;bottom:0;left:0;right:0;display:flex;justify-content:center;gap:4px;background:#0b1a2e;border-top:1px solid #29405f;padding:10px 6px;z-index:20}
        .gp-nav button{display:flex;flex-direction:column;align-items:center;gap:3px;min-width:65px}
        .gp-select{background:#182f4c;color:#fff;border:1px solid #365173;padding:10px;border-radius:10px;max-width:100%}
        .gp-warning{background:#473421;border:1px solid #896039;color:#ffe3ac;padding:12px;border-radius:12px;margin-top:12px;font-size:12px}
        .gp-range{width:100%;accent-color:#58a8ff;margin:15px 0}
      `}</style>

      <div className="gp-top">
        <div><h1 className="gp-title">🎯 GoalPulse <span style={{color:'#65dcb5'}}>PRO</span></h1><p className="gp-sub">Analyse 4.0 · automatischer Multi-Markt-Raster</p></div>
        <div className="gp-row"><CalendarDays size={18}/><select className="gp-select" value={date} onChange={e => setDate(e.target.value)}>{Array.from({length:8},(_,i)=>{const d=shift(berlinDate(new Date()),i);return <option key={d} value={d}>{i===0?'Heute':i===1?'Morgen':d}</option>;})}</select><button className="gp-btn" onClick={()=>setReload(n=>n+1)} title="Aktualisieren"><RefreshCw size={17}/></button></div>
      </div>

      <div className="gp-card"><div className="gp-row">{['Fußball','Eishockey','Gemischt'].map(s=><button key={s} className={`gp-btn ${sport===s?'on':''}`} onClick={()=>setSport(s)}>{s==='Fußball'?'⚽':s==='Eishockey'?'🏒':'🔀'} {s}</button>)}</div><p className="gp-muted">{games.length} Spiele · {picks.length} Torschützen · {markets.length} berechnete Märkte · {loading?'Analysiere …':'Daten geladen'}</p></div>
      {error && <div className="gp-warning"><AlertCircle size={15}/> {error}</div>}
      {data?.errors?.length>0 && <div className="gp-warning">{data.errors.join(' · ')}</div>}

      {page==='Raster' && <>
        <h2 className="gp-section">🧩 Automatische Kombis 2–10 · bis zu 4 pro Spiel</h2>
        <div className="gp-card">
          <div className="gp-row gp-between"><b>Anzahl Tipps</b><strong style={{fontSize:22}}>{count}</strong></div>
          <input className="gp-range" type="range" min="2" max="10" value={count} onChange={e=>{const n=Number(e.target.value);setCount(n);setManualIds(x=>x.slice(0,n));}}/>
          <div className="gp-row"><button className={`gp-btn ${!manualMode?'on':''}`} onClick={()=>setManualMode(false)}>⚡ Automatisch erstellen</button><button className={`gp-btn ${manualMode?'on':''}`} onClick={()=>setManualMode(true)}>✋ Manuell ändern</button></div>
          {!manualMode && <><p className="gp-muted">Automatische Strategie:</p><div className="gp-row"><button className={`gp-btn ${strategy==='mix'?'on':''}`} onClick={()=>setStrategy('mix')}>Marktmix</button><button className={`gp-btn ${strategy==='best'?'on':''}`} onClick={()=>setStrategy('best')}>Höchste Schätzwerte</button></div><div className="gp-row" style={{marginTop:12}}><label className="gp-muted"><input type="checkbox" checked={scorersOnly} onChange={e=>setScorersOnly(e.target.checked)}/> Nur Torschützen</label></div></>}
          <div className="gp-line"/>
          <div className="gp-row gp-between"><b>Deine {manualMode?'manuelle':'automatische'} Kombi</b><span>{combo.length}/{count}</span></div>
          {!comboComplete && <p className="gp-muted">Für eine vollständige Kombi fehlen {count-combo.length} passende Märkte. Bis zu vier verschiedene Marktarten pro Spiel sind möglich. Spiele mit Marktprognosen: {uniqueGames}.</p>}
          {combo.length===0 && <p className="gp-muted">Noch keine berechneten Märkte vorhanden. Wähle einen anderen Spieltag oder prüfe die API-Hinweise.</p>}
          {combo.map((m,i)=><div className="gp-market" key={m.id}><div><b>{i+1}. {m.label}</b><small>{m.game} · {m.sport} · {catName(m)}</small><small>Datenqualität: {m.dataQuality} · {m.model}</small></div><div style={{textAlign:'right'}}><div className="gp-pct">{Math.round(m.probability*100)}%</div>{manualMode && <button className="gp-btn" onClick={()=>toggleMarket(m)}>−</button>}</div></div>)}
          {manualMode && <button className="gp-btn" onClick={()=>setManualIds([])} style={{marginTop:12}}>Auswahl löschen</button>}
          <p className="gp-muted">Bis zu vier unterschiedliche Marktarten pro Spiel. Tipps aus demselben Spiel sind voneinander abhängig. Alle Prozentwerte sind unkalibrierte Modellschätzungen; keine sichere Kombi-Chance.</p>
        </div>
        <h2 className="gp-section">📊 Alle Spiele & Märkte analysiert</h2>
        <div className="gp-card"><div className="gp-row">{categories.map(c=><button key={c} className={`gp-btn ${categoryFilter===c?'on':''}`} onClick={()=>setCategoryFilter(c)}>{c}</button>)}</div></div>
        {games.map(g=>{
          const gameMarkets=markets.filter(m=>String(m.fixtureId)===String(g.id)&&m.sport===g.sport&&(categoryFilter==='Alle'||catName(m)===categoryFilter)).sort((a,b)=>rank(b)-rank(a));
          return <div className="gp-card" key={`${g.sport}-${g.id}`}><div className="gp-row gp-between"><div><b>{g.home} – {g.away}</b><p className="gp-muted" style={{margin:'5px 0'}}>{g.league} · {g.sport} · {clock(g.time)} Uhr</p></div><span className="gp-muted">{gameMarkets.length} Märkte</span></div>{gameMarkets.length===0?<p className="gp-muted">Keine belastbaren Teamdaten / Marktprognosen verfügbar.</p>:gameMarkets.map(m=>{const selected=manualIds.includes(m.id);const blocked=!selected&&(manual.length>=count||!canAddMarket(m,manual));return <div className="gp-market" key={m.id}><div><b>{m.label}</b><small>{catName(m)} · {m.dataQuality} · {m.model}</small></div><div className="gp-row"><strong style={{color:'#65dcb5'}}>{Math.round(m.probability*100)}%</strong>{manualMode&&<button className={`gp-btn ${selected?'on':''}`} disabled={blocked} onClick={()=>toggleMarket(m)}>{selected?'✓':'+'}</button>}</div></div>;})}</div>;
        })}
        {games.length===0&&!loading&&<div className="gp-card">Keine Spiele am gewählten Datum gefunden.</div>}
      </>}

      {page==='Home' && <><h2 className="gp-section">🏆 Torschützen-Analyse</h2>{picks.length===0?<div className="gp-card">Keine Spielerprognosen verfügbar.</div>:picks.map((p,i)=><div className="gp-card" key={p.id}><div className="gp-row gp-between"><div><b>{i+1}. {p.name}</b><p className="gp-muted">{p.team} – {p.opponent} · {p.league} · {clock(p.time)} Uhr</p><p className="gp-muted">Saisontore: {p.goals??'–'} · Schüsse: {p.shots??'–'} · Form: {p.form??'–'} · {p.model}</p></div><div className="gp-pct">{Math.round(p.probability*100)}%</div></div></div>)}</>}
      {page==='Spiele'&&<><h2 className="gp-section">📅 Spiele</h2>{games.map(g=><div className="gp-card" key={`${g.sport}-${g.id}`}><b>{g.home} – {g.away}</b><p className="gp-muted">{g.league} · {g.sport} · {clock(g.time)} Uhr</p></div>)}</>}
      {page==='Infos'&&<div className="gp-card"><h2>Über GoalPulse 4.0</h2><p className="gp-muted">Fußball: API-SPORTS Topscorer und Ligatabellen. NHL: NHL-Spieler- und Teamstatistiken. DEL: Spielplan, noch keine Marktprognosen.</p><p className="gp-muted">Sieger, Über-Tore und Beide treffen werden aus erwarteten Teamtoren mit einem vereinfachten Poisson-Modell geschätzt. Die NHL-Siegwahrscheinlichkeit verteilt ein modelliertes Unentschieden näherungsweise auf beide Teams; tatsächliche Overtime-Stärken fehlen. Aufstellungen, Verletzungen, xG und Buchmacherquoten sind nicht berücksichtigt.</p><p className="gp-muted">Es werden keine Werte erfunden, wenn Statistikdaten fehlen. Die API benötigt für Fußball zusätzlich zu den bisherigen Torschützenabfragen Tabellenanfragen; dadurch können API-Limits früher erreicht werden.</p><p className="gp-muted">Alle Prognosen sind unkalibriert und können deutlich von tatsächlichen Eintrittshäufigkeiten abweichen.</p></div>}
      <nav className="gp-nav">{[['Home',House],['Raster',Layers],['Spiele',Calendar],['Infos',Info]].map(([name,Icon])=><button key={name} className={`gp-btn ${page===name?'on':''}`} onClick={()=>setPage(name)}><Icon size={18}/><span>{name}</span></button>)}</nav>
    </div>
  );
}
