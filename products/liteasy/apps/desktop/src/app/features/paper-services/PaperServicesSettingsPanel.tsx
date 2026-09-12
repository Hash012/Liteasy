import { useEffect, useState } from "react";
import { Button, Field, Input, Radio, RadioGroup, Select } from "@fluentui/react-components";
import type { SettingsState, UpdateSettingCommand } from "../settings/settings.types";
import { deletePaperServiceKey, hasPaperServiceKey, savePaperServiceKey, validatePaperService, type PaperServiceConfig } from "./paperServiceTransport";

const endpoints = {
  crossref: "https://api.crossref.org",
  openalex: "https://api.openalex.org",
  "semantic-scholar": "https://api.semanticscholar.org/graph/v1",
  cloud: ""
};

function ServiceCredentials({ config }: { config: PaperServiceConfig }) {
  const [key, setKey] = useState("");
  const [saved, setSaved] = useState(false);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    setKey(""); setMessage(""); setSaved(false);
    hasPaperServiceKey(config).then((value) => { if (active) setSaved(value); }).catch(() => {});
    return () => { active = false; };
  }, [config.provider, config.endpoint]);
  async function change(remove = false) {
    setBusy(true);
    try {
      validatePaperService(config);
      if (remove) await deletePaperServiceKey(config); else await savePaperServiceKey(config, key);
      setKey(""); setSaved(!remove); setMessage(remove ? "密钥已删除。" : "密钥已保存。");
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  }
  return <div className="view-settings-panel">
    <Field label="API key" hint={saved ? "已配置密钥" : config.provider === "crossref" ? "Crossref 公共查询无需密钥；Plus 用户可选填。" : "填写服务提供的 API key。"}>
      <Input aria-label={`${config.provider} API key`} autoComplete="off" type="password" value={key} onChange={(_, data) => setKey(data.value)} />
    </Field>
    <div className="settings-service-actions">
      <Button disabled={busy || !key.trim()} onClick={() => void change()}>保存密钥</Button>
      <Button disabled={busy || !saved} onClick={() => void change(true)}>删除密钥</Button>
    </div>
    {message ? <p role="status">{message}</p> : null}
  </div>;
}

export function PaperServicesSettingsPanel({ settings, onUpdateSetting }: {
  settings?: Partial<SettingsState>; onUpdateSetting?: (command: UpdateSettingCommand) => void;
}) {
  const provider = settings?.["papers.metadata_provider"] ?? "crossref";
  const mode = settings?.["papers.mineru_mode"] ?? "local";
  const update = (target: UpdateSettingCommand["target"], value: string) => onUpdateSetting?.({ intent: "update_setting", target, value });
  return <div className="view-settings-panel" aria-label="论文解析与元信息设置">
    <Field label="薄读模式">
      <RadioGroup aria-label="薄读模式" value={settings?.["thin_reading.mode"] ?? "fast"} onChange={(_, data) => update("thin_reading.mode", data.value)}>
        <Radio value="fast" label="快速" /><Radio value="rigorous" label="严谨" />
      </RadioGroup>
    </Field>
    <p>快速模式直接生成讲解；严谨模式加强原文依据并补充核验提示。两种模式均不限固定字数，局部证据不足会注明，不阻止生成。进行中的任务继续使用原模式。</p>
    <Field label="文献元信息服务">
      <Select aria-label="文献元信息服务" value={provider} onChange={(_, data) => {
        update("papers.metadata_provider", data.value);
        update("papers.metadata_endpoint", endpoints[data.value as keyof typeof endpoints]);
      }}>
        <option value="crossref">Crossref</option><option value="openalex">OpenAlex</option>
        <option value="semantic-scholar">Semantic Scholar</option><option value="cloud">Liteasy 云端</option>
      </Select>
    </Field>
    {provider !== "cloud" ? <>
      <Field label="元信息 API 地址"><Input aria-label="元信息 API 地址" value={settings?.["papers.metadata_endpoint"] ?? endpoints[provider]} onChange={(_, data) => update("papers.metadata_endpoint", data.value)} /></Field>
      <ServiceCredentials config={{ provider, endpoint: settings?.["papers.metadata_endpoint"] ?? endpoints[provider] }} />
      <p>在文献库中右键论文，选择“确认文献身份”，查询并确认匹配结果。</p>
    </> : <p>使用当前 Liteasy 云端连接查询文献身份。</p>}
    <Field label="论文内容解析">
      <Select aria-label="论文内容解析" value={mode} onChange={(_, data) => {
        update("papers.mineru_mode", data.value);
        if (data.value === "official") update("papers.mineru_endpoint", "https://mineru.net");
        if (data.value === "custom") update("papers.mineru_endpoint", "http://127.0.0.1:8787");
      }}>
        <option value="local">本地 PDF 提取</option><option value="official">MinerU 官方 API</option><option value="custom">MinerU 兼容服务</option>
      </Select>
    </Field>
    {mode !== "local" ? <>
      <Field label="MinerU API 地址"><Input aria-label="MinerU API 地址" value={settings?.["papers.mineru_endpoint"] ?? "https://mineru.net"} onChange={(_, data) => update("papers.mineru_endpoint", data.value)} /></Field>
      <ServiceCredentials config={{ provider: "mineru", endpoint: settings?.["papers.mineru_endpoint"] ?? "https://mineru.net" }} />
      <p>{mode === "official" ? "使用 PDF 工具栏的“MinerU 解析”上传论文；完成后可切换阅读模式。" : "兼容服务需提供 /v1/pdf/mineru-extract 接口，返回正文页与图片。"}</p>
    </> : <p>本地提取可用于薄读；配置 MinerU 并解析论文后，可以使用图文阅读模式。</p>}
  </div>;
}
