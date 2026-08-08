import { getAvailableVisualizationModalities } from "../visualization/visualizationRendererRegistry";
import { isGeneratedVisualizationModality } from "../visualization/visualizationRuntime";

export type AgentCoreEntryStatus = "active" | "planned" | "review";

export type AgentCoreCatalogEntry = {
  docMarkdown?: string;
  docPath?: string;
  description: string;
  id: string;
  label: string;
  risk: "low" | "medium" | "high";
  status: AgentCoreEntryStatus;
};

export type AgentMemoryEntry = {
  id: string;
  importance: "高" | "中" | "低";
  namespace: string;
  summary: string;
  type: "偏好" | "画像" | "项目" | "经历";
};

export type AgentCoreConfig = {
  agentMd: {
    path: string;
    revision: string;
    summary: string;
  };
  budget: {
    maxIterations: number;
    maxToolCalls: number;
    staleObservationTurns: number;
  };
  mcpServers: AgentCoreCatalogEntry[];
  memories: AgentMemoryEntry[];
  plugins: AgentCoreCatalogEntry[];
  safety: {
    highRiskRequiresConfirmation: boolean;
    memoryWriteNeedsScan: boolean;
    namespaceIsolation: boolean;
  };
  skills: AgentCoreCatalogEntry[];
  status: "design_ready" | "disabled" | "running";
};

export function getAgentCoreSkills(config: AgentCoreConfig): AgentCoreCatalogEntry[] {
  if (config.skills.some((skill) => skill.id === "thin-reading-visualize")) return config.skills;
  const hasGeneratedVisualization = getAvailableVisualizationModalities()
    .some(isGeneratedVisualizationModality);
  if (!hasGeneratedVisualization) return config.skills;
  return [
    ...config.skills,
    {
      description: "按证据边界选择适合当前文献的可视化表达。",
      id: "thin-reading-visualize",
      label: "文献可视化",
      risk: "low",
      status: "active"
    }
  ];
}

