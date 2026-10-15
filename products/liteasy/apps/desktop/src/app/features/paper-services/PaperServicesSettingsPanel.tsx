import { OptionPicker } from "../../shared/ui/productPrimitives";
import { ActionButton as Button } from "../../shared/ui/productPrimitives";
import { useEffect, useRef, useState } from "react";
import { Field, Input, Radio, RadioGroup } from "@fluentui/react-components";
import type { SettingsState, UpdateSettingCommand } from "../settings/settings.types";
import { getAccountSessionGeneration } from "../account/accountSessionStorage";
import { ExternalNavigation } from "../navigation/externalNavigation";
import { deletePaperServiceKey, hasPaperServiceKey, savePaperServiceKey, validatePaperService, type PaperServiceConfig } from "./paperServiceTransport";
import { paperServiceConnectionInfo, testPaperServiceConnection } from "./paperServiceConnection";

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
  const [busy, setBusy] = useState<"credentials" | "connection" | null>(null);
  const operation = useRef(0);
  const credentialRevision = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const mounted = useRef(false);
  const generation = getAccountSessionGeneration();
  const connection = paperServiceConnectionInfo(config.provider);
  useEffect(() => {
    mounted.current = true;
    let active = true;
    const revision = credentialRevision.current;
    setKey(""); setMessage(""); setSaved(false);
    hasPaperServiceKey(config).then((value) => {
      if (active && revision === credentialRevision.current && generation === getAccountSessionGeneration()) setSaved(value);
    }).catch(() => {});
    return () => {
      mounted.current = false;
      active = false;
      operation.current += 1;
      controller.current?.abort();
    };
  }, [config.provider, config.endpoint, generation]);
  const current = (request: number) => mounted.current && operation.current === request && generation === getAccountSessionGeneration();
  function cancelTest(message = "") {
    controller.current?.abort(); controller.current = null;
    operation.current += 1;
    setBusy(null); setMessage(message);
  }
  async function change(remove = false) {
    controller.current?.abort(); controller.current = null;
    credentialRevision.current += 1;
    const request = ++operation.current;
    setBusy("credentials"); setMessage("");
    try {
      validatePaperService(config);
      if (remove) await deletePaperServiceKey(config); else await savePaperServiceKey(config, key);
      if (current(request)) { setKey(""); setSaved(!remove); setMessage(remove ? "密钥已删除。" : "密钥已保存。"); }
    } catch (error) { if (current(request)) setMessage(error instanceof Error ? error.message : String(error)); }
    finally { if (current(request)) setBusy(null); }
  }
  async function testConnection() {
    if (!connection) return;
    const request = ++operation.current;
    const abort = new AbortController(); controller.current = abort;
    setBusy("connection"); setMessage(`正在测试 ${connection.name}…`);
    try {
      const result = await testPaperServiceConnection({ ...config, provider: connection.provider }, abort.signal);
      if (current(request)) setMessage(`连接正常，已读取公开测试论文《${result.title}》。`);
    } catch (error) {
      if (current(request) && !abort.signal.aborted) setMessage(error instanceof Error ? error.message : "连接测试未完成，请稍后重试。");
    } finally {
      if (current(request)) { controller.current = null; setBusy(null); }
    }
  }
  return <div className="view-settings-panel">
    <Field label={connection ? "API key（可选）" : "API key"} hint={saved ? "已配置密钥" : connection?.hint ?? "填写服务提供的 API key。"}>
      <Input aria-label={`${config.provider} API key`} autoComplete="off" type="password" value={key} disabled={busy === "credentials"} onChange={(_, data) => {
        if (busy === "connection") cancelTest();
        else setMessage("");
        setKey(data.value);
      }} />
    </Field>
    <div className="settings-service-actions">
      <Button disabled={busy === "credentials" || !key.trim()} onClick={() => void change()}>保存密钥</Button>
      <Button disabled={busy === "credentials" || !saved} onClick={() => void change(true)}>删除密钥</Button>
      {connection ? busy === "connection" ? <Button onClick={() => cancelTest("测试已取消。")}>取消测试</Button>
        : <Button disabled={busy === "credentials" || Boolean(key.trim())} onClick={() => void testConnection()}>测试连接</Button> : null}
    </div>
    {connection ? <>
      <a href={connection.keyUrl} rel="noopener noreferrer" target="_blank" onClick={(event) => {
        event.preventDefault();
        const request = operation.current;
        void ExternalNavigation.open(connection.keyUrl).catch(() => {
          if (current(request)) setMessage("无法打开浏览器，请复制此链接后打开官方页面。");
        });
      }}>{connection.keyLabel}</a>
      <p>{key.trim() ? "请先保存新密钥，再测试连接。" : "连接测试仅查询一篇公开论文，使用已保存的密钥；未配置密钥时测试公共查询。"}</p>
    </> : null}
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
    <Field label="PDF 后台解析时机" hint="文件保存后即可阅读和选字；后台解析在本机进行。上传至解析服务需点击阅读器中的解析操作。">
      <OptionPicker aria-label="PDF 后台解析时机" value={settings?.["import.processing_policy"] ?? "on-open"} onValueChange={value => update("import.processing_policy", value)}
        options={[{ value: "on-open", label: "首次打开时解析" }, { value: "on-import", label: "导入时解析" }, { value: "manual", label: "仅手动解析" }]} />
    </Field>
    <Field label="扫描 PDF OCR 语言" hint="用于没有文字层的 PDF，可离线识别；识别结果支持页级定位。">
      <OptionPicker aria-label="扫描 PDF OCR 语言" value={String(settings?.["import.ocr_language"] ?? "eng")} onValueChange={nextValue => update("import.ocr_language", nextValue)} options={[{ value: String("eng"), label: String("English") }, { value: String("chi_sim"), label: String("\u4E2D\u6587\uFF08\u7B80\u4F53\uFF09") }, { value: String("eng+chi_sim"), label: String("\u4E2D\u6587 + English") }]} />
    </Field>
    <Field label="文献元信息服务">
      <OptionPicker aria-label="文献元信息服务" value={String(provider ?? "")} onValueChange={nextValue => {
        update("papers.metadata_provider", nextValue);
        update("papers.metadata_endpoint", endpoints[nextValue as keyof typeof endpoints]);
      }} options={[{ value: String("crossref"), label: String("Crossref") }, { value: String("openalex"), label: String("OpenAlex") }, { value: String("semantic-scholar"), label: String("Semantic Scholar") }, { value: String("cloud"), label: String("Liteasy \u4E91\u7AEF") }]} />
    </Field>
    {provider !== "cloud" ? <>
      <Field label="元信息 API 地址"><Input aria-label="元信息 API 地址" value={settings?.["papers.metadata_endpoint"] ?? endpoints[provider]} onChange={(_, data) => update("papers.metadata_endpoint", data.value)} /></Field>
      <ServiceCredentials key={`${provider}:${settings?.["papers.metadata_endpoint"] ?? endpoints[provider]}:${getAccountSessionGeneration()}`} config={{ provider, endpoint: settings?.["papers.metadata_endpoint"] ?? endpoints[provider] }} />
      <p>元信息与关联推荐共用此文献服务，无需 Liteasy 登录。公共查询无需密钥，可选密钥有助于提高可用额度。右键论文可获取元信息或确认文献身份。</p>
    </> : <p>使用当前 Liteasy 云端连接查询文献身份。</p>}
    <Field label="论文内容解析">
      <OptionPicker aria-label="论文内容解析" value={String(mode ?? "")} onValueChange={nextValue => {
        update("papers.mineru_mode", nextValue);
        if (nextValue === "official") update("papers.mineru_endpoint", "https://mineru.net");
        if (nextValue === "custom") update("papers.mineru_endpoint", "http://127.0.0.1:8787");
      }} options={[{ value: String("local"), label: String("\u672C\u5730 PDF \u63D0\u53D6") }, { value: String("official"), label: String("MinerU \u5B98\u65B9 API") }, { value: String("custom"), label: String("MinerU \u517C\u5BB9\u670D\u52A1") }]} />
    </Field>
    {mode !== "local" ? <>
      <Field label="MinerU API 地址"><Input aria-label="MinerU API 地址" value={settings?.["papers.mineru_endpoint"] ?? "https://mineru.net"} onChange={(_, data) => update("papers.mineru_endpoint", data.value)} /></Field>
      <ServiceCredentials key={`mineru:${settings?.["papers.mineru_endpoint"] ?? "https://mineru.net"}:${getAccountSessionGeneration()}`} config={{ provider: "mineru", endpoint: settings?.["papers.mineru_endpoint"] ?? "https://mineru.net" }} />
      <p>{mode === "official" ? "使用 PDF 工具栏的“MinerU 解析”上传论文；完成后可切换阅读模式。" : "兼容服务需提供 /v1/pdf/mineru-extract 接口，返回正文页与图片。"}</p>
    </> : <p>本地提取可用于薄读；配置 MinerU 并解析论文后，可以使用图文阅读模式。</p>}
  </div>;
}
