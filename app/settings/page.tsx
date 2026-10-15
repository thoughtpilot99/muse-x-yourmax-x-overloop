import Link from "next/link";
import { connection } from "next/server";
import { config } from "@/lib/config";
import { getSettings } from "@/lib/settings";
import { ActionForm } from "@/components/ActionForm";
import { Card, inputClass } from "@/components/ui";
import { importIcpAction, saveSettingsAction, testConnectionsAction } from "../actions";

export default async function SettingsPage() {
  await connection();
  const s = getSettings();
  const field = (name: keyof typeof s, label: string, type = "text", hint?: string) => (
    <label className="block text-sm">
      <span className="text-xs text-muted">{label}</span>
      <input name={name} type={type} defaultValue={String(s[name])} className={`${inputClass} mt-1`} />
      {hint && <span className="mt-1 block text-xs text-muted">{hint}</span>}
    </label>
  );

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Settings</h1>

      <Card title="Connections">
        <p className="text-sm text-muted">
          Keys, Max business, Overloop campaign and the live-sending switch are on the <Link href="/setup" className="underline">Setup</Link> page.
        </p>
        <ActionForm action={testConnectionsAction} submit={[{ label: "Test all connections", tone: "neutral" }]} />
      </Card>

      {config.maxApiKey() && config.maxBusinessId() && (
        <Card title="Import from Max">
          <p className="mb-1 text-sm text-muted">Copy this business&apos;s description and ideal customer profile from Max into the fields below.</p>
          <ActionForm action={importIcpAction} submit={[{ label: "Import ICP from Max", tone: "neutral" }]} />
        </Card>
      )}

      <ActionForm action={saveSettingsAction} submit={[{ label: "Save settings" }]} className="space-y-4">
        <Card title="Who you sell to">
          <div className="space-y-3">
            <label className="block text-sm">
              <span className="text-xs text-muted">Ideal customer profile</span>
              <textarea name="icp" rows={4} defaultValue={s.icp} className={`${inputClass} mt-1`}
                placeholder="B2B SaaS, 50-500 employees, Europe/US. Buyers: Head of Sales, VP Revenue, RevOps. Not agencies." />
            </label>
            <label className="block text-sm">
              <span className="text-xs text-muted">What you offer</span>
              <textarea name="offer" rows={3} defaultValue={s.offer} className={`${inputClass} mt-1`}
                placeholder="What it does, for whom, and the one result customers care about." />
            </label>
            <div className="grid gap-3 md:grid-cols-2">
              {field("senderName", "Sender name")}
              {field("tone", "Writing tone")}
            </div>
          </div>
        </Card>

        <Card title="Qualification and sending">
          <div className="grid gap-3 md:grid-cols-3">
            {field("maxSignalAgeDays", "Ignore signals older than (days)", "number")}
            {field("minFitScore", "Minimum ICP fit (0-100)", "number")}
            {field("dailySendCap", "Max new emails per day", "number", "Keep low on new domains")}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-4">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="autoApprove" defaultChecked={s.autoApprove} /> Auto-approve strong leads
            </label>
            <div className="w-56">{field("autoApproveThreshold", "Auto-approve at score ≥", "number")}</div>
          </div>
        </Card>

        <Card title="Overloop custom fields">
          <p className="mb-3 text-sm text-muted">
            Create these custom prospect fields in Overloop and use them as merge tags in your campaign steps (see README).
          </p>
          <div className="grid gap-3 md:grid-cols-2">
            {field("fieldSubject", "Subject field")}
            {field("fieldBody", "Body field")}
            {field("fieldFollowup1", "Follow-up 1 field")}
            {field("fieldFollowup2", "Follow-up 2 field")}
          </div>
        </Card>
      </ActionForm>
    </div>
  );
}
