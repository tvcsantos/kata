import { createTwoFilesPatch } from "diff";
import pc from "picocolors";
import { displayPath, type Plan, type PlannedFile, type TargetPlan } from "@katahq/core";

function actionLabel(file: PlannedFile): string {
  switch (file.action) {
    case "create":
      return pc.green("+ create");
    case "update":
      return pc.yellow("~ update");
    case "unchanged":
      return pc.dim("  ok     ");
  }
}

function byteLength(content: string | Buffer): number {
  return typeof content === "string" ? Buffer.byteLength(content, "utf8") : content.length;
}

function renderDiff(file: PlannedFile): string {
  if (Buffer.isBuffer(file.oldContent) || Buffer.isBuffer(file.newContent)) {
    return pc.dim(`binary file (${byteLength(file.newContent)} bytes)`);
  }
  const patch = createTwoFilesPatch(
    displayPath(file.relativePath, file.scope),
    displayPath(file.relativePath, file.scope),
    file.oldContent ?? "",
    file.newContent,
    undefined,
    undefined,
    { context: 2 },
  );
  return (
    patch
      .split("\n")
      // Skip the "Index:"-style header lines; keep hunks readable.
      .slice(4)
      .map((line) => {
        if (line.startsWith("+")) return pc.green(line);
        if (line.startsWith("-")) return pc.red(line);
        if (line.startsWith("@@")) return pc.cyan(line);
        return line;
      })
      .join("\n")
  );
}

export function renderTargetPlan(target: TargetPlan, opts: { diff: boolean }): string {
  const lines: string[] = [];
  const detected = target.detected ? "" : pc.dim(" (not detected on this machine)");
  lines.push(pc.bold(`target ${target.target}`) + detected);
  if (target.files.length === 0) {
    lines.push(pc.dim("  nothing to emit"));
  }
  for (const file of target.files) {
    lines.push(`  ${actionLabel(file)}  ${displayPath(file.relativePath, file.scope)}`);
    if (opts.diff && file.action !== "unchanged") {
      const diff = renderDiff(file);
      lines.push(
        diff
          .split("\n")
          .map((l) => "    " + l)
          .join("\n"),
      );
    }
  }
  for (const warning of target.warnings) {
    lines.push(pc.yellow(`  ! ${warning.message}`));
  }
  return lines.join("\n");
}

export function renderPlan(plan: Plan, opts: { diff: boolean }): string {
  const sections = plan.targets.map((t) => renderTargetPlan(t, opts));
  const changes = plan.targets
    .flatMap((t) => t.files)
    .filter((f) => f.action !== "unchanged").length;
  const summary =
    changes === 0
      ? pc.green("No changes. Native configs are up to date.")
      : pc.bold(`${changes} file(s) to write. Run \`kata apply\` to write them.`);
  return sections.concat(summary).join("\n\n");
}
