import { createContext, useContext, useState, type ReactNode } from "react";
import { Button, Tab, TabList, Dialog, DialogBody, DialogContent, DialogSurface, DialogTitle, DialogActions, Input, MenuItem, Tooltip } from "@fluentui/react-components";
import {
  FolderRegular, DocumentRegular, DocumentPdfRegular, DocumentTextRegular, ImageRegular,
  ImageMultipleRegular, DocumentImageRegular, BookOpenRegular, CodeRegular, TableRegular,
  SlideTextRegular, MusicNote2Regular, VideoRegular, ArchiveRegular, StarRegular,
  BookmarkRegular, LightbulbRegular, BeakerRegular, BrainCircuitRegular, GlobeRegular,
  CheckmarkCircleRegular, HeartRegular, FlagRegular, NoteRegular, FlowRegular, IconsRegular
} from "@fluentui/react-icons";

const choices = [
  ["folder", "文件夹", FolderRegular], ["file", "文件", DocumentRegular],
  ["pdf", "PDF 论文", DocumentPdfRegular], ["text", "文本", DocumentTextRegular],
  ["image", "图片", ImageRegular], ["images", "图片集合", ImageMultipleRegular],
  ["multimodal", "图文", DocumentImageRegular], ["book", "书籍", BookOpenRegular],
  ["code", "代码 Markdown", CodeRegular], ["table", "表格 数据", TableRegular],
  ["slides", "幻灯片", SlideTextRegular], ["audio", "音频", MusicNote2Regular],
  ["video", "视频", VideoRegular], ["archive", "归档", ArchiveRegular],
  ["star", "星标", StarRegular], ["bookmark", "书签", BookmarkRegular],
  ["idea", "灵感", LightbulbRegular], ["science", "实验 科学", BeakerRegular],
  ["brain", "思考 人工智能", BrainCircuitRegular], ["globe", "全球", GlobeRegular],
  ["done", "已完成", CheckmarkCircleRegular], ["heart", "喜爱", HeartRegular],
  ["flag", "重要", FlagRegular], ["note", "笔记", NoteRegular], ["diagram", "流程图", FlowRegular]
] as const;
type IconId = typeof choices[number][0];
const validIds = new Set<string>(choices.map(([id]) => id));
type IconValue = IconId | `emoji:${string}`;
type Preferences = Record<string, IconValue>;
export function isSingleEmoji(value: string) {
  if (!value || value.length > 64 || value !== value.trim()) return false;
  const segments = [...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(value)];
  return segments.length === 1 && /[\p{Extended_Pictographic}\p{Regional_Indicator}\u20e3]/u.test(value);
}
const emojiChoices = [["📚", "书籍"], ["📄", "文献"], ["📝", "笔记"], ["🔬", "实验"], ["🧠", "思考"], ["🧪", "研究"], ["📊", "数据"], ["🧮", "数学"], ["🌍", "地球"], ["💡", "灵感"], ["⭐", "星标"], ["❤️", "喜爱"], ["🎯", "目标"], ["🗂️", "归档"], ["✅", "完成"]];
const IconContext = createContext({
  preferences: {} as Preferences,
  pick: (_key: string, _title: string) => {},
  relocate: (_source: string, _target: string) => {}
});

export function defaultLibraryIcon(kind: string, fileName = ""): IconId {
  if (kind === "folder") return "folder";
  if (kind === "pdf") return "pdf";
  if (kind === "figures") return "images";
  if (kind === "multimodal" || kind === "artifact") return "multimodal";
  if (kind === "board") return "diagram";
  if (kind === "note") return "note";
  if (["epub", "mobi", "fb2"].includes(kind)) return "book";
  if (["markdown", "html"].includes(kind)) return "code";
  if (["txt", "text", "extracted_text"].includes(kind)) return "text";
  const extension = fileName.split(".").pop()?.toLowerCase() ?? "";
  if (/^(png|jpe?g|webp|gif|svg|bmp|tiff?)$/.test(extension)) return "image";
  if (/^(docx?|odt|rtf)$/.test(extension)) return "text";
  if (/^(xlsx?|csv|tsv|ods)$/.test(extension)) return "table";
  if (/^(pptx?|odp)$/.test(extension)) return "slides";
  if (/^(mp3|wav|flac|m4a|ogg)$/.test(extension)) return "audio";
  if (/^(mp4|webm|mov|mkv)$/.test(extension)) return "video";
  if (/^(zip|rar|7z|gz|tar)$/.test(extension)) return "archive";
  return "file";
}

function readPreferences(key: string): Preferences {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(key) ?? "{}");
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    return Object.fromEntries(Object.entries(value).filter(([, id]) => typeof id === "string" && (validIds.has(id) || (id.startsWith("emoji:") && isSingleEmoji(id.slice(6)))))) as Preferences;
  } catch { return {}; }
}

