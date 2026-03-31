import { ROG_WORKER_URL, ROG_ENABLED } from "../constants.js";

export async function sendToROG(endpoint: string, data: Record<string, unknown>): Promise<unknown> {
  if (!ROG_ENABLED) {
    throw new Error("ROG worker is disabled (ROG_ENABLED=false). Enable it in .env to use GPU-accelerated features.");
  }
  try {
    const resp = await fetch(`${ROG_WORKER_URL}${endpoint}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
      signal: AbortSignal.timeout(30000),
    });
    if (!resp.ok) throw new Error(`ROG worker returned ${resp.status}`);
    return await resp.json();
  } catch (error: unknown) {
    const err = error as Error;
    if (err.name === "TimeoutError") {
      throw new Error("ROG worker timed out — is the ASUS ROG machine running? Check ROG_WORKER_URL in .env");
    }
    throw new Error(`ROG worker unreachable at ${ROG_WORKER_URL} — ${err.message}`);
  }
}
