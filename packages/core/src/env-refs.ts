/**
 * Kata env-var references look like `${env:MY_VAR}`.
 * Adapters render them into each tool's native expansion syntax so secrets
 * are never inlined into generated files.
 */

const ENV_REF_REGEX = /\$\{env:([A-Za-z_][A-Za-z0-9_]*)\}/g;

/** Replace each `${env:VAR}` reference using the given renderer. */
export function renderEnvRefs(value: string, render: (varName: string) => string): string {
  return value.replace(ENV_REF_REGEX, (_, name: string) => render(name));
}

/** List the env var names referenced in a string. */
export function collectEnvRefs(value: string): string[] {
  return [...value.matchAll(ENV_REF_REGEX)].map((match) => match[1] as string);
}

/**
 * If the whole value is a single `${env:VAR}` reference, return `VAR`,
 * else null. Some tools can only source entire values from an env var
 * (no string interpolation), so adapters use this to pick a mapping.
 */
export function pureEnvRef(value: string): string | null {
  const match = /^\$\{env:([A-Za-z_][A-Za-z0-9_]*)\}$/.exec(value.trim());
  return match ? (match[1] as string) : null;
}
