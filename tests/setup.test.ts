import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { clearSecret, getSecret, mask, secretSource, setSecret } from "@/lib/secrets";
import { config, missingSendKeys } from "@/lib/config";
import { PRESETS, presetConfig } from "@/lib/monitors";
import { createSubscription, setSubscriptionActive } from "@/lib/maxApi";

beforeEach(() => db().exec("DELETE FROM secrets"));
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("secrets", () => {
  it("stores, masks and clears keys", () => {
    setSecret("MAX_API_KEY", "  abcdef123456  ");
    expect(getSecret("MAX_API_KEY")).toBe("abcdef123456");
    expect(mask("abcdef123456")).toBe("••••3456");
    expect(mask("short")).toBe("••••");
    setSecret("MAX_API_KEY", "");
    expect(getSecret("MAX_API_KEY")).toBe("");
  });

  it("prefers .env.local over keys saved in the app", () => {
    vi.stubEnv("MAX_API_KEY", "");
    setSecret("MAX_API_KEY", "from-app");
    expect(config.maxApiKey()).toBe("from-app");
    expect(secretSource("MAX_API_KEY")).toBe("app");
    vi.stubEnv("MAX_API_KEY", "from-env");
    expect(config.maxApiKey()).toBe("from-env");
    expect(secretSource("MAX_API_KEY")).toBe("env");
    clearSecret("MAX_API_KEY");
  });
});

describe("live sending switch", () => {
  it("is off by default and turns on from the app", () => {
    vi.stubEnv("SP_SENDING_ENABLED", "");
    expect(config.sendingEnabled()).toBe(false);
    expect(missingSendKeys().map((m) => m.key)).toContain("SP_SENDING_ENABLED");
    setSecret("SP_SENDING_ENABLED", "1");
    expect(config.sendingEnabled()).toBe(true);
  });

  it("can be forced off from the environment", () => {
    setSecret("SP_SENDING_ENABLED", "1");
    vi.stubEnv("SP_SENDING_ENABLED", "0");
    expect(config.sendingEnabled()).toBe(false);
    expect(config.sendingForcedOff()).toBe(true);
  });
});

describe("monitor presets", () => {
  const social = PRESETS.find((p) => p.id === "buyer-posts")!;
  const competitor = PRESETS.find((p) => p.id === "competitor-audience")!;

  it("uses the edited list and keeps other defaults", () => {
    const cfg = presetConfig(social, "need a payroll tool\n\n  recommend payroll software  \n");
    expect(cfg).toMatchObject({ keywords: ["need a payroll tool", "recommend payroll software"], posted_limit: "P1W", engagement_types: ["poster"] });
  });

  it("rejects empty lists and non-LinkedIn company URLs", () => {
    expect(() => presetConfig(social, "  \n ")).toThrow(/at least one/);
    expect(() => presetConfig(competitor, "https://example.com/company/x")).toThrow(/linkedin\.com\/company/);
  });

  it("creates monitors without Overloop auto-delivery", async () => {
    vi.stubEnv("MAX_API_KEY", "k");
    const fetchMock = vi.fn().mockImplementation(async () => new Response(JSON.stringify({ subscription: { id: 1, name: "x" } }), { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);
    await createSubscription("123", { signal_slug: "job-changes", name: "x", config: {} });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.yourmax.ai/api/v1/businesses/123/subscriptions");
    expect(init.headers.Authorization).toBe("Bearer k");
    expect(JSON.parse(init.body)).toEqual({ signal_slug: "job-changes", name: "x", config: {}, integrations: [] });

    await setSubscriptionActive("123", 9, false);
    expect(fetchMock.mock.calls[1][0]).toBe("https://api.yourmax.ai/api/v1/businesses/123/subscriptions/9/pause");
  });
});
