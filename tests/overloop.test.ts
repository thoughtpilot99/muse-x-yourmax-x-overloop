import { afterEach, describe, expect, it, vi } from "vitest";
import { enroll, OverloopError, upsertProspect } from "@/lib/overloop";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

afterEach(() => vi.unstubAllGlobals());

describe("overloop client", () => {
  it("creates a prospect when none exists, using JSON:API and the raw key", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(json({ data: [] }))
      .mockResolvedValueOnce(json({ data: { id: "7", type: "prospects", attributes: { email: "a@b.co" } } }, 201));
    vi.stubGlobal("fetch", fetchMock);

    const p = await upsertProspect({ email: "a@b.co", first_name: "A", c_sp_subject: "Hi" });
    expect(p.id).toBe("7");
    const [url, init] = fetchMock.mock.calls[1];
    expect(url).toBe("https://api.overloop.com/public/v1/prospects");
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toBe("test-overloop");
    expect(init.headers["Content-Type"]).toMatch(/application\/vnd\.api\+json/);
    expect(JSON.parse(init.body)).toEqual({ data: { type: "prospects", attributes: { email: "a@b.co", first_name: "A", c_sp_subject: "Hi" } } });
  });

  it("patches an existing prospect instead of duplicating it", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(json({ data: [{ id: "9", type: "prospects", attributes: { email: "a@b.co" } }] }))
      .mockResolvedValueOnce(json({ data: { id: "9", type: "prospects", attributes: { email: "a@b.co" } } }));
    vi.stubGlobal("fetch", fetchMock);
    await upsertProspect({ email: "a@b.co" });
    expect(fetchMock.mock.calls[1][0]).toMatch(/\/prospects\/9$/);
    expect(fetchMock.mock.calls[1][1].method).toBe("PATCH");
  });

  it("enrolls into the campaign without re-enrolling", async () => {
    const fetchMock = vi.fn().mockResolvedValue(json({ data: { id: "e1", type: "enrollments", attributes: {} } }, 201));
    vi.stubGlobal("fetch", fetchMock);
    await enroll("42", "7");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.overloop.com/public/v1/automations/42/enrollments");
    expect(JSON.parse(init.body)).toEqual({ data: { type: "enrollments", attributes: { prospect_id: 7, reenroll: false } } });
  });

  it("surfaces JSON:API error details", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => json({ errors: [{ detail: "email is invalid" }] }, 422)));
    await expect(enroll("42", "7")).rejects.toThrow(OverloopError);
    await expect(enroll("42", "7")).rejects.toThrow(/422: email is invalid/);
  });
});
