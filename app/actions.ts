"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { MissingKeysError, missingKeys, config } from "@/lib/config";
import { normalizeLead, splitPayload } from "@/lib/max";
import { pingMuse } from "@/lib/muse";
import { getCampaign, listCampaigns } from "@/lib/overloop";
import { getBusiness } from "@/lib/maxApi";
import {
  approve, importIcpFromMax, ingestLeads, pollReplies, processLead, processNewLeads, pullFromMax, reject, retry,
  saveDraft, sendApproved, setEmail, triage,
} from "@/lib/pipeline";
import { DEFAULT_SETTINGS, saveSettings, type Settings } from "@/lib/settings";

export type ActionResult = { ok: boolean; message: string };

async function attempt(fn: () => Promise<string> | string): Promise<ActionResult> {
  try {
    const message = await fn();
    revalidatePath("/", "layout");
    return { ok: true, message };
  } catch (e) {
    if (e instanceof MissingKeysError) {
      return { ok: false, message: `Connect these on the Setup page first: ${e.missing.map((m) => m.label).join(", ")}` };
    }
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}

const idOf = (fd: FormData) => z.coerce.number().int().positive().parse(fd.get("id"));
const str = (fd: FormData, k: string) => String(fd.get(k) ?? "");

export async function importLeadsAction(_: ActionResult | null, fd: FormData) {
  return attempt(() => {
    let body: unknown;
    try {
      body = JSON.parse(str(fd, "json"));
    } catch {
      throw new Error("Paste valid JSON (one lead object, an array, or {\"leads\": [...]})");
    }
    const leads = splitPayload(body).map((item) => {
      const lead = normalizeLead(item);
      return { ...lead, external_id: lead.external_id.replace(/^max:/, "manual:") };
    });
    if (!leads.length) throw new Error("No lead objects found in that JSON");
    const r = ingestLeads(leads, "manual");
    return `${r.inserted} lead(s) imported, ${r.duplicates} already existed.`;
  });
}

export async function pullFromMaxAction() {
  return attempt(async () => {
    const r = await pullFromMax(2);
    return `${r.inserted} new lead(s) pulled from Max, ${r.duplicates} already here.`;
  });
}

export async function importIcpAction() {
  return attempt(async () => `Imported the ideal customer profile and offer for ${await importIcpFromMax()} from Max. Review them below.`);
}

export async function runPipelineAction() {
  return attempt(async () => `Processed ${await processNewLeads(25)} new lead(s).`);
}

export async function processLeadAction(_: ActionResult | null, fd: FormData) {
  return attempt(async () => {
    const id = idOf(fd);
    retry(id);
    const lead = await processLead(id);
    return `Lead is now ${lead?.status}.`;
  });
}

export async function saveDraftAction(_: ActionResult | null, fd: FormData) {
  return attempt(() => {
    saveDraft(idOf(fd), {
      subject: str(fd, "subject"),
      body: str(fd, "body"),
      followup_1: str(fd, "followup_1"),
      followup_2: str(fd, "followup_2"),
      evidence_used: JSON.parse(str(fd, "evidence_used") || "[]"),
    });
    if (fd.get("intent") === "approve") {
      approve(idOf(fd));
      return "Saved and approved. It will be sent in the next send run.";
    }
    return "Draft saved.";
  });
}

export async function setEmailAction(_: ActionResult | null, fd: FormData) {
  return attempt(() => {
    setEmail(idOf(fd), str(fd, "email"));
    return "Email saved.";
  });
}

export async function rejectAction(_: ActionResult | null, fd: FormData) {
  return attempt(() => {
    reject(idOf(fd), str(fd, "reason"));
    return "Lead rejected.";
  });
}

export async function sendNowAction() {
  return attempt(async () => {
    const r = await sendApproved();
    return `Sent ${r.sent}, failed ${r.failed}${r.capped ? `, ${r.capped} waiting for tomorrow's cap` : ""}.`;
  });
}

export async function pollRepliesAction() {
  return attempt(async () => `${await pollReplies()} new repl(ies) detected.`);
}

export async function triageAction(_: ActionResult | null, fd: FormData) {
  return attempt(async () => {
    const text = str(fd, "reply_text").trim();
    if (!text) throw new Error("Paste the prospect's reply first");
    const t = await triage(idOf(fd), text);
    return `Classified as ${t.category}.`;
  });
}

export async function saveSettingsAction(_: ActionResult | null, fd: FormData) {
  return attempt(() => {
    const patch: Partial<Settings> = {};
    for (const [key, def] of Object.entries(DEFAULT_SETTINGS)) {
      if (typeof def === "boolean") {
        (patch as Record<string, unknown>)[key] = fd.get(key) === "on";
        continue;
      }
      const v = fd.get(key);
      if (v === null) continue;
      if (typeof def === "number") {
        const n = Number(v);
        if (!Number.isFinite(n) || n < 0) throw new Error(`${key} must be a positive number`);
        (patch as Record<string, unknown>)[key] = n;
      } else {
        const s = String(v).trim();
        if (key.startsWith("field") && !/^c_[a-z0-9_]+$/.test(s)) throw new Error(`${key} must look like c_my_field`);
        (patch as Record<string, unknown>)[key] = s;
      }
    }
    saveSettings(patch);
    return "Settings saved.";
  });
}

export async function testConnectionsAction(): Promise<ActionResult> {
  const missing = missingKeys();
  if (missing.length) return { ok: false, message: `Missing: ${missing.map((m) => m.key).join(", ")}` };
  const lines: string[] = [];
  let ok = true;
  try {
    lines.push(`Muse Wonder: OK (${await pingMuse()})`);
  } catch (e) {
    ok = false;
    lines.push(`Muse Wonder: ${e instanceof Error ? e.message : e}`);
  }
  if (config.maxApiKey()) {
    try {
      const b = config.maxBusinessId() ? await getBusiness(config.maxBusinessId()) : null;
      lines.push(`Max: OK${b ? `, business "${b.name}"` : " (set MAX_BUSINESS_ID to pull leads)"}`);
    } catch (e) {
      ok = false;
      lines.push(`Max: ${e instanceof Error ? e.message : e}`);
    }
  }
  if (config.overloopApiKey()) {
    // Read-only checks; nothing is created in Overloop here.
    try {
      if (config.overloopCampaignId()) {
        const c = await getCampaign(config.overloopCampaignId());
        lines.push(`Overloop: OK, campaign "${c.attributes.name}" is ${c.attributes.status}`);
      } else {
        lines.push(`Overloop: OK, ${(await listCampaigns()).length} campaign(s) visible`);
      }
    } catch (e) {
      ok = false;
      lines.push(`Overloop: ${e instanceof Error ? e.message : e}`);
    }
  }
  lines.push(config.sendingEnabled() ? "Sending: ON" : "Sending: OFF (SP_SENDING_ENABLED is not 1)");
  return { ok, message: lines.join("\n") };
}
