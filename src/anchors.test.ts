import { describe, expect, it } from "vitest";
import { escapeRegExp, findTextOffset } from "./anchors";

describe("escapeRegExp", () => {
  it("escapes regex metacharacters", () => {
    expect(escapeRegExp("a.b")).toBe("a\\.b");
    expect(escapeRegExp("(x)[y]{z}")).toBe("\\(x\\)\\[y\\]\\{z\\}");
    expect(escapeRegExp("plain")).toBe("plain");
  });
});

describe("findTextOffset", () => {
  it("finds exact match", () => {
    const content = "The quick brown fox jumps over the lazy dog.";
    expect(findTextOffset(content, "quick")).toBe(4);
  });

  it("returns -1 when needle is empty", () => {
    expect(findTextOffset("abc", "")).toBe(-1);
  });

  it("finds case-insensitive match with collapsed whitespace", () => {
    const content = "alpha  beta\n gamma";
    expect(findTextOffset(content, "alpha   beta gamma".trim())).toBeGreaterThanOrEqual(0);
  });

  it("returns -1 when not found", () => {
    expect(findTextOffset("abc", "xyz")).toBe(-1);
  });
});