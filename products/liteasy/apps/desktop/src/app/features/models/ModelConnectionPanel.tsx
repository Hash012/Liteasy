import { ActionButton as Button, DisclosureSection, InlineNotice, OptionPicker } from "../../shared/ui/productPrimitives";
import { OpenRegular } from "@fluentui/react-icons";
import { rememberVerifiedModel, forgetVerifiedModel, modelProfileId, directModelSettingCommands } from "./verifiedModelProfiles";
import { useVerifiedModels } from "./useVerifiedModels";
import { useEffect, useRef, useState } from "react";
import { Combobox, Input, Option, Textarea } from "@fluentui/react-components";
import { SettingRow } from "../workbench/WorkbenchPage";
import { isTauri } from "@tauri-apps/api/core";
import type { SettingsState, UpdateSettingCommand } from "../settings/settings.types";
import { createDirectModelClient } from "./directModelClient";
import { deleteDirectModelKey, hasDirectModelKey, saveDirectModelKey } from "./directModelTransport";
import { directModelNeedsKey, getDirectModelConfig, getModelProvider, modelProviders, validateDirectModelConfig, type DirectModelConfig } from "./modelProviders";
import "./modelConnection.css";

type Props = { expandAdvanced?: boolean; settings?: Partial<SettingsState>; onUpdateSetting?: (command: UpdateSettingCommand) => void };

