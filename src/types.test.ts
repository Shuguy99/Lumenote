import { describe, expect, it } from "vitest";
import { parseAnchor } from "./types";

describe("parseAnchor", () => {
  it("parses a valid anchor JSON", () => {
    const a = parseAnchor('{"offset":10,"length":5,"text":"hello"}');
    expect(a).toEqual({ offset: 10, length: 5, text: "hello" });
  });

  it("returns null for null/empty input", () => {
    expect(parseAnchor(null)).toBeNull();
    expect(parseAnchor("")).toBeNull();
  });

  it("returns null for malformed JSON", () => {
    expect(parseAnchor("not json")).toBeNull();
  });

  it("returns null for structurally invalid anchors", () => {
    expect(parseAnchor('{"offset":"x","length":5,"text":"y"}')).toBeNull();
    expect(parseAnchor('{"offset":1}')).toBeNull();
  });
});