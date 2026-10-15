import { all, claimLead, get, getLead, logEvent, run, updateLead, type Lead } from "./db";
import { getSettings } from "./settings";
import { assertCanSend, assertConfigured, assertOverloop, config, MissingKeysError } from "./config";
import { fetchCompanySite, type PageText } from "./research";
import { bannedPhraseHits, researchLead, triageReply, validateLead, writeEmail, type EmailDraft } from "./agents";
import { enroll, getProspect, upsertProspect } from "./overloop";
import { companyContext, normalizeLead, type NormalizedLead } from "./max";
import { getBusiness, icpToText, listLeads } from "./maxApi";
import { saveSettings } from "./settings";
import { remainingSendsToday } from "./pacing";

// ---------- account memory ----------------------------------------------

const MEMORY_LIMIT = 6_000;

export function getMemory(domain: string | null): string {
  if (!domain) return "";
  return get<{ memory: string }>("SELECT memory FROM accounts WHERE domain = ?", domain)?.memory ?? "";
}

export function remember(domain: string | null, note: string) {
  if (!domain) return;
  const line = `[${new Date().toISOString().slice(0, 10)}] ${note.replace(/\s+/g, " ").trim()}`;
  const memory = `${getMemory(domain)}\n${line}`.trim().slice(-MEMORY_LIMIT);
  run(
    `INSERT INTO accounts (domain, memory) VALUES (?, ?)
     ON CONFLICT(domain) DO UPDATE SET memory = excluded.memory, updated_at = datetime('now')`,
    domain, memory,
  );
}

// ---------- ingest ------------------------------------------------------

export function ingestLeads(leads: NormalizedLead[], source = "max"): { inserted: number; duplicates: number } {
  let inserted = 0;
  for (const l of leads) {
    const res = run(
      `INSERT INTO leads (source, external_id, first_name, last_name, email, title, company, domain,
         linkedin_url, location, signal_type, signal_detail, signal_at, raw)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(external_id) DO NOTHING`,
      source, l.external_id, l.first_name, l.last_name, l.email, l.title, l.company, l.domain,
      l.linkedin_url, l.location, l.signal_type, l.signal_detail, l.signal_at, l.raw,
    );
    inserted += Number(res.changes);
  }
  return { inserted, duplicates: leads.length - inserted };
}

// ---------- pull from the Max API ---------------------------------------

function businessId() {
  const id = config.maxBusinessId();
  if (!id) throw new MissingKeysError([{ key: "MAX_BUSINESS_ID", label: "Max business ID" }]);
  return id;
}

/** Read leads Max has already found (no new searches, no credits spent on enrichment). */
export async function pullFromMax(pages = 1, perPage = 25) {
  const id = businessId();
  let inserted = 0, duplicates = 0;
  for (let page = 1; page <= pages; page++) {
    const items = await listLeads(id, page, perPage);
    const r = ingestLeads(items.map(normalizeLead), "max");
    inserted += r.inserted;
    duplicates += r.duplicates;
    if (items.length < perPage) break;
  }
  return { inserted, duplicates };
}

/** Copy the business description and ICP from Max into SignalPilot's settings. */
export async function importIcpFromMax() {
  const b = await getBusiness(businessId());
  saveSettings({ icp: icpToText(b.ideal_customer_profile), offer: `${b.name} (${b.website}): ${b.description}` });
  return b.name;
}

// ---------- validate -> research -> write -------------------------------

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

export async function processLead(id: number): Promise<Lead | undefined> {
  assertConfigured();
  if (!claimLead(id, "new", "processing")) return getLead(id);
  const lead = getLead(id)!;
  const s = getSettings();
  try {
    const v = await validateLead(lead, s);
    updateLead(id, {
      fit_score: v.icp_fit, signal_score: v.signal_strength, urgency_score: v.urgency,
      reasons: JSON.stringify(v.reasons),
    });
    if (v.decision === "rejected") {
      updateLead(id, { status: "rejected" });
      return getLead(id);
    }

    let pages: PageText[] = [];
    if (lead.domain) {
      try {
        pages = await fetchCompanySite(lead.domain);
      } catch (e) {
        logEvent({ source: "research", kind: "site_fetch_failed", ok: false, note: `${lead.domain}: ${errMsg(e)}` });
      }
    }
    const fromMax = companyContext(lead.raw);
    if (fromMax) pages.push({ url: "max-enrichment", title: `${lead.company ?? "Company"} (from Max)`, text: fromMax });
    const brief = await researchLead(lead, pages, getMemory(lead.domain));
    updateLead(id, { brief: JSON.stringify(brief) });

    let draft = await writeEmail(lead, brief, s);
    let hits = bannedPhraseHits(draft);
    if (hits.length) {
      draft = await writeEmail(lead, brief, s, hits);
      hits = bannedPhraseHits(draft);
    }
    if (hits.length) v.reasons.push(`Draft still contains: ${hits.join(", ")} — edit before approving.`);
    updateLead(id, { draft: JSON.stringify(draft), reasons: JSON.stringify(v.reasons) });
    remember(lead.domain, `Signal "${lead.signal_type}" for ${lead.first_name ?? "contact"} (${lead.title ?? "?"}). Why now: ${brief.why_now}`);

    const urgent = Math.round((v.icp_fit + v.signal_strength) / 2);
    const status = !lead.email
      ? "needs_email"
      : s.autoApprove && !hits.length && urgent >= s.autoApproveThreshold
        ? "approved"
        : "draft";
    updateLead(id, { status, error: null });
  } catch (e) {
    updateLead(id, { status: "failed", error: errMsg(e) });
  }
  return getLead(id);
}

