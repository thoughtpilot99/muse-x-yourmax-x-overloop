import Link from "next/link";
import { connection } from "next/server";
import { config } from "@/lib/config";
import { all } from "@/lib/db";
import { listSubscriptions, type MaxSubscription } from "@/lib/maxApi";
import { PRESETS } from "@/lib/monitors";
import { ActionForm } from "@/components/ActionForm";
import { Card, inputClass } from "@/components/ui";
import { createMonitorAction, toggleMonitorAction } from "../setup/actions";
import { pullFromMaxAction } from "../actions";

export default async function MonitorsPage() {
  await connection();
  if (!config.maxApiKey() || !config.maxBusinessId()) {
    return (
      <div className="space-y-3">
        <h1 className="text-2xl font-semibold">Monitors</h1>
        <p className="text-sm text-muted">Connect Max and pick a business on the <Link href="/setup" className="underline">Setup</Link> page first.</p>
      </div>
    );
  }

  let subs: MaxSubscription[] = [];
  let error = "";
  try {
    subs = await listSubscriptions(config.maxBusinessId());
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }
  // How many leads each signal type has produced in SignalPilot, and how many qualified.
  const stats = Object.fromEntries(
    all<{ signal_type: string; n: number; good: number }>(
      `SELECT signal_type, COUNT(*) AS n,
         SUM(CASE WHEN status IN ('draft','needs_email','approved','sent','replied') THEN 1 ELSE 0 END) AS good
       FROM leads GROUP BY signal_type`,
    ).map((r) => [r.signal_type, r]),
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Monitors</h1>
          <p className="text-sm text-muted">Buying-signal searches running in Max. SignalPilot pulls what they find every 30 minutes.</p>
        </div>
        <ActionForm action={pullFromMaxAction} submit={[{ label: "Pull leads now" }]} />
      </div>

      {error && <p className="rounded-md bg-red-500/10 px-3 py-2 text-sm text-red-700 dark:text-red-300">{error}</p>}

      <div className="overflow-x-auto rounded-lg border border-line bg-panel">
        <table className="w-full min-w-[640px] text-sm">
          <thead className="text-left text-xs uppercase tracking-wide text-muted">
            <tr className="border-b border-line">
              <th className="px-3 py-2">Monitor</th>
              <th className="px-3 py-2">Signal</th>
              <th className="px-3 py-2">Last run</th>
              <th className="px-3 py-2">Leads here / qualified</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {subs.map((m) => {
              const st = stats[m.signal.name];
              return (
                <tr key={m.id} className="border-b border-line last:border-0">
                  <td className="px-3 py-2 font-medium">{m.name}{!m.active && <span className="ml-2 text-xs text-muted">paused</span>}</td>
                  <td className="px-3 py-2">{m.signal.name}</td>
                  <td className="px-3 py-2 text-muted">{m.last_checked_at ? m.last_checked_at.replace("T", " ").slice(0, 16) + " UTC" : "not yet"}</td>
                  <td className="px-3 py-2 tabular-nums">{st ? `${st.n} / ${st.good}` : "0 / 0"}</td>
                  <td className="px-3 py-2 text-right">
                    <ActionForm action={toggleMonitorAction} submit={[{ label: m.active ? "Pause" : "Resume", intent: m.active ? "pause" : "resume", tone: "neutral" }]}>
                      <input type="hidden" name="id" value={m.id} />
                    </ActionForm>
                  </td>
                </tr>
              );
            })}
            {!subs.length && !error && <tr><td colSpan={5} className="px-3 py-6 text-center text-muted">No monitors yet — add one below.</td></tr>}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted">Max charges credits for the leads monitors find. Pause monitors you don&apos;t need.</p>

      <h2 className="text-lg font-semibold">Add a monitor</h2>
      <div className="grid gap-4 md:grid-cols-2">
        {PRESETS.map((p) => (
          <Card key={p.id} title={p.name}>
            <p className="text-sm text-muted">{p.why}</p>
            <ActionForm action={createMonitorAction} submit={[{ label: "Create monitor", tone: "neutral" }]} className="mt-3">
              <input type="hidden" name="preset" value={p.id} />
              <input name="name" defaultValue={`SignalPilot - ${p.name}`} className={inputClass} />
              {p.listField && (
                <label className="mt-2 block text-xs text-muted">
                  {p.listLabel}
                  <textarea name="list" rows={5} required placeholder={p.listExample} className={`${inputClass} mt-1 font-mono`} />
                </label>
              )}
            </ActionForm>
          </Card>
        ))}
      </div>
    </div>
  );
}
