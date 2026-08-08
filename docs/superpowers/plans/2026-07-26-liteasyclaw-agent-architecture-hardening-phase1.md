# LiteasyClaw Agent Architecture Hardening Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the current Agent architecture auditable in-product and safer to extend by reconciling capability catalogs, exposing maturity/readiness signals, extracting event presentation logic, and adding guardrail tests for retrieval and high-risk actions.

**Architecture:** Keep the existing `agent-api -> agent-core -> agent-runtime -> actionRegistry` shape. Add small pure audit/readiness modules beside the owning features, then render only summarized governance signals in Settings. Do not introduce a general plugin runtime, domain MCP server, or high-risk action handler in this phase.

**Tech Stack:** React 18, TypeScript, Vitest, Testing Library, Fluent UI, Mermaid documentation.

---

## Scope

This Phase 1 plan implements the first hardening slice from `docs/engineering/agent-architecture-audit.md`:

- R1: skill catalog vs executable skill mismatch.
- R2: `AssistantPane` public Agent event presentation complexity.
- R3: static Agent Core governance needs visible audit state.
- R4: retrieval readiness needs explicit preflight status.
- R5: high-risk action metadata needs a tested default-deny audit helper.

This plan does not implement real domain MCP servers, plugin execution, arbitrary local file access, or high-risk workspace/cloud mutation handlers.

## File Structure

- Create `products/liteasy/apps/desktop/src/app/features/agent-core/capabilityAudit.ts`
  - Builds rows that compare `defaultAgentCoreConfig.skills` with executable skills and registered action families.
- Modify `products/liteasy/apps/desktop/src/app/features/skills/skillRegistry.ts`
  - Exposes executable skill metadata without changing skill execution behavior.
- Modify `products/liteasy/apps/desktop/src/app/features/agent-core/AgentSettingsPanel.tsx`
  - Renders capability audit summary and per-skill execution status.
- Modify `products/liteasy/apps/desktop/src/app/styles/app.css`
  - Adds styles for audit badges and summary chips.
- Create `products/liteasy/apps/desktop/src/app/features/assistant/agentEventPresenter.ts`
  - Extracts public Agent event-to-message presentation rules from `AssistantPane`.
- Modify `products/liteasy/apps/desktop/src/app/features/assistant/AssistantPane.tsx`
  - Uses the extracted presenter for non-UI public Agent events.
- Create `products/liteasy/apps/desktop/src/app/features/retrieval/retrievalReadiness.ts`
  - Computes selected-paper evidence readiness before QA/artifact work.
- Create `products/liteasy/apps/desktop/src/app/features/actions/highRiskActionAudit.ts`
  - Produces a tested audit list for high-risk actions that are intentionally blocked.
- Test `products/liteasy/apps/desktop/src/tests/agentCapabilityAudit.test.ts`
- Test `products/liteasy/apps/desktop/src/tests/SettingsPane.test.tsx`
- Test `products/liteasy/apps/desktop/src/tests/agentEventPresenter.test.ts`
- Test `products/liteasy/apps/desktop/src/tests/retrievalReadiness.test.ts`
- Test `products/liteasy/apps/desktop/src/tests/highRiskActionAudit.test.ts`

---

### Task 1: Capability Audit Model

**Files:**
- Modify: `products/liteasy/apps/desktop/src/app/features/skills/skillRegistry.ts`
- Create: `products/liteasy/apps/desktop/src/app/features/agent-core/capabilityAudit.ts`
- Test: `products/liteasy/apps/desktop/src/tests/agentCapabilityAudit.test.ts`

- [ ] **Step 1: Write the failing capability audit test**

