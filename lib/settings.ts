import { all, run } from "./db";

export type Settings = {
  icp: string;
  offer: string;
  senderName: string;
  tone: string;
  maxSignalAgeDays: number;
  minFitScore: number;
  dailySendCap: number;
  autoApprove: boolean;
  autoApproveThreshold: number;
  fieldSubject: string;
  fieldBody: string;
  fieldFollowup1: string;
  fieldFollowup2: string;
};

export const DEFAULT_SETTINGS: Settings = {
  icp: "",
  offer: "",
  senderName: "",
  tone: "Plain, specific, friendly. Short sentences. No hype.",
  maxSignalAgeDays: 21,
  minFitScore: 60,
  dailySendCap: 30,
  autoApprove: false,
  autoApproveThreshold: 85,
  fieldSubject: "c_sp_subject",
  fieldBody: "c_sp_body",
  fieldFollowup1: "c_sp_followup1",
  fieldFollowup2: "c_sp_followup2",
};

export function getSettings(): Settings {
  const rows = all<{ key: string; value: string }>("SELECT key, value FROM settings");
  const s: Settings = { ...DEFAULT_SETTINGS };
  for (const { key, value } of rows) {
    if (!(key in s)) continue;
    const k = key as keyof Settings;
    const def = DEFAULT_SETTINGS[k];
    (s as Record<string, unknown>)[k] =
      typeof def === "number" ? Number(value) : typeof def === "boolean" ? value === "1" : value;
  }
  return s;
}

export function saveSettings(patch: Partial<Settings>) {
  for (const [key, value] of Object.entries(patch)) {
    if (!(key in DEFAULT_SETTINGS) || value === undefined) continue;
    const v = typeof value === "boolean" ? (value ? "1" : "0") : String(value);
    run(
      "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      key, v,
    );
  }
}
