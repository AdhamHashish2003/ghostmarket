import { TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID } from "../constants.js";

export async function sendTelegramMessage(text: string): Promise<{ ok: boolean; message_id?: number }> {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
    throw new Error("TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID not configured in environment");
  }
  const resp = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text }),
  });
  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`Telegram API error ${resp.status}: ${body}`);
  }
  const data = await resp.json() as { ok: boolean; result?: { message_id: number } };
  return { ok: data.ok, message_id: data.result?.message_id };
}

export async function sendProductCard(
  productId: string,
  keyword: string,
  score: number,
  margin: string,
  supplier: string,
): Promise<{ ok: boolean; message_id?: number }> {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
    throw new Error("TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID not configured in environment");
  }
  const text = `🎯 PRODUCT #${productId.slice(0, 6)} — Score: ${score}/100\n━━━━━━━━━━━━━━━━━━━━━━\n${keyword}\n💰 Margin: ${margin}\n🏭 ${supplier}\n━━━━━━━━━━━━━━━━━━━━━━`;
  const keyboard = {
    inline_keyboard: [
      [
        { text: "✅ Approve", callback_data: `approve:${productId}` },
        { text: "⏭️ Skip", callback_data: `skip:${productId}` },
      ],
      [
        { text: "🔍 Details", callback_data: `details:${productId}` },
        { text: "🔄 Rescore", callback_data: `rescore:${productId}` },
      ],
    ],
  };
  const resp = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text, reply_markup: keyboard }),
  });
  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`Telegram API error ${resp.status}: ${body}`);
  }
  const data = await resp.json() as { ok: boolean; result?: { message_id: number } };
  return { ok: data.ok, message_id: data.result?.message_id };
}
