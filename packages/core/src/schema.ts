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

/** Manifest file every shareable package must carry: `kata-package.yaml`. */
export const packageManifestSchema = z.object({
  name: z.string().min(1),
  version: z.string().optional(),
  description: z.string().optional(),
});

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