Create `products/liteasy/apps/desktop/src/tests/agentCapabilityAudit.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import {
  buildAgentCapabilityAudit,
  getAgentCapabilityAuditSummary,
  getAgentCapabilityExecutionLabel
} from "../app/features/agent-core/capabilityAudit";
import { defaultAgentCoreConfig } from "../app/features/agent-core/agentCoreConfig";
import { getRegisteredActionMetadata } from "../app/features/skills/actionRegistry";
import { getExecutableSkillMetadata } from "../app/features/skills/skillRegistry";

describe("agent capability audit", () => {
  test("classifies configured skills by executable backing", () => {
    const rows = buildAgentCapabilityAudit({
      actions: getRegisteredActionMetadata(),
      config: defaultAgentCoreConfig,
      executableSkills: getExecutableSkillMetadata()
    });
    const byId = new Map(rows.map((row) => [row.catalogId, row]));

    expect(byId.get("artifact-generate")).toMatchObject({
      catalogStatus: "active",
      executionStatus: "skill_executor",
      risk: "medium"
    });
    expect(byId.get("settings-adjust")).toMatchObject({
      actionIds: ["settings.update"],
      executionStatus: "skill_executor"
    });
    expect(byId.get("workspace-organize")).toMatchObject({
      actionFamilies: ["dock", "layout", "panel", "theme"],
      executionStatus: "action_family"
    });
    expect(byId.get("literature-summarize")).toMatchObject({
      executionStatus: "catalog_only",
      note: "当前仅作为 Agent Core 能力说明进入 prompt，上层 QA 路径可处理文献问题，但没有独立 skill executor。"
    });
  });

  test("summarizes execution coverage for settings governance", () => {
    const rows = buildAgentCapabilityAudit({
      actions: getRegisteredActionMetadata(),
      config: defaultAgentCoreConfig,
      executableSkills: getExecutableSkillMetadata()
    });

    expect(getAgentCapabilityAuditSummary(rows)).toEqual({
      actionFamilyCount: 1,
      catalogOnlyCount: 3,
      skillExecutorCount: 3,
      total: 7
    });
    expect(getAgentCapabilityExecutionLabel("skill_executor")).toBe("可执行 Skill");
    expect(getAgentCapabilityExecutionLabel("action_family")).toBe("Action 家族支撑");
    expect(getAgentCapabilityExecutionLabel("catalog_only")).toBe("仅目录/提示词");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
cd products/liteasy/apps/desktop
npm test -- src/tests/agentCapabilityAudit.test.ts
```

Expected: FAIL because `capabilityAudit.ts` and `getExecutableSkillMetadata` do not exist.

- [ ] **Step 3: Expose executable skill metadata**

Modify `products/liteasy/apps/desktop/src/app/features/skills/skillRegistry.ts`.

Update the imports:

```ts
import type { ArtifactType } from "../artifacts/artifact.types";
import { executeAction } from "./actionRegistry";
import type { ActionContext, ActionInvocation, ActionResult } from "./actionRegistry";
import type { UpdateSettingCommand } from "../settings/settings.types";
```

Add this type and constant after `SkillInvocation`:

```ts
export type ExecutableSkillMetadata = {
  actionIds: ActionInvocation["actionId"][];
  catalogId: string;
  skillId: SkillInvocation["skillId"];
};

const executableSkillMetadata: ExecutableSkillMetadata[] = [
  {
    actionIds: ["settings.update"],
    catalogId: "settings-adjust",
    skillId: "settings.adjust"
  },
  {
    actionIds: ["artifact.generate"],
    catalogId: "artifact-generate",
    skillId: "artifact.generate"
  },
  {
    actionIds: ["organization.open_shared_library"],
    catalogId: "organization-library-open",
    skillId: "organization.open_shared_library"
  }
];

export function getExecutableSkillMetadata(): ExecutableSkillMetadata[] {
  return executableSkillMetadata.map((entry) => ({
    ...entry,
    actionIds: [...entry.actionIds]
  }));
}
```

- [ ] **Step 4: Add the capability audit helper**

Create `products/liteasy/apps/desktop/src/app/features/agent-core/capabilityAudit.ts`:

