import Link from "next/link";
import { connection } from "next/server";
import type { ReactNode } from "react";
import { config } from "@/lib/config";
import { getSecret, mask, secretSource, type SecretName } from "@/lib/secrets";
import { listBusinesses, type MaxBusiness } from "@/lib/maxApi";
import { listCampaigns, type Campaign } from "@/lib/overloop";
import { getSettings } from "@/lib/settings";
import { ActionForm } from "@/components/ActionForm";
import { Card, inputClass } from "@/components/ui";
import {
  chooseBusinessAction, chooseCampaignAction, saveKeyAction, setLiveAction, testMaxAction, testMuseAction, testOverloopAction,
} from "./actions";

function KeyField({ name, label, help }: { name: SecretName; label: string; help: ReactNode }) {
  const source = secretSource(name);
  const current = process.env[name] || getSecret(name);
  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <span className="font-medium">{label}</span>
        <span className={source === "none" ? "text-amber-600 dark:text-amber-400" : "text-emerald-600 dark:text-emerald-400"}>
          {source === "none" ? "not connected" : `connected ${mask(current)}${source === "env" ? " (from .env.local)" : ""}`}
        </span>
      </div>
      <p className="mt-1 text-xs text-muted">{help}</p>
      {source !== "env" && (
        <ActionForm action={saveKeyAction} submit={[{ label: source === "app" ? "Replace" : "Save", tone: "neutral" }]}>
          <input type="hidden" name="name" value={name} />
          <input name="value" type="password" autoComplete="off" placeholder={source === "app" ? "Paste a new key, or leave empty to remove" : "Paste key"} className={`${inputClass} mt-2`} />
        </ActionForm>
      )}
    </div>
  );
}

function Step({ n, title, done, children }: { n: number; title: string; done: boolean; children: ReactNode }) {
  return (
    <Card title={`${n}. ${title}`} actions={<span className={done ? "text-emerald-600 dark:text-emerald-400 text-sm" : "text-muted text-sm"}>{done ? "✓ done" : "to do"}</span>}>
      <div className="space-y-4">{children}</div>
    </Card>
  );
}

