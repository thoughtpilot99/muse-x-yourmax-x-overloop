import { describe, expect, it } from "vitest";
import { z } from "zod";
import { costUsd, extractJson, toStrictJsonSchema } from "@/lib/muse";
import { isPrivateIp, normalizeDomain } from "@/lib/research";

describe("toStrictJsonSchema", () => {
  it("marks every object property required and closes objects", () => {
    const schema = toStrictJsonSchema(
      z.object({ a: z.string(), nested: z.array(z.object({ b: z.number(), c: z.string() })) }),
    ) as { required: string[]; additionalProperties: boolean; properties: { nested: { items: { required: string[]; additionalProperties: boolean } } } };
    expect(schema.required).toEqual(["a", "nested"]);
    expect(schema.additionalProperties).toBe(false);
    expect(schema.properties.nested.items.required).toEqual(["b", "c"]);
    expect(schema.properties.nested.items.additionalProperties).toBe(false);
  });
});

describe("extractJson", () => {
  it("parses plain, fenced and prose-wrapped JSON", () => {
    expect(extractJson('{"a":1}')).toEqual({ a: 1 });
    expect(extractJson('```json\n{"a":2}\n```')).toEqual({ a: 2 });
    expect(extractJson('Here you go: {"a":3} thanks')).toEqual({ a: 3 });
    expect(() => extractJson("no json")).toThrow();
  });
});

describe("costUsd", () => {
  it("prices input, cached input and output tokens", () => {
    // 1M fresh input = $4, 1M output = $20, 1M cached = $0.20
    expect(costUsd({ prompt_tokens: 1_000_000, completion_tokens: 0 })).toBeCloseTo(4);
    expect(costUsd({ prompt_tokens: 0, completion_tokens: 1_000_000 })).toBeCloseTo(20);
    expect(costUsd({ prompt_tokens: 1_000_000, cached: 1_000_000 })).toBeCloseTo(0.2);
  });
});

describe("research guards", () => {
  it("detects private and loopback addresses", () => {
    for (const ip of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "192.168.1.1", "169.254.169.254", "::1", "fd00::1", "::ffff:10.0.0.1"]) {
      expect(isPrivateIp(ip), ip).toBe(true);
    }
    for (const ip of ["8.8.8.8", "172.32.0.1", "2606:4700::1111"]) expect(isPrivateIp(ip), ip).toBe(false);
  });

  it("normalizes domains from URLs and bare hosts", () => {
    expect(normalizeDomain("https://www.Acme.com/about?x=1")).toBe("acme.com");
    expect(normalizeDomain("beta.io")).toBe("beta.io");
    expect(normalizeDomain("")).toBeNull();
    expect(normalizeDomain(null)).toBeNull();
  });
});
