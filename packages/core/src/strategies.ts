import { parse as parseToml, stringify as stringifyToml } from "smol-toml";
import type { EmittedFile } from "./adapter.js";

export const REGION_BEGIN = "<!-- kata:begin -->";
export const REGION_END = "<!-- kata:end -->";
const REGION_NOTICE =
  "<!-- Managed by kata. Edits inside this block will be overwritten on `kata apply`. -->";

function renderRegion(body: string): string {
  return `${REGION_BEGIN}\n${REGION_NOTICE}\n\n${body.trim()}\n${REGION_END}`;
}

/**
 * Merge a managed region into an existing markdown file. Replaces the current
 * region if present, otherwise appends it, preserving all user content.
 */
export function mergeManagedRegion(existing: string | null, body: string): string {
  const region = renderRegion(body);
  if (existing === null || existing.trim() === "") return region + "\n";

  const beginIdx = existing.indexOf(REGION_BEGIN);
  const endIdx = existing.indexOf(REGION_END);
  if (beginIdx !== -1 && endIdx !== -1 && endIdx > beginIdx) {
    const before = existing.slice(0, beginIdx);
    const after = existing.slice(endIdx + REGION_END.length);
    return before + region + after;
  }
  const sep = existing.endsWith("\n") ? "\n" : "\n\n";
  return existing + sep + region + "\n";
}

/** Strip the kata-managed region, returning only the user's own content. */
export function removeManagedRegion(content: string): string {
  const beginIdx = content.indexOf(REGION_BEGIN);
  const endIdx = content.indexOf(REGION_END);
  if (beginIdx === -1 || endIdx === -1 || endIdx < beginIdx) return content;
  const before = content.slice(0, beginIdx);
  const after = content.slice(endIdx + REGION_END.length);
  const joined = (before.trimEnd() + "\n\n" + after.trimStart()).trim();
  return joined === "" ? "" : joined + "\n";
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Deep-merge `fragment` over `existing`: our keys win (arrays and scalars are
 * replaced, objects merge recursively), unknown keys are preserved.
 */
export function deepMerge(existing: unknown, fragment: unknown): unknown {
  if (isPlainObject(existing) && isPlainObject(fragment)) {
    const result: Record<string, unknown> = { ...existing };
    for (const [key, value] of Object.entries(fragment)) {
      result[key] = key in existing ? deepMerge(existing[key], value) : value;
    }
    return result;
  }
  return fragment;
}

export function stableJson(value: unknown): string {
  return JSON.stringify(value, null, 2) + "\n";
}

export function mergeJsonFragment(existing: string | null, fragmentJson: string): string {
  const fragment = JSON.parse(fragmentJson) as unknown;
  if (existing === null || existing.trim() === "") return stableJson(fragment);
  let current: unknown;
  try {
    current = JSON.parse(existing);
  } catch (err) {
    throw new Error(`Cannot merge into invalid JSON file: ${(err as Error).message}`, {
      cause: err,
    });
  }
  return stableJson(deepMerge(current, fragment));
}

export function mergeTomlFragment(existing: string | null, fragmentJson: string): string {
  const fragment = JSON.parse(fragmentJson) as unknown;
  let current: unknown = {};
  if (existing !== null && existing.trim() !== "") {
    try {
      current = parseToml(existing);
    } catch (err) {
      throw new Error(`Cannot merge into invalid TOML file: ${(err as Error).message}`, {
        cause: err,
      });
    }
  }
  return stringifyToml(deepMerge(current, fragment)) + "\n";
}

/** Compute the final on-disk content for an emitted file given what's there now. */
export function resolveContent(
  file: EmittedFile,
  existing: string | Buffer | null,
): string | Buffer {
  if (file.strategy.kind === "replace") {
    if (Buffer.isBuffer(file.content)) return file.content;
    return file.content.endsWith("\n") ? file.content : file.content + "\n";
  }
  if (Buffer.isBuffer(file.content)) {
    throw new Error(`${file.relativePath}: binary content requires the "replace" strategy`);
  }
  if (Buffer.isBuffer(existing)) {
    throw new Error(`${file.relativePath}: cannot merge into a binary file`);
  }
  switch (file.strategy.kind) {
    case "managed-region":
      return mergeManagedRegion(existing, file.content);
    case "json-merge":
      return mergeJsonFragment(existing, file.content);
    case "toml-merge":
      return mergeTomlFragment(existing, file.content);
  }
}
