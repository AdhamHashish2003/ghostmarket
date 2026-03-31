import { NextResponse } from 'next/server';

const ORCHESTRATOR_URL = process.env.ORCHESTRATOR_URL || 'http://localhost:4000';

export async function POST(request: Request) {
  try {
    const { agent } = await request.json() as { agent: string };

    const endpointMap: Record<string, string> = {
      scout: '/trigger/scout',
      scorer: '/trigger/scorer',
      builder: '/trigger/score', // triggers scoring which feeds builder
      learner: '/trigger/learn',
    };

    const endpoint = endpointMap[agent];
    if (!endpoint) {
      return NextResponse.json({ error: `Unknown agent: ${agent}` }, { status: 400 });
    }

    const resp = await fetch(`${ORCHESTRATOR_URL}${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(120000),
    });

    const data = await resp.json();
    return NextResponse.json({ success: resp.ok, agent, data });
  } catch (e) {
    return NextResponse.json({ success: false, error: String(e) }, { status: 500 });
  }
}