export function LibraryIconProvider({ scope, children }: { scope: string; children: ReactNode }) {
  const storageKey = `liteasy.library.icons.v1:${scope}`;
  const [preferences, setPreferences] = useState(() => readPreferences(storageKey));
  const [target, setTarget] = useState<{ key: string; title: string } | null>(null);
  const [tab, setTab] = useState("icons");
  const [emoji, setEmoji] = useState("");
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  function persist(next: Preferences) {
    try {
      localStorage.setItem(storageKey, JSON.stringify(next));
      setPreferences(next);
      setError("");
      return true;
    } catch { setError("图标设置未能保存，请检查本地存储空间后重试。"); return false; }
  }
  function choose(id?: IconValue) {
    if (!target) return;
    const next = { ...preferences };
    if (id) next[target.key] = id; else delete next[target.key];
    if (persist(next)) setTarget(null);
  }
  function relocate(source: string, destination: string) {
    const next = { ...preferences };
    for (const [key, value] of Object.entries(preferences)) {
      if (key === source || key.startsWith(`${source}/`)) {
        delete next[key];
        next[`${destination}${key.slice(source.length)}`] = value;
      }
    }
    persist(next);
  }
  return <IconContext.Provider value={{ preferences, pick: (key, title) => { setQuery(""); setEmoji(""); setError(""); setTarget({ key, title }); }, relocate }}>
    {children}
    <Dialog open={Boolean(target)} onOpenChange={(_, data) => { if (!data.open) setTarget(null); }}>
      <DialogSurface className="library-icon-dialog"><DialogBody>
        <DialogTitle>更换图标 · {target?.title}</DialogTitle>
        <DialogContent>
          <TabList selectedValue={tab} onTabSelect={(_, data) => setTab(String(data.value))}><Tab value="icons">图标</Tab><Tab value="emoji">Emoji</Tab></TabList>
          <Input aria-label="搜索图标" placeholder="搜索图标" value={query} onChange={(_, data) => setQuery(data.value)} />
          <div className="library-icon-grid" aria-label="可选图标">
            {tab === "icons" ? choices.filter(([id, label]) => `${id} ${label}`.toLowerCase().includes(query.trim().toLowerCase())).map(([id, label, Icon]) =>
              <Tooltip key={id} content={label} relationship="description"><Button appearance={target && preferences[target.key] === id ? "primary" : "subtle"}
                aria-label={label} aria-pressed={Boolean(target && preferences[target.key] === id)} icon={<Icon />} onClick={() => choose(id)} /></Tooltip>) : emojiChoices.filter(([value, label]) => `${value} ${label}`.includes(query.trim())).map(([value, label]) =>
              <Tooltip key={value} content={label} relationship="description"><Button aria-label={`Emoji ${label}`} aria-pressed={Boolean(target && preferences[target.key] === `emoji:${value}`)} appearance={target && preferences[target.key] === `emoji:${value}` ? "primary" : "subtle"} onClick={() => choose(`emoji:${value}`)}>{value}</Button></Tooltip>)}
          </div>
          {tab === "emoji" ? <div className="library-emoji-input"><Input aria-label="自定义 Emoji" placeholder="粘贴一个 Emoji，如 👩🏽‍🔬" value={emoji} maxLength={64} onChange={(_, data) => setEmoji(data.value)} />
            <Button disabled={!isSingleEmoji(emoji)} onClick={() => choose(`emoji:${emoji}`)}>使用 Emoji</Button></div> : null}
          {error ? <p role="alert">{error}</p> : null}
        </DialogContent>
        <DialogActions><Button onClick={() => choose()}>恢复默认图标</Button><Button onClick={() => setTarget(null)}>取消</Button></DialogActions>
      </DialogBody></DialogSurface>
    </Dialog>
  </IconContext.Provider>;
}

export const useLibraryIcons = () => useContext(IconContext);
export function LibraryIconMenuItem({ itemKey, title }: { itemKey: string; title: string }) {
  const { pick } = useLibraryIcons();
  return <MenuItem icon={<IconsRegular />} onClick={() => pick(itemKey, title)}>更换图标</MenuItem>;
}
export function LibraryItemIcon({ itemKey, kind, fileName }: { itemKey: string; kind: string; fileName?: string }) {
  const { preferences } = useLibraryIcons();
  const id = preferences[itemKey] ?? defaultLibraryIcon(kind, fileName);
  if (id.startsWith("emoji:")) return <span className="library-item-icon library-item-emoji" data-icon="emoji" aria-hidden="true">{id.slice(6)}</span>;
  const Icon = choices.find(([candidate]) => candidate === id)![2];
  return <span className="library-item-icon" data-icon={id} aria-hidden="true"><Icon /></span>;
}
