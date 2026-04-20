# git-stats

Bun-based CLI for extracting contribution and repository activity statistics from a Git repository, with a focus on metrics that are usually hidden in free plans or private repositories.

The tool combines `git blame` and `git log --numstat` to build a terminal dashboard that feels closer to repository insights than to raw JSON output.

## What It Provides

- Per-contributor metrics for current code ownership.
- Historical metrics for added lines, deleted lines, and churn.
- Repository insights: hotspots, extension mix, activity peaks, and commit cadence.
- Visual terminal output with colors, bars, and rankings.
- JSON output for integrations or downstream processing.
- Support for local repositories or clonable remotes.
- Identity consolidation through aliases.

## Requirements

- Bun 1.2 or higher.
- Git available on the system.
- Repository access through SSH, HTTPS credentials, `gh auth`, or Git Credential Manager.

## Quick Start

```bash
bun install
bun run start --repo .
```

Examples:

```bash
bun run start --repo .
bun run start --repo git@github.com:mi-org/mi-repo.git
bun run start --repo https://github.com/mi-org/mi-repo.git --branch main
bun run start --repo . --format json
bun run start --repo . --config ./git-stats.config.json
```

Available options:

- `--repo <path-or-url>`: local path or Git URL. Defaults to `.`.
- `--branch <ref>`: reference to analyze. Defaults to `HEAD`.
- `--format <table|json>`: `table` shows the visual dashboard; `json` emits the structured report.
- `--config <path>`: path to the configuration file. Defaults to `git-stats.config.json` if it exists.
- `--help`: shows help.

## Configuration

You can create `git-stats.config.json` from [git-stats.config.example.json](./git-stats.config.example.json).

```json
{
  "includeExtensions": [".ts", ".tsx", ".js"],
  "excludePaths": ["dist/", "src/generated/"],
  "aliases": {
    "person@company.com": "Canonical Name",
    "old name": "Canonical Name"
  }
}
```

Supported fields:

- `includeExtensions`: extensions that should be included in the analysis.
- `excludePaths`: paths or prefixes to exclude.
- `aliases`: mapping used to consolidate multiple identities under one name.

## Dashboard Overview

The default console output includes these sections:

- Repository summary: analyzed files, contributors, commits, active days, current LOC, and historical change volume.
- Current ownership: current snapshot of the codebase according to `git blame`.
- Historical activity: added, deleted, and net lines plus average touched lines per commit.
- Repo insights: repository history span, commits per active day, files per commit, global churn, and busiest day.
- Leaders: who leads in current ownership, commits, historical net contribution, and file reach.
- Hotspots: files that have accumulated the most changes.
- Activity peaks: days with the highest activity across included files.
- Language mix: current LOC distribution by extension.
- Contributors: compact per-person cards with ownership, activity, and churn.

## Contributor Metrics

- `currentLines`: non-empty lines currently attributed to the contributor by `git blame`.
- `currentLinesPercentage`: percentage of `currentLines` over the repository's current total.
- `currentFilesOwned`: files where the contributor currently owns at least one non-empty line.
- `currentFilesOwnedPercentage`: percentage of owned files over the aggregated total.
- `commitCount`: commits that touched included files.
- `commitCountPercentage`: contributor share of commits against the aggregated total.
- `filesTouched`: number of unique files touched historically.
- `activeDays`: number of distinct days with activity.
- `lastCommitDate`: most recent date on which the contributor touched an included file.
- `touchedLines`: total added lines plus deleted lines.
- `touchedLinesPercentage`: percentage of touched lines over the aggregated total.
- `historicalAdded`: lines added across the analyzed history.
- `historicalAddedPercentage`: percentage over the total added lines.
- `historicalDeleted`: lines deleted across the analyzed history.
- `historicalDeletedPercentage`: percentage over the total deleted lines.
- `historicalNet`: `historicalAdded - historicalDeleted`.
- `historicalNetPercentage`: percentage of net contribution over the aggregated net total.
- `averageLinesPerCommit`: average touched lines per commit.
- `churnRate`: ratio of deleted lines to added lines.

## Repository Metrics

- `analyzedFiles`: number of files included after applying filters.
- `contributorCount`: number of detected contributors.
- `commitCount`: commits affecting included files.
- `activeDays`: days with activity on included files.
- `currentLines`: current LOC inside analyzed files.
- `touchedLines`: total volume of added and deleted lines in the analyzed history.
- `historicalAdded`: lines added in the analyzed history.
- `historicalDeleted`: lines deleted in the analyzed history.
- `historicalNet`: net balance between added and deleted lines.
- `averageLinesPerCommit`: global average of touched lines per commit.
- `historySpanDays`: days between the first and last included commit.
- `commitsPerActiveDay`: commit density on days with activity.
- `averageFilesPerCommit`: average number of included files touched per commit.
- `busiestDay`: day with the highest activity; ties on commit count are broken by touched lines.
- `hotspots`: files with the highest accumulated touched lines.
- `languages`: current LOC distribution by extension.
- `churnRate`: global repository churn based on deleted over added lines.

## How It Is Calculated

- Current ownership is derived from `git blame --line-porcelain`, file by file.
- Historical activity comes from `git log --numstat`, filtered to included extensions and paths only.
- Hotspots are built by aggregating touched lines and commits per file.
- Language mix groups files by extension and sums their current LOC.
- Aliases are applied by both normalized email and normalized name.

## Limitations

- `git blame` measures current authorship, not cumulative effort.
- The analysis counts comment or configuration lines if the extension is included.
- Complex renames and binary files do not always provide useful signal in `numstat`.
- If someone has used multiple names or emails, it is best to consolidate them with `aliases`.
- On large repositories it may take a while because it needs to run `git blame` file by file.

## Development

```bash
bun run dev
bun test
```
