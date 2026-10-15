import { get } from "./db";

/** Sends left today (local server date) under the daily cap that protects sender reputation. */
export function remainingSendsToday(dailyCap: number): number {
  const row = get<{ n: number }>(
    "SELECT COUNT(*) AS n FROM leads WHERE sent_at IS NOT NULL AND date(sent_at, 'localtime') = date('now', 'localtime')",
  );
  return Math.max(0, dailyCap - (row?.n ?? 0));
}