```ts
import type {
  AgentCoreCatalogEntry,
  AgentCoreConfig,
  AgentCoreEntryStatus
} from "./agentCoreConfig";
import type {
  CapabilityFamily,
  RegisteredActionMetadata
} from "../skills/actionRegistry";
import type { ExecutableSkillMetadata } from "../skills/skillRegistry";

export type AgentCapabilityExecutionStatus =
  | "action_family"
  | "catalog_only"
  | "skill_executor";

export type AgentCapabilityAuditRow = {
  actionFamilies: CapabilityFamily[];
  actionIds: RegisteredActionMetadata["actionId"][];
  catalogId: string;
  catalogStatus: AgentCoreEntryStatus;
  executionStatus: AgentCapabilityExecutionStatus;
  label: string;
  note: string;
  risk: AgentCoreCatalogEntry["risk"];
};

export type AgentCapabilityAuditSummary = {
  actionFamilyCount: number;
  catalogOnlyCount: number;
  skillExecutorCount: number;
  total: number;
};

const catalogActionFamilies: Record<string, CapabilityFamily[]> = {
  "workspace-organize": ["dock", "layout", "panel", "theme"]
};

function uniqueSorted<T extends string>(values: T[]): T[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function getActionFamiliesForCatalog(
  catalogId: string,
  actions: RegisteredActionMetadata[]
) {
  const supportedFamilies = catalogActionFamilies[catalogId] ?? [];
  return uniqueSorted(
    actions
      .filter((action) => supportedFamilies.includes(action.family))
      .map((action) => action.family)
  );
}

function getNote(input: {
  actionFamilies: CapabilityFamily[];
  catalogEntry: AgentCoreCatalogEntry;
  executableSkill?: ExecutableSkillMetadata;
  executionStatus: AgentCapabilityExecutionStatus;
}) {
  if (input.executionStatus === "skill_executor" && input.executableSkill) {
    return `通过 ${input.executableSkill.skillId} 调用 ${input.executableSkill.actionIds.join(", ")}。`;
  }

  if (input.executionStatus === "action_family") {
    return `通过 ${input.actionFamilies.join(", ")} action family 支撑，但没有独立 skill executor。`;
  }

  if (input.catalogEntry.status === "planned") {
    return "当前仅作为规划项展示，尚未进入可执行链路。";
  }

  return "当前仅作为 Agent Core 能力说明进入 prompt，上层 QA 路径可处理文献问题，但没有独立 skill executor。";
}

export function buildAgentCapabilityAudit(input: {
  actions: RegisteredActionMetadata[];
  config: AgentCoreConfig;
  executableSkills: ExecutableSkillMetadata[];
}): AgentCapabilityAuditRow[] {
  return input.config.skills.map((catalogEntry) => {
    const executableSkill = input.executableSkills.find(
      (entry) => entry.catalogId === catalogEntry.id
    );
    const actionFamilies = executableSkill
      ? []
      : getActionFamiliesForCatalog(catalogEntry.id, input.actions);
    const executionStatus: AgentCapabilityExecutionStatus = executableSkill
      ? "skill_executor"
      : actionFamilies.length > 0
        ? "action_family"
        : "catalog_only";

    return {
      actionFamilies,
      actionIds: executableSkill?.actionIds ?? [],
      catalogId: catalogEntry.id,
      catalogStatus: catalogEntry.status,
      executionStatus,
      label: catalogEntry.label,
      note: getNote({
        actionFamilies,
        catalogEntry,
        executableSkill,
        executionStatus
      }),
      risk: catalogEntry.risk
    };
  });
}

export function getAgentCapabilityAuditSummary(
  rows: AgentCapabilityAuditRow[]
): AgentCapabilityAuditSummary {
  return rows.reduce<AgentCapabilityAuditSummary>(
    (summary, row) => {
      if (row.executionStatus === "skill_executor") {
        summary.skillExecutorCount += 1;
      } else if (row.executionStatus === "action_family") {
        summary.actionFamilyCount += 1;
      } else {
        summary.catalogOnlyCount += 1;
      }
      summary.total += 1;
      return summary;
    },
    {
      actionFamilyCount: 0,
      catalogOnlyCount: 0,
      skillExecutorCount: 0,
      total: 0
    }
  );
}

export function getAgentCapabilityExecutionLabel(
  status: AgentCapabilityExecutionStatus
) {
  if (status === "skill_executor") {
    return "可执行 Skill";
  }

  if (status === "action_family") {
    return "Action 家族支撑";
  }

  return "仅目录/提示词";
}
```

- [ ] **Step 5: Run the capability audit test to verify it passes**

Run:

```bash
cd products/liteasy/apps/desktop
npm test -- src/tests/agentCapabilityAudit.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add products/liteasy/apps/desktop/src/app/features/skills/skillRegistry.ts products/liteasy/apps/desktop/src/app/features/agent-core/capabilityAudit.ts products/liteasy/apps/desktop/src/tests/agentCapabilityAudit.test.ts
git commit -m "feat: add agent capability audit"
```

---

### Task 2: Agent Settings Governance View

**Files:**
- Modify: `products/liteasy/apps/desktop/src/app/features/agent-core/AgentSettingsPanel.tsx`
- Modify: `products/liteasy/apps/desktop/src/app/styles/app.css`
- Test: `products/liteasy/apps/desktop/src/tests/SettingsPane.test.tsx`

- [ ] **Step 1: Extend the settings test with capability audit copy**

Modify `products/liteasy/apps/desktop/src/tests/SettingsPane.test.tsx` inside the existing test after the assertion for `Skill 条目`:

```ts
    expect(within(pane).getByText("Capability Audit")).toBeInTheDocument();
    expect(within(pane).getByText("可执行 Skill：3")).toBeInTheDocument();
    expect(within(pane).getByText("Action 家族支撑：1")).toBeInTheDocument();
    expect(within(pane).getByText("仅目录/提示词：3")).toBeInTheDocument();
    expect(within(pane).getAllByText("可执行 Skill").length).toBeGreaterThanOrEqual(3);
    expect(within(pane).getByText("Action 家族支撑")).toBeInTheDocument();
    expect(within(pane).getAllByText("仅目录/提示词").length).toBeGreaterThanOrEqual(3);
    expect(
      within(pane).getAllByText("当前仅作为规划项展示，尚未进入可执行链路。").length
    ).toBeGreaterThanOrEqual(2);
```

- [ ] **Step 2: Run the settings test to verify it fails**

Run:

```bash
cd products/liteasy/apps/desktop
npm test -- src/tests/SettingsPane.test.tsx
```

Expected: FAIL because the capability audit section is not rendered.

- [ ] **Step 3: Render audit summary and per-skill backing**

