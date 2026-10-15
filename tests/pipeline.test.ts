import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/agents", async (orig) => ({
  ...(await orig<typeof import("@/lib/agents")>()),
  validateLead: vi.fn(),
  researchLead: vi.fn(),
  writeEmail: vi.fn(),
}));
vi.mock("@/lib/research", async (orig) => ({ ...(await orig<typeof import("@/lib/research")>()), fetchCompanySite: vi.fn() }));
vi.mock("@/lib/overloop", () => ({ upsertProspect: vi.fn(), enroll: vi.fn(), getProspect: vi.fn() }));

import { researchLead, validateLead, writeEmail } from "@/lib/agents";
import { fetchCompanySite } from "@/lib/research";
import { enroll, getProspect, upsertProspect } from "@/lib/overloop";
import { db, getLead, run } from "@/lib/db";
import { saveSettings, DEFAULT_SETTINGS } from "@/lib/settings";
import { ingestLeads, pollReplies, processLead, retry, sendApproved } from "@/lib/pipeline";
import { normalizeLead } from "@/lib/max";

const brief = { company_summary: "Acme sells X", why_now: "Hiring 3 SDRs", evidence: [], angles: [], risks: [] };
const draft = { subject: "SDR ramp", body: "Specific body", followup_1: "f1", followup_2: "f2", evidence_used: ["Hiring"] };

function addLead(over: Record<string, unknown> = {}) {
  const l = normalizeLead({ id: crypto.randomUUID(), first_name: "Ana", email: "ana@acme.com", company: "Acme", domain: "acme.com", signal_type: "job_posting", ...over });
  ingestLeads([l]);
  return db().prepare("SELECT id FROM leads WHERE external_id = ?").get(l.external_id) as { id: number };
}

beforeEach(() => {
  vi.clearAllMocks();
  db().exec("DELETE FROM leads; DELETE FROM settings; DELETE FROM accounts; DELETE FROM events;");
  saveSettings(DEFAULT_SETTINGS);
  vi.mocked(fetchCompanySite).mockResolvedValue([]);
  vi.mocked(researchLead).mockResolvedValue(brief);
  vi.mocked(writeEmail).mockResolvedValue(draft);
});

describe("ingest", () => {
  it("dedupes on external id", () => {
    const l = normalizeLead({ id: "same", first_name: "A" });
    expect(ingestLeads([l, l])).toEqual({ inserted: 1, duplicates: 1 });
  });
});

describe("processLead", () => {
  it("stops at rejection and never researches", async () => {
    vi.mocked(validateLead).mockResolvedValue({ icp_fit: 10, signal_strength: 10, urgency: 0, decision: "rejected", reasons: ["no fit"] });
    const { id } = addLead();
    expect((await processLead(id))?.status).toBe("rejected");
    expect(researchLead).not.toHaveBeenCalled();
  });

  it("produces a draft for a qualified lead with email", async () => {
    vi.mocked(validateLead).mockResolvedValue({ icp_fit: 80, signal_strength: 80, urgency: 70, decision: "qualified", reasons: ["fit"] });
    const { id } = addLead();
    const lead = await processLead(id);
    expect(lead?.status).toBe("draft");
    expect(JSON.parse(lead!.draft!)).toEqual(draft);
  });

  it("parks qualified leads without email in needs_email", async () => {
    vi.mocked(validateLead).mockResolvedValue({ icp_fit: 80, signal_strength: 80, urgency: 70, decision: "qualified", reasons: [] });
    const { id } = addLead({ email: undefined });
    expect((await processLead(id))?.status).toBe("needs_email");
  });

  it("rewrites once when the draft contains banned phrases", async () => {
    vi.mocked(validateLead).mockResolvedValue({ icp_fit: 80, signal_strength: 80, urgency: 70, decision: "qualified", reasons: [] });
    vi.mocked(writeEmail).mockResolvedValueOnce({ ...draft, body: "Hope this email finds you well" }).mockResolvedValueOnce(draft);
    const { id } = addLead();
    await processLead(id);
    expect(writeEmail).toHaveBeenCalledTimes(2);
    expect(vi.mocked(writeEmail).mock.calls[1][3]).toEqual(["Hope this email finds you well"]);
  });

  it("auto-approves only when enabled and above threshold", async () => {
    saveSettings({ autoApprove: true, autoApproveThreshold: 75 });
    vi.mocked(validateLead).mockResolvedValue({ icp_fit: 90, signal_strength: 80, urgency: 70, decision: "qualified", reasons: [] });
    const { id } = addLead();
    expect((await processLead(id))?.status).toBe("approved");
  });

  it("marks the lead failed when the model errors", async () => {
    vi.mocked(validateLead).mockRejectedValue(new Error("Muse down"));
    const { id } = addLead();
    const lead = await processLead(id);
    expect(lead?.status).toBe("failed");
    expect(lead?.error).toBe("Muse down");
  });
});

