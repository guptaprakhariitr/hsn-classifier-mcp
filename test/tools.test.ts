import { describe, it, expect } from "vitest";
import { lookupHsn, searchHsn, classifyProduct, DATASET_STATS } from "../src/upstream";

describe("dataset", () => {
  it("has thousands of HSN entries loaded", () => {
    expect(DATASET_STATS.count).toBeGreaterThan(1000);
  });
});

describe("lookupHsn", () => {
  it("looks up a 4-digit code", () => {
    const r = lookupHsn("0101");
    expect(r.code).toBe("0101");
    expect(r.description.toLowerCase()).toContain("horse");
  });

  it("strips non-digit characters", () => {
    const r = lookupHsn("01.01");
    expect(r.code).toBe("0101");
  });

  it("truncates 8-digit to 6-digit when no exact match", () => {
    // 010110 should resolve to either a 6-digit subheading or fall back to 0101.
    const r = lookupHsn("01011010");
    expect(["010110", "0101"]).toContain(r.code);
  });

  it("throws on garbage input", () => {
    expect(() => lookupHsn("9999")).toThrow();
    expect(() => lookupHsn("")).toThrow();
  });
});

describe("searchHsn", () => {
  it("finds entries by keyword", () => {
    const r = searchHsn("rice", 5);
    expect(r.matches.length).toBeGreaterThan(0);
    expect(r.matches.some((m) => m.description.toLowerCase().includes("rice"))).toBe(true);
  });

  it("respects the limit param", () => {
    const r = searchHsn("oil", 3);
    expect(r.matches.length).toBeLessThanOrEqual(3);
  });

  it("returns empty matches for nonsense input", () => {
    const r = searchHsn("zzzqqq_no_such_keyword_xyzzy");
    expect(r.matches.length).toBe(0);
    expect(r.total).toBe(0);
  });

  it("handles empty query", () => {
    const r = searchHsn("");
    expect(r.matches.length).toBe(0);
  });
});

describe("classifyProduct", () => {
  it("classifies a plain product name", () => {
    const r = classifyProduct("basmati rice");
    expect(r.best).not.toBeNull();
    expect(r.matched_tokens.length).toBeGreaterThan(0);
  });

  it("returns null best when nothing matches", () => {
    const r = classifyProduct("zzzqqq_no_such_keyword_xyzzy");
    expect(r.best).toBeNull();
    expect(r.alternatives).toEqual([]);
  });

  it("returns alternatives when there are multiple matches", () => {
    const r = classifyProduct("cotton fabric");
    expect(r.best).not.toBeNull();
    // Should have some alternatives unless dataset is tiny.
    expect(r.alternatives.length).toBeGreaterThan(0);
  });
});
