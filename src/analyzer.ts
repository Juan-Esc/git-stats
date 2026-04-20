import { cpus } from "node:os";
import { extname } from "node:path";

export type OutputFormat = "table" | "json";

export interface StatsConfig {
  includeExtensions?: string[];
  excludePaths?: string[];
  aliases?: Record<string, string>;
}

export interface ContributorStats {
  contributor: string;
  currentLines: number;
  currentLinesPercentage: number;
  currentFilesOwned: number;
  currentFilesOwnedPercentage: number;
  commitCount: number;
  commitCountPercentage: number;
  filesTouched: number;
  activeDays: number;
  lastCommitDate: string | null;
  touchedLines: number;
  touchedLinesPercentage: number;
  historicalAdded: number;
  historicalAddedPercentage: number;
  historicalDeleted: number;
  historicalDeletedPercentage: number;
  historicalNet: number;
  historicalNetPercentage: number;
  averageLinesPerCommit: number;
  churnRate: number;
}

export interface RepositoryStatsSummary {
  analyzedFiles: number;
  contributorCount: number;
  commitCount: number;
  activeDays: number;
  currentLines: number;
  currentFilesOwned: number;
  touchedLines: number;
  historicalAdded: number;
  historicalDeleted: number;
  historicalNet: number;
  averageLinesPerCommit: number;
}

export interface RepositoryLanguageStats {
  extension: string;
  fileCount: number;
  currentLines: number;
  currentLinesPercentage: number;
}

export interface RepositoryHotspot {
  filePath: string;
  commitCount: number;
  touchedLines: number;
  added: number;
  deleted: number;
}

export interface RepositoryActivityDay {
  date: string;
  commitCount: number;
  touchedLines: number;
  added: number;
  deleted: number;
}

export interface RepositoryInsights {
  firstCommitDate: string | null;
  lastCommitDate: string | null;
  historySpanDays: number;
  commitsPerActiveDay: number;
  averageFilesPerCommit: number;
  churnRate: number;
  busiestDay: RepositoryActivityDay | null;
  topActivityDays: RepositoryActivityDay[];
  hotspots: RepositoryHotspot[];
  languages: RepositoryLanguageStats[];
}

export interface AnalysisReport {
  summary: RepositoryStatsSummary;
  insights: RepositoryInsights;
  contributors: ContributorStats[];
}

export interface AnalyzeOptions {
  branch: string;
  config: StatsConfig;
}

interface MutableStats {
  contributor: string;
  currentLines: number;
  currentFilesOwned: number;
  commitCount: number;
  touchedLines: number;
  historicalAdded: number;
  historicalDeleted: number;
  touchedFiles: Set<string>;
  activeDays: Set<string>;
  lastCommitDate: string | null;
}

interface MutableHotspot {
  filePath: string;
  commitCount: number;
  touchedLines: number;
  added: number;
  deleted: number;
}

interface MutableActivityDay {
  date: string;
  commitCount: number;
  touchedLines: number;
  added: number;
  deleted: number;
}

interface HistoricalSummary {
  commitCount: number;
  activeDays: Set<string>;
  totalFilesTouched: number;
  firstCommitDate: string | null;
  lastCommitDate: string | null;
  hotspots: Map<string, MutableHotspot>;
  activityByDay: Map<string, MutableActivityDay>;
}

const DEFAULT_INCLUDE_EXTENSIONS = [
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".py",
  ".go",
  ".rs",
  ".java",
  ".kt",
  ".rb",
  ".php",
  ".cs",
  ".c",
  ".cc",
  ".cpp",
  ".h",
  ".hpp",
  ".swift",
  ".scala",
  ".sh",
  ".sql",
  ".html",
  ".css",
  ".scss",
  ".sass",
  ".vue",
  ".svelte",
  ".astro",
  ".tf",
  ".proto",
  ".graphql"
];

const DEFAULT_EXCLUDE_PATHS = [
  "node_modules/",
  "dist/",
  "build/",
  "coverage/",
  "vendor/",
  "target/",
  ".next/",
  ".turbo/",
  ".git/"
];

