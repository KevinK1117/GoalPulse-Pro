

import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const F =
  process.env.FOOTBALL_API_BASE ||
  'https://v3.football.api-sports.io';

const H =
  process.env.HOCKEY_API_BASE ||
  'https://v1.hockey.api-sports.io';

const FOOTBALL = [
  39,40,78,79,140,61,135,307,203,2,3
];

const HOCKEY = ['NHL','DEL'];

const berlin = value =>
  new Intl.DateTimeFormat('en-CA',{
    timeZone:'Europe/Berlin',
    year:'numeric',
    month:'2-digit',
    day:'2-digit'
  }).format(new Date(value));

const shift = (date,n) => {
  const d=new Date(date+'T12:00:00Z');
  d.setUTCDate(d.getUTCDate()+n);
  return d.toISOString().slice(0,10);
};

const sameDay = (value,date) => {
  try {
    return berlin(value)===date;
  } catch {
    return false;
  }
};

async function get(base,key,path) {
  const r=await fetch(base+path,{
    headers:{
      'x-apisports-key':key
    },
    next:{
      revalidate:900
    },
    signal:AbortSignal.timeout(12000)
  });

  if(!r.ok) {
    throw Error(`HTTP ${r.status}`);
  }

  const j=await r.json();

  if(
    j.errors &&
    (
      Array.isArray(j.errors)
        ?j.errors.length
        :Object.keys(j.errors).length
    )
  ) {
    throw Error(JSON.stringify(j.errors));
  }

  return j.response||[];
}

function row(g,sport){
  const f=g.fixture||g;
  const t=g.teams||{};

  return {
    id:f.id??g.id,
    sport,
    league:g.league?.name||'',
    leagueId:g.league?.id,
    home:t.home?.name||'Heim',
    away:t.away?.name||'Gast',
    homeId:t.home?.id,
    awayId:t.away?.id,
    time:f.date||g.date,
    status:
      f.status?.short||
      g.status?.short||
      ''
  };
}

const future = g =>
  ![
    'FT','AET','PEN','CANC','PST',
    'ABD','AW','AOT','AP'
  ].includes(g.status);

const season = date =>
  Number(date.slice(0,4)) -
  (Number(date.slice(5,7))<7?1:0);

function makePick(item,g){
  const player=item.player||{};

  const s=(item.statistics||[]).find(
    x=>x.league?.id===g.leagueId
  )||item.statistics?.[0];

  if(
    !s ||
    ![g.homeId,g.awayId].includes(s.team?.id)
  ) {
    return null;
  }

  const appearances=Number(
    s.games?.appearences??
    s.games?.appearances
  );

  const goals=Number(s.goals?.total);
  const totalMinutes=Number(s.games?.minutes);

  if(
    !Number.isFinite(appearances)||
    appearances<5||
    !Number.isFinite(goals)||
    goals<0
  ) {
    return null;
  }

  const minutes=
    Number.isFinite(totalMinutes)&&totalMinutes>0
      ?Math.round(
        Math.min(90,totalMinutes/appearances)
      )
      :null;

  const lambda=
    ((goals+0.5)/(appearances+2))*
    (
      minutes===null
        ?0.85
        :Math.max(0.35,minutes/90)
    );

  return {
    id:`football-${g.id}-${player.id}`,
    playerId:player.id,
    name:player.name||'Spieler',
    photo:player.photo||null,
    team:s.team?.name||'',
    opponent:
      s.team?.id===g.homeId
        ?g.away
        :g.home,
    league:g.league,
    sport:'Fußball',
    fixtureId:g.id,
    time:g.time,
    probability:1-Math.exp(-lambda),
    shots:s.shots?.total??null,
    goals,
    appearances,
    minutes,
    form:null,
    formGames:[],
    model:'Poisson-Basismodell (nicht kalibriert)',
    lineupConfirmed:false
  };
}

