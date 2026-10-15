import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { getLead } from "@/lib/db";
import type { EmailDraft, ResearchBrief } from "@/lib/agents";
import { bannedPhraseHits } from "@/lib/agents";
import { getMemory } from "@/lib/pipeline";
import { ActionForm } from "@/components/ActionForm";
import { Badge, Card, Score, inputClass } from "@/components/ui";
import { processLeadAction, rejectAction, saveDraftAction, setEmailAction, triageAction } from "../../actions";

export default async function LeadPage({ params }: PageProps<"/leads/[id]">) {
  await connection();
  const { id } = await params;
  const lead = getLead(Number(id));
  if (!lead) notFound();

  const reasons: string[] = lead.reasons ? JSON.parse(lead.reasons) : [];
  const brief: ResearchBrief | null = lead.brief ? JSON.parse(lead.brief) : null;
  const draft: EmailDraft | null = lead.draft ? JSON.parse(lead.draft) : null;
  const hits = draft ? bannedPhraseHits(draft) : [];
  const editable = ["draft", "needs_email", "failed", "approved"].includes(lead.status);
  const name = [lead.first_name, lead.last_name].filter(Boolean).join(" ") || "Unknown";

  return (
    <div className="space-y-6">
      <div>
        <Link href="/leads" className="text-sm text-muted hover:underline">← Leads</Link>
        <div className="mt-1 flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold">{name}</h1>
          <Badge status={lead.status} />
        </div>
        <p className="text-sm text-muted">
          {lead.title} · {lead.company ?? lead.domain} · {lead.email ?? "no email yet"}
          {lead.linkedin_url && (
            <> · <a href={lead.linkedin_url} target="_blank" rel="noreferrer" className="underline">LinkedIn</a></>
          )}
        </p>
        {lead.error && <p className="mt-2 rounded-md bg-red-500/10 px-3 py-2 text-sm text-red-700 dark:text-red-300">{lead.error}</p>}
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card title="Signal">
          <p className="font-medium">{lead.signal_type ?? "Unknown signal"}</p>
          <p className="mt-1 text-sm">{lead.signal_detail}</p>
          <p className="mt-2 text-xs text-muted">Detected {lead.signal_at ?? "unknown date"}</p>
        </Card>
        <Card title="Muse Wonder verdict">
          <div className="grid grid-cols-3 gap-2 text-center text-sm">
            <div><div className="text-xs text-muted">Fit</div><Score value={lead.fit_score} /></div>
            <div><div className="text-xs text-muted">Signal</div><Score value={lead.signal_score} /></div>
            <div><div className="text-xs text-muted">Urgency</div><Score value={lead.urgency_score} /></div>
          </div>
          <ul className="mt-3 list-disc space-y-1 pl-5 text-sm">{reasons.map((r, i) => <li key={i}>{r}</li>)}</ul>
        </Card>
        <Card title="Actions">
          <ActionForm action={processLeadAction} submit={[{ label: "Re-run Muse Wonder", tone: "neutral" }]}>
            <input type="hidden" name="id" value={lead.id} />
          </ActionForm>
          {lead.status !== "rejected" && lead.status !== "sent" && lead.status !== "replied" && (
            <ActionForm action={rejectAction} submit={[{ label: "Reject", tone: "danger" }]} className="mt-2">
              <input type="hidden" name="id" value={lead.id} />
              <input name="reason" placeholder="Reason (optional)" className={inputClass} />
            </ActionForm>
          )}
        </Card>
      </div>

      {(lead.status === "needs_email" || !lead.email) && (
        <Card title="Email address">
          <p className="mb-2 text-sm text-muted">
            This lead qualified but Max sent no email. Enrich it in Max (3 credits) or find it in Overloop, then paste it here.
          </p>
          <ActionForm action={setEmailAction} submit={[{ label: "Save email" }]}>
            <input type="hidden" name="id" value={lead.id} />
            <input name="email" type="email" required placeholder="name@company.com" className={inputClass} />
          </ActionForm>
        </Card>
      )}

      {brief && (
        <Card title="Research brief">
          <p className="text-sm"><strong>Why now:</strong> {brief.why_now}</p>
          <p className="mt-2 text-sm text-muted">{brief.company_summary}</p>
          {brief.evidence.length > 0 && (
            <ul className="mt-3 space-y-2 text-sm">
              {brief.evidence.map((e, i) => (
                <li key={i} className="rounded-md bg-subtle px-3 py-2">
                  <div>{e.fact}</div>
                  <div className="mt-1 text-xs text-muted">
                    “{e.quote}” —{" "}
                    {e.source_url.startsWith("http") ? (
                      <a href={e.source_url} target="_blank" rel="noreferrer" className="underline">{e.source_url}</a>
                    ) : (
                      e.source_url
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
          {brief.risks.length > 0 && <p className="mt-3 text-xs text-muted">Risks: {brief.risks.join(" · ")}</p>}
        </Card>
      )}

      {draft && (
        <Card title={editable ? "Email draft — edit anything" : "Email sent"}>
          {hits.length > 0 && (
            <p className="mb-3 rounded-md bg-amber-500/10 px-3 py-2 text-sm">Contains phrases buyers ignore: {hits.join(", ")}</p>
          )}
          <ActionForm
            action={saveDraftAction}
            submit={
              editable
                ? [
                    { label: "Save and approve", intent: "approve" },
                    { label: "Save draft", intent: "save", tone: "neutral" },
                  ]
                : []
            }
          >
            <input type="hidden" name="id" value={lead.id} />
            <input type="hidden" name="evidence_used" value={JSON.stringify(draft.evidence_used)} />
            <fieldset disabled={!editable} className="space-y-3">
              <label className="block text-xs text-muted">Subject
                <input name="subject" defaultValue={draft.subject} className={`${inputClass} mt-1`} />
              </label>
              <label className="block text-xs text-muted">Email
                <textarea name="body" defaultValue={draft.body} rows={8} className={`${inputClass} mt-1`} />
              </label>
              <div className="grid gap-3 md:grid-cols-2">
                <label className="block text-xs text-muted">Follow-up 1 (~day 3)
                  <textarea name="followup_1" defaultValue={draft.followup_1} rows={5} className={`${inputClass} mt-1`} />
                </label>
                <label className="block text-xs text-muted">Follow-up 2 (~day 7)
                  <textarea name="followup_2" defaultValue={draft.followup_2} rows={5} className={`${inputClass} mt-1`} />
                </label>
              </div>
            </fieldset>
          </ActionForm>
          {draft.evidence_used.length > 0 && (
            <p className="mt-3 text-xs text-muted">Built on: {draft.evidence_used.join(" · ")}</p>
          )}
        </Card>
      )}

      {(lead.status === "sent" || lead.status === "replied") && (
        <Card title="Reply">
          {lead.reply_category && (
            <div className="mb-3 space-y-2 text-sm">
              <p><strong>Category:</strong> {lead.reply_category.replace("_", " ")}</p>
              <p className="whitespace-pre-line rounded-md bg-subtle px-3 py-2">{lead.reply_draft}</p>
              <p className="text-xs text-muted">Suggested response — send it from your Overloop inbox.</p>
            </div>
          )}
          <p className="mb-2 text-sm text-muted">
            Overloop reports that a prospect replied but not what they said. Paste the reply to get it classified and answered.
          </p>
          <ActionForm action={triageAction} submit={[{ label: "Classify and draft response" }]}>
            <input type="hidden" name="id" value={lead.id} />
            <textarea name="reply_text" rows={4} defaultValue={lead.reply_text ?? ""} className={inputClass} />
          </ActionForm>
        </Card>
      )}

      <Card title="Account memory">
        <pre className="whitespace-pre-wrap text-xs text-muted">{getMemory(lead.domain) || "Nothing remembered yet."}</pre>
      </Card>
    </div>
  );
}
