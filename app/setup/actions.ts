"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { config } from "@/lib/config";
import { isSecretName, setSecret } from "@/lib/secrets";
import { pingMuse } from "@/lib/muse";
import { getBusiness, listBusinesses, createSubscription, setSubscriptionActive } from "@/lib/maxApi";
import { getCampaign, listCampaigns } from "@/lib/overloop";
import { importIcpFromMax } from "@/lib/pipeline";
import { PRESETS, presetConfig } from "@/lib/monitors";
import type { ActionResult } from "../actions";

async function attempt(fn: () => Promise<string> | string): Promise<ActionResult> {
  try {
    const message = await fn();
    revalidatePath("/", "layout");
    return { ok: true, message };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}

const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();

/** Save (or clear, when empty) one key entered on the setup page. */
export async function saveKeyAction(_: ActionResult | null, fd: FormData) {
  return attempt(() => {
    const name = str(fd, "name");
    if (!isSecretName(name) || name === "SP_SENDING_ENABLED") throw new Error("Unknown setting");
    if (process.env[name]) throw new Error(`${name} is set in .env.local, which takes precedence. Change it there.`);
    const value = str(fd, "value");
    if (value.length > 500 || /\s/.test(value)) throw new Error("That doesn't look like a key (no spaces, max 500 characters)");
    setSecret(name, value);
    return value ? "Saved." : "Cleared.";
  });
}

export async function testMuseAction(): Promise<ActionResult> {
  return attempt(async () => `Connected to ${await pingMuse()}.`);
}

export async function testMaxAction(): Promise<ActionResult> {
  return attempt(async () => {
    const list = await listBusinesses();
    return `Connected. ${list.length} business(es) on this account.`;
  });
}

export async function testOverloopAction(): Promise<ActionResult> {
  return attempt(async () => {
    const list = await listCampaigns();
    const chosen = config.overloopCampaignId();
    if (chosen) {
      const c = await getCampaign(chosen);
      return `Connected. Sending campaign "${c.attributes.name}" is ${c.attributes.status}.`;
    }
    return `Connected. ${list.length} campaign(s) found — pick one below.`;
  });
}

export async function chooseBusinessAction(_: ActionResult | null, fd: FormData) {
  return attempt(async () => {
    const id = z.coerce.number().int().positive().parse(fd.get("business_id"));
    const b = await getBusiness(String(id));
    setSecret("MAX_BUSINESS_ID", String(id));
    if (fd.get("import_icp") === "on") await importIcpFromMax();
    return `Using "${b.name}".${fd.get("import_icp") === "on" ? " ICP and offer imported into Settings." : ""}`;
  });
}

export async function chooseCampaignAction(_: ActionResult | null, fd: FormData) {
  return attempt(async () => {
    const id = str(fd, "campaign_id");
    if (!id) throw new Error("Pick a campaign");
    const c = await getCampaign(id);
    setSecret("OVERLOOP_CAMPAIGN_ID", id);
    return `Emails will be sent through "${c.attributes.name}".`;
  });
}

export async function setLiveAction(_: ActionResult | null, fd: FormData) {
  return attempt(() => {
    if (fd.get("intent") === "off") {
      setSecret("SP_SENDING_ENABLED", "0");
      return "Sending is off.";
    }
    if (config.sendingForcedOff()) throw new Error("SP_SENDING_ENABLED=0 in .env.local forces sending off. Remove it first.");
    if (str(fd, "confirm") !== "SEND") throw new Error('Type SEND to confirm');
    if (!config.overloopApiKey() || !config.overloopCampaignId()) throw new Error("Connect Overloop and pick a campaign first");
    setSecret("SP_SENDING_ENABLED", "1");
    return "Sending is ON. Approved leads will be enrolled in your Overloop campaign.";
  });
}

// ---------- Max monitors -------------------------------------------------

export async function createMonitorAction(_: ActionResult | null, fd: FormData) {
  return attempt(async () => {
    const preset = PRESETS.find((p) => p.id === str(fd, "preset"));
    if (!preset) throw new Error("Unknown preset");
    const businessId = config.maxBusinessId();
    if (!businessId) throw new Error("Pick a Max business on the Setup page first");
    const name = str(fd, "name") || preset.name;
    const sub = await createSubscription(businessId, {
      signal_slug: preset.signal_slug,
      name,
      config: presetConfig(preset, preset.listField ? String(fd.get("list") ?? "") : null),
    });
    return `Monitor "${sub.name}" created. Max runs it on its own schedule (usually daily).`;
  });
}

export async function toggleMonitorAction(_: ActionResult | null, fd: FormData) {
  return attempt(async () => {
    const id = z.coerce.number().int().positive().parse(fd.get("id"));
    const active = fd.get("intent") === "resume";
    await setSubscriptionActive(config.maxBusinessId(), id, active);
    return active ? "Monitor resumed." : "Monitor paused.";
  });
}
