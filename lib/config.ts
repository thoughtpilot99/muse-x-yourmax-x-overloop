import { getSecret, type SecretName } from "./secrets";

// Each value comes from .env.local first, then from what was entered on /setup.
const val = (name: SecretName) => process.env[name] || getSecret(name) || "";

export const config = {
  museApiKey: () => val("MODEL_API_KEY"),
  museBaseUrl: () => process.env.MUSE_BASE_URL || "https://api.meta.ai/v1",
  museModel: () => process.env.MUSE_MODEL || "muse-wonder-1.0",
  overloopApiKey: () => val("OVERLOOP_API_KEY"),
  overloopCampaignId: () => val("OVERLOOP_CAMPAIGN_ID"),
  maxApiKey: () => val("MAX_API_KEY"),
  maxApiUrl: () => (process.env.MAX_API_URL || "https://api.yourmax.ai").replace(/\/$/, ""),
  maxBusinessId: () => val("MAX_BUSINESS_ID"),
  maxWebhookSecret: () => val("MAX_WEBHOOK_SECRET"),
  jobsEnabled: () => process.env.SP_JOBS_ENABLED !== "0",
  // Sending is off unless switched on (on /setup or with SP_SENDING_ENABLED=1).
  // SP_SENDING_ENABLED=0 in the environment always forces it off.
  sendingEnabled: () => {
    const env = process.env.SP_SENDING_ENABLED;
    if (env === "0") return false;
    return env === "1" || getSecret("SP_SENDING_ENABLED") === "1";
  },
  sendingForcedOff: () => process.env.SP_SENDING_ENABLED === "0",
};

// Muse Wonder list price, USD per million tokens (dev.meta.ai, Oct 2026).
export const MUSE_PRICE = { input: 4, cachedInput: 0.2, output: 20 };

type Req = { key: string; label: string; get: () => string };

// Researching and writing only needs Muse Wonder.
const PROCESS: Req[] = [{ key: "MODEL_API_KEY", label: "Muse Wonder (Meta Model API)", get: config.museApiKey }];
// Sending also needs Overloop and an explicit opt-in.
const SEND: Req[] = [
  { key: "OVERLOOP_API_KEY", label: "Overloop API", get: config.overloopApiKey },
  { key: "OVERLOOP_CAMPAIGN_ID", label: "Overloop campaign ID", get: config.overloopCampaignId },
  { key: "SP_SENDING_ENABLED", label: "Live sending switch", get: () => (config.sendingEnabled() ? "1" : "") },
];

const missing = (reqs: Req[]) => reqs.filter((r) => !r.get()).map(({ key, label }) => ({ key, label }));

export function missingKeys() {
  return missing(PROCESS);
}

export function missingSendKeys() {
  return missing(SEND);
}

export class MissingKeysError extends Error {
  constructor(public missing: { key: string; label: string }[]) {
    super(`Missing configuration: ${missing.map((m) => m.key).join(", ")}`);
  }
}

export function assertConfigured() {
  const m = missingKeys();
  if (m.length) throw new MissingKeysError(m);
}

export function assertCanSend() {
  const m = [...missingKeys(), ...missingSendKeys()];
  if (m.length) throw new MissingKeysError(m);
}

export function assertOverloop() {
  if (!config.overloopApiKey()) throw new MissingKeysError([{ key: "OVERLOOP_API_KEY", label: "Overloop API" }]);
}
