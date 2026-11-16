import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

export type TestSuiteMode = "unit" | "integration" | "all";

const VALID_TEST_SUITE_MODES: ReadonlySet<string> = new Set<TestSuiteMode>([
  "unit",
  "integration",
  "all",
]);

/**
 * Normalizes a filesystem path to POSIX forward slashes relative to `rootDir`.
 */
function toRelativePosixPath(rootDir: string, absolutePath: string): string {
  return path.relative(rootDir, absolutePath).split(path.sep).join("/");
}

/**
 * Recursively collects all files within `dirPath` matching `predicate`.
 * Deterministic alphabetical ordering is guaranteed at every directory level.
 */
export function collectFilesRecursively(
  dirPath: string,
  predicate: (absoluteFilePath: string) => boolean
): string[] {
  if (!fs.existsSync(dirPath)) {
    throw new Error(
      `TEST_DISCOVERY_ERROR: Required test directory does not exist: ${dirPath}`
    );
  }

  const stat = fs.statSync(dirPath);
  if (!stat.isDirectory()) {
    throw new Error(
      `TEST_DISCOVERY_ERROR: Expected directory path but found file: ${dirPath}`
    );
  }

  const entries = fs
    .readdirSync(dirPath, { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name));

  const collected: string[] = [];

  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      collected.push(...collectFilesRecursively(fullPath, predicate));
    } else if (entry.isFile() && predicate(fullPath)) {
      collected.push(fullPath);
    }
  }

  return collected;
}

/**
 * Predicate identifying unit test files (`.test.ts`, excluding `.integration.test.ts`
 * and anything inside `src/test/integration/`).
 */
export function isUnitTestFile(filePath: string): boolean {
  const normalized = filePath.split(path.sep).join("/");
  return (
    normalized.endsWith(".test.ts") &&
    !normalized.endsWith(".integration.test.ts") &&
    !normalized.includes("/src/test/integration/")
  );
}

/**
 * Predicate identifying integration test files (`.integration.test.ts`).
 */
export function isIntegrationTestFile(filePath: string): boolean {
  const normalized = filePath.split(path.sep).join("/");
  return normalized.endsWith(".integration.test.ts");
}

/**
 * Discovers all unit test files recursively across `src/` (including `src/shared`,
 * `src/modules`, and `src/test/unit`), excluding integration tests.
 * Throws if `src/` or `src/test/unit` is missing or if zero unit tests are found.
 */
export function discoverUnitTestFiles(
  backendRoot: string = process.cwd()
): string[] {
  const srcDir = path.resolve(backendRoot, "src");
  const unitTestDir = path.resolve(backendRoot, "src/test/unit");

  const dedicatedUnitTests = collectFilesRecursively(
    unitTestDir,
    isUnitTestFile
  );
  if (dedicatedUnitTests.length === 0) {
    throw new Error(
      `TEST_DISCOVERY_ERROR: No unit test files (*.test.ts) found in ${unitTestDir}.`
    );
  }

  const allSrcUnitTests = collectFilesRecursively(srcDir, isUnitTestFile).map(
    (abs) => toRelativePosixPath(backendRoot, abs)
  );

  const uniqueFiles = Array.from(new Set(allSrcUnitTests));
  if (uniqueFiles.length === 0) {
    throw new Error("TEST_DISCOVERY_ERROR: Zero unit test files discovered.");
  }

  return uniqueFiles;
}

/**
 * Discovers all integration test files recursively across `src/test/integration`.
 * Throws if the directory is missing or if no integration test files are discovered.
 */
export function discoverIntegrationTestFiles(
  backendRoot: string = process.cwd()
): string[] {
  const integrationTestDir = path.resolve(backendRoot, "src/test/integration");

  const integrationTests = collectFilesRecursively(
    integrationTestDir,
    isIntegrationTestFile
  ).map((abs) => toRelativePosixPath(backendRoot, abs));

  const uniqueFiles = Array.from(new Set(integrationTests));
  if (uniqueFiles.length === 0) {
    throw new Error(
      `TEST_DISCOVERY_ERROR: No integration test files (*.integration.test.ts) found in ${integrationTestDir}.`
    );
  }

  return uniqueFiles;
}

/**
 * Resolves the list of test files to execute for the requested `TestSuiteMode`.
 */
export function resolveTestFilesForMode(
  mode: TestSuiteMode,
  backendRoot: string = process.cwd()
): string[] {
  if (!VALID_TEST_SUITE_MODES.has(mode)) {
    throw new Error(
      `INVALID_TEST_MODE: Expected 'unit', 'integration', or 'all', received '${String(mode)}'.`
    );
  }

  if (mode === "unit") {
    return discoverUnitTestFiles(backendRoot);
  }

  if (mode === "integration") {
    return discoverIntegrationTestFiles(backendRoot);
  }

  const unitFiles = discoverUnitTestFiles(backendRoot);
  const integrationFiles = discoverIntegrationTestFiles(backendRoot);
  return [...unitFiles, ...integrationFiles];
}

/**
 * Executes the discovered test files via `tsx --test` without relying on shell glob expansion.
 */
export function runDiscoveredTests(
  mode: TestSuiteMode,
  backendRoot: string = process.cwd()
): number {
  const testFiles = resolveTestFilesForMode(mode, backendRoot);

  const tsxCliPath = path.resolve(
    backendRoot,
    "node_modules/tsx/dist/cli.mjs"
  );
  if (!fs.existsSync(tsxCliPath)) {
    throw new Error(
      `TEST_RUNNER_ERROR: Could not locate tsx CLI at ${tsxCliPath}. Run 'npm ci' or 'npm install' first.`
    );
  }

  console.log(
    `[test-runner] Mode: '${mode}' — discovered ${testFiles.length} test file(s).`
  );

  const result = spawnSync(
    process.execPath,
    [tsxCliPath, "--test", ...testFiles],
    {
      cwd: backendRoot,
      stdio: "inherit",
      env: process.env,
    }
  );

  if (result.error) {
    throw result.error;
  }

  if (result.signal) {
    return 1;
  }

  return result.status ?? 1;
}

// Self-executing CLI entry point when invoked directly via tsx scripts/run-tests.ts <mode>
if (
  process.argv[1] &&
  !process.argv[1].includes(".test.") &&
  (process.argv[1].endsWith("run-tests.ts") ||
    process.argv[1].endsWith("run-tests.js"))
) {
  const rawMode = process.argv[2]?.trim() as TestSuiteMode | undefined;
  if (!rawMode || !VALID_TEST_SUITE_MODES.has(rawMode)) {
    console.error(
      "Usage: tsx scripts/run-tests.ts <unit|integration|all>"
    );
    process.exit(1);
  }

  try {
    const exitCode = runDiscoveredTests(rawMode, process.cwd());
    process.exit(exitCode);
  } catch (err: unknown) {
    console.error(
      err instanceof Error ? err.message : `Test execution failed: ${String(err)}`
    );
    process.exit(1);
  }
}
