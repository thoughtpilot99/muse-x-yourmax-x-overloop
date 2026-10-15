import { config, MissingKeysError } from "./config";

// Max (yourmax.ai) REST API, as used by Sortlist's official max-cli:
// https://api.yourmax.ai/api/v1, bearer API key. Leads are only read; monitors
// (subscriptions) can be created/paused from the Monitors page, always without
// Overloop auto-delivery so nothing is sent from Max directly.

export class MaxError extends Error {
  constructor(public status: number, message: string) {
    super(`Max ${status}: ${message}`);
  }
}

async function call<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const key = config.maxApiKey();
  if (!key) throw new MissingKeysError([{ key: "MAX_API_KEY", label: "Max API key" }]);
  const res = await fetch(`${config.maxApiUrl()}/api/v1${path}`, {
    method: init.method ?? "GET",
    headers: { Authorization: `Bearer ${key}`, Accept: "application/json", "Content-Type": "application/json" },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    signal: AbortSignal.timeout(30_000),
  });
  const text = await res.text();
  if (!res.ok) {
    let msg = text.slice(0, 300) || res.statusText;
    try {
      const j = JSON.parse(text);
      msg = j.error || (Array.isArray(j.errors) ? j.errors.join(", ") : msg);
    } catch {
      /* keep raw text */
    }
    throw new MaxError(res.status, msg);
  }
  return (text ? JSON.parse(text) : null) as T;
}

export type MaxSubscription = {
  id: number;
  name: string;
  signal: { name: string; slug: string };
  config: Record<string, unknown>;
  active: boolean;
  last_checked_at: string | null;
  created_at: string;
};

export async function listSubscriptions(businessId: string): Promise<MaxSubscription[]> {
  return (await call<{ subscriptions: MaxSubscription[] }>(`/businesses/${encodeURIComponent(businessId)}/subscriptions`)).subscriptions ?? [];
}

export async function createSubscription(businessId: string, data: { signal_slug: string; name: string; config: Record<string, unknown> }) {
  // integrations: [] — leads stay in Max until SignalPilot pulls them; no auto-delivery to Overloop.
  return (
    await call<{ subscription: MaxSubscription }>(`/businesses/${encodeURIComponent(businessId)}/subscriptions`, {
      method: "POST",
      body: { ...data, integrations: [] },
    })
  ).subscription;
}

export async function setSubscriptionActive(businessId: string, id: number, active: boolean) {
  await call(`/businesses/${encodeURIComponent(businessId)}/subscriptions/${id}/${active ? "resume" : "pause"}`, { method: "POST" });
}

export type MaxBusiness = { id: number; name: string; website: string; description: string };

export type MaxIcp = {
  target_job_titles?: string[];
  target_locations?: string[];
  target_industries?: string[];
  company_types?: string[];
  company_sizes?: string[];
  mandatory_keywords?: string[];
  excluded_companies?: string[];
};

export async function listBusinesses(): Promise<MaxBusiness[]> {
  return (await call<{ businesses: MaxBusiness[] }>("/businesses")).businesses;
}

export async function getBusiness(id: string) {
  return (await call<{ business: MaxBusiness & { ideal_customer_profile?: MaxIcp } }>(`/businesses/${encodeURIComponent(id)}`)).business;
}

export async function listLeads(businessId: string, page = 1, perPage = 25): Promise<Record<string, unknown>[]> {
  const res = await call<{ leads: Record<string, unknown>[] }>(
    `/businesses/${encodeURIComponent(businessId)}/leads?page=${page}&per_page=${perPage}`,
  );
  return res.leads ?? [];
}

/** Turn Max's structured ICP into the plain-text ICP SignalPilot's validator reads. */
export function icpToText(icp: MaxIcp | undefined): string {
  if (!icp) return "";
  const line = (label: string, v?: string[]) => (v?.length ? `${label}: ${v.join(", ")}` : "");
  return [
    line("Job titles", icp.target_job_titles),
    line("Locations", icp.target_locations),
    line("Industries", icp.target_industries),
    line("Company types", icp.company_types),
    line("Company sizes", icp.company_sizes),
    line("Keywords", icp.mandatory_keywords),
    line("Exclude", icp.excluded_companies),
  ].filter(Boolean).join("\n");
}
