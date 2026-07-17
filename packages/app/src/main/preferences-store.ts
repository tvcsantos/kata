import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { app } from "electron";
import type { RegistrySource } from "../shared/registry";

export type ThemePreference = "system" | "light" | "dark";

interface Preferences {
  /** Persona slugs chosen at onboarding; null means never asked (first run). */
  personas: string[] | null;
  /** Configured registries, in priority order; missing = never initialized. */
  registries?: RegistrySource[];
  theme?: ThemePreference;
}

function isRegistrySource(value: unknown): value is RegistrySource {
  return (
    typeof value === "object" && value !== null && typeof (value as RegistrySource).url === "string"
  );
}

/** User preferences: one JSON file in the app's userData dir. */
export class PreferencesStore {
  private readonly storePath = path.join(app.getPath("userData"), "preferences.json");

  async personas(): Promise<string[] | null> {
    const preferences = await this.read();
    return Array.isArray(preferences.personas)
      ? preferences.personas.filter((slug) => typeof slug === "string")
      : null;
  }

  async setPersonas(slugs: string[]): Promise<void> {
    const preferences = await this.read();
    await this.write({ ...preferences, personas: slugs });
  }

  async theme(): Promise<ThemePreference> {
    const preferences = await this.read();
    return preferences.theme === "light" || preferences.theme === "dark"
      ? preferences.theme
      : "system";
  }

  async setTheme(theme: ThemePreference): Promise<void> {
    const preferences = await this.read();
    await this.write({ ...preferences, theme });
  }

  /** The configured registries; empty until the user adds one (first run). */
  async registries(): Promise<RegistrySource[]> {
    const preferences = await this.read();
    if (!Array.isArray(preferences.registries)) return [];
    return preferences.registries.filter(isRegistrySource).map((source) => ({
      url: source.url,
      name: typeof source.name === "string" ? source.name : null,
    }));
  }

  async addRegistry(source: RegistrySource): Promise<void> {
    if (
      !source.url.startsWith("https://") &&
      !source.url.startsWith("http://") &&
      !source.url.startsWith("file://")
    ) {
      throw new Error("Registry URLs must start with https://, http://, or file://.");
    }
    const preferences = await this.read();
    const registries = (preferences.registries ?? []).filter(isRegistrySource);
    if (registries.some((existing) => existing.url === source.url)) {
      throw new Error("That registry is already configured.");
    }
    await this.write({ ...preferences, registries: [...registries, source] });
  }

  async removeRegistry(url: string): Promise<void> {
    const preferences = await this.read();
    const registries = (preferences.registries ?? []).filter(isRegistrySource);
    await this.write({
      ...preferences,
      registries: registries.filter((source) => source.url !== url),
    });
  }

  private async read(): Promise<Preferences> {
    let raw: string;
    try {
      raw = await readFile(this.storePath, "utf8");
    } catch {
      return { personas: null };
    }
    try {
      const parsed = JSON.parse(raw) as Preferences;
      return typeof parsed === "object" && parsed !== null ? parsed : { personas: null };
    } catch {
      return { personas: null };
    }
  }

  private async write(preferences: Preferences): Promise<void> {
    await mkdir(path.dirname(this.storePath), { recursive: true });
    await writeFile(this.storePath, JSON.stringify(preferences, null, 2) + "\n", "utf8");
  }
}
