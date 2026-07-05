import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

const repoSrc = dirname(fileURLToPath(import.meta.url)).replace(/\/tests$/, "");

function readSources(relativeDirectory: string) {
  const directory = join(repoSrc, relativeDirectory);
  const files: string[] = [];

  function visit(current: string) {
    for (const entry of readdirSync(current)) {
      const path = join(current, entry);
      if (statSync(path).isDirectory()) {
        visit(path);
      } else if (/\.(ts|tsx)$/.test(path)) {
        files.push(readFileSync(path, "utf8"));
      }
    }
  }

  visit(directory);
  return files.join("\n");
}

describe("generative UI boundaries", () => {
  test("generative-ui does not import AppShell or DOM mutation APIs", () => {
    const source = readSources("app/features/generative-ui");

    expect(source).not.toMatch(/AppShell/);
    expect(source).not.toMatch(/agent-runtime/);
    expect(source).not.toMatch(/document\.querySelector|document\.getElementById|eval\s*\(/);
  });

  test("agent-runtime does not import React or AppShell", () => {
    const source = readSources("app/features/agent-runtime");

    expect(source).not.toMatch(/from "react"|from 'react'|AppShell/);
  });

  test("agent-runtime owns mode contracts without importing assistant feature modules", () => {
    const source = readSources("app/features/agent-runtime");

    expect(source).not.toMatch(/features\/assistant|"\.\.\/assistant|'..\/assistant/);
  });

  test("semantic planner delegates matching instead of hard-coding phrase branches", () => {
    const source = readFileSync(join(repoSrc, "app/features/agent-runtime/semanticPlanner.ts"), "utf8");

    expect(source).not.toMatch(/includesAny|\.includes\(|normalized ===/);
    expect(source).toMatch(/matchSemanticActionCandidates/);
  });

  test("semantic matcher expands reusable concepts instead of branching on complete commands", () => {
    const source = readFileSync(join(repoSrc, "app/features/agent-runtime/semanticActionMatcher.ts"), "utf8");

    expect(source).toMatch(/conceptAliasLexicon/);
    expect(source).toMatch(/signal\.concept/);
    expect(source).not.toMatch(/input\s*===/);
    expect(source).not.toMatch(/case\s+["'`]打开组织/);
    expect(source).not.toMatch(/case\s+["'`]带我去团队资料区/);
  });

  test("assistant input entrypoint delegates to the IntentInputAdapter", () => {
    const source = readFileSync(join(repoSrc, "app/features/assistant/AssistantPane.tsx"), "utf8");

    expect(source).toMatch(/adaptDefaultUiIntent/);
    expect(source).toMatch(/adaptTextIntent/);
    expect(source).not.toMatch(/input\.trim\(\)/);
  });

  test("runtime orchestrator delegates planner and policy context construction", () => {
    const source = readFileSync(join(repoSrc, "app/features/agent-runtime/runtimeOrchestrator.ts"), "utf8");

    expect(source).toMatch(/buildIntentRuntimeContexts/);
    expect(source).not.toMatch(/registeredActions:\s*getRegisteredActionMetadata\(\)/);
    expect(source).not.toMatch(/routeAgentIntent|executeRuntimeSkill/);
  });

  test("agent runtime has retired legacy string command routing modules", () => {
    expect(existsSync(join(repoSrc, "app/features/agent-runtime/intentRouter.ts"))).toBe(false);
    expect(existsSync(join(repoSrc, "app/features/agent-runtime/skillExecutor.ts"))).toBe(false);
    expect(existsSync(join(repoSrc, "app/features/agent-runtime/confirmationPolicy.ts"))).toBe(false);
  });

  test("plan executor delegates policy decisions to the PolicyEngine", () => {
    const source = readFileSync(join(repoSrc, "app/features/agent-runtime/planExecutor.ts"), "utf8");

    expect(source).toMatch(/evaluateSemanticPlanPolicy/);
    expect(source).not.toMatch(/function getConfirmationAction|function getArtifactClarification/);
  });

  test("plan executor delegates execution pacing to the SmoothPolicy", () => {
    const source = readFileSync(join(repoSrc, "app/features/agent-runtime/planExecutor.ts"), "utf8");

    expect(source).toMatch(/evaluateSmoothExecutionPolicy/);
    expect(source).toMatch(/createRecoverableActionFailure/);
    expect(source).not.toMatch(/function shouldGenerateUIDslForPlan/);
  });

  test("assistant dynamic action entrypoint delegates ActionRefs to the runtime bridge", () => {
    const source = readFileSync(join(repoSrc, "app/features/assistant/AssistantPane.tsx"), "utf8");

    expect(source).toMatch(/executeUIDslActionRef/);
    expect(source).toMatch(/action:\s*"trigger_action"/);
    expect(source).toMatch(/adaptDefaultUiIntent/);
    expect(source).not.toMatch(/routeUIDslActionRef/);
  });
});