export function ModelConnectionPanel({ settings = {}, onUpdateSetting, expandAdvanced = false }: Props) {
  const [advancedOpen, setAdvancedOpen] = useState(false);
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
  const [profileQuery, setProfileQuery] = useState("");
  const { profiles } = useVerifiedModels();
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
    let testedConfig: DirectModelConfig | undefined;
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
      for (const command of directModelSettingCommands(valid)) onUpdateSetting?.(command);
      setConfig(valid);
      setMessage(testConnection ? "配置已保存，正在发送测试请求…" : "配置已保存，可直接使用 AI，无需登录。");
      if (testConnection) {
        testedConfig = valid;
        const result = await createDirectModelClient(valid)({
          model: valid.model, provider: valid.provider,
          prompt: "请只用一句简短中文确认你已准备好帮助阅读论文。",
          signal: controller.signal,
          onDelta: (_delta, accumulated) => { if (mountedRef.current) setReply(accumulated); }
        });
        controller.signal.throwIfAborted();
        if (!result.answer.trim()) throw new Error("模型返回了空响应，请检查配置后重新测试。");
        rememberVerifiedModel(valid);
        if (mountedRef.current) { setReply(result.answer); setMessage("连接成功，已收到模型的真实响应。可以开始对话或论文分析。"); }
      }
    } catch (error) {
      if (testedConfig && !controller.signal.aborted) forgetVerifiedModel(modelProfileId(testedConfig));
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
    <SettingRow title="接入方式">
      <OptionPicker aria-label="AI 接入方式" disabled={pending} value={mode} onValueChange={(value) => { setMode(value as typeof mode); setMessage(""); setReply(""); }}
        options={[{ value: "direct", label: "自备 API key", description: "无需登录" }, { value: "cloud", label: "Liteasy 云端模型", description: "需要登录" }]} />
    </SettingRow>
    {mode === "direct" ? <>
      {profiles.length ? <SettingRow title="已验证模型" description="可保留多个服务商、地址与模型；对话输入框可直接切换。">
        <Combobox aria-label="载入已验证模型配置" disabled={pending} value={profileQuery} placeholder="选择已保存的模型配置"
          onChange={(event) => setProfileQuery(event.target.value)}
          onOptionSelect={(_, data) => {
            const profile = profiles.find((item) => item.id === data.optionValue);
            if (profile) { update(profile.config); setProfileQuery(profile.config.model); }
          }}>
          {profiles.filter((profile) => `${profile.config.model} ${profile.config.provider} ${profile.config.endpoint}`.toLowerCase().includes(profileQuery.toLowerCase())).map((profile) =>
            <Option value={profile.id} key={profile.id} text={profile.config.model}><span className="product-option-text">{profile.config.model}<small>{getModelProvider(profile.config.provider).label} · {profile.config.endpoint}</small></span></Option>)}
        </Combobox>
      </SettingRow> : null}
      <SettingRow title="服务商">
        <OptionPicker aria-label="API 服务商" disabled={pending} value={config.provider} onValueChange={(value) => update(getModelProvider(value))}
          options={modelProviders.map((entry) => ({ value: entry.provider, label: entry.label, description: entry.hint }))} />
      </SettingRow>
      {preset.docs ? <Button as="a" appearance="subtle" size="small" className="model-provider-docs"
        icon={<OpenRegular />} href={preset.docs} rel="noopener noreferrer" target="_blank">查看服务商 API 文档</Button> : null}
      <SettingRow title="API 基础地址" description={preset.hint ?? "保留服务商要求的版本路径；无需添加 /chat/completions 或 /messages。"}>
        <Input aria-label="API 基础地址" disabled={pending} value={config.endpoint} onChange={(_event, data) => update({ endpoint: data.value })} placeholder="https://api.example.com/v1" />
      </SettingRow>
      <SettingRow title="模型 ID" description="可选择建议值或填写账号中已开通的模型；Azure / 方舟可填写部署或接入点名称。">
        <Combobox aria-label="模型 ID" disabled={pending} freeform value={config.model} selectedOptions={preset.models.includes(config.model) ? [config.model] : []}
          onChange={(event) => update({ model: event.target.value })}
          onOptionSelect={(_, data) => { if (data.optionValue !== undefined) update({ model: data.optionValue }); }}>
          {preset.models.filter((model) => model.toLowerCase().includes(config.model.toLowerCase())).map((model) => <Option key={model} value={model}>{model}</Option>)}
        </Combobox>
      </SettingRow>
      <SettingRow title="API key" description={config.provider === "ollama" ? "本机 Ollama 不需要密钥。" : hasKey ? "此 API 地址已有密钥；留空即可保留，填写新值可替换。" : isTauri() ? "保存在此设备的系统凭据库中。" : "浏览器预览仅在当前页面会话保留密钥；关闭或刷新页面后需重新填写。"}>
        <Input aria-label="API key" autoComplete="off" disabled={pending} type="password" value={apiKey} onChange={(_event, data) => setApiKey(data.value)} placeholder={hasKey ? "已保存，留空保留" : "输入 API key"} />
      </SettingRow>
      <DisclosureSection title="高级设置" open={expandAdvanced || advancedOpen} onOpenChange={(open) => { if (!expandAdvanced) setAdvancedOpen(open); }}>
        <SettingRow title="API 协议">
          <OptionPicker aria-label="API 协议" disabled={pending} value={config.protocol} onValueChange={(value) => update({ protocol: value as DirectModelConfig["protocol"] })}
            options={[{ value: "openai", label: "OpenAI Chat Completions", description: "兼容此协议的服务" }, { value: "anthropic", label: "Anthropic Messages" }]} />
        </SettingRow>
        {config.protocol === "openai" ? <SettingRow title="结构化输出" description="论文分析需要 JSON；若服务商拒绝 response_format，可选择按提示生成。">
          <OptionPicker aria-label="结构化输出" disabled={pending} value={config.outputFormat} onValueChange={(value) => update({ outputFormat: value as DirectModelConfig["outputFormat"] })}
            options={[{ value: "prompt", label: "按提示生成 JSON", description: "兼容性优先" }, { value: "json_object", label: "JSON 模式" }, { value: "json_schema", label: "JSON Schema" }]} />
        </SettingRow> : null}
      </DisclosureSection>

    </> : <p className="model-connection-description">使用 Liteasy 账号提供的云端模型与额度。社区与云端同步功能仍需要登录。</p>}
    <div className="model-connection-actions">
      <Button appearance="primary" disabled={pending || !onUpdateSetting} onClick={() => void save(false)}>保存配置</Button>
      {mode === "direct" ? <Button disabled={pending || !onUpdateSetting} onClick={() => void save(true)}>保存并测试</Button> : null}
      {pending ? <Button onClick={() => requestRef.current?.abort()}>停止测试</Button> : null}
      {mode === "direct" && hasKey ? <Button disabled={pending} onClick={() => void removeKey()}>删除密钥</Button> : null}
    </div>
    {mode === "direct" ? <p className="model-connection-description">测试会发送一条短请求，按服务商的 API 计费规则使用额度。</p> : null}
    {message ? <InlineNotice intent={failed ? "error" : pending ? "busy" : "info"} message={message} /> : null}
    {reply ? <SettingRow title="测试响应"><Textarea aria-label="测试响应" readOnly resize="vertical" value={reply} /></SettingRow> : null}
  </div>;
}