async function football(date,key,errors){
  const raw=await get(
    F,key,
    `/fixtures?date=${date}`
  );

  const games=raw
    .filter(g=>FOOTBALL.includes(g.league?.id))
    .map(g=>row(g,'Fußball'))
    .filter(g=>sameDay(g.time,date)&&future(g));

  const byLeague=new Map();

  for(const g of games){
    if(!byLeague.has(g.leagueId)){
      byLeague.set(g.leagueId,[]);
    }

    byLeague.get(g.leagueId).push(g);
  }

  const groups=[...byLeague.entries()];

  const results=await Promise.allSettled(
    groups.map(async ([id,fixtures])=>{
      const scorers=await get(
        F,key,
        `/players/topscorers?league=${id}&season=${season(date)}`
      );

      return fixtures.flatMap(g=>
        scorers
          .map(s=>makePick(s,g))
          .filter(Boolean)
      );
    })
  );

  const picks=[];

  results.forEach((r,i)=>{
    if(r.status==='fulfilled'){
      picks.push(...r.value);
    }else{
      errors.push(
        `Spielerstatistik Liga ${groups[i][0]}: `+
        r.reason.message
      );
    }
  });

  // Formdaten:
  // Maximal 30 Spieler aus maximal 12 Vereinen.
  // Die letzten fünf abgeschlossenen Spiele
  // werden je Verein abgefragt.

  const selected=picks
    .sort((a,b)=>b.probability-a.probability)
    .slice(0,30);

  const clubMap=new Map();

  for(const p of selected){
    const game=games.find(
      g=>g.id===p.fixtureId
    );

    const teamId=
      game?.home===p.team
        ?game.homeId
        :game?.away===p.team
          ?game.awayId
          :null;

    if(
      teamId &&
      !clubMap.has(teamId)
    ){
      clubMap.set(teamId,[]);
    }

    if(teamId){
      clubMap.get(teamId).push(p);
    }
  }

  const clubs=[...clubMap.entries()]
    .slice(0,12);

  await Promise.allSettled(
    clubs.map(async ([teamId,players])=>{
      try{
        const fixtures=await get(
          F,key,
          `/fixtures?team=${teamId}&last=5`
        );

        const completed=fixtures
          .filter(f=>
            ['FT','AET','PEN'].includes(
              f.fixture?.status?.short
            ) &&
            new Date(f.fixture?.date) <
              new Date(date+'T00:00:00Z')
          )
          .sort(
            (a,b)=>
              new Date(b.fixture.date)-
              new Date(a.fixture.date)
          )
          .slice(0,5);

        const perGame=await Promise.allSettled(
          completed.map(f=>
            get(
              F,key,
              `/fixtures/players?fixture=${f.fixture.id}`
            )
          )
        );

        for(const p of players){
          const form=[];

          perGame.forEach((r,i)=>{
            if(r.status!=='fulfilled'){
              return;
            }

            const teams=r.value||[];

            const entry=teams
              .flatMap(t=>t.players||[])
              .find(x=>
                x.player?.id===p.playerId
              );

            const goals=
              entry?.statistics?.[0]
                ?.goals?.total;

            if(
              goals!==null &&
              goals!==undefined &&
              Number.isFinite(Number(goals))
            ){
              form.push({
                date:completed[i].fixture.date,
                goals:Number(goals)
              });
            }
          });

          p.formGames=form;

          p.form=form.length
            ?form.reduce(
              (sum,x)=>sum+x.goals,
              0
            )
            :null;
        }
      }catch(e){
        errors.push(
          `Formdaten Team ${teamId}: `+
          e.message
        );
      }
    })
  );

  return {games,picks};
}

async function hockey(date,key,errors){
  const leagues=await get(
    H,key,
    '/leagues'
  );

  const found=leagues.filter(l=>
    HOCKEY.includes(
      (l.name||'')
        .trim()
        .toUpperCase()
    )
  );

  if(!found.length){
    errors.push(
      'NHL/DEL-Liga nicht gefunden'
    );
  }

  const res=await Promise.allSettled(
    found.map(l=>
      get(
        H,key,
        `/games?date=${date}`+
        `&league=${l.id}`+
        `&season=${season(date)}`
      )
    )
  );

  const games=[];

  res.forEach((r,i)=>{
    if(r.status==='fulfilled'){
      games.push(
        ...r.value
          .map(g=>row(g,'Eishockey'))
          .filter(g=>
            sameDay(g.time,date)&&future(g)
          )
      );
    }else{
      errors.push(
        `${found[i].name}: `+
        r.reason.message
      );
    }
  });

  return {
    games,
    picks:[]
  };
}

export async function GET(req){
  const today=berlin(new Date());

  const date=
    new URL(req.url)
      .searchParams.get('date')||
    today;

  if(
    !/^\d{4}-\d{2}-\d{2}$/.test(date)||
    Number.isNaN(Date.parse(date))||
    date<today||
    date>shift(today,7)
  ){
    return NextResponse.json(
      {
        error:
          'Datum außerhalb der nächsten sieben Tage'
      },
      {
        status:400
      }
    );
  }

  const errors=[];
  const games=[];
  const picks=[];
  const tasks=[];

  const fk=
    process.env.APISPORTS_FOOTBALL_KEY;

  const hk=
    process.env.APISPORTS_HOCKEY_KEY;

  if(fk){
    tasks.push(
      football(date,fk,errors)
        .then(r=>{
          games.push(...r.games);
          picks.push(...r.picks);
        })
        .catch(e=>
          errors.push(
            'Fußball: '+e.message
          )
        )
    );
  }else{
    errors.push(
      'Football-API-Key fehlt'
    );
  }

  if(hk){
    tasks.push(
      hockey(date,hk,errors)
        .then(r=>{
          games.push(...r.games);
          picks.push(...r.picks);
        })
        .catch(e=>
          errors.push(
            'Hockey: '+e.message
          )
        )
    );
  }else{
    errors.push(
      'Hockey-API-Key fehlt'
    );
  }

  await Promise.all(tasks);

  games.sort(
    (a,b)=>
      new Date(a.time)-
      new Date(b.time)
  );

  picks.sort(
    (a,b)=>
      b.probability-
      a.probability
  );

  return NextResponse.json(
    {
      date,
      games,
      picks,
      errors,
      notice:
        'Fußball: unkalibrierte Modellschätzungen; '+
        'Form nur bei verfügbaren Spielerdaten. '+
        'Hockey: noch keine verifizierte '+
        'individuelle Spieler-Datenquelle.',
      updatedAt:
        new Date().toISOString()
    },
    {
      headers:{
        'Cache-Control':'no-store'
      }
    }
  );
}
