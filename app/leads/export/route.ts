import { all, type Lead } from "@/lib/db";

const COLUMNS = [
  "id", "status", "first_name", "last_name", "email", "title", "company", "domain", "linkedin_url", "location",
  "signal_type", "signal_detail", "signal_at", "fit_score", "signal_score", "urgency_score", "reasons", "subject", "body",
  "sent_at", "replied_at", "reply_category",
] as const;

function cell(v: unknown): string {
  const s = v === null || v === undefined ? "" : String(v);
  // Neutralise spreadsheet formulas and quote everything.
  const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
  return `"${safe.replace(/"/g, '""')}"`;
}

export async function GET(req: Request) {
  const status = new URL(req.url).searchParams.get("status");
  const leads = status
    ? all<Lead>("SELECT * FROM leads WHERE status = ? ORDER BY id", status)
    : all<Lead>("SELECT * FROM leads ORDER BY id");
  const rows = leads.map((l) => {
    const draft = l.draft ? JSON.parse(l.draft) : {};
    const reasons = l.reasons ? (JSON.parse(l.reasons) as string[]).join(" | ") : "";
    const rec: Record<string, unknown> = { ...l, reasons, subject: draft.subject, body: draft.body };
    return COLUMNS.map((c) => cell(rec[c])).join(",");
  });
  const csv = [COLUMNS.join(","), ...rows].join("\r\n");
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="signalpilot-leads${status ? `-${status}` : ""}.csv"`,
    },
  });
}
