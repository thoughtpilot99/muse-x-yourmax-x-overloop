import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/muse", async (orig) => ({ ...(await orig<typeof import("@/lib/muse")>()), runStructured: vi.fn() }));

import { runStructured } from "@/lib/muse";
import { bannedPhraseHits, reasonsAreGrounded, signalAgeDays, validateLead, type EmailDraft } from "@/lib/agents";
import { DEFAULT_SETTINGS } from "@/lib/settings";
import type { Lead } from "@/lib/db";

const lead = (over: Partial<Lead> = {}) =>
  ({ id: 1, first_name: "Ana", title: "VP Sales", company: "Acme", domain: "acme.com", signal_type: "job_posting",
     signal_detail: "Hiring SDRs", signal_at: new Date().toISOString(), ...over }) as Lead;

beforeEach(() => vi.mocked(runStructured).mockReset());

describe("signalAgeDays", () => {
  it("computes whole days and handles unknown dates", () => {
    const now = new Date("2026-10-15T12:00:00Z");
    expect(signalAgeDays("2026-10-05T12:00:00Z", now)).toBe(10);
    expect(signalAgeDays(null, now)).toBeNull();
    expect(signalAgeDays("not a date", now)).toBeNull();
  });
});

describe("validateLead", () => {
  it("rejects stale signals without calling the model", async () => {
    const v = await validateLead(lead({ signal_at: "2020-01-01" }), DEFAULT_SETTINGS);
    expect(v.decision).toBe("rejected");
    expect(v.reasons[0]).toMatch(/days old/);
    expect(runStructured).not.toHaveBeenCalled();
  });

  it("enforces the minimum fit score even if the model qualifies", async () => {
    vi.mocked(runStructured).mockResolvedValue({ icp_fit: 40, signal_strength: 90, urgency: 80, decision: "qualified", reasons: ["Acme is hiring"] });
    const v = await validateLead(lead(), { ...DEFAULT_SETTINGS, minFitScore: 60 });
    expect(v.decision).toBe("rejected");
    expect(v.reasons.at(-1)).toMatch(/below the minimum/);
  });

  it("passes a qualified lead through", async () => {
    vi.mocked(runStructured).mockResolvedValue({ icp_fit: 85, signal_strength: 70, urgency: 60, decision: "qualified", reasons: ["VP Sales at Acme is hiring SDRs"] });
    expect((await validateLead(lead(), DEFAULT_SETTINGS)).decision).toBe("qualified");
    expect(runStructured).toHaveBeenCalledTimes(1);
  });

  it("retries once when reasons don't mention the lead, then holds it back", async () => {
    vi.mocked(runStructured)
      .mockResolvedValueOnce({ icp_fit: 90, signal_strength: 90, urgency: 90, decision: "qualified", reasons: ["install budget exists"] })
      .mockResolvedValueOnce({ icp_fit: 90, signal_strength: 90, urgency: 90, decision: "qualified", reasons: ["conversion problem exists"] });
    const v = await validateLead(lead(), DEFAULT_SETTINGS);
    expect(runStructured).toHaveBeenCalledTimes(2);
    expect(v.decision).toBe("rejected");
    expect(v.reasons.at(-1)).toMatch(/manual review/);
  });

  it("does not accept reasons about a different person that merely say 'unknown'", () => {
    const l = lead({ title: "Founder", company: "Northwind", location: "Finland", raw: "{}" });
    expect(reasonsAreGrounded(['Role given as "Marketing Coordinator" at Contoso, Inc.', "industry unknown"], l)).toBe(false);
    expect(reasonsAreGrounded(["Founder at Northwind, no stated need"], l)).toBe(true);
    expect(reasonsAreGrounded(["Finnish company Northwind Oy"], lead({ company: "Northwind Oy", raw: "{}" }))).toBe(true);
  });

  it("accepts a grounded retry", async () => {
    vi.mocked(runStructured)
      .mockResolvedValueOnce({ icp_fit: 90, signal_strength: 80, urgency: 70, decision: "qualified", reasons: ["install budget exists"] })
      .mockResolvedValueOnce({ icp_fit: 90, signal_strength: 80, urgency: 70, decision: "qualified", reasons: ["Acme posted a job_posting for SDRs"] });
    expect((await validateLead(lead(), DEFAULT_SETTINGS)).decision).toBe("qualified");
  });
});

describe("bannedPhraseHits", () => {
  const draft = (body: string): EmailDraft => ({ subject: "Hiring SDRs", body, followup_1: "New angle", followup_2: "Case study", evidence_used: [] });

  it("flags generic lines buyers ignore", () => {
    expect(bannedPhraseHits(draft("I noticed your company just raised a Series B."))).toHaveLength(1);
    expect(bannedPhraseHits(draft("Hope this email finds you well. Just checking in."))).toHaveLength(2);
  });

  it("flags copy that reveals how the lead was found", () => {
    expect(bannedPhraseHits(draft("Your Head of Marketing role at Acme was flagged as a match."))).toHaveLength(1);
    expect(bannedPhraseHits(draft("You fit our ICP perfectly."))).toHaveLength(1);
  });

  it("passes specific copy", () => {
    expect(bannedPhraseHits(draft("Saw the three SDR roles on your careers page — ramping that many reps at once is where onboarding breaks."))).toEqual([]);
  });
});