Modify `products/liteasy/apps/desktop/src/app/features/agent-core/AgentSettingsPanel.tsx`.

Add imports:

```ts
import {
  buildAgentCapabilityAudit,
  getAgentCapabilityAuditSummary,
  getAgentCapabilityExecutionLabel,
  type AgentCapabilityAuditRow
} from "./capabilityAudit";
import { getRegisteredActionMetadata } from "../skills/actionRegistry";
import { getExecutableSkillMetadata } from "../skills/skillRegistry";
```

Replace the `AgentCatalogList` props type and function with:

```tsx
function AgentCatalogList({
  auditRows,
  entries,
  onOpenSkillDocument,
  title
}: {
  auditRows?: AgentCapabilityAuditRow[];
  entries: AgentCoreCatalogEntry[];
  onOpenSkillDocument?: (entry: AgentCoreCatalogEntry) => void;
  title: string;
}) {
  const auditById = new Map(auditRows?.map((row) => [row.catalogId, row]) ?? []);

  return (
    <div className="agent-settings-section">
      <div className="agent-settings-section-title">{title}</div>
      <div className="agent-settings-list">
        {entries.map((entry) => {
          const audit = auditById.get(entry.id);

          return (
            <div className="agent-settings-row" key={entry.id}>
              <div className="agent-settings-row-main">
                <div className="agent-settings-row-title">{entry.label}</div>
                <div className="agent-settings-row-description">{entry.description}</div>
                {audit ? (
                  <div className="agent-settings-row-description">{audit.note}</div>
                ) : null}
              </div>
              <div className="agent-settings-badge-stack">
                <div className={`agent-settings-badge ${entry.status}`}>
                  {getAgentEntryStatusLabel(entry.status)}
                </div>
                {audit ? (
                  <div className={`agent-settings-badge execution-${audit.executionStatus}`}>
                    {getAgentCapabilityExecutionLabel(audit.executionStatus)}
                  </div>
                ) : null}
              </div>
              {entry.docMarkdown ? (
                <button
                  className="agent-settings-doc-button"
                  onClick={() => onOpenSkillDocument?.(entry)}
                  type="button"
                >
                  打开文档
                </button>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
```

Inside `AgentSettingsPanel`, add this after `safetyItems`:

```ts
  const capabilityAuditRows = buildAgentCapabilityAudit({
    actions: getRegisteredActionMetadata(),
    config,
    executableSkills: getExecutableSkillMetadata()
  });
  const capabilityAuditSummary = getAgentCapabilityAuditSummary(capabilityAuditRows);
```

Add this JSX after the `agent-settings-budget` block and before the first `AgentCatalogList`:

```tsx
      <div className="agent-settings-section" aria-label="Agent capability audit">
        <div className="agent-settings-section-title">Capability Audit</div>
        <div className="agent-settings-chip-row">
          <span className="agent-settings-chip">
            可执行 Skill：{capabilityAuditSummary.skillExecutorCount}
          </span>
          <span className="agent-settings-chip">
            Action 家族支撑：{capabilityAuditSummary.actionFamilyCount}
          </span>
          <span className="agent-settings-chip">
            仅目录/提示词：{capabilityAuditSummary.catalogOnlyCount}
          </span>
        </div>
      </div>
```

Update the skill list call:

```tsx
      <AgentCatalogList
        auditRows={capabilityAuditRows}
        entries={config.skills}
        onOpenSkillDocument={onOpenSkillDocument}
        title="Skill 条目"
      />
```

- [ ] **Step 4: Add badge stack styles**

Modify `products/liteasy/apps/desktop/src/app/styles/app.css` after `.agent-settings-badge`:

```css
.agent-settings-badge-stack {
  align-items: flex-end;
  display: grid;
  flex: 0 0 auto;
  gap: 5px;
  justify-items: end;
}
```

Add this after the existing `.agent-settings-badge.review, .agent-settings-badge.memory` block:

```css
.agent-settings-badge.execution-skill_executor {
  border-color: rgba(70, 132, 87, 0.28);
  background: rgba(235, 248, 239, 0.88);
  color: #2f6c43;
}

.agent-settings-badge.execution-action_family {
  border-color: rgba(71, 124, 167, 0.26);
  background: rgba(235, 244, 252, 0.9);
  color: #315f85;
}

.agent-settings-badge.execution-catalog_only {
  border-color: rgba(148, 111, 42, 0.24);
  background: rgba(255, 247, 229, 0.9);
  color: #785b24;
}
```

- [ ] **Step 5: Run the settings test to verify it passes**

Run:

```bash
cd products/liteasy/apps/desktop
npm test -- src/tests/SettingsPane.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add products/liteasy/apps/desktop/src/app/features/agent-core/AgentSettingsPanel.tsx products/liteasy/apps/desktop/src/app/styles/app.css products/liteasy/apps/desktop/src/tests/SettingsPane.test.tsx
git commit -m "feat: show agent capability audit"
```

