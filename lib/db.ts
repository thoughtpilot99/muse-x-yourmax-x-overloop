import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";

export type LeadStatus =
  | "new"
  | "processing"
  | "rejected"
  | "needs_email"
  | "draft"
  | "approved"
  | "sent"
  | "replied"
  | "failed";

export type Lead = {
  id: number;
  source: string;
  external_id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  title: string | null;
  company: string | null;
  domain: string | null;
  linkedin_url: string | null;
  location: string | null;
  signal_type: string | null;
  signal_detail: string | null;
  signal_at: string | null;
  raw: string;
  status: LeadStatus;
  fit_score: number | null;
  signal_score: number | null;
  urgency_score: number | null;
  reasons: string | null; // JSON string[]
  brief: string | null; // JSON ResearchBrief
  draft: string | null; // JSON EmailDraft
  overloop_prospect_id: string | null;
  enrollment_id: string | null;
  sent_at: string | null;
  replied_at: string | null;
  reply_text: string | null;
  reply_category: string | null;
  reply_draft: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
};

const SCHEMA = `
CREATE TABLE IF NOT EXISTS leads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source TEXT NOT NULL,
  external_id TEXT NOT NULL UNIQUE,
  first_name TEXT, last_name TEXT, email TEXT, title TEXT,
  company TEXT, domain TEXT, linkedin_url TEXT, location TEXT,
  signal_type TEXT, signal_detail TEXT, signal_at TEXT,
  raw TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'new',
  fit_score INTEGER, signal_score INTEGER, urgency_score INTEGER,
  reasons TEXT, brief TEXT, draft TEXT,
  overloop_prospect_id TEXT, enrollment_id TEXT,
  sent_at TEXT, replied_at TEXT,
  reply_text TEXT, reply_category TEXT, reply_draft TEXT,
  error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS leads_status ON leads(status);
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source TEXT NOT NULL,
  kind TEXT NOT NULL,
  ok INTEGER NOT NULL,
  note TEXT,
  headers TEXT,
  payload TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS ai_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  step TEXT NOT NULL,
  lead_id INTEGER,
  input_tokens INTEGER, output_tokens INTEGER, cost_usd REAL,
  ok INTEGER NOT NULL,
  error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS secrets (
  name TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS accounts (
  domain TEXT PRIMARY KEY,
  memory TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`;

const g = globalThis as unknown as { __spDb?: DatabaseSync };

export function db(): DatabaseSync {
  if (!g.__spDb) {
    const file = process.env.SP_DB_PATH ?? path.join(process.cwd(), "data", "app.db");
    if (file !== ":memory:") fs.mkdirSync(path.dirname(file), { recursive: true });
    const d = new DatabaseSync(file);
    d.exec("PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;");
    d.exec(SCHEMA);
    g.__spDb = d;
  }
  return g.__spDb;
}

type Param = string | number | null;

export function all<T>(sql: string, ...params: Param[]): T[] {
  return db().prepare(sql).all(...params) as T[];
}

export function get<T>(sql: string, ...params: Param[]): T | undefined {
  return db().prepare(sql).get(...params) as T | undefined;
}

export function run(sql: string, ...params: Param[]) {
  return db().prepare(sql).run(...params);
}

export function getLead(id: number) {
  return get<Lead>("SELECT * FROM leads WHERE id = ?", id);
}

const LEAD_COLUMNS = new Set([
  "email", "status", "fit_score", "signal_score", "urgency_score", "reasons", "brief", "draft",
  "overloop_prospect_id", "enrollment_id", "sent_at", "replied_at", "reply_text",
  "reply_category", "reply_draft", "error",
]);

export function updateLead(id: number, fields: Partial<Record<keyof Lead, Param>>) {
  const keys = Object.keys(fields).filter((k) => LEAD_COLUMNS.has(k));
  if (!keys.length) return;
  const sets = keys.map((k) => `${k} = ?`).join(", ");
  run(
    `UPDATE leads SET ${sets}, updated_at = datetime('now') WHERE id = ?`,
    ...keys.map((k) => fields[k as keyof Lead] ?? null),
    id,
  );
}

/** Atomically move a lead between statuses; returns false if another worker got there first. */
export function claimLead(id: number, from: LeadStatus, to: LeadStatus): boolean {
  const res = run(
    "UPDATE leads SET status = ?, updated_at = datetime('now') WHERE id = ? AND status = ?",
    to, id, from,
  );
  return Number(res.changes) === 1;
}

export function logEvent(e: {
  source: string;
  kind: string;
  ok: boolean;
  note?: string;
  headers?: Record<string, string>;
  payload?: string;
}) {
  run(
    "INSERT INTO events (source, kind, ok, note, headers, payload) VALUES (?, ?, ?, ?, ?, ?)",
    e.source, e.kind, e.ok ? 1 : 0, e.note ?? null,
    e.headers ? JSON.stringify(e.headers) : null, e.payload ?? null,
  );
}
