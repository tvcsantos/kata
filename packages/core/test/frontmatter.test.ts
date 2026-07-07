import { describe, expect, it } from "vitest";
import { parseFrontmatter, stripFrontmatter } from "@katahq/core";

describe("parseFrontmatter", () => {
  it("parses a frontmatter block and returns the body", () => {
    const { data, body } = parseFrontmatter(
      "---\ndescription: Hi\nalwaysApply: true\n---\nBody text.\n",
    );
    expect(data).toEqual({ description: "Hi", alwaysApply: true });
    expect(body).toBe("Body text.\n");
  });

  it("returns null data when there is no frontmatter", () => {
    const { data, body } = parseFrontmatter("Just text.\n");
    expect(data).toBeNull();
    expect(body).toBe("Just text.\n");
  });

  it("treats invalid YAML as content, not frontmatter", () => {
    const raw = "---\n: not: valid: yaml:\n---\nBody.\n";
    const { data, body } = parseFrontmatter(raw);
    expect(data).toBeNull();
    expect(body).toBe(raw);
  });

  it("does not confuse a mid-file hr for frontmatter", () => {
    const raw = "Intro.\n\n---\n\nMore.\n";
    expect(stripFrontmatter(raw)).toBe(raw);
  });
});