---

### Task 3: Public Agent Event Presenter

**Files:**
- Create: `products/liteasy/apps/desktop/src/app/features/assistant/agentEventPresenter.ts`
- Modify: `products/liteasy/apps/desktop/src/app/features/assistant/AssistantPane.tsx`
- Test: `products/liteasy/apps/desktop/src/tests/agentEventPresenter.test.ts`

- [ ] **Step 1: Write the presenter test**

Create `products/liteasy/apps/desktop/src/tests/agentEventPresenter.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import { formatPublicAgentEventMessage } from "../app/features/assistant/agentEventPresenter";
import type { AgentEvent } from "../app/features/agent-api/agentApi.types";

function event(overrides: Partial<AgentEvent>): AgentEvent {
  return {
    apiVersion: "liteasy.agent/v1",
    emittedAt: "2026-07-26T00:00:00.000Z",
    eventId: "event-1",
    runId: "run-1",
    sequence: 1,
    sessionId: "session-1",
    type: "run.completed",
    ...overrides
  } as AgentEvent;
}

describe("agent event presenter", () => {
  test("formats public run events used by AssistantPane", () => {
    expect(
      formatPublicAgentEventMessage(
        event({
          plan: {
            actionIds: ["settings.update"],
            planId: "plan-settings",
            requiresConfirmation: false,
            riskLevel: "low",
            summary: "关闭联网推荐"
          },
          type: "plan.preview"
        })
      )
    ).toBe("计划：关闭联网推荐");

    expect(
      formatPublicAgentEventMessage(
        event({
          missing: ["selected_document_set"],
          question: "请先锁定当前选中文献集。",
          type: "clarification.required"
        })
      )
    ).toBe("请先锁定当前选中文献集。");

    expect(
      formatPublicAgentEventMessage(
        event({
          message: "执行失败",
          recovery: "请检查 action handler。",
          type: "run.failed"
        })
      )
    ).toBe("执行失败");

    expect(formatPublicAgentEventMessage(event({ type: "run.completed" }))).toBeNull();
  });
});
```

- [ ] **Step 2: Run the presenter test to verify it fails**

Run:

```bash
cd products/liteasy/apps/desktop
npm test -- src/tests/agentEventPresenter.test.ts
```

Expected: FAIL because `agentEventPresenter.ts` does not exist.

- [ ] **Step 3: Add the public event presenter**

Create `products/liteasy/apps/desktop/src/app/features/assistant/agentEventPresenter.ts`:

```ts
import type { AgentEvent } from "../agent-api/agentApi.types";

export function formatPublicAgentEventMessage(event: AgentEvent): string | null {
  if (event.type === "plan.preview") {
    return `计划：${event.plan.summary}`;
  }

  if (event.type === "progress.started") {
    return `开始执行：${event.summary}`;
  }

  if (event.type === "clarification.required") {
    return event.question;
  }

  if (event.type === "confirmation.required") {
    return event.summary;
  }

  if (event.type === "action.requested") {
    return `准备执行受控动作：${event.action.actionId}`;
  }

  if (event.type === "action.failed" || event.type === "run.failed") {
    return event.message;
  }

  if (event.type === "task.requested") {
    return "后台任务已请求。";
  }

  if (event.type === "task.created") {
    return "后台任务已创建。";
  }

  if (event.type === "artifact.requested") {
    return "产物创建已请求。";
  }

  if (event.type === "run.cancelled") {
    return event.reason ? `运行已取消：${event.reason}` : "运行已取消。";
  }

  return null;
}
```

- [ ] **Step 4: Use the presenter in AssistantPane**

Modify `products/liteasy/apps/desktop/src/app/features/assistant/AssistantPane.tsx`.

Add this import:

```ts
import { formatPublicAgentEventMessage } from "./agentEventPresenter";
```

Inside `appendPublicAgentEvent`, replace this block:

```ts
    let message: string | null = null;
    if (event.type === "plan.preview") {
      message = `计划：${event.plan.summary}`;
    } else if (event.type === "progress.started") {
      message = `开始执行：${event.summary}`;
    } else if (event.type === "clarification.required") {
      message = event.question;
    } else if (event.type === "confirmation.required") {
      message = event.summary;
    } else if (event.type === "action.requested") {
      message = `准备执行受控动作：${event.action.actionId}`;
    } else if (event.type === "action.failed" || event.type === "run.failed") {
      message = event.message;
    } else if (event.type === "task.requested") {
      message = "后台任务已请求。";
    } else if (event.type === "task.created") {
      message = "后台任务已创建。";
    } else if (event.type === "artifact.requested") {
      message = "产物创建已请求。";
    } else if (event.type === "run.cancelled") {
      message = event.reason ? `运行已取消：${event.reason}` : "运行已取消。";
    }
```

