import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { app } from "electron";
import type { RecentProject } from "../shared/bridge";

const MAX_RECENT_PROJECTS = 10;

/** Recent-projects persistence: one JSON file in the app's userData dir. */
export class ProjectStore {
  private readonly storePath = path.join(app.getPath("userData"), "recent-projects.json");

  async recents(): Promise<RecentProject[]> {
    let raw: string;
    try {
      raw = await readFile(this.storePath, "utf8");
    } catch {
      return [];
    }
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) return [];
      return parsed.filter(
        (entry): entry is RecentProject =>
          typeof entry === "object" &&
          entry !== null &&
          typeof (entry as RecentProject).dir === "string" &&
          typeof (entry as RecentProject).name === "string" &&
          typeof (entry as RecentProject).lastOpenedAt === "string",
      );
    } catch {
      return [];
    }
  }

  async remember(dir: string, name: string): Promise<void> {
    const entry: RecentProject = { dir, name, lastOpenedAt: new Date().toISOString() };
    const others = (await this.recents()).filter((recent) => recent.dir !== dir);
    const recents = [entry, ...others].slice(0, MAX_RECENT_PROJECTS);
    await mkdir(path.dirname(this.storePath), { recursive: true });
    await writeFile(this.storePath, JSON.stringify(recents, null, 2) + "\n", "utf8");
  }
}
