import { expect, test } from "bun:test";

import { analyzeRepository, normalizeConfig, resolveContributor, shouldIncludeFile } from "./analyzer";

test("should include source files and exclude configured folders", () => {
  const config = normalizeConfig({
    includeExtensions: [".ts", ".tsx"],
    excludePaths: ["src/generated/", "dist/"]
  });

  expect(shouldIncludeFile("src/index.ts", config)).toBe(true);
  expect(shouldIncludeFile("src/generated/types.ts", config)).toBe(false);
  expect(shouldIncludeFile("README.md", config)).toBe(false);
});

test("should normalize contributors using aliases", () => {
  expect(resolveContributor("Juan Pérez", "juan@empresa.com", {
    "juan@empresa.com": "Juan Perez"
  })).toBe("Juan Perez");

  expect(resolveContributor("Juan Pérez", "", {
    "juan pérez": "Juan Perez"
  })).toBe("Juan Perez");
});

test("should aggregate current ownership and historical activity", async () => {
  const responses = new Map<string, string>([
    [
      "ls-files",
      ["src/index.ts", "src/util.ts", "README.md"].join("\n")
    ],
    [
      "blame --line-porcelain HEAD -- src/index.ts",
      [
        "a1 1 1 1",
        "author Alice",
        "author-mail <alice@example.com>",
        "\tconst answer = 42;",
        "b1 2 2 1",
        "author Bob",
        "author-mail <bob@example.com>",
        "\tconsole.log(answer);"
      ].join("\n")
    ],
    [
      "blame --line-porcelain HEAD -- src/util.ts",
      [
        "a2 1 1 2",
        "author Alice",
        "author-mail <alice@example.com>",
        "\texport function add(a: number, b: number) {",
        "\t  return a + b;"
      ].join("\n")
    ],
    [
      "log HEAD --numstat --date=short --format=%x1e%H%x1f%an%x1f%ae%x1f%ad",
      [
        "\u001ea1\u001fAlice\u001falice@example.com\u001f2026-04-01",
        "1\t0\tsrc/index.ts",
        "2\t1\tsrc/util.ts",
        "\u001eb1\u001fBob\u001fbob@example.com\u001f2026-04-03",
        "1\t0\tsrc/index.ts",
        "\u001ec1\u001fDocs\u001fdocs@example.com\u001f2026-04-04",
        "5\t0\tREADME.md"
      ].join("\n")
    ]
  ]);

  const report = await analyzeRepository(
    async (args) => {
      const key = args.join(" ");
      const value = responses.get(key);

      if (!value) {
        throw new Error(`Missing mock response for ${key}`);
      }

      return value;
    },
    {
      branch: "HEAD",
      config: {}
    }
  );

  expect(report.summary).toEqual({
    analyzedFiles: 2,
    contributorCount: 2,
    commitCount: 2,
    activeDays: 2,
    currentLines: 4,
    currentFilesOwned: 3,
    touchedLines: 5,
    historicalAdded: 4,
    historicalDeleted: 1,
    historicalNet: 3,
    averageLinesPerCommit: 2.5
  });

  expect(report.insights).toEqual({
    firstCommitDate: "2026-04-01",
    lastCommitDate: "2026-04-03",
    historySpanDays: 3,
    commitsPerActiveDay: 1,
    averageFilesPerCommit: 1.5,
    churnRate: 25,
    busiestDay: {
      date: "2026-04-01",
      commitCount: 1,
      touchedLines: 4,
      added: 3,
      deleted: 1
    },
    topActivityDays: [
      {
        date: "2026-04-01",
        commitCount: 1,
        touchedLines: 4,
        added: 3,
        deleted: 1
      },
      {
        date: "2026-04-03",
        commitCount: 1,
        touchedLines: 1,
        added: 1,
        deleted: 0
      }
    ],
    hotspots: [
      {
        filePath: "src/util.ts",
        commitCount: 1,
        touchedLines: 3,
        added: 2,
        deleted: 1
      },
      {
        filePath: "src/index.ts",
        commitCount: 2,
        touchedLines: 2,
        added: 2,
        deleted: 0
      }
    ],
    languages: [
      {
        extension: ".ts",
        fileCount: 2,
        currentLines: 4,
        currentLinesPercentage: 100
      }
    ]
  });

  expect(report.contributors).toEqual([
    {
      contributor: "Alice",
      currentLines: 3,
      currentLinesPercentage: 75,
      currentFilesOwned: 2,
      currentFilesOwnedPercentage: 66.67,
      commitCount: 1,
      commitCountPercentage: 50,
      filesTouched: 2,
      activeDays: 1,
      lastCommitDate: "2026-04-01",
      touchedLines: 4,
      touchedLinesPercentage: 80,
      historicalAdded: 3,
      historicalAddedPercentage: 75,
      historicalDeleted: 1,
      historicalDeletedPercentage: 100,
      historicalNet: 2,
      historicalNetPercentage: 66.67,
      averageLinesPerCommit: 4,
      churnRate: 33.33
    },
    {
      contributor: "Bob",
      currentLines: 1,
      currentLinesPercentage: 25,
      currentFilesOwned: 1,
      currentFilesOwnedPercentage: 33.33,
      commitCount: 1,
      commitCountPercentage: 50,
      filesTouched: 1,
      activeDays: 1,
      lastCommitDate: "2026-04-03",
      touchedLines: 1,
      touchedLinesPercentage: 20,
      historicalAdded: 1,
      historicalAddedPercentage: 25,
      historicalDeleted: 0,
      historicalDeletedPercentage: 0,
      historicalNet: 1,
      historicalNetPercentage: 33.33,
      averageLinesPerCommit: 1,
      churnRate: 0
    }
  ]);
});