with:

```ts
    const message = formatPublicAgentEventMessage(event);
```

- [ ] **Step 5: Run the presenter and assistant tests**

Run:

```bash
cd products/liteasy/apps/desktop
npm test -- src/tests/agentEventPresenter.test.ts src/tests/AssistantPane.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add products/liteasy/apps/desktop/src/app/features/assistant/agentEventPresenter.ts products/liteasy/apps/desktop/src/app/features/assistant/AssistantPane.tsx products/liteasy/apps/desktop/src/tests/agentEventPresenter.test.ts
git commit -m "refactor: extract agent event presenter"
```

---

### Task 4: Retrieval Readiness Audit

**Files:**
- Create: `products/liteasy/apps/desktop/src/app/features/retrieval/retrievalReadiness.ts`
- Test: `products/liteasy/apps/desktop/src/tests/retrievalReadiness.test.ts`

- [ ] **Step 1: Write the readiness test**

Create `products/liteasy/apps/desktop/src/tests/retrievalReadiness.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import { evaluateRetrievalReadiness } from "../app/features/retrieval/retrievalReadiness";
import type { Paper } from "../app/features/workspace/workspace.types";

const papers: Paper[] = [
  {
    abstract: "A",
    authors: ["One"],
    id: "paper-1",
    selected: true,
    title: "First Paper",
    year: 2026
  },
  {
    abstract: "B",
    authors: ["Two"],
    id: "paper-2",
    selected: true,
    title: "Second Paper",
    year: 2026
  }
];

describe("retrieval readiness", () => {
  test("reports empty selection before retrieval starts", () => {
    expect(
      evaluateRetrievalReadiness({
        importedChunksByPaperId: {},
        selectedPapers: []
      })
    ).toEqual({
      importedPaperCount: 0,
      missingPaperIds: [],
      ready: false,
      selectedPaperCount: 0,
      status: "empty_selection",
      summary: "请先选择要交给 Agent 分析的文献。"
    });
  });

  test("reports partial evidence coverage", () => {
    expect(
      evaluateRetrievalReadiness({
        importedChunksByPaperId: {
          "paper-1": [
            {
              page: 1,
              paperId: "paper-1",
              paperTitle: "First Paper",
              snippet: "retrieval snippet",
              summary: "summary",
              tags: ["retrieval"]
            }
          ]
        },
        selectedPapers: papers
      })
    ).toEqual({
      importedPaperCount: 1,
      missingPaperIds: ["paper-2"],
      ready: false,
      selectedPaperCount: 2,
      status: "partial",
      summary: "2 篇选中文献中已有 1 篇具备检索片段，缺失：paper-2。"
    });
  });

  test("reports ready when every selected paper has chunks", () => {
    const result = evaluateRetrievalReadiness({
      importedChunksByPaperId: {
        "paper-1": [
          {
            page: 1,
            paperId: "paper-1",
            paperTitle: "First Paper",
            snippet: "retrieval snippet",
            summary: "summary",
            tags: ["retrieval"]
          }
        ],
        "paper-2": [
          {
            page: 2,
            paperId: "paper-2",
            paperTitle: "Second Paper",
            snippet: "agent snippet",
            summary: "summary",
            tags: ["agent"]
          }
        ]
      },
      selectedPapers: papers
    });

    expect(result).toMatchObject({
      importedPaperCount: 2,
      missingPaperIds: [],
      ready: true,
      selectedPaperCount: 2,
      status: "ready"
    });
  });
});
```

- [ ] **Step 2: Run the readiness test to verify it fails**

Run:

```bash
cd products/liteasy/apps/desktop
npm test -- src/tests/retrievalReadiness.test.ts
```

Expected: FAIL because `retrievalReadiness.ts` does not exist.

- [ ] **Step 3: Add retrieval readiness helper**

Create `products/liteasy/apps/desktop/src/app/features/retrieval/retrievalReadiness.ts`:

