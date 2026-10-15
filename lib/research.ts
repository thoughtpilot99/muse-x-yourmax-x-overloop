import * as cheerio from "cheerio";
import dns from "node:dns/promises";
import net from "node:net";

// Lead domains arrive from a public webhook, so only fetch public hosts
// (never localhost or private ranges) to avoid server-side request forgery.
export function isPrivateIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    return (
      a === 10 || a === 127 || a === 0 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127)
    );
  }
  const v6 = ip.toLowerCase();
  return v6 === "::1" || v6 === "::" || v6.startsWith("fc") || v6.startsWith("fd") || v6.startsWith("fe80") ||
    (v6.startsWith("::ffff:") && isPrivateIp(v6.slice(7)));
}

async function assertPublicUrl(url: URL) {
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("Only http(s) URLs are fetched");
  const addrs = await dns.lookup(url.hostname, { all: true });
  if (!addrs.length || addrs.some((a) => isPrivateIp(a.address))) {
    throw new Error(`Refusing to fetch non-public host ${url.hostname}`);
  }
}

export function normalizeDomain(input: string | null | undefined): string | null {
  if (!input) return null;
  const s = input.trim().toLowerCase();
  if (!s) return null;
  try {
    return new URL(s.includes("://") ? s : `https://${s}`).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

export type PageText = { url: string; title: string; text: string };

async function fetchPage(url: URL, hops = 0): Promise<PageText & { links: string[] }> {
  if (hops > 4) throw new Error(`Too many redirects from ${url}`);
  await assertPublicUrl(url);
  const res = await fetch(url, {
    redirect: "manual",
    signal: AbortSignal.timeout(10_000),
    headers: { "User-Agent": "SignalPilot research bot" },
  });
  if (res.status >= 300 && res.status < 400) {
    const loc = res.headers.get("location");
    if (!loc) throw new Error(`Redirect without location from ${url}`);
    return fetchPage(new URL(loc, url), hops + 1); // re-checked by assertPublicUrl
  }
  if (!res.ok) throw new Error(`${url} returned ${res.status}`);
  const html = (await res.text()).slice(0, 2_000_000);
  const $ = cheerio.load(html);
  const links = $("a[href]")
    .map((_, a) => $(a).attr("href") ?? "")
    .get();
  $("script, style, noscript, svg, nav, footer, iframe").remove();
  const title = $("title").first().text().trim();
  const description = $('meta[name="description"]').attr("content")?.trim() ?? "";
  const text = [description, $("body").text()].join("\n").replace(/\s+/g, " ").trim();
  return { url: url.toString(), title, text: text.slice(0, 12_000), links };
}

const INTERESTING = /(about|news|press|blog|careers|jobs|customers|pricing)/i;

/** Homepage plus up to two "about/news/careers"-type pages from the same site. */
export async function fetchCompanySite(domain: string): Promise<PageText[]> {
  const home = await fetchPage(new URL(`https://${domain}`));
  const pages: PageText[] = [{ url: home.url, title: home.title, text: home.text }];
  const extra = new Set<string>();
  for (const href of home.links) {
    try {
      const u = new URL(href, home.url);
      if (u.hostname.replace(/^www\./, "") !== domain || !INTERESTING.test(u.pathname)) continue;
      u.hash = "";
      extra.add(u.toString());
    } catch {
      /* ignore malformed links */
    }
    if (extra.size >= 2) break;
  }
  for (const link of extra) {
    try {
      const p = await fetchPage(new URL(link));
      pages.push({ url: p.url, title: p.title, text: p.text.slice(0, 6_000) });
    } catch {
      /* a missing subpage should not fail the lead */
    }
  }
  return pages;
}
