import { config } from "./config";

// Overloop public API (apidoc.overloop.com): JSON:API, raw key in Authorization.
const BASE = "https://api.overloop.com/public/v1";
const MEDIA = "application/vnd.api+json; charset=utf-8";

export class OverloopError extends Error {
  constructor(public status: number, message: string) {
    super(`Overloop ${status}: ${message}`);
  }
}

type Resource<A = Record<string, unknown>> = { id: string; type: string; attributes: A };

async function call<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: init.method ?? "GET",
    headers: { Authorization: config.overloopApiKey(), "Content-Type": MEDIA, Accept: MEDIA },
    body: init.body ? JSON.stringify(init.body) : undefined,
    signal: AbortSignal.timeout(20_000),
  });
  const text = await res.text();
  let json: Record<string, unknown> = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    if (res.ok) throw new OverloopError(res.status, "response was not JSON");
  }
  if (!res.ok) {
    const errs = Array.isArray(json.errors)
      ? json.errors.map((e: { detail?: string; message?: string }) => e.detail ?? e.message).join("; ")
      : text.slice(0, 300);
    throw new OverloopError(res.status, errs || res.statusText);
  }
  return json as T;
}

export type Campaign = Resource<{ name: string; status: string; automation_type: string }>;

export async function listCampaigns(): Promise<Campaign[]> {
  const res = await call<{ data: Campaign[] }>("/automations?filter=automation_type:campaign&page[size]=100");
  return res.data;
}

export async function getCampaign(id: string): Promise<Campaign> {
  return (await call<{ data: Campaign }>(`/automations/${encodeURIComponent(id)}`)).data;
}

export type ProspectAttrs = {
  email: string;
  first_name?: string | null;
  last_name?: string | null;
  jobtitle?: string | null;
  linkedin_profile?: string | null;
  description?: string | null;
  lists?: string[];
  // Custom fields are keyed by their Overloop identifier, e.g. c_sp_subject.
  [customField: string]: string | string[] | null | undefined;
};

export type Prospect = Resource<{
  email: string;
  replied?: boolean;
  replied_at?: string | null;
  email_reply_count?: number;
}>;

export async function findProspectByEmail(email: string): Promise<Prospect | null> {
  // Overloop filter syntax is attr:value with commas between filters, so
  // emails containing commas cannot be expressed and are rejected upstream.
  const res = await call<{ data: Prospect[] }>(`/prospects?filter=email:${encodeURIComponent(email)}`);
  return res.data[0] ?? null;
}

export async function upsertProspect(attrs: ProspectAttrs): Promise<Prospect> {
  const existing = await findProspectByEmail(attrs.email);
  if (existing) {
    return (
      await call<{ data: Prospect }>(`/prospects/${existing.id}`, {
        method: "PATCH",
        body: { data: { id: existing.id, type: "prospects", attributes: attrs } },
      })
    ).data;
  }
  return (
    await call<{ data: Prospect }>("/prospects", {
      method: "POST",
      body: { data: { type: "prospects", attributes: attrs } },
    })
  ).data;
}

export async function enroll(campaignId: string, prospectId: string): Promise<{ id: string }> {
  return (
    await call<{ data: { id: string } }>(`/automations/${encodeURIComponent(campaignId)}/enrollments`, {
      method: "POST",
      body: { data: { type: "enrollments", attributes: { prospect_id: Number(prospectId) || prospectId, reenroll: false } } },
    })
  ).data;
}

export async function getProspect(id: string): Promise<Prospect> {
  return (await call<{ data: Prospect }>(`/prospects/${encodeURIComponent(id)}`)).data;
}
