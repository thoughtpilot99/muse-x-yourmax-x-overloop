import Link from "next/link";
import { connection } from "next/server";
import { all, type Lead } from "@/lib/db";
import { ActionForm } from "@/components/ActionForm";
import { Badge, Card, Score, inputClass } from "@/components/ui";
import { importLeadsAction, runPipelineAction } from "../actions";

const STATUSES = ["all", "new", "draft", "needs_email", "approved", "sent", "replied", "rejected", "failed"];

export default async function LeadsPage({ searchParams }: PageProps<"/leads">) {
  await connection();
  const sp = await searchParams;
  const status = typeof sp.status === "string" && STATUSES.includes(sp.status) ? sp.status : "all";
  const signals = all<{ signal_type: string; n: number }>(
    "SELECT signal_type, COUNT(*) AS n FROM leads WHERE signal_type IS NOT NULL GROUP BY signal_type ORDER BY n DESC",
  );
  const signal = typeof sp.signal === "string" && signals.some((s) => s.signal_type === sp.signal) ? sp.signal : "";
  const leads = all<Lead>(
    `SELECT * FROM leads WHERE (? = 'all' OR status = ?) AND (? = '' OR signal_type = ?)
     ORDER BY ${status === "all" ? "id DESC" : "COALESCE(urgency_score, 0) DESC, id DESC"} LIMIT 300`,
    status, status, signal, signal,
  );
  const href = (s: string, sig = signal) => {
    const q = new URLSearchParams();
    if (s !== "all") q.set("status", s);
    if (sig) q.set("signal", sig);
    return `/leads${q.size ? `?${q}` : ""}`;
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{status === "draft" ? "Review queue" : "Leads"}</h1>
          <p className="text-sm text-muted">Leads arrive from Max (pulled or webhook) or the import box below.</p>
        </div>
        <ActionForm action={runPipelineAction} submit={[{ label: "Process new signals" }]} />
      </div>

      <div className="flex flex-wrap items-center gap-2 text-sm">
        {STATUSES.map((s) => (
          <Link
            key={s}
            href={href(s)}
            className={`rounded-full border px-3 py-1 ${s === status ? "border-accent text-accent" : "border-line text-muted hover:text-foreground"}`}
          >
            {s.replace("_", " ")}
          </Link>
        ))}
        <a href={`/leads/export${status !== "all" ? `?status=${status}` : ""}`} className="ml-auto text-sm underline">Export CSV</a>
      </div>

      {signals.length > 1 && (
        <div className="flex flex-wrap gap-2 text-xs">
          <span className="py-1 text-muted">Signal:</span>
          <Link href={href(status, "")} className={`rounded-full border px-2 py-1 ${!signal ? "border-accent text-accent" : "border-line text-muted"}`}>any</Link>
          {signals.map((s) => (
            <Link key={s.signal_type} href={href(status, s.signal_type)}
              className={`rounded-full border px-2 py-1 ${signal === s.signal_type ? "border-accent text-accent" : "border-line text-muted"}`}>
              {s.signal_type} ({s.n})
            </Link>
          ))}
        </div>
      )}

      <div className="overflow-x-auto rounded-lg border border-line bg-panel">
        <table className="w-full min-w-[720px] text-sm">
          <thead className="text-left text-xs uppercase tracking-wide text-muted">
            <tr className="border-b border-line">
              <th className="px-3 py-2">Person</th>
              <th className="px-3 py-2">Company</th>
              <th className="px-3 py-2">Signal</th>
              <th className="px-3 py-2">Fit</th>
              <th className="px-3 py-2">Signal</th>
              <th className="px-3 py-2">Urgency</th>
              <th className="px-3 py-2">Status</th>
            </tr>
          </thead>
          <tbody>
            {leads.map((l) => (
              <tr key={l.id} className="border-b border-line last:border-0 hover:bg-subtle">
                <td className="px-3 py-2">
                  <Link href={`/leads/${l.id}`} className="font-medium hover:underline">
                    {[l.first_name, l.last_name].filter(Boolean).join(" ") || "Unknown"}
                  </Link>
                  <div className="text-xs text-muted">{l.title}</div>
                </td>
                <td className="px-3 py-2">{l.company ?? l.domain ?? "–"}</td>
                <td className="max-w-[260px] truncate px-3 py-2" title={l.signal_detail ?? ""}>
                  {l.signal_type ?? "–"}
                </td>
                <td className="px-3 py-2"><Score value={l.fit_score} /></td>
                <td className="px-3 py-2"><Score value={l.signal_score} /></td>
                <td className="px-3 py-2"><Score value={l.urgency_score} /></td>
                <td className="px-3 py-2"><Badge status={l.status} /></td>
              </tr>
            ))}
            {!leads.length && (
              <tr>
                <td colSpan={7} className="px-3 py-8 text-center text-muted">No leads here yet.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <Card title="Import leads exported from Max">
        <ActionForm action={importLeadsAction} submit={[{ label: "Import" }]}>
          <textarea
            name="json"
            rows={6}
            className={`${inputClass} font-mono`}
            placeholder='[{"first_name":"Ana","last_name":"Silva","title":"VP Sales","company":"Acme","domain":"acme.com","email":"ana@acme.com","signal":{"type":"job_posting","description":"Hiring 3 SDRs","detected_at":"2026-10-10"}}]'
          />
        </ActionForm>
      </Card>
    </div>
  );
}