```ts
import type { Paper } from "../workspace/workspace.types";
import type { RetrievalChunk } from "./retrieval.types";

export type RetrievalReadinessStatus =
  | "empty_selection"
  | "missing_chunks"
  | "partial"
  | "ready";

export type RetrievalReadiness = {
  importedPaperCount: number;
  missingPaperIds: string[];
  ready: boolean;
  selectedPaperCount: number;
  status: RetrievalReadinessStatus;
  summary: string;
};

function hasChunks(chunks: RetrievalChunk[] | undefined) {
  return Boolean(chunks?.some((chunk) => chunk.snippet.trim().length > 0));
}

export function evaluateRetrievalReadiness(input: {
  importedChunksByPaperId: Record<string, RetrievalChunk[]>;
  selectedPapers: Paper[];
}): RetrievalReadiness {
  const selectedPaperIds = input.selectedPapers.map((paper) => paper.id);
  const selectedPaperCount = selectedPaperIds.length;

  if (selectedPaperCount === 0) {
    return {
      importedPaperCount: 0,
      missingPaperIds: [],
      ready: false,
      selectedPaperCount,
      status: "empty_selection",
      summary: "请先选择要交给 Agent 分析的文献。"
    };
  }

  const missingPaperIds = selectedPaperIds.filter(
    (paperId) => !hasChunks(input.importedChunksByPaperId[paperId])
  );
  const importedPaperCount = selectedPaperCount - missingPaperIds.length;

  if (missingPaperIds.length === 0) {
    return {
      importedPaperCount,
      missingPaperIds,
      ready: true,
      selectedPaperCount,
      status: "ready",
      summary: `${selectedPaperCount} 篇选中文献均具备检索片段。`
    };
  }

  if (importedPaperCount === 0) {
    return {
      importedPaperCount,
      missingPaperIds,
      ready: false,
      selectedPaperCount,
      status: "missing_chunks",
      summary: `${selectedPaperCount} 篇选中文献尚未生成检索片段。`
    };
  }

  return {
    importedPaperCount,
    missingPaperIds,
    ready: false,
    selectedPaperCount,
    status: "partial",
    summary: `${selectedPaperCount} 篇选中文献中已有 ${importedPaperCount} 篇具备检索片段，缺失：${missingPaperIds.join(", ")}。`
  };
}
```

- [ ] **Step 4: Run the readiness test to verify it passes**

Run:

```bash
cd products/liteasy/apps/desktop
npm test -- src/tests/retrievalReadiness.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add products/liteasy/apps/desktop/src/app/features/retrieval/retrievalReadiness.ts products/liteasy/apps/desktop/src/tests/retrievalReadiness.test.ts
git commit -m "feat: add retrieval readiness audit"
```

---

### Task 5: High-Risk Action Audit

**Files:**
- Create: `products/liteasy/apps/desktop/src/app/features/actions/highRiskActionAudit.ts`
- Test: `products/liteasy/apps/desktop/src/tests/highRiskActionAudit.test.ts`

- [ ] **Step 1: Write the high-risk action audit test**

Create `products/liteasy/apps/desktop/src/tests/highRiskActionAudit.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import {
  buildHighRiskActionAudit,
  getHighRiskActionAuditSummary
} from "../app/features/actions/highRiskActionAudit";
import { getRegisteredActionMetadata } from "../app/features/skills/actionRegistry";

describe("high-risk action audit", () => {
  test("keeps destructive and cloud-write actions confirmation-gated", () => {
    const rows = buildHighRiskActionAudit(getRegisteredActionMetadata());

    expect(rows.map((row) => row.actionId).sort()).toEqual([
      "cloud.sync_workspace",
      "cloud.upload_documents",
      "workspace.batch_update_documents",
      "workspace.delete_documents",
      "workspace.overwrite_documents"
    ]);
    expect(rows.every((row) => row.requiresConfirmation)).toBe(true);
    expect(rows.every((row) => row.executionStatus === "blocked_until_handler_registered")).toBe(true);
    expect(getHighRiskActionAuditSummary(rows)).toEqual({
      blockedCount: 5,
      confirmationGatedCount: 5,
      total: 5
    });
  });
});
```

- [ ] **Step 2: Run the high-risk action audit test to verify it fails**

Run:

```bash
cd products/liteasy/apps/desktop
npm test -- src/tests/highRiskActionAudit.test.ts
```

Expected: FAIL because `highRiskActionAudit.ts` does not exist.

- [ ] **Step 3: Add high-risk action audit helper**

Create `products/liteasy/apps/desktop/src/app/features/actions/highRiskActionAudit.ts`:

```ts
import type { RegisteredActionMetadata } from "../skills/actionRegistry";

export type HighRiskActionExecutionStatus =
  | "blocked_until_handler_registered"
  | "handler_registered";

export type HighRiskActionAuditRow = {
  actionId: RegisteredActionMetadata["actionId"];
  executionStatus: HighRiskActionExecutionStatus;
  family: RegisteredActionMetadata["family"];
  label: string;
  requiredContext: string[];
  requiresConfirmation: boolean;
};

export type HighRiskActionAuditSummary = {
  blockedCount: number;
  confirmationGatedCount: number;
  total: number;
};

const blockedHighRiskActionIds = new Set<RegisteredActionMetadata["actionId"]>([
  "cloud.sync_workspace",
  "cloud.upload_documents",
  "workspace.batch_update_documents",
  "workspace.delete_documents",
  "workspace.overwrite_documents"
]);

export function buildHighRiskActionAudit(
  actions: RegisteredActionMetadata[]
): HighRiskActionAuditRow[] {
  return actions
    .filter((action) => action.riskLevel === "high")
    .map((action) => ({
      actionId: action.actionId,
      executionStatus: blockedHighRiskActionIds.has(action.actionId)
        ? "blocked_until_handler_registered"
        : "handler_registered",
      family: action.family,
      label: action.label,
      requiredContext: [...action.requiredContext],
      requiresConfirmation: action.requiresConfirmation
    }));
}

export function getHighRiskActionAuditSummary(
  rows: HighRiskActionAuditRow[]
): HighRiskActionAuditSummary {
  return rows.reduce<HighRiskActionAuditSummary>(
    (summary, row) => {
      if (row.executionStatus === "blocked_until_handler_registered") {
        summary.blockedCount += 1;
      }
      if (row.requiresConfirmation) {
        summary.confirmationGatedCount += 1;
      }
      summary.total += 1;
      return summary;
    },
    {
      blockedCount: 0,
      confirmationGatedCount: 0,
      total: 0
    }
  );
}
```

