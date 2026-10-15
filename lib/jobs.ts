import { config, missingKeys, MissingKeysError } from "./config";
import { logEvent } from "./db";
import { pollReplies, processNewLeads, pullFromMax, sendApproved } from "./pipeline";

type Job = { name: string; everyMs: number; fn: () => Promise<unknown> };

const JOBS: Job[] = [
  { name: "pull_from_max", everyMs: 30 * 60_000, fn: () => pullFromMax() },
  { name: "process_new_leads", everyMs: 60_000, fn: () => processNewLeads() },
  { name: "send_approved", everyMs: 5 * 60_000, fn: () => sendApproved() },
  { name: "poll_replies", everyMs: 15 * 60_000, fn: () => pollReplies() },
];

const g = globalThis as unknown as { __spJobs?: boolean; __spRunning?: Set<string> };

async function tick(job: Job) {
  const running = (g.__spRunning ??= new Set());
  if (running.has(job.name) || missingKeys().length) return;
  running.add(job.name);
  try {
    await job.fn();
  } catch (e) {
    // A job whose integration isn't configured (e.g. sending switched off) just skips.
    if (!(e instanceof MissingKeysError)) {
      logEvent({ source: "jobs", kind: job.name, ok: false, note: e instanceof Error ? e.message : String(e) });
    }
  } finally {
    running.delete(job.name);
  }
}

export function startJobs() {
  if (g.__spJobs || !config.jobsEnabled()) return;
  g.__spJobs = true;
  for (const job of JOBS) setInterval(() => void tick(job), job.everyMs).unref?.();
}
