
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const BASE = 'https://v1.hockey.api-sports.io';

export async function GET(request) {
  const key = process.env.APISPORTS_HOCKEY_KEY;

  if (!key) {
    return NextResponse.json(
      { error: 'Hockey-API-Key fehlt' },
      { status: 500 }
    );
  }

  const url = new URL(request.url);
  const game = url.searchParams.get('game');

  if (!game || !/^\d+$/.test(game)) {
    return NextResponse.json(
      {
        message: 'Bitte eine Spiel-ID angeben.',
        example: '/api/hockey-test?game=12345'
      },
      { status: 400 }
    );
  }

  try {
    const response = await fetch(
      `${BASE}/games/events?game=${game}`,
      {
        headers: {
          'x-apisports-key': key
        },
        cache: 'no-store',
        signal: AbortSignal.timeout(12000)
      }
    );

    const json = await response.json();

    if (!response.ok || (
      json.errors &&
      Object.keys(json.errors).length > 0
    )) {
      return NextResponse.json(
        {
          error: 'Hockey-API-Abfrage fehlgeschlagen',
          details: json.errors || response.status
        },
        { status: 502 }
      );
    }

    return NextResponse.json({
      gameId: Number(game),
      count: json.results ?? json.response?.length ?? 0,
      events: json.response || [],
      note: 'Echte Ereignisdaten aus API-SPORTS Hockey'
    });

  } catch (error) {
    return NextResponse.json(
      { error: error.message },
      { status: 500 }
    );
  }
}