export function normalizeConfig(config: StatsConfig): Required<StatsConfig> {
  const includeExtensions = (config.includeExtensions?.length ? config.includeExtensions : DEFAULT_INCLUDE_EXTENSIONS)
    .map((extension) => extension.startsWith(".") ? extension.toLowerCase() : `.${extension.toLowerCase()}`);

  const excludePaths = [...DEFAULT_EXCLUDE_PATHS, ...(config.excludePaths ?? [])]
    .map((pattern) => normalizeRepoPath(pattern).replace(/^\.\//, ""));

  const aliases = Object.fromEntries(
    Object.entries(config.aliases ?? {}).map(([key, value]) => [key.trim().toLowerCase(), value.trim()])
  );

  return {
    includeExtensions,
    excludePaths,
    aliases
  };
}

export function shouldIncludeFile(filePath: string, config: Required<StatsConfig>): boolean {
  const normalizedPath = normalizeRepoPath(filePath);

  if (config.excludePaths.some((pattern) => matchesExcludePattern(normalizedPath, pattern))) {
    return false;
  }

  return config.includeExtensions.includes(extname(normalizedPath).toLowerCase());
}

export function resolveContributor(name: string, email: string, aliases: Record<string, string>): string {
  const trimmedName = name.trim();
  const trimmedEmail = email.trim().toLowerCase();
  const canonicalAlias = aliases[trimmedEmail] ?? aliases[trimmedName.toLowerCase()];

  if (canonicalAlias) {
    return canonicalAlias;
  }

  if (trimmedName) {
    return trimmedName;
  }

  if (trimmedEmail) {
    return trimmedEmail;
  }

  return "Unknown";
}

export async function analyzeRepository(
  runGitCommand: (args: string[]) => Promise<string>,
  options: AnalyzeOptions
): Promise<AnalysisReport> {
  const config = normalizeConfig(options.config);
  const stats = new Map<string, MutableStats>();
  const currentFileLineCounts = new Map<string, number>();

  const trackedFilesOutput = await runGitCommand(["ls-files"]);
  const trackedFiles = trackedFilesOutput
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((filePath) => shouldIncludeFile(filePath, config));

  await collectCurrentLines(trackedFiles, runGitCommand, options.branch, config.aliases, stats, currentFileLineCounts);
  const historySummary = await collectHistoricalLines(runGitCommand, options.branch, config, stats);

  const totals = calculateTotals(stats);
  const languages = buildLanguageStats(currentFileLineCounts, totals.currentLines);
  const topActivityDays = [...historySummary.activityByDay.values()]
    .sort((left, right) => {
      if (right.commitCount !== left.commitCount) {
        return right.commitCount - left.commitCount;
      }

      if (right.touchedLines !== left.touchedLines) {
        return right.touchedLines - left.touchedLines;
      }

      return right.date.localeCompare(left.date);
    })
    .slice(0, 3);

  const hotspots = [...historySummary.hotspots.values()]
    .sort((left, right) => {
      if (right.touchedLines !== left.touchedLines) {
        return right.touchedLines - left.touchedLines;
      }

      if (right.commitCount !== left.commitCount) {
        return right.commitCount - left.commitCount;
      }

      return left.filePath.localeCompare(right.filePath);
    })
    .slice(0, 5);
  const contributors = [...stats.values()]
    .map((entry) => {
      const historicalNet = entry.historicalAdded - entry.historicalDeleted;

      return {
        contributor: entry.contributor,
        currentLines: entry.currentLines,
        currentLinesPercentage: calculatePercentage(entry.currentLines, totals.currentLines),
        currentFilesOwned: entry.currentFilesOwned,
        currentFilesOwnedPercentage: calculatePercentage(entry.currentFilesOwned, totals.currentFilesOwned),
        commitCount: entry.commitCount,
        commitCountPercentage: calculatePercentage(entry.commitCount, totals.commitCount),
        filesTouched: entry.touchedFiles.size,
        activeDays: entry.activeDays.size,
        lastCommitDate: entry.lastCommitDate,
        touchedLines: entry.touchedLines,
        touchedLinesPercentage: calculatePercentage(entry.touchedLines, totals.touchedLines),
        historicalAdded: entry.historicalAdded,
        historicalAddedPercentage: calculatePercentage(entry.historicalAdded, totals.historicalAdded),
        historicalDeleted: entry.historicalDeleted,
        historicalDeletedPercentage: calculatePercentage(entry.historicalDeleted, totals.historicalDeleted),
        historicalNet,
        historicalNetPercentage: calculatePercentage(historicalNet, totals.historicalNet),
        averageLinesPerCommit: roundToTwo(entry.commitCount === 0 ? 0 : entry.touchedLines / entry.commitCount),
        churnRate: roundToTwo(entry.historicalAdded === 0 ? 0 : (entry.historicalDeleted / entry.historicalAdded) * 100)
      } satisfies ContributorStats;
    })
    .sort((left, right) => {
      if (right.currentLines !== left.currentLines) {
        return right.currentLines - left.currentLines;
      }

      if (right.commitCount !== left.commitCount) {
        return right.commitCount - left.commitCount;
      }

      if (right.historicalNet !== left.historicalNet) {
        return right.historicalNet - left.historicalNet;
      }

      return left.contributor.localeCompare(right.contributor);
    });

  return {
    summary: {
      analyzedFiles: trackedFiles.length,
      contributorCount: contributors.length,
      commitCount: historySummary.commitCount,
      activeDays: historySummary.activeDays.size,
      currentLines: totals.currentLines,
      currentFilesOwned: totals.currentFilesOwned,
      touchedLines: totals.touchedLines,
      historicalAdded: totals.historicalAdded,
      historicalDeleted: totals.historicalDeleted,
      historicalNet: totals.historicalNet,
      averageLinesPerCommit: roundToTwo(historySummary.commitCount === 0 ? 0 : totals.touchedLines / historySummary.commitCount)
    },
    insights: {
      firstCommitDate: historySummary.firstCommitDate,
      lastCommitDate: historySummary.lastCommitDate,
      historySpanDays: calculateDaySpan(historySummary.firstCommitDate, historySummary.lastCommitDate),
      commitsPerActiveDay: roundToTwo(historySummary.activeDays.size === 0 ? 0 : historySummary.commitCount / historySummary.activeDays.size),
      averageFilesPerCommit: roundToTwo(historySummary.commitCount === 0 ? 0 : historySummary.totalFilesTouched / historySummary.commitCount),
      churnRate: roundToTwo(totals.historicalAdded === 0 ? 0 : (totals.historicalDeleted / totals.historicalAdded) * 100),
      busiestDay: topActivityDays[0] ?? null,
      topActivityDays,
      hotspots,
      languages
    },
    contributors
  };
}

async function collectCurrentLines(
  trackedFiles: string[],
  runGitCommand: (args: string[]) => Promise<string>,
  branch: string,
  aliases: Record<string, string>,
  stats: Map<string, MutableStats>,
  currentFileLineCounts: Map<string, number>
): Promise<void> {
  const concurrency = Math.max(1, Math.min(8, cpus().length));
  let index = 0;

  const workers = Array.from({ length: concurrency }, async () => {
    while (index < trackedFiles.length) {
      const currentIndex = index;
      index += 1;
      const filePath = trackedFiles[currentIndex];
      const blameOutput = await runGitCommand(["blame", "--line-porcelain", branch, "--", filePath]);
      currentFileLineCounts.set(filePath, applyBlameToStats(blameOutput, aliases, stats));
    }
  });

  await Promise.all(workers);
}

async function collectHistoricalLines(
  runGitCommand: (args: string[]) => Promise<string>,
  branch: string,
  config: Required<StatsConfig>,
  stats: Map<string, MutableStats>
): Promise<HistoricalSummary> {
  const logOutput = await runGitCommand([
    "log",
    branch,
    "--numstat",
    "--date=short",
    "--format=%x1e%H%x1f%an%x1f%ae%x1f%ad"
  ]);

  const commits = logOutput.split("\u001e").map((chunk) => chunk.trim()).filter(Boolean);
  const activeDays = new Set<string>();
  let commitCount = 0;
  let totalFilesTouched = 0;
  let firstCommitDate: string | null = null;
  let lastCommitDate: string | null = null;
  const hotspots = new Map<string, MutableHotspot>();
  const activityByDay = new Map<string, MutableActivityDay>();

  for (const commit of commits) {
    const [header, ...entries] = commit.split(/\r?\n/);
    const [, name = "Unknown", email = "", commitDate = ""] = header.split("\u001f");
    let addedInCommit = 0;
    let deletedInCommit = 0;
    let includedEntries = 0;
    const touchedFiles = new Map<string, { added: number; deleted: number }>();

    for (const entry of entries) {
      const parsed = parseNumstatLine(entry);

      if (!parsed || !shouldIncludeFile(parsed.filePath, config)) {
        continue;
      }

      addedInCommit += parsed.added;
      deletedInCommit += parsed.deleted;
      const current = touchedFiles.get(parsed.filePath) ?? { added: 0, deleted: 0 };
      current.added += parsed.added;
      current.deleted += parsed.deleted;
      touchedFiles.set(parsed.filePath, current);
      includedEntries += 1;
    }

    if (includedEntries === 0) {
      continue;
    }

    const contributor = ensureStats(stats, resolveContributor(name, email, config.aliases));
    contributor.commitCount += 1;
    contributor.historicalAdded += addedInCommit;
    contributor.historicalDeleted += deletedInCommit;
    contributor.touchedLines += addedInCommit + deletedInCommit;
    contributor.lastCommitDate = latestDate(contributor.lastCommitDate, commitDate);

    if (commitDate) {
      contributor.activeDays.add(commitDate);
      activeDays.add(commitDate);
      firstCommitDate = earliestDate(firstCommitDate, commitDate);
      lastCommitDate = latestDate(lastCommitDate, commitDate);

      const activityDay = ensureActivityDay(activityByDay, commitDate);
      activityDay.commitCount += 1;
      activityDay.added += addedInCommit;
      activityDay.deleted += deletedInCommit;
      activityDay.touchedLines += addedInCommit + deletedInCommit;
    }

    totalFilesTouched += touchedFiles.size;

    for (const [filePath, fileStats] of touchedFiles) {
      contributor.touchedFiles.add(filePath);
      const hotspot = ensureHotspot(hotspots, filePath);
      hotspot.commitCount += 1;
      hotspot.added += fileStats.added;
      hotspot.deleted += fileStats.deleted;
      hotspot.touchedLines += fileStats.added + fileStats.deleted;
    }

    commitCount += 1;
  }

  return {
    commitCount,
    activeDays,
    totalFilesTouched,
    firstCommitDate,
    lastCommitDate,
    hotspots,
    activityByDay
  };
}

function applyBlameToStats(
  blameOutput: string,
  aliases: Record<string, string>,
  stats: Map<string, MutableStats>
): number {
  let currentAuthor = "Unknown";
  let currentEmail = "";
  const fileContributors = new Set<string>();
  let currentLines = 0;

  for (const line of blameOutput.split(/\r?\n/)) {
    if (line.startsWith("author ")) {
      currentAuthor = line.slice("author ".length).trim();
      continue;
    }

    if (line.startsWith("author-mail ")) {
      currentEmail = line.slice("author-mail ".length).replace(/[<>]/g, "").trim();
      continue;
    }

    if (!line.startsWith("\t")) {
      continue;
    }

    if (!line.slice(1).trim()) {
      continue;
    }

    const contributor = resolveContributor(currentAuthor, currentEmail, aliases);
    ensureStats(stats, contributor).currentLines += 1;
    fileContributors.add(contributor);
    currentLines += 1;
  }

  for (const contributor of fileContributors) {
    ensureStats(stats, contributor).currentFilesOwned += 1;
  }

  return currentLines;
}

function ensureStats(stats: Map<string, MutableStats>, contributor: string): MutableStats {
  const existing = stats.get(contributor);

  if (existing) {
    return existing;
  }

  const created: MutableStats = {
    contributor,
    currentLines: 0,
    currentFilesOwned: 0,
    commitCount: 0,
    touchedLines: 0,
    historicalAdded: 0,
    historicalDeleted: 0,
    touchedFiles: new Set<string>(),
    activeDays: new Set<string>(),
    lastCommitDate: null
  };

  stats.set(contributor, created);
  return created;
}

function parseNumstatLine(line: string): { added: number; deleted: number; filePath: string } | null {
  const [addedRaw, deletedRaw, ...filePathParts] = line.split("\t");
  const filePath = filePathParts.join("\t").trim();

  if (!addedRaw || !deletedRaw || !filePath || addedRaw === "-" || deletedRaw === "-") {
    return null;
  }

  const added = Number.parseInt(addedRaw, 10);
  const deleted = Number.parseInt(deletedRaw, 10);

  if (Number.isNaN(added) || Number.isNaN(deleted)) {
    return null;
  }

  return { added, deleted, filePath };
}

function calculateTotals(stats: Map<string, MutableStats>): {
  currentLines: number;
  currentFilesOwned: number;
  commitCount: number;
  touchedLines: number;
  historicalAdded: number;
  historicalDeleted: number;
  historicalNet: number;
} {
  const totals = {
    currentLines: 0,
    currentFilesOwned: 0,
    commitCount: 0,
    touchedLines: 0,
    historicalAdded: 0,
    historicalDeleted: 0,
    historicalNet: 0
  };

  for (const entry of stats.values()) {
    totals.currentLines += entry.currentLines;
    totals.currentFilesOwned += entry.currentFilesOwned;
    totals.commitCount += entry.commitCount;
    totals.touchedLines += entry.touchedLines;
    totals.historicalAdded += entry.historicalAdded;
    totals.historicalDeleted += entry.historicalDeleted;
    totals.historicalNet += entry.historicalAdded - entry.historicalDeleted;
  }

  return totals;
}

function calculatePercentage(value: number, total: number): number {
  if (total === 0) {
    return 0;
  }

  return roundToTwo((value / total) * 100);
}

function roundToTwo(value: number): number {
  return Number(value.toFixed(2));
}

function buildLanguageStats(
  currentFileLineCounts: Map<string, number>,
  totalCurrentLines: number
): RepositoryLanguageStats[] {
  const languageStats = new Map<string, { extension: string; fileCount: number; currentLines: number }>();

  for (const [filePath, currentLines] of currentFileLineCounts) {
    const extension = extname(filePath).toLowerCase() || "[no-ext]";
    const entry = languageStats.get(extension) ?? { extension, fileCount: 0, currentLines: 0 };
    entry.fileCount += 1;
    entry.currentLines += currentLines;
    languageStats.set(extension, entry);
  }

  return [...languageStats.values()]
    .map((entry) => ({
      extension: entry.extension,
      fileCount: entry.fileCount,
      currentLines: entry.currentLines,
      currentLinesPercentage: calculatePercentage(entry.currentLines, totalCurrentLines)
    }))
    .sort((left, right) => {
      if (right.currentLines !== left.currentLines) {
        return right.currentLines - left.currentLines;
      }

      if (right.fileCount !== left.fileCount) {
        return right.fileCount - left.fileCount;
      }

      return left.extension.localeCompare(right.extension);
    })
    .slice(0, 5);
}

function latestDate(current: string | null, candidate: string): string | null {
  if (!candidate) {
    return current;
  }

  if (!current || candidate > current) {
    return candidate;
  }

  return current;
}

function earliestDate(current: string | null, candidate: string): string | null {
  if (!candidate) {
    return current;
  }

  if (!current || candidate < current) {
    return candidate;
  }

  return current;
}

function calculateDaySpan(start: string | null, end: string | null): number {
  if (!start || !end) {
    return 0;
  }

  const startDate = new Date(`${start}T00:00:00Z`);
  const endDate = new Date(`${end}T00:00:00Z`);
  const diff = endDate.getTime() - startDate.getTime();

  if (Number.isNaN(diff) || diff < 0) {
    return 0;
  }

  return Math.floor(diff / 86_400_000) + 1;
}

function ensureHotspot(stats: Map<string, MutableHotspot>, filePath: string): MutableHotspot {
  const existing = stats.get(filePath);

  if (existing) {
    return existing;
  }

  const created: MutableHotspot = {
    filePath,
    commitCount: 0,
    touchedLines: 0,
    added: 0,
    deleted: 0
  };

  stats.set(filePath, created);
  return created;
}

function ensureActivityDay(stats: Map<string, MutableActivityDay>, date: string): MutableActivityDay {
  const existing = stats.get(date);

  if (existing) {
    return existing;
  }

  const created: MutableActivityDay = {
    date,
    commitCount: 0,
    touchedLines: 0,
    added: 0,
    deleted: 0
  };

  stats.set(date, created);
  return created;
}

function matchesExcludePattern(filePath: string, pattern: string): boolean {
  const normalizedPattern = normalizeRepoPath(pattern).replace(/^\.\//, "");

  if (!normalizedPattern) {
    return false;
  }

  if (normalizedPattern.endsWith("/")) {
    return filePath.startsWith(normalizedPattern);
  }

  return filePath === normalizedPattern || filePath.startsWith(`${normalizedPattern}/`);
}

function normalizeRepoPath(filePath: string): string {
  return filePath.replace(/\\/g, "/").trim();
}
