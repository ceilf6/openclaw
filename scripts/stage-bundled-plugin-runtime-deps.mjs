import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function removePathIfExists(targetPath) {
  fs.rmSync(targetPath, { recursive: true, force: true });
}

function listBundledPluginRuntimeDirs(repoRoot) {
  const extensionsRoot = path.join(repoRoot, "dist", "extensions");
  if (!fs.existsSync(extensionsRoot)) {
    return [];
  }

  return fs
    .readdirSync(extensionsRoot, { withFileTypes: true })
    .filter((dirent) => dirent.isDirectory())
    .map((dirent) => path.join(extensionsRoot, dirent.name))
    .filter((pluginDir) => fs.existsSync(path.join(pluginDir, "package.json")));
}

function hasRuntimeDeps(packageJson) {
  return (
    Object.keys(packageJson.dependencies ?? {}).length > 0 ||
    Object.keys(packageJson.optionalDependencies ?? {}).length > 0
  );
}

function shouldStageRuntimeDeps(packageJson) {
  return packageJson.openclaw?.bundle?.stageRuntimeDependencies === true;
}

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function installPluginRuntimeDeps(pluginDir, pluginId) {
  let lastOutput = "";

  for (let attempt = 1; attempt <= 5; attempt++) {
    console.log(`[runtime-postbuild] staging deps for ${pluginId} (attempt ${attempt}/5)`);

    const result = spawnSync(
      "npm",
      ["install", "--omit=dev", "--ignore-scripts", "--package-lock=false"],
      {
        cwd: pluginDir,
        encoding: "utf8",
        stdio: "pipe",
        shell: process.platform === "win32",
        env: {
          ...process.env,
          npm_config_strict_ssl: process.env.npm_config_strict_ssl ?? "false",
        },
      },
    );

    if (result.status === 0) {
      console.log(`[runtime-postbuild] staged deps for ${pluginId}`);
      return;
    }

    lastOutput = [result.stderr, result.stdout].filter(Boolean).join("\n").trim();
    console.error(`[runtime-postbuild] ${pluginId} failed on attempt ${attempt}/5`);
    if (lastOutput) {
      console.error(lastOutput);
    }

    if (attempt < 5) {
      sleep(5000);
    }
  }

  throw new Error(
    `failed to stage bundled runtime deps for ${pluginId}: ${lastOutput || "npm install failed"}`,
  );
}

export function stageBundledPluginRuntimeDeps(params = {}) {
  const repoRoot = params.cwd ?? params.repoRoot ?? process.cwd();
  for (const pluginDir of listBundledPluginRuntimeDirs(repoRoot)) {
    const pluginId = path.basename(pluginDir);
    const packageJson = readJson(path.join(pluginDir, "package.json"));
    const nodeModulesDir = path.join(pluginDir, "node_modules");
    removePathIfExists(nodeModulesDir);
    if (!hasRuntimeDeps(packageJson) || !shouldStageRuntimeDeps(packageJson)) {
      continue;
    }
    installPluginRuntimeDeps(pluginDir, pluginId);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  stageBundledPluginRuntimeDeps();
}
