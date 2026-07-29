import type { SettingKey } from "./settings.types";

export const settingsRegistry: Record<SettingKey, { label: string }> = {
  "network.recommendation.enabled": { label: "联网推荐" },
  "network.recommendation.sort_mode": { label: "推荐排序" },
  "assistant.public_audit.enabled": { label: "公开审计过程" },
  "assistant.default_output_mode": { label: "默认输出模式" },
  "assistant.language": { label: "回答语言" },
  "import.ocr_language": { label: "扫描 PDF OCR 语言" },
  "thin_reading.intuecho_endpoint": { label: "Intuecho 同步端点" },
  "thin_reading.openalex_api_key": { label: "OpenAlex API 密钥" },
  "models.default_provider": { label: "默认模型服务商" },
  "models.cloud_proxy_endpoint": { label: "云代理模型端点" },
  "models.control_plane_endpoint": { label: "云端控制平面端点" }
};