export async function processNewLeads(limit = 10) {
  const ids = all<{ id: number }>("SELECT id FROM leads WHERE status = 'new' ORDER BY id LIMIT ?", limit);
  for (const { id } of ids) await processLead(id);
  return ids.length;
}

// ---------- review actions ----------------------------------------------

export function saveDraft(id: number, draft: EmailDraft) {
  updateLead(id, { draft: JSON.stringify(draft) });
}

export function approve(id: number) {
  const lead = getLead(id);
  if (!lead) throw new Error("Lead not found");
  if (!lead.email) throw new Error("Add an email address before approving");
  if (!lead.draft) throw new Error("Lead has no draft");
  if (!["draft", "needs_email", "failed", "approved"].includes(lead.status)) throw new Error(`Cannot approve a ${lead.status} lead`);
  updateLead(id, { status: "approved", error: null });
}

export function setEmail(id: number, email: string) {
  const clean = email.trim().toLowerCase();
  if (!/^[^\s@,]+@[^\s@,]+\.[^\s@,]+$/.test(clean)) throw new Error("That does not look like an email address");
  const lead = getLead(id);
  updateLead(id, { email: clean, ...(lead?.status === "needs_email" ? { status: "draft" } : {}) });
}

export function reject(id: number, reason: string) {
  const lead = getLead(id);
  const reasons: string[] = lead?.reasons ? JSON.parse(lead.reasons) : [];
  updateLead(id, { status: "rejected", reasons: JSON.stringify([...reasons, `Rejected by rep: ${reason || "no reason"}`]) });
}

const REPROCESSABLE = ["failed", "rejected", "draft", "needs_email"];

/** Send a lead back through validate/research/write. Never touches sent or replied leads. */
export function retry(id: number) {
  const lead = getLead(id);
  if (!lead) throw new Error("Lead not found");
  if (lead.status === "new") return;
  if (!REPROCESSABLE.includes(lead.status)) throw new Error(`A ${lead.status} lead cannot be reprocessed`);
  updateLead(id, { status: "new", error: null });
}

// ---------- send via Overloop -------------------------------------------

export async function sendApproved(): Promise<{ sent: number; failed: number; capped: number }> {
  // Hard stop: no prospect is created and no email is sent unless SP_SENDING_ENABLED=1.
  assertCanSend();
  const s = getSettings();
  const budget = remainingSendsToday(s.dailySendCap);
  // Most urgent signals first: stale signals lose value fastest.
  const queue = all<Lead>(
    "SELECT * FROM leads WHERE status = 'approved' ORDER BY COALESCE(urgency_score, 0) DESC, id LIMIT 500",
  );
  let sent = 0, failed = 0;
  for (const lead of queue.slice(0, budget)) {
    if (!claimLead(lead.id, "approved", "processing")) continue;
    try {
      const draft: EmailDraft = JSON.parse(lead.draft!);
      const prospect = await upsertProspect({
        email: lead.email!,
        first_name: lead.first_name,
        last_name: lead.last_name,
        jobtitle: lead.title,
        linkedin_profile: lead.linkedin_url,
        lists: ["SignalPilot"],
        [s.fieldSubject]: draft.subject,
        [s.fieldBody]: draft.body,
        [s.fieldFollowup1]: draft.followup_1,
        [s.fieldFollowup2]: draft.followup_2,
      });
      const enrollment = await enroll(config.overloopCampaignId(), prospect.id);
      updateLead(lead.id, {
        status: "sent", overloop_prospect_id: prospect.id, enrollment_id: enrollment.id,
        sent_at: new Date().toISOString(), error: null,
      });
      remember(lead.domain, `Emailed ${lead.email}: "${draft.subject}"`);
      sent++;
    } catch (e) {
      updateLead(lead.id, { status: "approved", error: errMsg(e) });
      logEvent({ source: "overloop", kind: "send_failed", ok: false, note: `lead ${lead.id}: ${errMsg(e)}` });
      failed++;
    }
  }
  return { sent, failed, capped: Math.max(0, queue.length - budget) };
}

// ---------- replies -----------------------------------------------------

/** Overloop exposes reply status (not reply text) on prospects, so poll sent leads. */
export async function pollReplies(limit = 100): Promise<number> {
  assertOverloop();
  const sentLeads = all<Lead>(
    "SELECT * FROM leads WHERE status = 'sent' AND overloop_prospect_id IS NOT NULL ORDER BY sent_at DESC LIMIT ?",
    limit,
  );
  let found = 0;
  for (const lead of sentLeads) {
    try {
      const p = await getProspect(lead.overloop_prospect_id!);
      if (p.attributes.replied || (p.attributes.email_reply_count ?? 0) > 0) {
        updateLead(lead.id, { status: "replied", replied_at: p.attributes.replied_at ?? new Date().toISOString() });
        remember(lead.domain, `${lead.email} replied.`);
        found++;
      }
    } catch (e) {
      logEvent({ source: "overloop", kind: "reply_poll_failed", ok: false, note: `lead ${lead.id}: ${errMsg(e)}` });
    }
  }
  return found;
}

export async function triage(id: number, replyText: string) {
  assertConfigured();
  const lead = getLead(id);
  if (!lead) throw new Error("Lead not found");
  const draft = lead.draft ? (JSON.parse(lead.draft) as EmailDraft) : null;
  const t = await triageReply(lead, draft, replyText, getMemory(lead.domain), getSettings());
  updateLead(id, {
    status: "replied", reply_text: replyText, reply_category: t.category,
    reply_draft: t.suggested_reply, replied_at: lead.replied_at ?? new Date().toISOString(),
  });
  remember(lead.domain, `Reply (${t.category}): ${t.summary}`);
  return t;
}