- [ ] **Step 4: Run the high-risk action audit test to verify it passes**

Run:

```bash
cd products/liteasy/apps/desktop
npm test -- src/tests/highRiskActionAudit.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add products/liteasy/apps/desktop/src/app/features/actions/highRiskActionAudit.ts products/liteasy/apps/desktop/src/tests/highRiskActionAudit.test.ts
git commit -m "test: audit high-risk agent actions"
```

---

### Task 6: Architecture Audit Cross-Link

**Files:**
- Modify: `docs/engineering/agent-architecture-audit.md`

- [ ] **Step 1: Add the Phase 1 tracking link**

Modify `docs/engineering/agent-architecture-audit.md` after the maturity marker section:

```md
## Phase 1 Tracking

当前第一阶段执行计划见：

- `docs/superpowers/plans/2026-07-26-liteasyclaw-agent-architecture-hardening-phase1.md`

该计划只处理现有 Agent 架构硬化，不包含完整 plugin runtime、domain MCP server 或高风险写操作 handler。
```

- [ ] **Step 2: Verify the cross-link renders as Markdown**

Run:

```bash
rg -n "Phase 1 Tracking|agent-architecture-hardening-phase1" docs/engineering/agent-architecture-audit.md
```

Expected:

```text
The output contains one match for "## Phase 1 Tracking" and one match for "2026-07-26-liteasyclaw-agent-architecture-hardening-phase1.md".
```

- [ ] **Step 3: Commit**

```bash
git add docs/engineering/agent-architecture-audit.md
git commit -m "docs: link agent hardening plan"
```

---

### Task 7: Final Verification

**Files:**
- Verify only; no source edits expected in this task.

- [ ] **Step 1: Run focused desktop tests**

Run:

```bash
cd products/liteasy/apps/desktop
npm test -- src/tests/agentCapabilityAudit.test.ts src/tests/SettingsPane.test.tsx src/tests/agentEventPresenter.test.ts src/tests/retrievalReadiness.test.ts src/tests/highRiskActionAudit.test.ts src/tests/AssistantPane.test.tsx
```

Expected: PASS for all listed test files.

- [ ] **Step 2: Run full desktop test suite**

Run:

```bash
cd products/liteasy/apps/desktop
npm test
```

Expected: PASS.

- [ ] **Step 3: Run production build**

Run:

```bash
cd products/liteasy/apps/desktop
npm run build
```

Expected: PASS with Vite production output and TypeScript compile success.

- [ ] **Step 4: Commit verification notes if the implementation changed docs**

If Task 6 was the last documentation commit and no files changed during verification, do not create an empty commit.

Run:

```bash
git status --short
```

Expected: no output.

If verification produced a deliberate docs note, commit only that docs file:

```bash
git add docs/engineering/agent-architecture-audit.md
git commit -m "docs: record agent hardening verification"
```

---

## Assignment Map

| Track | Primary task | Suggested owner |
|---|---|---|
| Agent Core Governance | Task 1, Task 2 | Agent architecture owner |
| Assistant/API Convergence | Task 3 | Frontend architecture owner |
| Retrieval/Ingestion Readiness | Task 4 | Retrieval owner |
| Safety/Governance QA | Task 5 | Safety or QA owner |
| Documentation Control | Task 6 | Tech lead |
| Release Confidence | Task 7 | Integrator |

## Review Checklist

Before merging Phase 1, reviewers should verify:

1. `AgentSettingsPanel` shows both catalog status and execution backing for every configured skill.
2. Active catalog entries that are not executable are visibly labeled as catalog/prompt-only.
3. `AssistantPane` uses `formatPublicAgentEventMessage` for public Agent non-UI event text.
4. Retrieval readiness reports empty, missing, partial, and ready states without calling a model.
5. High-risk actions remain confirmation-gated and blocked until a dedicated handler is intentionally registered.
6. The full desktop test suite and production build pass.
