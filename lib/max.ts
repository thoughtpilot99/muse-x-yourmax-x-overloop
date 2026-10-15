import crypto from "node:crypto";
import { normalizeDomain } from "./research";

// Max (yourmax.ai, by Sortlist) does not publish its webhook payload schema.
// The normalizer below accepts the common shapes (flat lead, {lead, signal},
// {person, company}, arrays, {leads: [...]}) and keeps the raw payload on every
// lead so field mapping can be tightened once a real delivery has been captured.

export type NormalizedLead = {
  external_id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  title: string | null;
  company: string | null;
  domain: string | null;
  linkedin_url: string | null;
  location: string | null;
  signal_type: string | null;
  signal_detail: string | null;
  signal_at: string | null;
  raw: string;
};

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === "object" && !Array.isArray(v);

function pick(sources: (Obj | undefined)[], keys: string[]): string | null {
  for (const src of sources) {
    if (!src) continue;
    for (const k of keys) {
      const v = src[k];
      if (typeof v === "string" && v.trim()) return v.trim();
      if (typeof v === "number") return String(v);
    }
  }
  return null;
}

/** Split a webhook body into individual lead objects. */
export function splitPayload(body: unknown): Obj[] {
  if (Array.isArray(body)) return body.filter(isObj);
  if (!isObj(body)) return [];
  for (const k of ["leads", "data", "items", "results"]) {
    const v = body[k];
    if (Array.isArray(v)) return v.filter(isObj);
    if (isObj(v) && k === "data") return splitPayload(v);
  }
  return [body];
}

export function normalizeLead(item: Obj): NormalizedLead {
  const person = [item.lead, item.person, item.contact, item.profile].find(isObj);
  const companyObj = [item.company, item.organization, person?.company].find(isObj);
  const signalObj = [item.signal, item.trigger, item.event].find(isObj);
  const signals = Array.isArray(item.signals) ? item.signals.filter(isObj) : [];
  const signal = signalObj ?? signals[0];
  const p = [person, item];

  let first = pick(p, ["first_name", "firstName", "firstname"]);
  let last = pick(p, ["last_name", "lastName", "lastname"]);
  const full = pick(p, ["full_name", "fullName", "name"]);
  if (!first && full) [first, last] = [full.split(" ")[0], full.split(" ").slice(1).join(" ") || null];

  const companyName =
    pick([companyObj], ["name", "company_name"]) ?? pick(p, ["company", "company_name", "companyName", "organization"]);
  const domain = normalizeDomain(
    pick([companyObj], ["domain", "website", "website_url", "url"]) ??
      pick(p, ["company_domain", "companyDomain", "domain", "website", "company_website"]),
  );
  const email = pick(p, ["email", "work_email", "workEmail", "email_address"]);
  const linkedin = pick(p, ["linkedin_url", "linkedinUrl", "linkedin", "linkedin_profile", "profile_url"]);

  const signalType =
    pick([signal], ["type", "name", "signal_type", "category", "key"]) ?? pick([item], ["signal_type", "signalType"]);
  // Max's API puts the human-readable reason in engagement_context / signal_excerpt
  // (inside `payload`) and the detection time in triggered_at.
  const payload = isObj(item.payload) ? item.payload : undefined;
  const signalDetail =
    pick([signal], ["description", "detail", "details", "summary", "reason", "text", "title"]) ??
    pick([item, payload], ["signal_excerpt", "engagement_context", "signal_detail", "reason", "match_reason", "why"]);
  const signalAt =
    pick([signal], ["detected_at", "occurred_at", "date", "created_at", "timestamp"]) ??
    pick([item], ["triggered_at", "detected_at", "created_at", "date"]);

  const raw = JSON.stringify(item);
  const id =
    pick([item], ["id", "lead_id", "leadId", "uuid"]) ??
    crypto.createHash("sha256").update([linkedin, email, signalType, signalAt, raw.length].join("|")).digest("hex").slice(0, 24);

  return {
    external_id: `max:${id}`,
    first_name: first,
    last_name: last,
    email: email?.toLowerCase() ?? null,
    title: pick(p, ["title", "job_title", "jobTitle", "position", "headline"]),
    company: companyName,
    domain,
    linkedin_url: linkedin,
    location: pick(p, ["location", "country", "city", "region"]),
    signal_type: signalType,
    signal_detail: signalDetail,
    signal_at: signalAt,
    raw,
  };
}

/** Company description Max already enriched, used as research input when the website can't be fetched. */
export function companyContext(raw: string): string {
  try {
    const item = JSON.parse(raw) as Obj;
    const payload = isObj(item.payload) ? item.payload : undefined;
    return [
      pick([item, payload], ["company_summary"]),
      pick([item, payload], ["company_description"]),
      pick([item, payload], ["headline"]),
      pick([item, payload], ["post_url"]) ? `Signal post: ${pick([item, payload], ["post_url"])}` : null,
    ].filter(Boolean).join("\n");
  } catch {
    return "";
  }
}

const SIGNATURE_HEADERS = ["x-max-signature", "x-signature", "x-webhook-signature", "x-hub-signature-256", "x-signature-256"];

/** HMAC-SHA256 of the raw body, hex, optionally prefixed with "sha256=". */
export function verifySignature(rawBody: string, headers: Headers, secret: string): boolean {
  const expected = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
  for (const h of SIGNATURE_HEADERS) {
    const got = headers.get(h)?.trim().replace(/^sha256=/i, "");
    if (!got || got.length !== expected.length) continue;
    if (crypto.timingSafeEqual(Buffer.from(got), Buffer.from(expected))) return true;
  }
  return false;
}
