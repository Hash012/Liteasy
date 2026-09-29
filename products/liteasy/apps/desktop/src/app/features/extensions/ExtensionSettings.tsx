import { useEffect, useState } from "react";
import { Button, Select } from "@fluentui/react-components";
import { useExtensionWorkbench } from "./extensionWorkbenchContext";
import { SchemaFields } from "./SchemaFields";
import type { ValidatedExtension } from "./extensionPackage";
import { schemaDefaults, validateSchemaValue, type JsonObject } from "./extensionSchema";
import type { ConfigurationLevel } from "./extensionWorkspaceStore";

export function extensionSettingsMatch(pkg: ValidatedExtension, id: string, query: string) {
  const definition = pkg.manifest.contributes.settings.find((item) => item.id === id);
  const text = [pkg.manifest.name, definition?.title, ...Object.entries(pkg.settings[id]?.properties ?? {}).flatMap(([key, value]) => [key, value.title, value.description])].join(" ").toLowerCase();
  return query.trim().toLowerCase().split(/\s+/).every((term) => text.includes(term));
}

function ExtensionSettingsGroup({ pkg, id }: { pkg: ValidatedExtension; id: string }) {
  const host = useExtensionWorkbench()!;
  const schema = pkg.settings[id];
  const [level, setLevel] = useState<ConfigurationLevel>("profile");
  const [value, setValue] = useState(schemaDefaults(schema) as JsonObject);
  const [revision, setRevision] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [valid, setValid] = useState(true);
  const [dirty, setDirty] = useState(false);
  const [source, setSource] = useState<Record<string, string>>({});
  useEffect(() => {
    let alive = true; setLoaded(false); setMessage("");
    void host.workspace.readConfiguration(pkg.manifest.id, id, schema, level).then((result) => {
      if (alive) { setValue(result.effective); setRevision(result.revision); setSource(result.sources); setLoaded(true); }
    }).catch((e) => { if (alive) setMessage(`原配置已保留：${String(e)}`); });
    return () => { alive = false; };
  }, [host.workspace, pkg, id, level]);
  async function save(reset = false) {
    setBusy(true); setMessage("");
    try {
      if (!reset) validateSchemaValue(schema, value);
      await host.workspace.saveConfiguration(pkg.manifest.id, id, schema, level, reset ? {} : value, revision);
      const saved = await host.workspace.readConfiguration(pkg.manifest.id, id, schema, level);
      setRevision(saved.revision); setValue(saved.effective); setSource(saved.sources); setMessage("已保存。"); setDirty(false); setValid(true);
    } catch (e) { setMessage(String(e)); }
    finally { setBusy(false); }
  }
  return <div>
    <div className="extension-toolbar"><label>配置范围 <Select aria-label={`${pkg.manifest.name}配置范围`} disabled={dirty || busy} value={level} onChange={(_, data) => setLevel(data.value as ConfigurationLevel)}><option value="profile">当前用户配置</option><option value="global">全局默认</option></Select></label></div>
    {loaded ? <SchemaFields schema={schema} value={value} onChange={(value) => { setValue(value); setDirty(true); }} onValidityChange={setValid} /> : null}
    <p className="extension-settings-note">{Object.values(source).some((entry) => entry === "profile") ? "包含当前用户覆盖值" : "继承默认值"} · 来自 {pkg.manifest.name}</p>
    <div className="extension-toolbar"><Button appearance="primary" disabled={!loaded || busy || !valid} onClick={() => void save()}>应用设置</Button><Button disabled={!loaded || busy} onClick={() => void save(true)}>恢复继承</Button><Button onClick={() => void navigator.clipboard.writeText(`liteasy://extensions/${pkg.manifest.id}/settings/${id}`).catch((e) => setMessage(String(e)))}>复制设置链接</Button></div>
    {message ? <p role="status">{message}</p> : null}
  </div>;
}

export function ExtensionSettings({ query, category }: { query: string; category: string }) {
  const host = useExtensionWorkbench();
  const groups = host?.packages.snapshot.packages.flatMap((pkg) => pkg.manifest.contributes.settings.map((definition) => ({ pkg, definition }))) ?? [];
  return <>{groups.map(({ pkg, definition }) => <section key={`${pkg.manifest.id}/${definition.id}/${pkg.manifest.version}`} className="settings-card" aria-label={definition.title} hidden={query.trim() ? !extensionSettingsMatch(pkg, definition.id, query) : !["all", "extensions", definition.category === "reading" ? "appearance" : definition.category].includes(category)}>
    <header className="settings-card-header"><h2>{definition.title}</h2><p>{pkg.manifest.name}</p></header>
    <div className="settings-card-content"><ExtensionSettingsGroup pkg={pkg} id={definition.id} /></div>
  </section>)}</>;
}
