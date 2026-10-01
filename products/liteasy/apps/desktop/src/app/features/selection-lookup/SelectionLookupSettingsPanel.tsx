import { useEffect, useState } from "react";
import { Button, Field, Input, Select, Switch } from "@fluentui/react-components";
import type { SettingsState, UpdateSettingCommand } from "../settings/settings.types";
import { defaultSelectionLookupSettings, dictionaryServices } from "./selectionLookup.types";
import { deleteLookupKey, hasLookupKey, saveLookupKey, validateLookupEndpoint } from "./selectionLookupTransport";
import "./selectionLookup.css";

const languages = [{ id: "en", label: "英语" }, { id: "zh", label: "中文" }, { id: "ja", label: "日语" },
  { id: "de", label: "德语" }, { id: "fr", label: "法语" }, { id: "es", label: "西班牙语" }, { id: "ru", label: "俄语" }];
export function SelectionLookupSettingsPanel({ settings, onUpdateSetting }: {
  settings?: Partial<SettingsState>; onUpdateSetting?: (command: UpdateSettingCommand) => void;
}) {
  const current = { ...defaultSelectionLookupSettings, ...settings };
  const configuredEndpoint = current["lookup.libretranslate_endpoint"];
  const [endpoint, setEndpoint] = useState(configuredEndpoint);
  const [key, setKey] = useState("");
  const [hasKey, setHasKey] = useState(false);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  useEffect(() => { setEndpoint(configuredEndpoint); }, [configuredEndpoint]);
  useEffect(() => {
    let active = true;
    setHasKey(false);
    if (current["lookup.translation_service"] === "libretranslate") {
      void hasLookupKey(configuredEndpoint).then((value) => { if (active) setHasKey(value); }).catch(() => undefined);
    }
    return () => { active = false; };
  }, [configuredEndpoint, current["lookup.translation_service"]]);
  async function saveConnection() {
    setPending(true); setError(""); setMessage("");
    try {
      const normalized = validateLookupEndpoint(endpoint);
      if (key) { await saveLookupKey(normalized, key); setKey(""); setHasKey(true); }
      else setHasKey(await hasLookupKey(normalized));
      onUpdateSetting?.({ intent: "update_setting", target: "lookup.libretranslate_endpoint", value: normalized });
      setMessage("翻译服务连接设置已保存。");
    } catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)); }
    finally { setPending(false); }
  }
  return <div className="selection-lookup-settings">
    <Field label="词典服务"><Select aria-label="词典服务" value={current["lookup.dictionary_service"]} disabled={!onUpdateSetting}
      onChange={(_, data) => onUpdateSetting?.({ intent: "update_setting", target: "lookup.dictionary_service", value: data.value })}>
      {dictionaryServices.map((service) => <option key={service.id} value={service.id}>{service.label} · {service.description}</option>)}
    </Select></Field>
    <Field label="选段翻译服务"><Select aria-label="选段翻译服务" value={current["lookup.translation_service"]} disabled={!onUpdateSetting}
      onChange={(_, data) => onUpdateSetting?.({ intent: "update_setting", target: "lookup.translation_service", value: data.value })}>
      <option value="ai">当前 AI 连接</option><option value="libretranslate">LibreTranslate</option>
    </Select></Field>
    <div className="selection-lookup-language-fields">
      <Field label="查询原语言"><Select aria-label="查询原语言" value={current["lookup.source_language"]} disabled={!onUpdateSetting}
        onChange={(_, data) => onUpdateSetting?.({ intent: "update_setting", target: "lookup.source_language", value: data.value })}>
        <option value="auto">自动识别</option>{languages.map((language) => <option key={language.id} value={language.id}>{language.label}</option>)}
      </Select></Field>
      <Field label="查询目标语言"><Select aria-label="查询目标语言" value={current["lookup.target_language"]} disabled={!onUpdateSetting}
        onChange={(_, data) => onUpdateSetting?.({ intent: "update_setting", target: "lookup.target_language", value: data.value })}>
        {languages.map((language) => <option key={language.id} value={language.id}>{language.label}</option>)}
      </Select></Field>
    </div>
    <Switch label="自动查询选区" checked={current["lookup.auto_query"]} disabled={!onUpdateSetting}
      onChange={(_, data) => onUpdateSetting?.({ intent: "update_setting", target: "lookup.auto_query", value: data.checked })} />
    <small>英文单词与短语先查询词典。未收录时可翻译选段；AI 翻译需点击确认。英英词典提供英文释义。</small>
    {current["lookup.translation_service"] === "libretranslate" ? <div className="selection-lookup-connection">
      <Field label="LibreTranslate 地址"><Input aria-label="LibreTranslate 地址" value={endpoint} disabled={pending}
        onChange={(_, data) => { setEndpoint(data.value); setMessage(""); }} placeholder="http://localhost:5000" /></Field>
      <details><summary>配置可选密钥</summary>
        <Field label="翻译服务密钥" hint="无密钥的自部署服务可留空。"><Input aria-label="翻译服务密钥" type="password" autoComplete="off"
          value={key} disabled={pending} onChange={(_, data) => setKey(data.value)} /></Field>
        <p>{hasKey ? "此地址已保存密钥。" : "此地址未保存密钥。"}</p>
        {hasKey ? <Button size="small" disabled={pending} onClick={() => {
          setPending(true); setError("");
          void deleteLookupKey(configuredEndpoint).then(() => { setHasKey(false); setMessage("翻译服务密钥已删除。"); })
            .catch((failure) => setError(String(failure))).finally(() => setPending(false));
        }}>删除翻译服务密钥</Button> : null}
      </details>
      <Button disabled={pending || !onUpdateSetting} onClick={() => void saveConnection()}>保存翻译连接</Button>
      {message ? <p role="status">{message}</p> : null}{error ? <p role="alert">{error}</p> : null}
    </div> : null}
  </div>;
}
