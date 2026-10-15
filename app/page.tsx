import Link from "next/link";
import { connection } from "next/server";
import { all, get } from "@/lib/db";
import { getSettings } from "@/lib/settings";
import { remainingSendsToday } from "@/lib/pacing";
import { config } from "@/lib/config";
import { ActionForm } from "@/components/ActionForm";
import { Checklist } from "@/components/Checklist";
import { Card, Stat } from "@/components/ui";
import { pollRepliesAction, pullFromMaxAction, runPipelineAction, sendNowAction } from "./actions";

export default async function Dashboard() {
  await connection();
  const counts = Object.fromEntries(
    all<{ status: string; n: number }>("SELECT status, COUNT(*) AS n FROM leads GROUP BY status").map((r) => [r.status, r.n]),
  );
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const qualified = total - (counts.new ?? 0) - (counts.processing ?? 0) - (counts.rejected ?? 0) - (counts.failed ?? 0);
  const sent = (counts.sent ?? 0) + (counts.replied ?? 0);
  const replied = counts.replied ?? 0;
  const ai = get<{ cost: number | null; runs: number }>("SELECT SUM(cost_usd) AS cost, COUNT(*) AS runs FROM ai_runs") ?? { cost: 0, runs: 0 };
  const s = getSettings();
  const left = remainingSendsToday(s.dailySendCap);

  const reasons = all<{ reasons: string }>("SELECT reasons FROM leads WHERE status = 'rejected' AND reasons IS NOT NULL ORDER BY id DESC LIMIT 200");
  const recentRejects = reasons.flatMap((r) => (JSON.parse(r.reasons) as string[]).slice(0, 1)).slice(0, 6);

  const drafted = qualified > 0;
  const checklist = [
    { label: "Connect Muse Wonder", done: !!config.museApiKey(), href: "/setup" },
    { label: "Connect Max and pick a business", done: !!config.maxApiKey() && !!config.maxBusinessId(), href: "/setup" },
    { label: "Describe your ICP and offer", done: !!s.icp && !!s.offer, href: "/settings" },
    // Done once a lead from an intent monitor (anything beyond plain ICP matches) has arrived.
    {
      label: "Add a buying-signal monitor",
      done: (get<{ n: number }>("SELECT COUNT(*) AS n FROM leads WHERE signal_type IS NOT NULL AND signal_type != 'ICP Matches'")?.n ?? 0) > 0,
      href: "/monitors",
    },
    { label: "Process your first leads", done: total - (counts.new ?? 0) > 0, href: "/leads" },
    { label: "Review a draft", done: drafted, href: "/leads?status=draft" },
    { label: "Connect Overloop and pick a campaign", done: !!config.overloopApiKey() && !!config.overloopCampaignId(), href: "/setup" },
    { label: "Turn sending on", done: config.sendingEnabled(), href: "/setup" },
  ];

  const funnel = [
    { label: "Signals in", value: total },
    { label: "Qualified", value: qualified },
    { label: "Sent", value: sent },
    { label: "Replied", value: replied },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Dashboard</h1>
        <p className="text-sm text-muted">Max signals → Muse Wonder checks, researches, writes → Overloop sends.</p>
      </div>

      <Checklist items={checklist} />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {funnel.map((f, i) => (
          <Stat
            key={f.label}
            label={f.label}
            value={f.value}
            hint={i > 0 && funnel[i - 1].value ? `${Math.round((f.value / funnel[i - 1].value) * 100)}% of previous` : undefined}
          />
        ))}
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <Stat label="False alarms filtered" value={counts.rejected ?? 0} hint="Skip these in Max to save enrichment credits" />
        <Stat label="Sends left today" value={`${left} / ${s.dailySendCap}`} hint="Daily cap protects your domain" />
        <Stat label="Muse Wonder spend" value={`$${(ai.cost ?? 0).toFixed(2)}`} hint={`${ai.runs} model calls`} />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card title="Needs you">
          <ul className="space-y-2 text-sm">
            <li><Link className="underline" href="/leads?status=draft">{counts.draft ?? 0} drafts to review</Link></li>
            <li><Link className="underline" href="/leads?status=needs_email">{counts.needs_email ?? 0} qualified leads missing an email</Link></li>
            <li><Link className="underline" href="/replies">{replied} replies</Link></li>
            <li><Link className="underline" href="/leads?status=failed">{counts.failed ?? 0} failed</Link></li>
          </ul>
        </Card>
        <Card title="Run now">
          <div className="space-y-1">
            <ActionForm action={pullFromMaxAction} submit={[{ label: "Pull leads from Max", tone: "neutral" }]} />
            <ActionForm action={runPipelineAction} submit={[{ label: "Process new signals" }]} />
            <ActionForm action={sendNowAction} submit={[{ label: "Send approved emails", tone: "neutral" }]} />
            <ActionForm action={pollRepliesAction} submit={[{ label: "Check for replies", tone: "neutral" }]} />
          </div>
          <p className="mt-3 text-xs text-muted">These also run automatically (Max every 30 minutes, processing every minute, sending every 5, replies every 15).</p>
        </Card>
      </div>

      <Card title="Why signals were rejected (latest)">
        {recentRejects.length ? (
          <ul className="list-disc space-y-1 pl-5 text-sm">{recentRejects.map((r, i) => <li key={i}>{r}</li>)}</ul>
        ) : (
          <p className="text-sm text-muted">Nothing rejected yet.</p>
        )}
      </Card>
    </div>
  );
}
