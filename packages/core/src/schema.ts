import { z } from "zod";

export const CONFIG_SCHEMA_VERSION = 1;
export const MCP_SERVERS_SCHEMA_VERSION = 1;

/**
 * Kata schema (version 1): `config.yaml`, `mcp/servers.yaml`, and the
 * `kata-package.yaml` package manifest. Everything read from `.kata/` is
 * validated against these schemas.
 */

export const targetConfigSchema = z.object({
  enabled: z.boolean().default(true),
  /** Per-target options bag; adapters interpret their own keys. */
  options: z.record(z.string(), z.unknown()).default({}),
});

export const configSchema = z.object({
  version: z.literal(CONFIG_SCHEMA_VERSION),
  targets: z.record(z.string(), targetConfigSchema).default({}),
  /**
   * Shared config packages to compose, in order. Later entries override
   * earlier ones; local project artifacts override all packages.
   * Refs: `./local/path` (relative to project root) or `npm:<package-name>`.
   */
  compose: z.array(z.string()).default([]),
});

/** Lowercase kebab-case, the format for registry names, personas, and tags. */
const slugSchema = z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "must be lowercase kebab-case");

const envVarNameSchema = z
  .string()
  .regex(/^[A-Za-z_][A-Za-z0-9_]*$/, "must be a valid env var name");

export const packageAuthorSchema = z.object({
  name: z.string().min(1),
  url: z.url().optional(),
});

/**
 * Requirements surfaced to users before install. `env` is derivable by
 * scanning `${env:VAR}` references in `mcp/servers.yaml`; the explicit
 * field lets authors document vars kata cannot see.
 */
export const packageRequiresSchema = z.object({
  env: z.array(envVarNameSchema).default([]),
  /** Binaries the package's MCP servers execute (e.g. "npx"). */
  tools: z.array(z.string().min(1)).default([]),
});

/**
 * Manifest file every shareable package must carry: `kata-package.yaml`.
 * Only `name` is required; the discovery fields exist so registries and
 * marketplace UIs can present the package - packages without them still
 * install fine.
 */
export const packageManifestSchema = z.object({
  name: z.string().min(1),
  version: z.string().optional(),
  description: z.string().optional(),
  /** Persona slugs this package is curated for (open set; see registry). */
  personas: z.array(slugSchema).optional(),
  tags: z.array(slugSchema).optional(),
  /**
   * Harnesses this package is intended for (informational - kata compiles
   * for whatever the project enables); used for marketplace filtering.
   */
  targets: z.array(z.string().min(1)).optional(),
  homepage: z.url().optional(),
  license: z.string().min(1).optional(),
  /** Path to a square icon (<= 128px), relative to the package root. */
  icon: z.string().min(1).optional(),
  authors: z.array(packageAuthorSchema).optional(),
  requires: packageRequiresSchema.optional(),
});

export type PackageAuthor = z.infer<typeof packageAuthorSchema>;
export type PackageRequires = z.infer<typeof packageRequiresSchema>;
export type PackageManifest = z.infer<typeof packageManifestSchema>;

export type TargetConfig = z.infer<typeof targetConfigSchema>;
export type KataConfig = z.infer<typeof configSchema>;

const envValueSchema = z.string();

export const mcpServerSchema = z
  .object({
    transport: z.enum(["stdio", "http", "sse"]).default("stdio"),
    /** stdio transport */
    command: z.string().optional(),
    args: z.array(z.string()).default([]),
    /** Values may contain `${env:VAR}` references; never inline secrets. */
    env: z.record(z.string(), envValueSchema).default({}),
    /** http / sse transports */
    url: z.string().optional(),
    headers: z.record(z.string(), envValueSchema).default({}),
    scope: z.enum(["project", "global"]).default("project"),
  })
  .check((ctx) => {
    const server = ctx.value;
    if (server.transport === "stdio" && !server.command) {
      ctx.issues.push({
        code: "custom",
        message: 'transport "stdio" requires "command"',
        input: server,
      });
    }
    if ((server.transport === "http" || server.transport === "sse") && !server.url) {
      ctx.issues.push({
        code: "custom",
        message: `transport "${server.transport}" requires "url"`,
        input: server,
      });
    }
  });

export const mcpServersFileSchema = z.object({
  version: z.literal(MCP_SERVERS_SCHEMA_VERSION).default(MCP_SERVERS_SCHEMA_VERSION),
  servers: z.record(z.string(), mcpServerSchema).default({}),
});

export type McpServer = z.infer<typeof mcpServerSchema>;
export type McpServersFile = z.infer<typeof mcpServersFileSchema>;
