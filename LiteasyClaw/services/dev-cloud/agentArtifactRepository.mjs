import fs from "node:fs";
import path from "node:path";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryDir = dirname(fileURLToPath(import.meta.url));
const defaultResultDirectory = resolve(repositoryDir, "../../../project-docs/agent-results");
const artifactVersion = "liteasy.agent-artifact/v1";
const artifactTypes = new Set(["comparison_table", "layered_graph", "mindmap", "ppt", "thin_reading", "tree"]);

function validateArtifactId(artifactId) {
  if (
    typeof artifactId !== "string" ||
    !/^[A-Za-z0-9._-]{1,120}$/.test(artifactId)
  ) {
    throw new Error("invalid_agent_artifact_id");
  }
  return artifactId;
}

function validateArtifact(document) {
  if (!document || typeof document !== "object" || Array.isArray(document)) {
    throw new Error("invalid_agent_artifact");
  }
  if (
    document.version !== artifactVersion ||
    typeof document.artifactId !== "string" ||
    !/^[A-Za-z0-9._-]{1,120}$/.test(document.artifactId) ||
    !artifactTypes.has(document.artifactType) ||
    typeof document.createdAt !== "string" ||
    typeof document.title !== "string" ||
    !document.agent ||
    typeof document.agent !== "object" ||
    typeof document.agent.runId !== "string" ||
    document.agent.status !== "completed"
  ) {
    throw new Error("invalid_agent_artifact");
  }
  return document;
}

function artifactPath(resultDirectory, artifactId) {
  return path.join(resultDirectory, `${validateArtifactId(artifactId)}.json`);
}

function readArtifact(filePath) {
  return validateArtifact(JSON.parse(fs.readFileSync(filePath, "utf8")));
}

export function createAgentArtifactRepository(options = {}) {
  const resultDirectory = options.resultDirectory ?? defaultResultDirectory;

  return {
    list() {
      if (!fs.existsSync(resultDirectory)) {
        return [];
      }
      return fs
        .readdirSync(resultDirectory, { withFileTypes: true })
        .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
        .flatMap((entry) => {
          try {
            return [readArtifact(path.join(resultDirectory, entry.name))];
          } catch {
            return [];
          }
        })
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
    },

    save(document) {
      const validated = validateArtifact(document);
      fs.mkdirSync(resultDirectory, { recursive: true, mode: 0o755 });
      const destination = artifactPath(resultDirectory, validated.artifactId);
      const temporary = `${destination}.${process.pid}.${Date.now()}.tmp`;
      try {
        fs.writeFileSync(temporary, `${JSON.stringify(validated, null, 2)}\n`, {
          encoding: "utf8",
          flag: "wx",
          mode: 0o644
        });
        fs.renameSync(temporary, destination);
      } catch (error) {
        if (fs.existsSync(temporary)) {
          fs.unlinkSync(temporary);
        }
        throw error;
      }
      return {
        artifact: validated,
        path: `project-docs/agent-results/${validated.artifactId}.json`
      };
    },

    remove(artifactId) {
      const validatedArtifactId = validateArtifactId(artifactId);
      const destination = artifactPath(resultDirectory, validatedArtifactId);
      if (!fs.existsSync(destination)) {
        return null;
      }
      const stat = fs.statSync(destination);
      if (!stat.isFile()) {
        return null;
      }
      fs.unlinkSync(destination);
      return {
        artifactId: validatedArtifactId,
        deleted: true,
        path: `project-docs/agent-results/${validatedArtifactId}.json`
      };
    }
  };
}

export { artifactVersion };