describe("sendApproved", () => {
  function approved(urgency: number, email: string) {
    const { id } = addLead({ email });
    run("UPDATE leads SET status = 'approved', urgency_score = ?, draft = ? WHERE id = ?", urgency, JSON.stringify(draft), id);
    return id;
  }

  it("respects the daily cap and sends the most urgent first", async () => {
    saveSettings({ dailySendCap: 2 });
    vi.mocked(upsertProspect).mockImplementation(async (a) => ({ id: `p-${a.email}`, type: "prospects", attributes: { email: a.email } }));
    vi.mocked(enroll).mockResolvedValue({ id: "e1" });
    const low = approved(10, "low@x.com");
    const high = approved(90, "high@x.com");
    const mid = approved(50, "mid@x.com");

    const r = await sendApproved();
    expect(r).toEqual({ sent: 2, failed: 0, capped: 1 });
    expect(getLead(high)?.status).toBe("sent");
    expect(getLead(mid)?.status).toBe("sent");
    expect(getLead(low)?.status).toBe("approved");
    expect(vi.mocked(upsertProspect).mock.calls[0][0]).toMatchObject({ email: "high@x.com", c_sp_subject: "SDR ramp", c_sp_body: "Specific body" });
    expect(enroll).toHaveBeenCalledWith("42", "p-high@x.com");

    expect((await sendApproved()).sent).toBe(0); // cap reached for today
  });

  it("refuses to touch Overloop when sending is switched off", async () => {
    vi.stubEnv("SP_SENDING_ENABLED", "0");
    const id = approved(50, "a@x.com");
    await expect(sendApproved()).rejects.toThrow(/SP_SENDING_ENABLED/);
    expect(upsertProspect).not.toHaveBeenCalled();
    expect(enroll).not.toHaveBeenCalled();
    expect(getLead(id)?.status).toBe("approved");
    vi.unstubAllEnvs();
  });

  it("keeps the lead approved and records the error when Overloop fails", async () => {
    vi.mocked(upsertProspect).mockRejectedValue(new Error("Overloop 422: bad field"));
    const id = approved(50, "a@x.com");
    expect((await sendApproved()).failed).toBe(1);
    expect(getLead(id)).toMatchObject({ status: "approved", error: "Overloop 422: bad field" });
  });
});

describe("pollReplies and retry", () => {
  it("marks replied prospects", async () => {
    const { id } = addLead();
    run("UPDATE leads SET status = 'sent', overloop_prospect_id = 'p1', sent_at = datetime('now') WHERE id = ?", id);
    vi.mocked(getProspect).mockResolvedValue({ id: "p1", type: "prospects", attributes: { email: "ana@acme.com", replied: true, replied_at: "2026-10-15" } });
    expect(await pollReplies()).toBe(1);
    expect(getLead(id)?.status).toBe("replied");
  });

  it("refuses to reprocess a sent lead", () => {
    const { id } = addLead();
    run("UPDATE leads SET status = 'sent' WHERE id = ?", id);
    expect(() => retry(id)).toThrow(/cannot be reprocessed/);
  });
});
