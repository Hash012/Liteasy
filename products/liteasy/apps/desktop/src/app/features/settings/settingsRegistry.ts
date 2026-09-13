import type { SettingKey } from "./settings.types";

export const settingsRegistry: Record<SettingKey, { label: string; help?: string; dependencies?: string[]; restartRequirement?: "none" | "next-run" }> = {
  "thin_reading.mode": { label: "薄读模式" },
  "papers.metadata_provider": { label: "文献元信息服务" },
  "papers.metadata_endpoint": { label: "元信息 API 地址" },
  "papers.mineru_mode": { label: "论文解析服务" },
  "papers.mineru_endpoint": { label: "MinerU API 地址" },
  "network.recommendation.enabled": { ...{ help: "控制联网文献推荐。关闭后不获取新的联网推荐，不会删除已保存的文献。", dependencies: [], restartRequirement: "none" }, label: "联网推荐" },
  "network.recommendation.sort_mode": { label: "推荐排序" },
  "assistant.public_audit.enabled": { label: "公开审计过程" },
  "profile.enabled": { label: "用户画像" },
  "assistant.default_output_mode": { label: "默认输出模式" },
  "assistant.language": { ...{ help: "为后续生成设置回答语言，已有回答保持原样。", dependencies: [], restartRequirement: "next-run" }, label: "回答语言" },
  "import.ocr_language": { label: "扫描 PDF OCR 语言" },
  "thin_reading.intuecho_endpoint": { label: "Intuecho 同步端点" },
  "models.default_provider": { label: "默认模型服务商" },
  "models.connection_mode": { label: "AI 接入方式" },
  "models.direct_provider": { label: "自备 API 服务商" },
  "models.direct_endpoint": { label: "自备 API 地址" },
  "models.direct_model": { label: "自备 API 模型" },
  "models.direct_protocol": { label: "自备 API 协议" },
  "models.direct_output_format": { label: "结构化输出方式" },
  "models.cloud_proxy_endpoint": { label: "云代理模型端点" },
  "models.control_plane_endpoint": { label: "云端控制平面端点" },
  "view.font_family": { ...{ help: "选择应用界面的字体。不会安装系统字体或改写论文。", dependencies: [], restartRequirement: "none" }, label: "界面字体" },
  "view.font_size": { ...{ help: "调整应用界面字号。不会修改论文 PDF 文件。", dependencies: [], restartRequirement: "none" }, label: "界面字号" },
  "view.pdf_background": { ...{ help: "调整 PDF 阅读区域的显示底色，不修改 PDF 原文件。", dependencies: [], restartRequirement: "none" }, label: "PDF 阅读底色" },
  "view.pdf_custom_background": { label: "自定义 PDF 底色" }
};

export function describeObjectSetting(key: string, state: import("./settings.types").SettingsState) {
  const help = settingsRegistry[key as SettingKey]; if (!help?.help) return undefined;
  return { title: settingsRegistry[key as SettingKey].label, text: `${settingsRegistry[key as SettingKey].label}：${String(state[key as SettingKey])}\n${help.help}\n生效时间：${help.restartRequirement === "next-run" ? "下次生成" : "即时"}` };
}
export const explainableSettingKeys = (Object.keys(settingsRegistry) as SettingKey[]).filter((key) => !!settingsRegistry[key].help);
