import { redactDiagnostic } from "../context/objectContext";
import { DisclosureSection, OptionPicker } from "../../shared/ui/productPrimitives";
import { useExtensionWorkbench } from "../extensions/extensionWorkbenchContext";
import { liteasyPath } from "../resource-filesystem/liteasyPath";
import { useEffect, useRef, useState } from "react";
import { Button, Field, Input, Textarea } from "@fluentui/react-components";
import type { WorkbenchViewModel } from "../boards/ObjectWorkbench";
import { refOf } from "../objects/object.types";
import { projectBlockText } from "./blockRegistry";
import type { JsonObject } from "../extensions/extensionSchema";
import { paperLensPackage } from "../extensions/paperLensPackage";
import type { ExtensionInstallation } from "../extensions/extensionPackageStore";

export function BlockComposer({ model }: { model: WorkbenchViewModel }) {
  const host = useExtensionWorkbench();
  const extensions = model.extensions!;
  const types = extensions.snapshot.registry.list();
  const [typeKey, setTypeKey] = useState("liteasy/RichTextBlock@1.0.0");
  const type = types.find((item) => `${item.id}@${item.version}` === typeKey) ?? types[0];
  const [title, setTitle] = useState("新内容块");
  const [data, setData] = useState(JSON.stringify(type.defaults, null, 2));
  const [installations, setInstallations] = useState<Array<ExtensionInstallation & { displayName?: string }>>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const file = useRef<HTMLInputElement>(null);
  useEffect(() => { setData(JSON.stringify(type.defaults, null, 2)); }, [type.id, type.version]);
  const currentStore = useRef(extensions.store); currentStore.current = extensions.store;
  async function loadInstallations() {
    const store = extensions.store;
    const items = await store.list();
    const named = [];
    for (const item of items) {
      if (currentStore.current !== store) return [];
      try { const pkg = await store.get(item.id, item.version); named.push({ ...item, displayName: pkg.manifest.name }); }
      catch { named.push(item); }
    }
    return named;
  }
  useEffect(() => { let alive = true; setInstallations([]); void loadInstallations().then((items) => { if (alive) setInstallations(items); }).catch((cause: unknown) => { if (alive) setError(cause instanceof Error ? cause.message : String(cause)); }); return () => { alive = false; }; }, [extensions.store, extensions.snapshot]);
  async function run(operation: () => Promise<unknown>) {
    setBusy(true); setError("");
    try { await operation(); const items = await loadInstallations(); if (currentStore.current === extensions.store) setInstallations(items); await model.refresh(); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }
  return <div className="block-composer">
    <Field label="内容类型"><OptionPicker aria-label="内容类型" value={`${type.id}@${type.version}`} onValueChange={setTypeKey} options={types.map((item) => ({ value: `${item.id}@${item.version}`, label: item.title }))} /></Field>
    <Field label="名称"><Input value={title} onChange={(_, next) => setTitle(next.value)} /></Field>
    <Field label="内容字段"><Textarea aria-label="组件内容字段" resize="vertical" value={data} onChange={(_, next) => setData(next.value)} /></Field>
    <small>所有类型继承字体、Markdown/公式、图片、拖放与上下文操作。</small>
    <Button appearance="primary" disabled={busy || !title.trim()} onClick={() => void run(async () => {
      const value = extensions.snapshot.registry.instantiate(type.id, type.version, JSON.parse(data) as JsonObject);
      const board = model.board ? await model.repository.resolveLatest(model.board.objectId) : await model.repository.create({ kind: "workspace.board", title: "我的白板", content: { schema: "liteasy.board/v1", payload: { description: "" } } });
      await model.repository.createStructuredBlock({ title, text: projectBlockText(value), block: { schema: "liteasy.visual-block/v1", type: { id: type.id, version: type.version }, data: value }, boardRef: refOf(board), operationId: crypto.randomUUID() });
      await model.selectBoard(await model.repository.resolveLatest(board.objectId));
    })}>添加到白板</Button>
    <h4>组合模板</h4>
    {host?.studio && model.board ? <Button disabled={busy} onClick={() => void run(async () => { await host.studio!.service.call("liteasy_board_template", { path: liteasyPath(model.repository.scopeId, { kind: "object", ref: refOf(model.board!) }), title: model.board!.title }, { writable: true }); host.openStudio(); })}>将当前白板保存为模板</Button> : null}
    {extensions.snapshot.packages.flatMap((pkg) => pkg.templates.map((template) => <Button key={`${pkg.manifest.id}/${template.id}`} disabled={busy} onClick={() => void run(async () => {
      const board = await model.repository.importBoardFile({ title: template.title, operationId: crypto.randomUUID(), edges: [], nodes: template.cards.map((card) => {
        const value = extensions.snapshot.registry.instantiate(card.type.id, card.type.version, card.data);
        return { id: card.id, position: card.position, size: card.size, structured: { schema: "liteasy.visual-block/v1" as const, type: card.type, data: value }, draft: { title: card.title, kind: "content.note" as const, content: { schema: "liteasy.note/v1" as const, payload: { text: projectBlockText(value), origin: "user" as const } } } };
      }) });
      await model.selectBoard(board);
    })}>{template.title}</Button>))}
    <h4>本地扩展</h4>
    <input hidden ref={file} type="file" accept=".json" onChange={(event) => { const selected = event.target.files?.[0]; event.target.value = ""; if (selected) void run(async () => {
      if (selected.size > 24 * 1024 * 1024) throw new Error("包文件不能超过 24 MB。");
      const raw = JSON.parse(await selected.text());
      const { validateExtensionPackage } = await import("../extensions/extensionPackage");
      const pkg = await validateExtensionPackage(raw);
      const previous = (await extensions.store.list()).find((item) => item.id === pkg.manifest.id);
      await extensions.store.install(raw, previous?.revision ?? null);
    }); }} />
    <div className="object-toolbar"><Button disabled={busy} onClick={() => file.current?.click()}>导入扩展包</Button><Button disabled={busy} onClick={() => void run(async () => { const previous = (await extensions.store.list()).find((item) => item.id === "plugin.paper-lens"); await extensions.store.install(await paperLensPackage(), previous?.revision ?? null); })}>安装论文比较板示例</Button></div>
    {installations.map((item) => <section key={item.id} className="extension-package-card"><strong>{item.displayName ?? "扩展名称无法读取"}</strong><span>{item.version} · {item.enabled ? "已启用" : "已停用"}</span>
      <Button disabled={busy || !item.displayName} onClick={() => void run(() => extensions.store.enable(item.id, !item.enabled, item.revision))}>{item.enabled ? "停用" : "启用"}</Button>
      <Button disabled={busy || !item.displayName} onClick={() => void run(() => extensions.store.uninstall(item.id, item.revision))}>卸载并保留内容</Button>
      <DisclosureSection title="扩展技术信息"><p>{item.id} · {item.version}</p></DisclosureSection>
    </section>)}
    {extensions.snapshot.failures.map((failure) => <div key={failure.id} role="status">扩展暂不可用。<DisclosureSection title="错误技术详情"><p>{failure.id}：{redactDiagnostic(failure.message)}</p></DisclosureSection></div>)}
    {error || extensions.error ? <div role="alert">扩展操作未完成，请检查扩展后重试。<DisclosureSection title="错误技术详情"><pre>{redactDiagnostic(error || extensions.error)}</pre></DisclosureSection></div> : null}
  </div>;
}
