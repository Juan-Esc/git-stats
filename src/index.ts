import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, resolve } from "node:path";

import { analyzeRepository, type AnalysisReport, type ContributorStats, type OutputFormat, type StatsConfig } from "./analyzer";

interface CliOptions {
  repo: string;
  branch: string;
  format: OutputFormat;
  configPath?: string;
  help: boolean;
}

async function main(): Promise<void> {
  const options = parseArgs(Bun.argv.slice(2));

  if (options.help) {
    printUsage();
    return;
  }

  let cleanupPath: string | undefined;

  try {
    const repositoryPath = await prepareRepository(options.repo, options.branch);
    cleanupPath = repositoryPath.cleanupPath;

    const config = loadConfig(options.configPath);
    const results = await analyzeRepository(
      async (args) => runGitCommand(repositoryPath.path, args),
      {
        branch: options.branch,
        config
      }
    );

    renderResults(results, options.format, options.branch);
  } finally {
    if (cleanupPath) {
      rmSync(cleanupPath, { recursive: true, force: true });
    }
  }
}

function parseArgs(args: string[]): CliOptions {
  const options: CliOptions = {
    repo: ".",
    branch: "HEAD",
    format: "table",
    help: false
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    switch (arg) {
      case "--repo":
        options.repo = requireValue(arg, args[index + 1]);
        index += 1;
        break;
      case "--branch":
        options.branch = requireValue(arg, args[index + 1]);
        index += 1;
        break;
      case "--format": {
        const format = requireValue(arg, args[index + 1]);
        if (format !== "table" && format !== "json") {
          throw new Error(`Formato no soportado: ${format}`);
        }
        options.format = format;
        index += 1;
        break;
      }
      case "--config":
        options.configPath = requireValue(arg, args[index + 1]);
        index += 1;
        break;
      case "--help":
      case "-h":
        options.help = true;
        break;
      default:
        throw new Error(`Argumento no reconocido: ${arg}`);
    }
  }

  return options;
}

function requireValue(flag: string, value: string | undefined): string {
  if (!value || value.startsWith("--")) {
    throw new Error(`Falta un valor para ${flag}`);
  }

  return value;
}

function loadConfig(configPath?: string): StatsConfig {
  const resolvedPath = configPath
    ? resolve(configPath)
    : resolve("git-stats.config.json");

  if (!existsSync(resolvedPath)) {
    return {};
  }

  return JSON.parse(readFileSync(resolvedPath, "utf8")) as StatsConfig;
}

async function prepareRepository(repoInput: string, branch: string): Promise<{ path: string; cleanupPath?: string }> {
  if (!isRemoteRepository(repoInput)) {
    const localPath = isAbsolute(repoInput) ? repoInput : resolve(repoInput);
    await runGitCommand(localPath, ["rev-parse", "--is-inside-work-tree"]);
    return { path: localPath };
  }

  const tempPath = mkdtempSync(resolve(tmpdir(), "git-stats-"));

  const cloneArgs = ["clone", "--quiet"];

  if (branch !== "HEAD") {
    cloneArgs.push("--branch", branch);
  }

  cloneArgs.push(repoInput, tempPath);
  await runGitCommand(process.cwd(), cloneArgs);
  return { path: tempPath, cleanupPath: tempPath };
}

function isRemoteRepository(value: string): boolean {
  return /^(https?:\/\/|ssh:\/\/|git@)/i.test(value);
}

async function runGitCommand(cwd: string, args: string[]): Promise<string> {
  const process = Bun.spawn({
    cmd: ["git", ...args],
    cwd,
    stdout: "pipe",
    stderr: "pipe"
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
    process.exited
  ]);

  if (exitCode !== 0) {
    const errorOutput = stderr.trim() || stdout.trim() || `git ${args.join(" ")} falló`;
    throw new Error(errorOutput);
  }

  return stdout;
}

