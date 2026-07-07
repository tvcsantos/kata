import { describe, expect, it } from "vitest";
import {
  REGION_BEGIN,
  REGION_END,
  deepMerge,
  mergeJsonFragment,
  mergeManagedRegion,
  mergeTomlFragment,
  resolveContent,
} from "@katahq/core";

describe("resolveContent with binary content", () => {
  it("passes a Buffer through replace untouched (no newline normalization)", () => {
    const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff]);
    const out = resolveContent(
      { relativePath: "logo.png", content: bytes, strategy: { kind: "replace" } },
      null,
    );
    expect(out).toBe(bytes);
  });

  it("rejects a Buffer for merge strategies", () => {
    expect(() =>
      resolveContent(
        { relativePath: "x.json", content: Buffer.from([0x00]), strategy: { kind: "json-merge" } },
        null,
      ),
    ).toThrow(/requires the "replace" strategy/);
  });

  it("refuses to merge into an existing binary file", () => {
    expect(() =>
      resolveContent(
        { relativePath: "x.json", content: "{}", strategy: { kind: "json-merge" } },
        Buffer.from([0x00, 0xff]),
      ),
    ).toThrow(/binary/);
  });
});

describe("mergeManagedRegion", () => {
  it("creates a fresh file with only the managed region", () => {
    const out = mergeManagedRegion(null, "Use tabs.");
    expect(out).toContain(REGION_BEGIN);
    expect(out).toContain("Use tabs.");
    expect(out).toContain(REGION_END);
    expect(out.endsWith("\n")).toBe(true);
  });

  it("appends the region to an existing file, preserving user content", () => {
    const existing = "# My notes\n\nHand-written stuff.\n";
    const out = mergeManagedRegion(existing, "Use tabs.");
    expect(out.startsWith("# My notes")).toBe(true);
    expect(out).toContain("Hand-written stuff.");
    expect(out.indexOf(REGION_BEGIN)).toBeGreaterThan(out.indexOf("Hand-written stuff."));
  });

  it("replaces an existing region in place, keeping content around it", () => {
    const first = mergeManagedRegion("# Title\n\nintro\n", "old body");
    const withTrailer = first + "\nuser trailer\n";
    const out = mergeManagedRegion(withTrailer, "new body");
    expect(out).toContain("# Title");
    expect(out).toContain("user trailer");
    expect(out).toContain("new body");
    expect(out).not.toContain("old body");
    // Still exactly one region.
    expect(out.split(REGION_BEGIN).length).toBe(2);
  });

  it("is idempotent", () => {
    const once = mergeManagedRegion("# Title\n", "body");
    const twice = mergeManagedRegion(once, "body");
    expect(twice).toBe(once);
  });
});

describe("deepMerge / mergeJsonFragment", () => {
  it("preserves unknown keys and overrides ours", () => {
    const existing = JSON.stringify({
      mcpServers: {
        theirs: { command: "keep-me" },
        shared: { command: "old", extra: true },
      },
      otherTopLevel: 1,
    });
    const fragment = JSON.stringify({
      mcpServers: { shared: { command: "new" }, added: { command: "x" } },
    });
    const out = JSON.parse(mergeJsonFragment(existing, fragment));
    expect(out.otherTopLevel).toBe(1);
    expect(out.mcpServers.theirs.command).toBe("keep-me");
    expect(out.mcpServers.shared.command).toBe("new");
    expect(out.mcpServers.shared.extra).toBe(true);
    expect(out.mcpServers.added.command).toBe("x");
  });

  it("replaces arrays instead of concatenating", () => {
    expect(deepMerge({ a: [1, 2] }, { a: [3] })).toEqual({ a: [3] });
  });

  it("throws a clear error on invalid existing JSON", () => {
    expect(() => mergeJsonFragment("{not json", "{}")).toThrow(/invalid JSON/i);
  });
});

describe("mergeTomlFragment", () => {
  it("merges mcp_servers tables, preserving foreign keys", () => {
    const existing = [
      'model = "gpt-5.3-codex"',
      "",
      "[mcp_servers.theirs]",
      'command = "keep-me"',
    ].join("\n");
    const fragment = JSON.stringify({
      mcp_servers: { github: { command: "npx", args: ["-y", "server-github"] } },
    });
    const out = mergeTomlFragment(existing, fragment);
    expect(out).toContain('model = "gpt-5.3-codex"');
    expect(out).toContain("[mcp_servers.theirs]");
    expect(out).toContain('command = "keep-me"');
    expect(out).toContain("[mcp_servers.github]");
    expect(out).toContain('command = "npx"');
  });

  it("creates a fresh TOML file from the fragment", () => {
    const out = mergeTomlFragment(null, JSON.stringify({ mcp_servers: { a: { command: "x" } } }));
    expect(out).toContain("[mcp_servers.a]");
    expect(out.endsWith("\n")).toBe(true);
  });

  it("throws a clear error on invalid existing TOML", () => {
    expect(() => mergeTomlFragment("= broken", "{}")).toThrow(/invalid TOML/i);
  });
});
