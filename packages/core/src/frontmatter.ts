import { parse as parseYaml } from "yaml";

export interface Frontmatter {
  /** Parsed YAML frontmatter, or null when the file has none. */
  data: Record<string, unknown> | null;
  /** Content without the frontmatter block. */
  body: string;
}

const FRONTMATTER_REGEX = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

export function parseFrontmatter(content: string): Frontmatter {
  const match = FRONTMATTER_REGEX.exec(content);
  if (!match) return { data: null, body: content };
  let data: unknown;
  try {
    data = parseYaml(match[1] as string);
  } catch {
    return { data: null, body: content };
  }
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    return { data: null, body: content };
  }
  return {
    data: data as Record<string, unknown>,
    body: content.slice(match[0].length),
  };
}

export function stripFrontmatter(content: string): string {
  return parseFrontmatter(content).body;
}
