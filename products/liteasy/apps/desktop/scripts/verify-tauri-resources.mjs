import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const desktopDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const defaultTauriDirectory = path.join(desktopDirectory, "src-tauri");
const defaultConfigPath = path.join(defaultTauriDirectory, "tauri.conf.json");
const canonicalWindowsIcon = "icons/icon.ico";

function normalizeResourcePath(resourcePath) {
  return resourcePath.replaceAll("\\", "/");
}

function isInside(parentDirectory, candidatePath) {
  const relativePath = path.relative(parentDirectory, candidatePath);
  return relativePath !== "" &&
    !relativePath.startsWith(`..${path.sep}`) &&
    relativePath !== ".." &&
    !path.isAbsolute(relativePath);
}

function assertTracked(resourcePath, repositoryDirectory, violations) {
  const repositoryPath = normalizeResourcePath(path.relative(repositoryDirectory, resourcePath));
  try {
    execFileSync("git", ["ls-files", "--error-unmatch", "--", repositoryPath], {
      cwd: repositoryDirectory,
      stdio: "ignore"
    });
  } catch {
    violations.push(`resource is not tracked by Git: ${repositoryPath}`);
  }
}

export function verifyTauriResources({
  configPath = defaultConfigPath,
  requireGitTracked = false,
  repositoryDirectory = path.resolve(desktopDirectory, "../../../.."),
  tauriDirectory = path.dirname(configPath)
} = {}) {
  const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
  const icons = config.bundle?.icon;
  const violations = [];

  if (!Array.isArray(icons) || icons.length === 0) {
    throw new Error("tauri_resource_contract:\nbundle.icon must contain at least one resource path");
  }

  const normalizedIcons = icons.map((icon) => {
    if (typeof icon !== "string" || icon.trim() === "") {
      violations.push("bundle.icon entries must be non-empty strings");
      return "";
    }

    const normalizedIcon = normalizeResourcePath(icon);
    const iconPath = path.resolve(tauriDirectory, normalizedIcon);
    if (!isInside(tauriDirectory, iconPath)) {
      violations.push(`resource must stay inside src-tauri: ${icon}`);
      return normalizedIcon;
    }
    if (!fs.statSync(iconPath, { throwIfNoEntry: false })?.isFile()) {
      violations.push(`configured resource does not exist: ${normalizedIcon}`);
      return normalizedIcon;
    }

    if (normalizedIcon.toLocaleLowerCase().endsWith(".ico")) {
      const header = fs.readFileSync(iconPath).subarray(0, 4);
      if (header.length < 4 || header.readUInt16LE(0) !== 0 || header.readUInt16LE(2) !== 1) {
        violations.push(`configured Windows icon is not a valid ICO file: ${normalizedIcon}`);
      }
    }
    if (requireGitTracked) assertTracked(iconPath, repositoryDirectory, violations);
    return normalizedIcon;
  });

  const windowsIcons = normalizedIcons.filter((icon) => icon.toLocaleLowerCase().endsWith(".ico"));
  if (windowsIcons.length !== 1 || windowsIcons[0] !== canonicalWindowsIcon) {
    violations.push(`Windows resource icon must use the canonical path: ${canonicalWindowsIcon}`);
  }

  // These files are otherwise first read by the NSIS bundler, after Rust compilation.
  const nsis = config.bundle?.windows?.nsis ?? {};
  const installerResources = [
    "installerHooks", "template", "headerImage", "sidebarImage",
    "installerIcon", "uninstallerIcon", "uninstallerHeaderImage"
  ].flatMap((field) => nsis[field] == null ? [] : [[field, nsis[field]]]);
  for (const [field, resource] of installerResources) {
    if (typeof resource !== "string" || !resource.trim()) {
      violations.push(`bundle.windows.nsis.${field} must be a non-empty resource path`);
      continue;
    }
    const normalizedResource = normalizeResourcePath(resource);
    const resourcePath = path.resolve(tauriDirectory, normalizedResource);
    if (!isInside(tauriDirectory, resourcePath)) {
      violations.push(`installer resource must stay inside src-tauri: ${resource}`);
    } else if (!fs.statSync(resourcePath, { throwIfNoEntry: false })?.isFile()) {
      violations.push(`configured installer resource does not exist: ${normalizedResource}`);
    } else if (requireGitTracked) {
      assertTracked(resourcePath, repositoryDirectory, violations);
    }
  }

  if (violations.length > 0) {
    throw new Error(`tauri_resource_contract:\n${violations.join("\n")}`);
  }

  return {
    checkedResources: normalizedIcons.length + installerResources.length,
    verified: true,
    windowsIcon: canonicalWindowsIcon
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = verifyTauriResources({
    requireGitTracked: process.argv.includes("--require-git-tracked")
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
}