export default async function SetupPage() {
  await connection();
  let businesses: MaxBusiness[] = [];
  let businessError = "";
  if (config.maxApiKey()) {
    try {
      businesses = await listBusinesses();
    } catch (e) {
      businessError = e instanceof Error ? e.message : String(e);
    }
  }
  let campaigns: Campaign[] = [];
  let campaignError = "";
  if (config.overloopApiKey()) {
    try {
      campaigns = await listCampaigns();
    } catch (e) {
      campaignError = e instanceof Error ? e.message : String(e);
    }
  }
  const s = getSettings();
  const fields = [s.fieldSubject, s.fieldBody, s.fieldFollowup1, s.fieldFollowup2];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Setup</h1>
        <p className="text-sm text-muted">
          Connect your own accounts. Keys are stored only on this computer (in <code>data/app.db</code>, never committed). Values in{" "}
          <code>.env.local</code> take precedence.
        </p>
      </div>

      <Step n={1} title="Muse Wonder (the AI)" done={!!config.museApiKey()}>
        <KeyField name="MODEL_API_KEY" label="Meta Model API key"
          help={<>Create one at <a className="underline" href="https://dev.meta.ai" target="_blank" rel="noreferrer">dev.meta.ai</a> → API keys. Model: <code>{config.museModel()}</code>.</>} />
        {config.museApiKey() && <ActionForm action={testMuseAction} submit={[{ label: "Test Muse Wonder", tone: "neutral" }]} />}
      </Step>

      <Step n={2} title="Max (where leads come from)" done={!!config.maxApiKey() && !!config.maxBusinessId()}>
        <KeyField name="MAX_API_KEY" label="Max API key"
          help={<>From your Max account (yourmax.ai). Optional if you only use the webhook or paste leads.</>} />
        {config.maxApiKey() && <ActionForm action={testMaxAction} submit={[{ label: "Test Max", tone: "neutral" }]} />}
        {businessError && <p className="text-sm text-red-600 dark:text-red-400">{businessError}</p>}
        {businesses.length > 0 && (
          <ActionForm action={chooseBusinessAction} submit={[{ label: "Use this business" }]}>
            <label className="block text-sm">
              <span className="text-xs text-muted">Business whose leads SignalPilot works on</span>
              <select name="business_id" defaultValue={config.maxBusinessId()} className={`${inputClass} mt-1`}>
                {businesses.map((b) => <option key={b.id} value={b.id}>{b.name} — {b.website}</option>)}
              </select>
            </label>
            <label className="mt-2 flex items-center gap-2 text-sm">
              <input type="checkbox" name="import_icp" defaultChecked={!s.icp} /> Import its ideal customer profile and description into Settings
            </label>
          </ActionForm>
        )}
        {config.maxBusinessId() && (
          <p className="text-sm">Next: add buying-signal monitors on the <Link className="underline" href="/monitors">Monitors</Link> page.</p>
        )}
        <details className="text-sm">
          <summary className="cursor-pointer text-muted">Prefer webhooks instead of pulling?</summary>
          <div className="mt-2 space-y-2">
            <KeyField name="MAX_WEBHOOK_SECRET" label="Max webhook secret" help="Any random string; use the same value as --secret when creating the webhook in Max." />
            <p className="text-xs text-muted">Webhook URL: <code>https://&lt;your-tunnel&gt;/api/webhooks/max</code> — see the README for tunnel setup.</p>
          </div>
        </details>
      </Step>

      <Step n={3} title="Overloop (how emails are sent)" done={!!config.overloopApiKey() && !!config.overloopCampaignId()}>
        <KeyField name="OVERLOOP_API_KEY" label="Overloop API key" help="Overloop → Settings → API. API access needs the Growth plan or higher." />
        {config.overloopApiKey() && <ActionForm action={testOverloopAction} submit={[{ label: "Test Overloop", tone: "neutral" }]} />}
        {campaignError && <p className="text-sm text-red-600 dark:text-red-400">{campaignError}</p>}
        <div className="rounded-md bg-subtle p-3 text-sm">
          <p className="font-medium">One-time setup inside Overloop</p>
          <ol className="mt-1 list-decimal space-y-1 pl-5">
            <li>Create four custom prospect fields: {fields.map((f) => <code key={f} className="mr-1">{f}</code>)} (change the names in Settings if Overloop assigns different ones).</li>
            <li>Create an email campaign: step 1 subject <code>{`{{${s.fieldSubject}}}`}</code> + body <code>{`{{${s.fieldBody}}}`}</code>; step 2 (day 3) <code>{`{{${s.fieldFollowup1}}}`}</code>; step 3 (day 7) <code>{`{{${s.fieldFollowup2}}}`}</code>; exit when the prospect replies.</li>
            <li>Pick that campaign below.</li>
          </ol>
        </div>
        {campaigns.length > 0 && (
          <ActionForm action={chooseCampaignAction} submit={[{ label: "Send through this campaign" }]}>
            <select name="campaign_id" defaultValue={config.overloopCampaignId()} className={inputClass}>
              <option value="">Choose a campaign…</option>
              {campaigns.map((c) => <option key={c.id} value={c.id}>{c.attributes.name} ({c.attributes.status})</option>)}
            </select>
          </ActionForm>
        )}
      </Step>

      <Step n={4} title="Tell it who you sell to" done={!!s.icp && !!s.offer}>
        <p className="text-sm">
          Describe your ideal customer and your offer on the <Link className="underline" href="/settings">Settings</Link> page (or import them from Max in step 2).
          Every qualification decision and email is based on these two fields.
        </p>
      </Step>

      <Step n={5} title="Go live (optional)" done={config.sendingEnabled()}>
        <p className="text-sm">
          While sending is off, SignalPilot still finds, checks, researches and drafts — you review everything, but nothing is created in Overloop and no
          email goes out. Turn it on only when your drafts look right.
        </p>
        {config.sendingEnabled() ? (
          <ActionForm action={setLiveAction} submit={[{ label: "Turn sending off", intent: "off", tone: "danger" }]} />
        ) : config.sendingForcedOff() ? (
          <p className="text-sm text-muted"><code>SP_SENDING_ENABLED=0</code> in .env.local keeps sending off.</p>
        ) : (
          <ActionForm action={setLiveAction} submit={[{ label: "Turn sending on", intent: "on", tone: "danger" }]}>
            <input name="confirm" placeholder="Type SEND to confirm" className={`${inputClass} max-w-xs`} />
          </ActionForm>
        )}
      </Step>
    </div>
  );
}