function renderResults(report: AnalysisReport, format: OutputFormat, branch: string): void {
  if (format === "json") {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  renderPrettyResults(report, branch);
}

function renderPrettyResults(report: AnalysisReport, branch: string): void {
  const palette = createPalette(process.stdout.isTTY);
  const leaders = buildLeaders(report.contributors);

  console.log(palette.bold(palette.cyan("git-stats")));
  console.log(`${palette.dim("Reference")} ${branch}`);
  console.log(`${palette.dim("Files")} ${formatInteger(report.summary.analyzedFiles)}   ${palette.dim("Contributors")} ${formatInteger(report.summary.contributorCount)}   ${palette.dim("Commits")} ${formatInteger(report.summary.commitCount)}   ${palette.dim("Active days")} ${formatInteger(report.summary.activeDays)}`);
  console.log("");

  console.log(palette.bold("Current ownership"));
  console.log(`  ${palette.dim("Lines now")}${padLeft(formatInteger(report.summary.currentLines), 12)}   ${palette.dim("Files owned")}${padLeft(formatInteger(report.summary.currentFilesOwned), 8)}`);
  console.log("");

  console.log(palette.bold("Historical activity"));
  console.log(`  ${palette.green("+" + formatInteger(report.summary.historicalAdded))} added   ${palette.red("-" + formatInteger(report.summary.historicalDeleted))} deleted   ${formatNet(report.summary.historicalNet, palette)} net   ${formatInteger(report.summary.touchedLines)} touched   ${report.summary.averageLinesPerCommit.toFixed(2)} avg/commit`);
  console.log("");

  console.log(palette.bold("Repo insights"));
  console.log(`  ${palette.dim("History")} ${report.insights.firstCommitDate ?? "-"} -> ${report.insights.lastCommitDate ?? "-"}   ${palette.dim("Span")} ${formatInteger(report.insights.historySpanDays)} days   ${palette.dim("Commits/day")} ${report.insights.commitsPerActiveDay.toFixed(2)}   ${palette.dim("Files/commit")} ${report.insights.averageFilesPerCommit.toFixed(2)}   ${palette.dim("Repo churn")} ${report.insights.churnRate.toFixed(2)}%`);
  if (report.insights.busiestDay) {
    console.log(`  ${palette.dim("Peak day")} ${renderActivityDay(report.insights.busiestDay, palette)}`);
  }
  console.log("");

  console.log(palette.bold("Leaders"));
  for (const leader of leaders) {
    console.log(`  ${palette.dim(leader.label)} ${leader.value}`);
  }
  console.log("");

  if (report.insights.hotspots.length > 0) {
    console.log(palette.bold("Hotspots"));
    for (const hotspot of report.insights.hotspots) {
      console.log(`  ${renderHotspot(hotspot, palette)}`);
    }
    console.log("");
  }

  if (report.insights.topActivityDays.length > 0) {
    console.log(palette.bold("Activity peaks"));
    for (const activityDay of report.insights.topActivityDays) {
      console.log(`  ${renderActivityDay(activityDay, palette)}`);
    }
    console.log("");
  }

  if (report.insights.languages.length > 0) {
    console.log(palette.bold("Language mix"));
    for (const language of report.insights.languages) {
      console.log(`  ${renderLanguageLine(language, palette)}`);
    }
    console.log("");
  }

  console.log(palette.bold("Contributors"));
  for (const [index, contributor] of report.contributors.entries()) {
    console.log(renderContributorBlock(index + 1, contributor, palette));
  }
}

function buildLeaders(contributors: ContributorStats[]): Array<{ label: string; value: string }> {
  const currentLeader = pickLeader(contributors, (entry) => entry.currentLines);
  const commitLeader = pickLeader(contributors, (entry) => entry.commitCount);
  const netLeader = pickLeader(contributors, (entry) => entry.historicalNet);
  const reachLeader = pickLeader(contributors, (entry) => entry.filesTouched);

  return [
    {
      label: "Current LOC:",
      value: currentLeader ? `${currentLeader.contributor} (${formatInteger(currentLeader.currentLines)}, ${formatPercentage(currentLeader.currentLinesPercentage)})` : "n/a"
    },
    {
      label: "Commits:    ",
      value: commitLeader ? `${commitLeader.contributor} (${formatInteger(commitLeader.commitCount)})` : "n/a"
    },
    {
      label: "Net lines:  ",
      value: netLeader ? `${netLeader.contributor} (${formatSignedInteger(netLeader.historicalNet)})` : "n/a"
    },
    {
      label: "File reach: ",
      value: reachLeader ? `${reachLeader.contributor} (${formatInteger(reachLeader.filesTouched)} files)` : "n/a"
    }
  ];
}

function pickLeader(
  contributors: ContributorStats[],
  getValue: (entry: ContributorStats) => number
): ContributorStats | undefined {
  return contributors
    .slice()
    .sort((left, right) => getValue(right) - getValue(left) || left.contributor.localeCompare(right.contributor))[0];
}

function renderContributorBlock(rank: number, contributor: ContributorStats, palette: Palette): string {
  const title = `${palette.bold(`#${rank}`)} ${palette.bold(truncate(contributor.contributor, 28))}`;
  const summary = `${formatNet(contributor.historicalNet, palette)} net   ${formatInteger(contributor.currentLines)} LOC now   ${contributor.lastCommitDate ?? "-"}`;
  const ownership = `  own ${renderBar(contributor.currentLinesPercentage, 12, palette.blue)}   ${formatInteger(contributor.currentFilesOwned)} ${pluralize(contributor.currentFilesOwned, "file", "files")} owned`;
  const activity = `  act ${renderBar(contributor.touchedLinesPercentage, 12, palette.yellow)}   ${formatInteger(contributor.commitCount)} ${pluralize(contributor.commitCount, "commit", "commits")}   ${formatInteger(contributor.filesTouched)} ${pluralize(contributor.filesTouched, "file", "files")} touched   ${formatInteger(contributor.activeDays)} ${pluralize(contributor.activeDays, "day", "days")}   churn ${contributor.churnRate.toFixed(2)}%`;

  return `${title}\n${summary}\n${ownership}\n${activity}\n`;
}

function renderActivityDay(
  activityDay: AnalysisReport["insights"]["topActivityDays"][number],
  palette: Palette
): string {
  return `${activityDay.date}   ${formatInteger(activityDay.commitCount)} ${pluralize(activityDay.commitCount, "commit", "commits")}   ${formatInteger(activityDay.touchedLines)} touched   ${palette.green("+" + formatInteger(activityDay.added))}/${palette.red("-" + formatInteger(activityDay.deleted))}`;
}

function renderHotspot(
  hotspot: AnalysisReport["insights"]["hotspots"][number],
  palette: Palette
): string {
  return `${truncatePath(hotspot.filePath, 40)}   ${formatInteger(hotspot.commitCount)} ${pluralize(hotspot.commitCount, "commit", "commits")}   ${formatInteger(hotspot.touchedLines)} touched   ${palette.green("+" + formatInteger(hotspot.added))}/${palette.red("-" + formatInteger(hotspot.deleted))}`;
}

function renderLanguageLine(
  language: AnalysisReport["insights"]["languages"][number],
  palette: Palette
): string {
  const extension = padRight(language.extension, 8);
  const files = `${formatInteger(language.fileCount)} ${pluralize(language.fileCount, "file", "files")}`;
  return `${palette.cyan(extension)} ${renderBar(language.currentLinesPercentage, 10, palette.blue)}   ${padLeft(formatInteger(language.currentLines), 6)} LOC   ${files}`;
}

function renderBar(percentage: number, width: number, colorize: (value: string) => string): string {
  const clamped = Math.max(0, Math.min(100, percentage));
  const filled = Math.round((clamped / 100) * width);
  const bar = `[${"#".repeat(filled)}${".".repeat(Math.max(0, width - filled))}]`;
  return `${colorize(bar)} ${padLeft(formatPercentage(clamped), 6)}`;
}

function formatInteger(value: number): string {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(value);
}

function formatSignedInteger(value: number): string {
  const prefix = value > 0 ? "+" : "";
  return `${prefix}${formatInteger(value)}`;
}

function formatPercentage(value: number): string {
  return `${value.toFixed(2)}%`;
}

function pluralize(value: number, singular: string, plural: string): string {
  return value === 1 ? singular : plural;
}

function formatNet(value: number, palette: Palette): string {
  const formatted = formatSignedInteger(value);

  if (value > 0) {
    return palette.green(formatted);
  }

  if (value < 0) {
    return palette.red(formatted);
  }

  return palette.dim(formatted);
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, Math.max(0, maxLength - 3))}...`;
}

function padLeft(value: string, width: number): string {
  const length = visibleLength(value);

  if (length >= width) {
    return value;
  }

  return `${" ".repeat(width - length)}${value}`;
}

function padRight(value: string, width: number): string {
  const length = visibleLength(value);

  if (length >= width) {
    return value;
  }

  return `${value}${" ".repeat(width - length)}`;
}

function visibleLength(value: string): number {
  return value.replace(/\x1b\[[0-9;]*m/g, "").length;
}

function truncatePath(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }

  const tailLength = Math.max(10, maxLength - 3);
  return `...${value.slice(value.length - tailLength)}`;
}

interface Palette {
  bold: (value: string) => string;
  dim: (value: string) => string;
  cyan: (value: string) => string;
  blue: (value: string) => string;
  green: (value: string) => string;
  red: (value: string) => string;
  yellow: (value: string) => string;
}

function createPalette(enabled: boolean): Palette {
  const wrap = (code: number) => (value: string) => enabled ? `\u001b[${code}m${value}\u001b[0m` : value;

  return {
    bold: wrap(1),
    dim: wrap(2),
    cyan: wrap(36),
    blue: wrap(34),
    green: wrap(32),
    red: wrap(31),
    yellow: wrap(33)
  };
}

function printUsage(): void {
  console.log(`git-stats

Uso:
  bun run start --repo <ruta-o-url> [--branch <ref>] [--format table|json] [--config <ruta>]

Ejemplos:
  bun run start --repo .
  bun run start --repo git@github.com:mi-org/mi-repo.git --branch main
  bun run start --repo https://github.com/mi-org/mi-repo.git --format json
`);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Error: ${message}`);
  process.exitCode = 1;
});