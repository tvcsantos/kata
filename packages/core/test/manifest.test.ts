import { describe, expect, it } from "vitest";
import {
  deriveRequiredEnv,
  validateManifest,
  MANIFEST_DESCRIPTION_MAX_LENGTH,
  type McpServer,
} from "@katahq/core";

describe("validateManifest", () => {
  it("accepts a minimal manifest with no warnings", () => {
    const result = validateManifest({ name: "team-standards" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.manifest.name).toBe("team-standards");
    expect(result.warnings).toEqual([]);
  });

  it("accepts the full discovery-field schema", () => {
    const result = validateManifest({
      name: "backend-essentials",
      version: "1.4.0",
      description: "Test-first instructions, PR conventions, and MCP servers.",
      personas: ["backend", "devops"],
      tags: ["testing", "code-review", "postgres"],
      targets: ["claude-code", "cursor"],
      homepage: "https://github.com/acme/agent-standards",
      license: "MIT",
      icon: "./icon.png",
      authors: [{ name: "Jane Doe", url: "https://github.com/janedoe" }],
      requires: { env: ["GITHUB_TOKEN"], tools: ["npx"] },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.warnings).toEqual([]);
    expect(result.manifest.personas).toEqual(["backend", "devops"]);
    expect(result.manifest.requires?.env).toEqual(["GITHUB_TOKEN"]);
  });

  it("rejects a manifest without a name", () => {
    const result = validateManifest({ description: "nameless" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((issue) => issue.path === "name")).toBe(true);
  });

  it("rejects malformed discovery fields with paths into the manifest", () => {
    const result = validateManifest({
      name: "bad-fields",
      personas: ["Backend Dev"],
      homepage: "not a url",
      requires: { env: ["1BAD"] },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const paths = result.errors.map((issue) => issue.path);
    expect(paths).toContain("personas[0]");
    expect(paths).toContain("homepage");
    expect(paths).toContain("requires.env[0]");
  });

  it("warns on a non-kebab-case name without rejecting", () => {
    const result = validateManifest({ name: "Team_Standards" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.warnings.map((issue) => issue.path)).toEqual(["name"]);
  });

  it("warns on a non-semver version and an over-long description", () => {
    const result = validateManifest({
      name: "chatty",
      version: "v2",
      description: "x".repeat(MANIFEST_DESCRIPTION_MAX_LENGTH + 1),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.warnings.map((issue) => issue.path).sort()).toEqual(["description", "version"]);
  });

  it("accepts semver with prerelease and build metadata", () => {
    const result = validateManifest({ name: "pre", version: "2.0.0-rc.1+build.5" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.warnings).toEqual([]);
  });

  it("warns on unknown persona and target slugs when given canonical lists", () => {
    const result = validateManifest(
      { name: "drifty", personas: ["backend", "wizard"], targets: ["claude-code", "notepad"] },
      { knownPersonas: ["backend"], knownTargets: ["claude-code"] },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.warnings.map((issue) => issue.path).sort()).toEqual([
      "personas[1]",
      "targets[1]",
    ]);
  });
});

describe("deriveRequiredEnv", () => {
  const stdioServer = (overrides: Partial<McpServer>): McpServer => ({
    transport: "stdio",
    command: "npx",
    args: [],
    env: {},
    url: undefined,
    headers: {},
    scope: "project",
    ...overrides,
  });

  it("collects env refs from env values, args, urls, and headers, sorted and deduped", () => {
    const servers: Record<string, McpServer> = {
      github: stdioServer({
        args: ["--token", "${env:GITHUB_TOKEN}"],
        env: { TOKEN: "${env:GITHUB_TOKEN}", HOST: "${env:API_HOST}" },
      }),
      remote: stdioServer({
        transport: "http",
        command: undefined,
        url: "https://api.example.com/${env:TENANT}",
        headers: { Authorization: "Bearer ${env:API_KEY}" },
      }),
    };
    expect(deriveRequiredEnv(servers)).toEqual(["API_HOST", "API_KEY", "GITHUB_TOKEN", "TENANT"]);
  });

  it("returns an empty list when servers reference no env vars", () => {
    expect(deriveRequiredEnv({ plain: stdioServer({}) })).toEqual([]);
  });
});
