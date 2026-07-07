import { stat, readdir, readFile } from "node:fs/promises";
import { join, relative, sep } from "node:path";

/** Does the path exist (file or directory)? */
export async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

/** Read a UTF-8 text file, or null when it cannot be read (e.g. missing). */
export async function readTextFileOrNull(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch {
    return null;
  }
}

/** Read a UTF-8 text file, or `defaultValue` when it cannot be read (e.g. missing). */
export async function readTextFileOrDefault(path: string, defaultValue: string): Promise<string> {
  return (await readTextFileOrNull(path)) ?? defaultValue;
}

/** A markdown file keyed by its basename (without the `.md` extension). */
export interface NamedMarkdownFile {
  name: string;
  content: string;
}

/** Every `.md` file in `dir` (missing dir → []), sorted by name. */
export async function readNamedMarkdownFiles(dir: string): Promise<NamedMarkdownFile[]> {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    entries = [];
  }
  const result: NamedMarkdownFile[] = [];
  for (const entry of entries.filter((file) => file.endsWith(".md")).sort()) {
    result.push({
      name: entry.replace(/\.md$/, ""),
      content: await readFile(join(dir, entry), "utf8"),
    });
  }
  return result;
}

/** Convert a platform-native relative path to `/`-separated form. */
export function toPosixPath(relativePath: string): string {
  return relativePath.split(sep).join("/");
}

/** Every file under `dir`, as sorted dir-relative paths with `/` separators. */
export async function listFilesRecursive(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { recursive: true, withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => toPosixPath(relative(dir, join(entry.parentPath, entry.name))))
    .sort();
}
