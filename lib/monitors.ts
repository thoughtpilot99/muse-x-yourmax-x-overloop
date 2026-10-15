// Intent-signal monitor presets for Max. Each preset fixes the signal type and
// sensible limits; you supply the keywords or competitor pages for your market.
// Config fields follow each signal's input_schema from GET /api/v1/signals/{slug}.

export type Preset = {
  id: string;
  signal_slug: string;
  name: string;
  why: string;
  // Which editable field the form shows (one list per preset), if any.
  listField?: "keywords" | "linkedin_company_urls";
  listLabel?: string;
  // Example shown as a placeholder only; never submitted unless typed in.
  listExample?: string;
  defaults: Record<string, unknown>;
};

export const PRESETS: Preset[] = [
  {
    id: "buyer-posts",
    signal_slug: "social-mentions",
    name: "Buyer posts",
    why: "People posting on LinkedIn that they are looking for what you sell: the clearest buying intent.",
    listField: "keywords",
    listLabel: "Phrases a buyer would post (one per line)",
    listExample: "looking for a payroll provider\nrecommend a payroll software\nswitching payroll provider",
    defaults: { posted_limit: "P1W", max_posts: 10, engagement_types: ["poster"] },
  },
  {
    id: "new-leaders",
    signal_slug: "job-changes",
    name: "New leaders (job changes)",
    why: "People who just started a role matching your ICP titles; new leaders often review vendors in their first 90 days.",
    defaults: {},
  },
  {
    id: "competitor-audience",
    signal_slug: "competitor-social-reactions",
    name: "Competitor audience",
    why: "Posts your competitors' go-to-market teams engage with, and the people behind them.",
    listField: "linkedin_company_urls",
    listLabel: "Competitor LinkedIn company pages (one per line)",
    listExample: "https://www.linkedin.com/company/competitor-one/\nhttps://www.linkedin.com/company/competitor-two/",
    defaults: { posted_limit: "P1W", max_posts: 5, engagement_types: ["poster"] },
  },
  {
    id: "public-tenders",
    signal_slug: "public-tenders",
    name: "Public tenders",
    why: "Public bodies publishing tenders that match your keywords; captures the buyer contact.",
    listField: "keywords",
    listLabel: "Tender keywords (one per line)",
    listExample: "payroll services\nHR software",
    defaults: {},
  },
];

/** Merge the edited list (textarea, one item per line) into the preset's config. */
export function presetConfig(preset: Preset, listText: string | null): Record<string, unknown> {
  const cfg = { ...preset.defaults };
  if (preset.listField && listText !== null) {
    const items = listText.split(/\r?\n/).map((s) => s.trim()).filter(Boolean).slice(0, 25);
    if (!items.length) throw new Error(`${preset.listLabel ?? "List"} needs at least one entry`);
    if (preset.listField === "linkedin_company_urls" && items.some((u) => !/^https:\/\/(www\.)?linkedin\.com\/company\//i.test(u))) {
      throw new Error("Company pages must look like https://www.linkedin.com/company/<name>/");
    }
    cfg[preset.listField] = items;
  }
  return cfg;
}
