import { useEffect, useId, useRef, useState } from "react";
import { Button, Field, Input, Select, Textarea } from "@fluentui/react-components";
import { isTauri } from "@tauri-apps/api/core";
import type { SettingsState, UpdateSettingCommand } from "../settings/settings.types";
import { createDirectModelClient } from "./directModelClient";
import { deleteDirectModelKey, hasDirectModelKey, saveDirectModelKey } from "./directModelTransport";
import { directModelNeedsKey, getDirectModelConfig, getModelProvider, modelProviders, validateDirectModelConfig, type DirectModelConfig } from "./modelProviders";
import "./modelConnection.css";

type Props = { settings?: Partial<SettingsState>; onUpdateSetting?: (command: UpdateSettingCommand) => void };

export function ModelConnectionPanel({ settings = {}, onUpdateSetting }: Props) {
  const [mode, setMode] = useState(settings["models.connection_mode"] ?? "direct");
  const [config, setConfig] = useState(() => getDirectModelConfig(settings));
  const [apiKey, setApiKey] = useState("");
  const [hasKey, setHasKey] = useState(false);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);
  const [reply, setReply] = useState("");
  const requestRef = useRef<AbortController>();
  const mountedRef = useRef(true);
  const modelListId = useId();
  const preset = getModelProvider(config.provider);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; requestRef.current?.abort(); };
  }, []);
  useEffect(() => {
    let active = true;
    setHasKey(false);
    void hasDirectModelKey(config).then((value) => { if (active) setHasKey(value); }).catch(() => undefined);
    return () => { active = false; };
  }, [config.provider, config.endpoint, config.model]);

  function update(patch: Partial<DirectModelConfig>) {
    if (patch.provider !== undefined || patch.endpoint !== undefined) setApiKey("");
    setConfig((current) => ({ ...current, ...patch }));
    setMessage("");
    setReply("");
  }
  function apply(target: UpdateSettingCommand["target"], value: string) {
    onUpdateSetting?.({ intent: "update_setting", target, value });
  }
  async function save(testConnection: boolean) {
    setPending(true); setFailed(false); setMessage(""); setReply("");
    const controller = new AbortController();
    requestRef.current = controller;
    try {
      if (mode === "cloud") {
        apply("models.connection_mode", "cloud");
        setMessage("已切换为 Liteasy 云端模型，登录后可使用。");
        return;
      }
      const valid = validateDirectModelConfig(config);
      if (apiKey.trim()) {
        await saveDirectModelKey(valid, apiKey);
        if (mountedRef.current) { setApiKey(""); setHasKey(true); }
      } else if (directModelNeedsKey(valid) && !await hasDirectModelKey(valid)) {
        throw new Error("请填写 API key；修改服务商或 API 地址后需要重新保存对应密钥。");
      }
      controller.signal.throwIfAborted();
      apply("models.direct_provider", valid.provider);
      apply("models.direct_endpoint", valid.endpoint);
      apply("models.direct_model", valid.model);
      apply("models.direct_protocol", valid.protocol);
      apply("models.direct_output_format", valid.outputFormat);
      apply("models.connection_mode", "direct");
      setConfig(valid);
      setMessage(testConnection ? "配置已保存，正在发送测试请求…" : "配置已保存，可直接使用 AI，无需登录。");
      if (testConnection) {
        const result = await createDirectModelClient(valid)({
          model: valid.model, provider: valid.provider,
          prompt: "请只用一句简短中文确认你已准备好帮助阅读论文。",
          signal: controller.signal,
          onDelta: (_delta, accumulated) => { if (mountedRef.current) setReply(accumulated); }
        });
        if (mountedRef.current) { setReply(result.answer); setMessage("连接成功，已收到模型的真实响应。可以开始对话或论文分析。"); }
      }
    } catch (error) {
      if (mountedRef.current) {
        setFailed(!controller.signal.aborted);
        setMessage(controller.signal.aborted ? "已停止测试。" : error instanceof Error ? error.message : String(error));
      }
    } finally {
      if (mountedRef.current) setPending(false);
      if (requestRef.current === controller) requestRef.current = undefined;
    }
  }
  async function removeKey() {
    try {
      await deleteDirectModelKey(config);
      setHasKey(false); setApiKey(""); setFailed(false); setMessage("已删除此服务商与 API 地址对应的密钥。");
    } catch (error) { setFailed(true); setMessage(error instanceof Error ? error.message : String(error)); }
  }

  return <div className="model-connection-panel">
    <p className="model-connection-description">使用自己的 API key 即可开始，无需登录 Liteasy。</p>
    <Field label="接入方式">
      <Select aria-label="AI 接入方式" disabled={pending} value={mode} onChange={(_event, data) => { setMode(data.value as typeof mode); setMessage(""); setReply(""); }}>
        <option value="direct">自备 API key（无需登录）</option>
        <option value="cloud">Liteasy 云端模型（需要登录）</option>
      </Select>
    </Field>
    {mode === "direct" ? <>
      <Field label="服务商">
        <Select aria-label="API 服务商" disabled={pending} value={config.provider} onChange={(_event, data) => update(getModelProvider(data.value))}>
          {modelProviders.map((entry) => <option value={entry.provider} key={entry.provider}>{entry.label}</option>)}
        </Select>
      </Field>
      <Field label="API 基础地址" hint={preset.hint ?? "保留服务商要求的版本路径；无需添加 /chat/completions 或 /messages。"}>
        <Input aria-label="API 基础地址" disabled={pending} value={config.endpoint} onChange={(_event, data) => update({ endpoint: data.value })} placeholder="https://api.example.com/v1" />
      </Field>
      <Field label="模型 ID" hint="可选择建议值或填写账号中已开通的模型；Azure / 方舟可填写部署或接入点名称。">
        <Input aria-label="模型 ID" disabled={pending} list={modelListId} value={config.model} onChange={(_event, data) => update({ model: data.value })} />
        <datalist id={modelListId}>{preset.models.map((model) => <option key={model} value={model} />)}</datalist>
      </Field>
      <Field label="API key" hint={config.provider === "ollama" ? "本机 Ollama 不需要密钥。" : hasKey ? "此 API 地址已有密钥；留空即可保留，填写新值可替换。" : isTauri() ? "保存在此设备的系统凭据库中。" : "浏览器预览仅在当前页面会话保留密钥；关闭或刷新页面后需重新填写。"}>
        <Input aria-label="API key" autoComplete="off" disabled={pending} type="password" value={apiKey} onChange={(_event, data) => setApiKey(data.value)} placeholder={hasKey ? "已保存，留空保留" : "输入 API key"} />
      </Field>
      <details>
        <summary>高级设置</summary>
        <Field label="API 协议">
          <Select aria-label="API 协议" disabled={pending} value={config.protocol} onChange={(_event, data) => update({ protocol: data.value as DirectModelConfig["protocol"] })}>
            <option value="openai">OpenAI Chat Completions 兼容</option>
            <option value="anthropic">Anthropic Messages</option>
          </Select>
        </Field>
        {config.protocol === "openai" ? <Field label="结构化输出" hint="论文分析需要 JSON；若服务商拒绝 response_format，可选择按提示生成。">
          <Select aria-label="结构化输出" disabled={pending} value={config.outputFormat} onChange={(_event, data) => update({ outputFormat: data.value as DirectModelConfig["outputFormat"] })}>
            <option value="prompt">按提示生成 JSON（兼容性优先）</option>
            <option value="json_object">JSON 模式</option>
            <option value="json_schema">JSON Schema</option>
          </Select>
        </Field> : null}
      </details>
      {preset.docs ? <a href={preset.docs} rel="noreferrer" target="_blank">查看服务商 API 文档</a> : null}
    </> : <p className="model-connection-description">使用 Liteasy 账号提供的云端模型与额度。社区与云端同步功能仍需要登录。</p>}
    <div className="model-connection-actions">
      <Button appearance="primary" disabled={pending || !onUpdateSetting} onClick={() => void save(false)}>保存配置</Button>
      {mode === "direct" ? <Button disabled={pending || !onUpdateSetting} onClick={() => void save(true)}>保存并测试</Button> : null}
      {pending ? <Button onClick={() => requestRef.current?.abort()}>停止测试</Button> : null}
      {mode === "direct" && hasKey ? <Button disabled={pending} onClick={() => void removeKey()}>删除密钥</Button> : null}
    </div>
    {mode === "direct" ? <p className="model-connection-description">测试会发送一条短请求，按服务商的 API 计费规则使用额度。</p> : null}
    {message ? <p className="model-connection-message" role={failed ? "alert" : "status"}>{message}</p> : null}
    {reply ? <Field label="测试响应"><Textarea aria-label="测试响应" readOnly resize="vertical" value={reply} /></Field> : null}
  </div>;
}
