import { config } from "@/lib/config";
import { logEvent } from "@/lib/db";
import { normalizeLead, splitPayload, verifySignature } from "@/lib/max";
import { ingestLeads } from "@/lib/pipeline";

const MAX_BODY = 1_000_000;

function headerSnapshot(req: Request) {
  const out: Record<string, string> = {};
  req.headers.forEach((v, k) => {
    if (k !== "authorization" && k !== "cookie") out[k] = v;
  });
  return out;
}

export async function POST(req: Request) {
  const secret = config.maxWebhookSecret();
  if (!secret) {
    return Response.json({ error: "Set MAX_WEBHOOK_SECRET before receiving Max webhooks" }, { status: 503 });
  }
  const raw = await req.text();
  if (raw.length > MAX_BODY) return Response.json({ error: "Payload too large" }, { status: 413 });

  const headers = headerSnapshot(req);
  if (!verifySignature(raw, req.headers, secret)) {
    // Header names are recorded so the expected signature header can be confirmed.
    logEvent({ source: "max", kind: "webhook_rejected", ok: false, note: "bad or missing signature", headers });
    return Response.json({ error: "Invalid signature" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    logEvent({ source: "max", kind: "webhook_invalid_json", ok: false, headers, payload: raw.slice(0, 20_000) });
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const leads = splitPayload(body).map(normalizeLead);
  const result = ingestLeads(leads);
  logEvent({
    source: "max", kind: "webhook", ok: true, headers, payload: raw.slice(0, 50_000),
    note: `${result.inserted} new, ${result.duplicates} duplicate`,
  });
  return Response.json(result);
}
