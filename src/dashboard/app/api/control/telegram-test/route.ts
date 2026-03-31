import { NextResponse } from 'next/server';

export async function POST() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (!token || !chatId) {
    return NextResponse.json({ success: false, error: 'TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID not set' }, { status: 400 });
  }

  try {
    const resp = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: `🧪 Dashboard test message\n${new Date().toISOString()}`,
      }),
      signal: AbortSignal.timeout(10000),
    });

    const data = await resp.json();
    return NextResponse.json({ success: resp.ok, data });
  } catch (e) {
    return NextResponse.json({ success: false, error: String(e) }, { status: 500 });
  }
}
