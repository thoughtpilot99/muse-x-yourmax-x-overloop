import crypto from "node:crypto";
import { describe, expect, it } from "vitest";
import { companyContext, normalizeLead, splitPayload, verifySignature } from "@/lib/max";

describe("splitPayload", () => {
  it("handles arrays, {leads}, {data} and single objects", () => {
    expect(splitPayload([{ a: 1 }, { b: 2 }])).toHaveLength(2);
    expect(splitPayload({ leads: [{ a: 1 }] })).toHaveLength(1);
    expect(splitPayload({ data: [{ a: 1 }, { a: 2 }, { a: 3 }] })).toHaveLength(3);
    expect(splitPayload({ id: "x" })).toEqual([{ id: "x" }]);
    expect(splitPayload("nope")).toEqual([]);
  });
});

describe("normalizeLead", () => {
  it("reads a nested {lead, company, signal} shape", () => {
    const l = normalizeLead({
      id: "abc",
      lead: { firstName: "Ana", lastName: "Silva", email: "ANA@Acme.com", jobTitle: "VP Sales", linkedinUrl: "https://linkedin.com/in/ana" },
      company: { name: "Acme", website: "https://www.acme.com/about" },
      signal: { type: "job_posting", description: "Hiring 3 SDRs", detected_at: "2026-10-10" },
    });
    expect(l).toMatchObject({
      external_id: "max:abc",
      first_name: "Ana",
      last_name: "Silva",
      email: "ana@acme.com",
      title: "VP Sales",
      company: "Acme",
      domain: "acme.com",
      signal_type: "job_posting",
      signal_detail: "Hiring 3 SDRs",
      signal_at: "2026-10-10",
    });
  });

  it("reads a flat shape and splits full names", () => {
    const l = normalizeLead({ name: "Jo Van Dam", company: "Beta", company_domain: "beta.io", signal_type: "funding" });
    expect(l.first_name).toBe("Jo");
    expect(l.last_name).toBe("Van Dam");
    expect(l.domain).toBe("beta.io");
    expect(l.signal_type).toBe("funding");
    expect(l.external_id).toMatch(/^max:[0-9a-f]{24}$/);
  });

  it("reads the Max API lead shape", () => {
    const l = normalizeLead({
      id: 1001, name: "Jordan Example", job_title: "Digital Media Manager", email: null,
      linkedin_url: "https://www.linkedin.com/in/jordan-example", location: "United States",
      company: "Example Media", company_website: "https://example-media.test",
      signals: [{ name: "ICP Matches", slug: "atlas-icp" }], triggered_at: "2026-10-14T18:00:20Z",
      payload: { engagement_context: "Matched your ICP: Digital Media Manager at Example Media.", company_summary: "Direct response agency." },
    });
    expect(l).toMatchObject({
      external_id: "max:1001", first_name: "Jordan", last_name: "Example", email: null,
      title: "Digital Media Manager", company: "Example Media", domain: "example-media.test",
      signal_type: "ICP Matches", signal_detail: "Matched your ICP: Digital Media Manager at Example Media.",
      signal_at: "2026-10-14T18:00:20Z",
    });
    expect(companyContext(l.raw)).toContain("Direct response agency.");
  });

  it("is deterministic for the same payload without id", () => {
    const item = { name: "A B", linkedin: "x", signal_type: "s" };
    expect(normalizeLead(item).external_id).toBe(normalizeLead(item).external_id);
  });
});

describe("verifySignature", () => {
  const body = '{"id":"1"}';
  const sig = crypto.createHmac("sha256", "s3cret").update(body).digest("hex");

  it("accepts a valid hex signature with or without sha256= prefix", () => {
    expect(verifySignature(body, new Headers({ "x-max-signature": sig }), "s3cret")).toBe(true);
    expect(verifySignature(body, new Headers({ "x-hub-signature-256": `sha256=${sig}` }), "s3cret")).toBe(true);
  });

  it("rejects wrong secrets, tampered bodies and missing headers", () => {
    expect(verifySignature(body, new Headers({ "x-max-signature": sig }), "other")).toBe(false);
    expect(verifySignature('{"id":"2"}', new Headers({ "x-max-signature": sig }), "s3cret")).toBe(false);
    expect(verifySignature(body, new Headers(), "s3cret")).toBe(false);
  });
});
