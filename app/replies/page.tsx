import Link from "next/link";
import { connection } from "next/server";
import { all, type Lead } from "@/lib/db";
import { ActionForm } from "@/components/ActionForm";
import { Badge } from "@/components/ui";
import { pollRepliesAction } from "../actions";

export default async function RepliesPage() {
  await connection();
  const leads = all<Lead>("SELECT * FROM leads WHERE status = 'replied' ORDER BY replied_at DESC LIMIT 300");
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Replies</h1>
          <p className="text-sm text-muted">Overloop stops the sequence automatically when someone replies.</p>
        </div>
        <ActionForm action={pollRepliesAction} submit={[{ label: "Check for replies" }]} />
      </div>
      <ul className="divide-y divide-line rounded-lg border border-line bg-panel">
        {leads.map((l) => (
          <li key={l.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
            <div>
              <Link href={`/leads/${l.id}`} className="font-medium hover:underline">
                {[l.first_name, l.last_name].filter(Boolean).join(" ") || l.email}
              </Link>
              <div className="text-xs text-muted">{l.company} · replied {l.replied_at?.slice(0, 10)}</div>
            </div>
            {l.reply_category ? <Badge status={l.reply_category} /> : <span className="text-xs text-muted">not classified yet</span>}
          </li>
        ))}
        {!leads.length && <li className="px-4 py-8 text-center text-sm text-muted">No replies yet.</li>}
      </ul>
    </div>
  );
}