export const defaultAgentCoreConfig: AgentCoreConfig = {
  agentMd: {
    path: "agent.md",
    revision: "v0.1 design",
    summary: "Liteasy 学术工作台 Agent：优先服务文献理解、知识组织、产物生成和受控工作区操作。"
  },
  budget: {
    maxIterations: 64,
    maxToolCalls: 32,
    staleObservationTurns: 3
  },
  mcpServers: [
    {
      description: "暴露本地 PDF、Markdown 笔记和选中文献集检索工具。",
      id: "local-library",
      label: "本地文献库 MCP",
      risk: "medium",
      status: "planned"
    },
    {
      description: "提供 DOI、BibTeX、CSL 和引用格式化能力。",
      id: "citation-tools",
      label: "引用工具 MCP",
      risk: "low",
      status: "planned"
    }
  ],
  memories: [
    {
      id: "pref-output-zh",
      importance: "高",
      namespace: "local-user",
      summary: "默认使用中文输出，并保留可执行下一步。",
      type: "偏好"
    },
    {
      id: "profile-research-workbench",
      importance: "中",
      namespace: "local-user",
      summary: "用户主要在 Liteasy 中做文献阅读、论文比较和知识卡片整理。",
      type: "画像"
    },
    {
      id: "project-agent-core",
      importance: "高",
      namespace: "workspace",
      summary: "当前项目需要补齐 Agent 核心：agent.md、skills、plugins、MCP、memory 和预算治理。",
      type: "项目"
    }
  ],
  plugins: [
    {
      description: "从 PDF 元数据、DOI 和题录中生成统一引用字段。",
      id: "citation-normalizer",
      label: "引用规范化插件",
      risk: "low",
      status: "planned"
    },
    {
      description: "把分析结果写入卡片、脑图和阅读笔记产物。",
      id: "artifact-writer",
      label: "产物写入插件",
      risk: "medium",
      status: "review"
    }
  ],
  safety: {
    highRiskRequiresConfirmation: true,
    memoryWriteNeedsScan: true,
    namespaceIsolation: true
  },
  skills: [
    {
      docMarkdown: [
        "# artifact-generate",
        "",
        "## 目标",
        "",
        "把文献分析结果转换成 Liteasy 可展示的产物，例如脑图、知识卡片、表格、复习笔记或报告草稿。",
        "",
        "## 安全边界",
        "",
        "- 只能调用已注册的产物生成 action。",
        "- 不直接修改原始 PDF。",
        "- 涉及组织资料写入时需要确认。"
      ].join("\n"),
      description: "基于选中文献生成摘要、脑图、卡片或结构化笔记。",
      id: "artifact-generate",
      label: "生成学术产物",
      risk: "medium",
      status: "active"
    },
    {
      docMarkdown: [
        "# organization-library-open",
        "",
        "## 目标",
        "",
        "在用户授权和组织上下文可用时，打开组织共享资料区，并把组织资料作为受控上下文来源。",
        "",
        "## 安全边界",
        "",
        "- 未登录、无组织或 manifest 为空时必须拒绝或澄清。",
        "- 不跨组织读取资料。",
        "- 不把组织资料发送到未声明的外部 API。"
      ].join("\n"),
      description: "打开组织资料区，并把云端资料作为受控上下文。",
      id: "organization-library-open",
      label: "组织资料区",
      risk: "medium",
      status: "active"
    },
    {
      docMarkdown: [
        "# settings-adjust",
        "",
        "## 目标",
        "",
        "处理低风险设置变更，例如回答语言、默认输出模式、联网推荐排序等。",
        "",
        "## 安全边界",
        "",
        "- 只能修改白名单设置项。",
        "- 高风险策略、模型密钥、API endpoint 不通过自然语言静默修改。",
        "- 修改后必须给出明确反馈。"
      ].join("\n"),
      description: "调整低风险用户设置，例如回答语言和默认输出模式。",
      id: "settings-adjust",
      label: "设置调整",
      risk: "low",
      status: "active"
    },
    {
      docMarkdown: [
        "# literature-summarize",
        "",
        "## 目标",
        "",
        "基于当前选中文献集生成结构化摘要，帮助用户快速理解论文的问题、方法、实验、结论和局限。",
        "",
        "## 安全边界",
        "",
        "- 只能读取已导入的选中文献片段。",
        "- 不访问任意本地文件。",
        "- 不执行写操作。"
      ].join("\n"),
      description: "基于 PDF 选区或选中文献片段回答问题、解释概念并生成摘要。",
      id: "literature-summarize",
      label: "文献摘要",
      risk: "low",
      status: "active"
    },
    {
      docMarkdown: [
        "# literature-compare",
        "",
        "## 目标",
        "",
        "比较多篇文献在研究问题、方法、数据集、指标、结论和适用边界上的异同。",
        "",
        "## 安全边界",
        "",
        "- 只比较当前选中文献。",
        "- 不自动上传文献内容。",
        "- 不把缺失信息编造成事实。"
      ].join("\n"),
      description: "比较多篇文献的问题、方法、数据和结论。",
      id: "literature-compare",
      label: "文献对比",
      risk: "low",
      status: "planned"
    },
    {
      docMarkdown: [
        "# workspace-organize",
        "",
        "## 目标",
        "",
        "根据用户意图调整 Liteasy 工作台布局，让阅读、问答、产物和组织资料区处在合适位置。",
        "",
        "## 安全边界",
        "",
        "- 只调用注册过的 UI action。",
        "- 不直接操作 DOM。",
        "- 不执行任意脚本或 CSS 注入。"
      ].join("\n"),
      description: "通过受控动作调整布局、面板、dock 和主题。",
      id: "workspace-organize",
      label: "工作区整理",
      risk: "medium",
      status: "active"
    },
    {
      docMarkdown: [
        "# memory-curate",
        "",
        "## 目标",
        "",
        "结合用户维护的学术档案与产品内聚合信号，改善推荐和助手回答；不保留可回溯的行为历史或经历记忆。",
        "",
        "## 安全边界",
        "",
        "- 写入前扫描提示词注入和越权指令。",
        "- 不保存密钥、token、隐私文件内容。",
        "- 必须按 namespace 隔离。"
      ].join("\n"),
      description: "基于学术档案和聚合信号改善推荐与助手回答。",
      id: "memory-curate",
      label: "记忆整理",
      risk: "medium",
      status: "planned"
    }
  ],
  status: "running"
};

export function getAgentCoreStatusLabel(status: AgentCoreConfig["status"]) {
  if (status === "running") {
    return "运行中";
  }

  if (status === "disabled") {
    return "未启用";
  }

  return "设计就绪";
}

export function getAgentEntryStatusLabel(status: AgentCoreEntryStatus) {
  if (status === "active") {
    return "已接入";
  }

  if (status === "review") {
    return "待审核";
  }

  return "规划中";
}
