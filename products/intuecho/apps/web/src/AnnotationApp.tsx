import {
  Badge,
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  FluentProvider,
  Input,
  Menu,
  MenuItem,
  MenuList,
  MenuPopover,
  MenuTrigger,
  Spinner,
  Textarea,
  Tooltip,
  webLightTheme
} from "@fluentui/react-components";
import {
  Add20Regular,
  ArrowReset20Regular,
  Bookmark20Filled,
  Bookmark20Regular,
  Chat20Regular,
  ChatMultiple20Regular,
  ChevronDown20Regular,
  Delete20Regular,
  Dismiss20Regular,
  Edit20Regular,
  Filter20Regular,
  Globe20Regular,
  Library20Regular,
  Open20Regular,
  PeopleTeam20Regular,
  PersonHeart20Regular,
  PersonAdd20Regular,
  Search20Regular,
  Send20Regular,
  Settings20Regular,
  SignOut20Regular,
  Star20Filled,
  Star20Regular
} from "@fluentui/react-icons";
import { lazy, Suspense, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import {
  type AcademicProfile,
  type AnnotationTarget,
  type CommunityAnnotation,
  type CommunityReply,
  type ConversationSummary,
  type PaperIdentity,
  type PlazaFilters
} from "./community.types";
import { communityApi } from "./communityApi";
import { AnnotationComposer as ExtractedAnnotationComposer, type ComposerState } from "./AnnotationComposer";
import type { IdentityMode, IdentitySession } from "./identity.types";
import { identityApi, readIdentitySession, setAuthRequiredHandler } from "./identityClient";

const DevelopmentAuthForm = import.meta.env.DEV
  ? lazy(() => import("./DevelopmentAuthForm").then((module) => ({ default: module.DevelopmentAuthForm })))
  : null;

type View = "plaza" | "following" | "messages" | "mine" | "organizations" | "profile";
type ConversationSelection = { canSend?: boolean; id: string; participant: CommunityAnnotation["author"]; unreadCount?: number };
const pendingHandoffStorageKey = "intuecho.pending-annotation-handoff.v2";
const intuechoTheme = {
  ...webLightTheme,
  colorBrandBackground: "#175b71",
  colorBrandBackgroundHover: "#104c60",
  colorBrandBackgroundPressed: "#0b4051",
  colorBrandForeground1: "#175b71",
  colorBrandForeground2: "#104c60",
  colorCompoundBrandForeground1: "#175b71",
  colorCompoundBrandForeground1Hover: "#104c60",
  colorCompoundBrandStroke: "#175b71",
  colorCompoundBrandStrokeHover: "#104c60"
};

function initialsFor(name: string) {
  return [...name.trim()].filter((character) => !/\s/u.test(character)).slice(0, 2).join("").toLocaleUpperCase("zh-CN") || "?";
}

function useRemote<T>(load: () => Promise<T>, key: string) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    setData(null);
    setError("");
    void load().then((value) => active && setData(value)).catch((reason) => active && setError(reason instanceof Error ? reason.message : "请求未能完成"));
    return () => { active = false; };
  }, [key]);
  return { data, error };
}

function usePollingRemote<T>(load: () => Promise<T>, key: string, intervalMs: number, preserveData = false) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    let loading = false;
    if (!preserveData) setData(null);
    setError("");
    async function refresh() {
      if (loading || document.visibilityState === "hidden") return;
      loading = true;
      try {
        const value = await load();
        if (active) { setData(value); setError(""); }
      } catch (reason) {
        if (active) setError(reason instanceof Error ? reason.message : "请求未能完成");
      } finally {
        loading = false;
      }
    }
    void refresh();
    const timer = window.setInterval(() => void refresh(), intervalMs);
    const resume = () => { if (document.visibilityState === "visible") void refresh(); };
    document.addEventListener("visibilitychange", resume);
    return () => {
      active = false;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", resume);
    };
  }, [key, intervalMs, preserveData]);
  return { data, error };
}

export function AnnotationApp() {
  const [session, setSession] = useState<IdentitySession | null>(() => readIdentitySession());
  const [identityMode, setIdentityMode] = useState<IdentityMode | null>(null);
  const [authOpen, setAuthOpen] = useState(false);
  const [view, setView] = useState<View>("plaza");
  const [detailId, setDetailId] = useState<string | null>(() => decodeURIComponent(window.location.pathname.match(/^\/annotations\/([^/]+)$/)?.[1] ?? "") || null);
  const [composer, setComposer] = useState<ComposerState | null>(null);
  const [conversation, setConversation] = useState<ConversationSelection | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [inboxRefresh, setInboxRefresh] = useState(0);
  const [filters, setFilters] = useState<PlazaFilters>(() => {
    const params = new URLSearchParams(window.location.search);
    const kind = params.get("literatureIdentityKind") as PaperIdentity["kind"] | null;
    return {
      ...(kind && new Set(["doi", "arxiv_id", "semantic_scholar_id", "title_authors_year_hash"]).has(kind) ? { literatureIdentityKind: kind } : {}),
      ...(params.get("literatureIdentityValue") ? { literatureIdentityValue: params.get("literatureIdentityValue")! } : {}),
      sort: "recommended"
    };
  });
  const [handoffStatus, setHandoffStatus] = useState("");
  const inbox = usePollingRemote(
    () => session ? communityApi.conversations() : Promise.resolve({ conversations: [] as ConversationSummary[] }),
    `${session?.sessionId ?? "signed-out"}-${inboxRefresh}`,
    8_000,
    true
  );
  const unreadMessages = inbox.data?.conversations.reduce((total, item) => total + item.unreadCount, 0) ?? 0;

  useEffect(() => {
    setAuthRequiredHandler(() => setAuthOpen(true));
    void identityApi.initialize().then((result) => {
      setIdentityMode(result.mode);
      setSession(result.session);
    }).catch(() => {
      setIdentityMode("unavailable");
      setSession(null);
    });
    return () => setAuthRequiredHandler(null);
  }, []);

  useEffect(() => {
    const url = new URL(window.location.href);
    const requested = url.searchParams.get("handoff");
    if (requested) sessionStorage.setItem(pendingHandoffStorageKey, requested);
    const handoffId = requested ?? sessionStorage.getItem(pendingHandoffStorageKey);
    if (!handoffId || identityMode === null) return;
    if (!session) {
      if (identityMode !== "unavailable") setAuthOpen(true);
      return;
    }
    let active = true;
    setHandoffStatus("正在恢复来自 Liteasy 的批注");
    void communityApi.consumeAnnotationHandoff(handoffId).then((result) => {
      if (!active) return;
      sessionStorage.removeItem(pendingHandoffStorageKey);
      url.searchParams.delete("handoff");
      window.history.replaceState({}, document.title, `${url.pathname}${url.search}${url.hash}`);
      setHandoffStatus("");
      setComposer({ draft: result.draft });
    }).catch((reason) => {
      if (!active) return;
      setHandoffStatus(reason instanceof Error ? reason.message : "无法恢复来自 Liteasy 的批注");
    });
    return () => { active = false; };
  }, [identityMode, session?.sessionId]);

  function requireSession(operation: () => void) {
    if (!session) setAuthOpen(true);
    else operation();
  }

  return <FluentProvider theme={intuechoTheme} className="annotation-app">
    <AppHeader
      filters={filters}
      onChangeFilters={setFilters}
      onLogin={() => setAuthOpen(true)}
      onLogout={async () => { await identityApi.logout(); setSession(null); setView("plaza"); }}
      onPublish={() => requireSession(() => setComposer({}))}
      onView={(next) => { setDetailId(null); window.history.pushState({}, document.title, "/"); setView(next); }}
      session={session}
      unreadMessages={unreadMessages}
      view={view}
    />
    {handoffStatus && <div className="handoff-status-v2" role="status">{handoffStatus}</div>}
    <div className="annotation-workspace">
      <main className="annotation-main">
        {detailId ? <AnnotationDetail annotationId={detailId} refresh={refresh} session={session} onCompose={setComposer} onConversation={setConversation} /> : <>
          {view === "plaza" && <Plaza filters={filters} onFilters={setFilters} refresh={refresh} session={session} onCompose={setComposer} onConversation={setConversation} />}
          {view === "following" && (session ? <FollowingAnnotations refresh={refresh} session={session} onCompose={setComposer} onConversation={setConversation} /> : <SignedOut onLogin={() => setAuthOpen(true)} />)}
          {view === "messages" && (session ? <ConversationsPage data={inbox.data} error={inbox.error} onConversation={setConversation} /> : <SignedOut onLogin={() => setAuthOpen(true)} />)}
          {view === "mine" && (session ? <MyAnnotations refresh={refresh} session={session} onCompose={setComposer} /> : <SignedOut onLogin={() => setAuthOpen(true)} />)}
          {view === "organizations" && (session ? <OrganizationAnnotations refresh={refresh} session={session} onCompose={setComposer} /> : <SignedOut onLogin={() => setAuthOpen(true)} />)}
          {view === "profile" && (session ? <ProfileEditor refresh={refresh} /> : <SignedOut onLogin={() => setAuthOpen(true)} />)}
        </>}
      </main>
    </div>
    {composer && <ExtractedAnnotationComposer context={composer} onClose={() => setComposer(null)} onSaved={() => { setComposer(null); setRefresh((value) => value + 1); }} />}
    {conversation && <ConversationDrawer conversation={conversation} session={session!} onInboxChange={() => setInboxRefresh((value) => value + 1)} onClose={() => { setConversation(null); setInboxRefresh((value) => value + 1); }} />}
    {authOpen && <AuthDialog identityMode={identityMode} onAuthenticated={(next) => { setSession(next); setAuthOpen(false); }} onClose={() => setAuthOpen(false)} />}
  </FluentProvider>;
}

function AppHeader({ filters, onChangeFilters, onLogin, onLogout, onPublish, onView, session, unreadMessages, view }: {
  filters: PlazaFilters;
  onChangeFilters: (filters: PlazaFilters) => void;
  onLogin: () => void;
  onLogout: () => Promise<void>;
  onPublish: () => void;
  onView: (view: View) => void;
  session: IdentitySession | null;
  unreadMessages: number;
  view: View;
}) {
  const [query, setQuery] = useState(filters.query ?? "");
  useEffect(() => setQuery(filters.query ?? ""), [filters.query]);
  function search(event: FormEvent) {
    event.preventDefault();
    onChangeFilters({ ...filters, query: query.trim() });
    onView("plaza");
  }
  return <header className="annotation-header">
    <nav aria-label="主要导航">
      <button className="annotation-brand" aria-label="返回 Intuecho 广场" onClick={() => onView("plaza")}>
        <span aria-hidden="true">∿</span>
        <strong>Intuecho</strong>
      </button>
      <div className="sidebar-nav-items">
        <button className={view === "plaza" ? "active" : ""} aria-label="广场" aria-current={view === "plaza" ? "page" : undefined} onClick={() => onView("plaza")}><Globe20Regular /><span className="nav-label">广场</span></button>
        <button className={view === "following" ? "active" : ""} aria-label="关注" aria-current={view === "following" ? "page" : undefined} onClick={() => onView("following")}><PersonHeart20Regular /><span className="nav-label">关注</span></button>
        <button className={view === "messages" ? "active" : ""} aria-label="信息" aria-current={view === "messages" ? "page" : undefined} onClick={() => onView("messages")}><ChatMultiple20Regular /><span className="nav-label">信息</span>{unreadMessages > 0 && <Badge appearance="filled" color="brand" size="small" aria-label={`${unreadMessages} 条未读消息`}>{unreadMessages > 99 ? "99+" : unreadMessages}</Badge>}</button>
        <button className={view === "mine" ? "active" : ""} aria-label="我的批注" aria-current={view === "mine" ? "page" : undefined} onClick={() => onView("mine")}><Library20Regular /><span className="nav-label">我的批注</span></button>
        <button className={view === "organizations" ? "active" : ""} aria-label="组织批注" aria-current={view === "organizations" ? "page" : undefined} onClick={() => onView("organizations")}><PeopleTeam20Regular /><span className="nav-label">组织批注</span></button>
      </div>
      <div className="sidebar-publish">
        <Tooltip content="发布批注" relationship="label"><Button appearance="primary" className="publish-action" icon={<Add20Regular />} aria-label="发布批注" onClick={onPublish}>新批注</Button></Tooltip>
      </div>
    </nav>
    <div className="header-primary">
      <form className="annotation-search" onSubmit={search}>
        <Search20Regular />
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="检索批注、文献或输入 /分类" aria-label="检索批注" />
      </form>
      <div className="annotation-account">
        {session ? <Menu>
          <MenuTrigger disableButtonEnhancement>
            <button className="account-button" aria-label={`${session.name} 的账户菜单`}>
              <span>{initialsFor(session.name)}</span><b>{session.name}</b><ChevronDown20Regular />
            </button>
          </MenuTrigger>
          <MenuPopover className="account-menu"><div className="account-menu-profile"><strong>{session.name}</strong><span>{session.email}</span></div><MenuList><MenuItem icon={<Settings20Regular />} onClick={() => onView("profile")}>学术资料</MenuItem><MenuItem icon={<SignOut20Regular />} onClick={() => void onLogout()}>退出登录</MenuItem></MenuList></MenuPopover>
        </Menu> : <Button appearance="subtle" onClick={onLogin}>登录</Button>}
      </div>
    </div>
  </header>;
}

function Plaza({ filters, onCompose, onConversation, onFilters, refresh, session }: {
  filters: PlazaFilters;
  onCompose: (value: { edit?: CommunityAnnotation; replyTo?: CommunityAnnotation }) => void;
  onConversation: (value: ConversationSelection) => void;
  onFilters: (value: PlazaFilters) => void;
  refresh: number;
  session: IdentitySession | null;
}) {
  const key = JSON.stringify(filters) + refresh;
  const { data, error } = useRemote(() => communityApi.plaza(filters), key);
  const [activeFilters, setActiveFilters] = useState(filters);
  const [filtersOpen, setFiltersOpen] = useState(false);
  useEffect(() => setActiveFilters(filters), [key]);
  const filterCount = [filters.institution, filters.documentType, filters.educationStage, filters.query].filter(Boolean).length;
  const draftFilterCount = [activeFilters.institution, activeFilters.documentType, activeFilters.educationStage, activeFilters.query].filter(Boolean).length;
  function changeSort(sort: PlazaFilters["sort"]) {
    const next = { ...filters, sort };
    setActiveFilters(next);
    onFilters(next);
  }
  function clearFilters() {
    const next: PlazaFilters = { sort: activeFilters.sort ?? "recommended" };
    setActiveFilters(next);
    onFilters(next);
  }
  return <div className="plaza-layout">
    <section className="plaza-feed">
      <div className="plaza-heading">
        <div><span>公开批注</span><h1>广场</h1><p>{data ? `${data.annotations.length} 条批注` : "正在整理内容"}</p></div>
        <div className="plaza-tools">
          <div className="sort-control" aria-label="排序方式">
          <button className={filters.sort === "recommended" ? "active" : ""} onClick={() => changeSort("recommended")}>推荐</button>
          <button className={filters.sort === "latest" ? "active" : ""} onClick={() => changeSort("latest")}>最新</button>
          </div>
          <Button appearance="subtle" icon={<Filter20Regular />} aria-expanded={filtersOpen} onClick={() => setFiltersOpen((open) => !open)}>筛选{filterCount ? ` ${filterCount}` : ""}</Button>
        </div>
      </div>
      {filterCount > 0 && <div className="active-filter-summary" aria-label="当前筛选条件">
        <span className="active-filter-label">已筛选</span>
        {filters.institution && <span>机构：{filters.institution}</span>}
        {filters.documentType && <span>文献类型：{filters.documentType}</span>}
        {filters.educationStage && <span>学段：{filters.educationStage}</span>}
        {filters.query && <span>{filters.query.startsWith("/") ? "分类" : "检索"}：{filters.query.replace(/^\//, "")}</span>}
        <Button appearance="subtle" size="small" icon={<ArrowReset20Regular />} onClick={clearFilters}>清除</Button>
      </div>}
      {filtersOpen && <section className="filter-panel" aria-label="筛选批注"><PlazaFilters value={activeFilters} onChange={setActiveFilters} /><div className="filter-actions"><Button appearance="subtle" icon={<ArrowReset20Regular />} disabled={!draftFilterCount} onClick={clearFilters}>清除</Button><Button appearance="primary" onClick={() => { onFilters(activeFilters); setFiltersOpen(false); }}>应用筛选</Button></div></section>}
      {error ? <ErrorNotice message={error} /> : !data ? <Loading /> : data.annotations.length ? <div className="annotation-list">{data.annotations.map((annotation) => <AnnotationCard key={`${annotation.id}-${refresh}`} annotation={annotation} session={session} onCompose={onCompose} onConversation={onConversation} />)}</div> : <EmptyState text="没有符合条件的公开批注" />}
    </section>
  </div>;
}

function PlazaFilters({ value, onChange }: { value: PlazaFilters; onChange: (value: PlazaFilters) => void }) {
  return <div className="filter-grid">
    <label>发布者机构<Input value={value.institution ?? ""} onChange={(_, data) => onChange({ ...value, institution: data.value })} /></label>
    <label>文献类型<Input value={value.documentType ?? ""} onChange={(_, data) => onChange({ ...value, documentType: data.value })} /></label>
    <label>发布者学段<Input value={value.educationStage ?? ""} onChange={(_, data) => onChange({ ...value, educationStage: data.value })} /></label>
  </div>;
}

export function AnnotationCard({ annotation, onCompose, onConversation, session }: {
  annotation: CommunityAnnotation;
  onCompose: (value: { edit?: CommunityAnnotation; replyTo?: CommunityAnnotation }) => void;
  onConversation?: (value: ConversationSelection) => void;
  session: IdentitySession | null;
}) {
  const [current, setCurrent] = useState(annotation);
  const [repliesOpen, setRepliesOpen] = useState(false);
  const [status, setStatus] = useState("");
  const [appealTag, setAppealTag] = useState<string | null>(null);
  const [appealReason, setAppealReason] = useState("");
  const [moderationAction, setModerationAction] = useState<"restore" | "withdraw" | null>(null);
  const [moderationReason, setModerationReason] = useState("");
  async function rate(value: number) {
    try {
      const result = await communityApi.rateAnnotation(current.id, value);
      setCurrent({ ...current, ratingAverage: result.ratingAverage, ratingCount: result.ratingCount, viewerRating: result.viewerRating });
    } catch (reason) { setStatus(reason instanceof Error ? reason.message : "评价失败"); }
  }
  async function save() {
    try { const result = await communityApi.saveAnnotation(current.id); setCurrent({ ...current, viewerSaved: result.saved }); }
    catch (reason) { setStatus(reason instanceof Error ? reason.message : "收藏失败"); }
  }
  async function follow() {
    try { const result = await communityApi.followUser(current.author.id); setStatus(result.following ? (result.mutual ? "已互相关注" : "已关注") : "已取消关注"); }
    catch (reason) { setStatus(reason instanceof Error ? reason.message : "关注失败"); }
  }
  async function message() {
    try {
      const result = await communityApi.createConversation(current.author.id);
      onConversation?.({ canSend: true, id: result.id, participant: current.author });
    } catch (reason) { setStatus(reason instanceof Error ? reason.message : "无法开始私聊"); }
  }
  async function moderateOrganization() {
    if (!moderationAction) return;
    try {
      await communityApi.moderateOrganizationAnnotation(current.id, { action: moderationAction, reason: moderationReason.trim() });
      setCurrent({ ...current, withdrawnAt: moderationAction === "withdraw" ? new Date().toISOString() : null });
      setStatus(moderationAction === "withdraw" ? "已由组织管理员撤回" : "已恢复");
      setModerationAction(null);
      setModerationReason("");
    } catch (reason) { setStatus(reason instanceof Error ? reason.message : "组织治理失败"); }
  }
  return <article className={`annotation-card${current.withdrawnAt ? " withdrawn" : ""}`}>
    <header>
      <div className="author-avatar">{current.author.initials}</div>
      <div className="annotation-author"><strong>{current.author.name}</strong><span>{profileLine(current.author.profile)}</span></div>
      <time>{new Date(current.updatedAt).toLocaleDateString("zh-CN", { month: "short", day: "numeric" })}{current.revision > 1 ? " · 已编辑" : ""}</time>
      {session && session.userId !== current.author.id && <div className="author-actions">
        <Tooltip content="关注发布者" relationship="label"><Button appearance="subtle" icon={<PersonAdd20Regular />} aria-label="关注发布者" onClick={() => void follow()} /></Tooltip>
        <Tooltip content="私聊" relationship="label"><Button appearance="subtle" icon={<Chat20Regular />} aria-label="私聊" onClick={() => void message()} /></Tooltip>
      </div>}
    </header>
    <div className="annotation-content"><p className="annotation-body">{current.body}</p></div>
    {current.withdrawnAt && <p className="moderation-state">已由组织管理员撤回</p>}
    {current.originalReply && <p className="derived-reply-context">回复了某条批注</p>}
    {current.originalReply?.status === "parent_deleted" && <p className="deleted-reply-context">原回复对象已删除</p>}
    <div className="target-list">{current.targets.map((target, index) => <TargetChip key={`${target.kind}-${index}`} target={target} />)}</div>
    {current.tags.length > 0 && <div className="annotation-tags">{current.tags.map((tag) => tag.origin === "platform" && current.viewerIsAuthor && tag.state === "active" ? <button type="button" key={`${tag.origin}-${tag.name}`} className="platform-tag" aria-label={`申诉平台标签 ${tag.name}`} onClick={() => { setAppealReason(""); setAppealTag(tag.name); }}>#{tag.name} · 平台</button> : <span key={`${tag.origin}-${tag.name}`} className={tag.origin === "platform" ? "platform-tag" : ""}>#{tag.name}{tag.origin === "platform" ? tag.state === "appealed" ? " · 审核中" : tag.state === "upheld" ? " · 已维持" : " · 平台" : ""}</span>)}</div>}
    <footer>
      <div className="star-rating" aria-label={current.ratingCount ? `${current.ratingAverage} 星，共 ${current.ratingCount} 人评分` : "暂无评分"}>
        {[1, 2, 3, 4, 5].map((value) => <Tooltip key={value} content={`${value} 星`} relationship="label"><Button appearance="subtle" icon={(current.viewerRating ?? 0) >= value ? <Star20Filled /> : <Star20Regular />} aria-label={`${value} 星`} disabled={!session || current.viewerIsAuthor || Boolean(current.withdrawnAt)} onClick={() => void rate(value)} /></Tooltip>)}
        <span>{current.ratingAverage === null ? "暂无评分" : `${current.ratingAverage} (${current.ratingCount})`}</span>
      </div>
      <Button appearance="subtle" icon={<Chat20Regular />} disabled={Boolean(current.withdrawnAt)} onClick={() => setRepliesOpen((value) => !value)}>回复</Button>
      <Tooltip content={current.viewerSaved ? "取消收藏" : "收藏"} relationship="label"><Button appearance="subtle" icon={current.viewerSaved ? <Bookmark20Filled /> : <Bookmark20Regular />} aria-label={current.viewerSaved ? "取消收藏" : "收藏"} disabled={Boolean(current.withdrawnAt)} onClick={() => void save()} /></Tooltip>
      {current.viewerIsAuthor && !current.withdrawnAt && <><Tooltip content="编辑" relationship="label"><Button appearance="subtle" icon={<Edit20Regular />} aria-label="编辑批注" onClick={() => onCompose({ edit: current })} /></Tooltip><Tooltip content="撤回" relationship="label"><Button appearance="subtle" icon={<Delete20Regular />} aria-label="撤回批注" onClick={() => void communityApi.withdrawAnnotation(current.id).then(() => setStatus("已撤回"))} /></Tooltip></>}
      {current.viewerCanModerate && <Button appearance="subtle" icon={current.withdrawnAt ? <Open20Regular /> : <Delete20Regular />} onClick={() => { setModerationAction(current.withdrawnAt ? "restore" : "withdraw"); setModerationReason(""); }}>{current.withdrawnAt ? "恢复" : "治理撤回"}</Button>}
      <Tooltip content="打开批注详情" relationship="label"><a className="annotation-detail-link" href={`/annotations/${encodeURIComponent(current.id)}`} aria-label="打开批注详情"><Open20Regular /></a></Tooltip>
    </footer>
    {status && <p className="inline-status" role="status">{status}</p>}
    {repliesOpen && <ReplyThread annotation={current} session={session} onCompose={onCompose} />}
    <Dialog open={Boolean(appealTag)} onOpenChange={(_, data) => !data.open && setAppealTag(null)}>
      <DialogSurface><DialogBody><DialogTitle>申诉平台标签</DialogTitle><DialogContent><p>#{appealTag}</p><label className="field-label">申诉理由<Textarea value={appealReason} minLength={8} maxLength={2000} resize="vertical" onChange={(_, data) => setAppealReason(data.value)} /></label></DialogContent><DialogActions><Button appearance="secondary" onClick={() => setAppealTag(null)}>取消</Button><Button appearance="primary" disabled={appealReason.trim().length < 8} onClick={() => { const tag = appealTag; if (!tag) return; void communityApi.appealTag(current.id, tag, appealReason.trim()).then(() => { setCurrent({ ...current, tags: current.tags.map((item) => item.origin === "platform" && item.name === tag ? { ...item, state: "appealed" } : item) }); setAppealTag(null); setStatus("标签申诉已提交"); }).catch((reason) => setStatus(reason instanceof Error ? reason.message : "申诉提交失败")); }}>提交申诉</Button></DialogActions></DialogBody></DialogSurface>
    </Dialog>
    <Dialog open={Boolean(moderationAction)} onOpenChange={(_, data) => !data.open && setModerationAction(null)}>
      <DialogSurface><DialogBody><DialogTitle>{moderationAction === "withdraw" ? "撤回组织批注" : "恢复组织批注"}</DialogTitle><DialogContent><label className="field-label">治理原因<Textarea value={moderationReason} minLength={3} maxLength={1000} resize="vertical" onChange={(_, data) => setModerationReason(data.value)} /></label></DialogContent><DialogActions><Button appearance="secondary" onClick={() => setModerationAction(null)}>取消</Button><Button appearance="primary" disabled={moderationReason.trim().length < 3} onClick={() => void moderateOrganization()}>确认</Button></DialogActions></DialogBody></DialogSurface>
    </Dialog>
  </article>;
}

function AnnotationDetail({ annotationId, onCompose, onConversation, refresh, session }: {
  annotationId: string;
  onCompose: (value: { edit?: CommunityAnnotation; replyTo?: CommunityAnnotation }) => void;
  onConversation: (value: ConversationSelection) => void;
  refresh: number;
  session: IdentitySession | null;
}) {
  const { data, error } = useRemote(() => communityApi.annotation(annotationId), `${annotationId}:${refresh}`);
  return <section className="single-column annotation-detail"><div className="page-heading"><span>批注</span><h1>详情</h1></div>{error ? <ErrorNotice message={error} /> : !data ? <Loading /> : <AnnotationCard annotation={data.annotation} session={session} onCompose={onCompose} onConversation={onConversation} />}</section>;
}

function TargetChip({ target }: { target: AnnotationTarget }) {
  const title = "metadata" in target.literature ? target.literature.metadata.title : `文献 ${target.literature.literatureId}`;
  return <div className="target-chip">
    <Library20Regular />
    <span><strong>{title}</strong><small>{target.kind === "whole_document" ? "整篇文献" : target.kind === "source_passage" ? `${target.page ? `第 ${target.page} 页 · ` : ""}${target.excerpt}` : `薄读内容 · ${target.derivedContent.excerpt}`}</small></span>
  </div>;
}

export function ReplyThread({ annotation, onCompose, session }: { annotation: CommunityAnnotation; onCompose: (value: { replyTo?: CommunityAnnotation }) => void; session: IdentitySession | null }) {
  const { data, error } = useRemote(() => communityApi.replies(annotation.id), annotation.id);
  return <section className="reply-thread">
    <div className="reply-heading"><strong>回复</strong>{session && <Button size="small" appearance="subtle" icon={<Add20Regular />} onClick={() => onCompose({ replyTo: annotation })}>写回复</Button>}</div>
    {error ? <ErrorNotice message={error} /> : !data ? <Spinner size="tiny" /> : data.replies.length ? data.replies.map((reply) => <ReplyItem key={reply.id} parent={annotation} reply={reply} session={session} onCompose={onCompose} />) : <span className="empty-replies">暂无回复</span>}
  </section>;
}

export function ReplyItem({ parent, reply }: { onCompose: (value: { replyTo?: CommunityAnnotation }) => void; parent: CommunityAnnotation; reply: CommunityReply; session: IdentitySession | null }) {
  const [body, setBody] = useState(reply.body);
  const [publicationState, setPublicationState] = useState(reply.derivedAnnotationState);
  const [derivedAnnotationId, setDerivedAnnotationId] = useState(reply.derivedAnnotationId);
  const [editing, setEditing] = useState(false);
  const [status, setStatus] = useState("");
  async function save() {
    try {
      const result = await communityApi.updateReply(reply.id, { body });
      setBody(result.reply.body);
      setEditing(false);
    } catch (reason) { setStatus(reason instanceof Error ? reason.message : "回复保存失败"); }
  }
  async function updatePublication(published: boolean) {
    try {
      const input = published ? { published: true as const, targets: parent.targets, tags: [] } : { published: false as const };
      const result = await communityApi.updateReplyPublication(reply.id, input);
      setPublicationState(result.reply.derivedAnnotationState);
      setDerivedAnnotationId(result.reply.derivedAnnotationId);
      setStatus("");
    } catch {
      setStatus(published ? "恢复失败，独立批注仍隐藏" : "撤回失败，独立批注仍公开");
    }
  }
  const publicationLabel = publicationState === "published" ? "停止独立批注" : publicationState === "withdrawn" ? "恢复独立批注" : "发布为独立批注";
  const publicationStateLabel = publicationState === "published" ? "已发布" : publicationState === "withdrawn" ? "已撤回" : "未发布";
  return <article className="reply-item"><header><span className="author-avatar">{reply.author.initials}</span><div><strong>{reply.author.name}</strong><small>{new Date(reply.updatedAt).toLocaleDateString("zh-CN")}{reply.revision > 1 ? " · 已编辑" : ""}</small></div></header>{editing ? <><Textarea value={body} onChange={(_, data) => setBody(data.value)} /><div className="reply-edit-actions"><Button size="small" onClick={() => setEditing(false)}>取消</Button><Button size="small" appearance="primary" onClick={() => void save()}>保存</Button></div></> : <p>{body}</p>}<span className={`reply-publication-state ${publicationState}`}>独立批注：{publicationStateLabel}</span>{publicationState === "published" && derivedAnnotationId && <a className="derived-annotation-link" href={`/annotations/${encodeURIComponent(derivedAnnotationId)}`}>查看同步发布的批注</a>}<footer>{reply.viewerIsAuthor && !editing && <Button size="small" appearance="subtle" icon={<Edit20Regular />} onClick={() => setEditing(true)}>编辑</Button>}{reply.viewerIsAuthor && !editing && <Button size="small" appearance="subtle" onClick={() => void updatePublication(publicationState !== "published")}>{publicationLabel}</Button>}</footer>{status && <p className="inline-status" role="status">{status}</p>}</article>;
}

function FollowingAnnotations({ onCompose, onConversation, refresh, session }: {
  onCompose: (value: { edit?: CommunityAnnotation; replyTo?: CommunityAnnotation }) => void;
  onConversation: (value: ConversationSelection) => void;
  refresh: number;
  session: IdentitySession;
}) {
  const { data, error } = useRemote(communityApi.followingAnnotations, String(refresh));
  return <section className="single-column"><div className="page-heading"><span>关注动态</span><h1>关注</h1></div>{error ? <ErrorNotice message={error} /> : !data ? <Loading /> : data.annotations.length ? <div className="annotation-list">{data.annotations.map((annotation) => <AnnotationCard key={`${annotation.id}-${refresh}`} annotation={annotation} onCompose={onCompose} onConversation={onConversation} session={session} />)}</div> : <EmptyState icon={<PersonHeart20Regular />} text="关注的人还没有发布新批注" />}</section>;
}

function conversationPreview(conversation: ConversationSummary) {
  if (!conversation.lastMessage) return "还没有消息";
  if (conversation.lastMessage.kind === "organization_invitation") return "组织邀请";
  return conversation.lastMessage.body;
}

function ConversationsPage({ data, error, onConversation }: { data: { conversations: ConversationSummary[] } | null; error: string; onConversation: (value: ConversationSelection) => void }) {
  return <section className="conversations-page"><div className="page-heading"><span>直接交流</span><h1>私聊</h1></div>{error && !data ? <ErrorNotice message={error} /> : !data ? <Loading /> : data.conversations.length ? <div className="conversation-list">{data.conversations.map((conversation) => <button className={`conversation-row${conversation.unreadCount > 0 ? " unread" : ""}`} key={conversation.id} onClick={() => onConversation(conversation)} type="button"><span className="author-avatar">{conversation.participant.initials}</span><span className="conversation-copy"><strong>{conversation.participant.name}</strong><small>{profileLine(conversation.participant.profile)}</small><span>{conversationPreview(conversation)}</span></span><span className="conversation-meta"><time>{new Date(conversation.lastMessage?.createdAt ?? conversation.createdAt).toLocaleDateString("zh-CN", { month: "short", day: "numeric" })}</time>{conversation.unreadCount > 0 ? <Badge appearance="filled" color="brand" size="small" aria-label={`${conversation.unreadCount} 条未读消息`}>{conversation.unreadCount > 99 ? "99+" : conversation.unreadCount}</Badge> : !conversation.canSend ? <small>仅可查看</small> : null}</span><Open20Regular /></button>)}</div> : <EmptyState icon={<ChatMultiple20Regular />} text="还没有私聊会话" />}</section>;
}

function MyAnnotations({ onCompose, refresh, session }: { onCompose: (value: { edit?: CommunityAnnotation; replyTo?: CommunityAnnotation }) => void; refresh: number; session: IdentitySession }) {
  const { data, error } = useRemote(communityApi.myAnnotations, String(refresh));
  return <section className="single-column"><div className="page-heading"><span>个人中心</span><h1>我的批注</h1></div>{error ? <ErrorNotice message={error} /> : !data ? <Loading /> : data.annotations.length ? <div className="annotation-list">{data.annotations.map((annotation) => <AnnotationCard key={`${annotation.id}-${refresh}`} annotation={annotation} onCompose={onCompose} session={session} />)}</div> : <EmptyState text="还没有批注" />}</section>;
}

function OrganizationAnnotations({ onCompose, refresh, session }: { onCompose: (value: { edit?: CommunityAnnotation; replyTo?: CommunityAnnotation }) => void; refresh: number; session: IdentitySession }) {
  const { data, error } = useRemote(communityApi.organizationAnnotations, String(refresh));
  return <section className="single-column"><div className="page-heading"><span>组织</span><h1>组织批注</h1></div>{error ? <ErrorNotice message={error} /> : !data ? <Loading /> : data.organizations.length ? <div className="organization-groups">{data.organizations.map((organization) => <section className="organization-group" key={organization.organizationId}><header><div><strong>{organization.name}</strong><span>{organization.role === "owner" ? "负责人" : organization.role === "admin" ? "管理员" : "成员"}</span></div><small>{organization.annotations.length} 条</small></header>{organization.annotations.length ? <div className="annotation-list">{organization.annotations.map((annotation) => <AnnotationCard key={`${annotation.id}-${annotation.updatedAt}`} annotation={annotation} onCompose={onCompose} session={session} />)}</div> : <EmptyState text="该组织还没有可见批注" />}</section>)}</div> : <EmptyState text="当前没有可访问的组织" />}</section>;
}

function ProfileEditor({ refresh }: { refresh: number }) {
  const { data, error } = useRemote(communityApi.academicProfile, String(refresh));
  if (error) return <ErrorNotice message={error} />;
  if (!data) return <Loading />;
  return <ProfileForm key={data.profile.revision} profile={data.profile} />;
}

function ProfileForm({ profile }: { profile: AcademicProfile }) {
  const [educationStage, setEducationStage] = useState(profile.educationStage ?? "");
  const [institutions, setInstitutions] = useState(profile.institutions);
  const [status, setStatus] = useState("");
  async function save(event: FormEvent) {
    event.preventDefault();
    try { await communityApi.updateAcademicProfile({ educationStage: educationStage || null, institutions }); setStatus("已保存"); }
    catch (reason) { setStatus(reason instanceof Error ? reason.message : "保存失败"); }
  }
  return <section className="profile-page"><div className="page-heading"><span>个人中心</span><h1>学术资料</h1></div><form onSubmit={save}><label>学段<Input value={educationStage} onChange={(_, data) => setEducationStage(data.value)} /></label><div className="institution-editor"><div className="section-row"><strong>研究机构</strong><Button type="button" appearance="subtle" icon={<Add20Regular />} onClick={() => setInstitutions([...institutions, { name: "" }])}>添加</Button></div>{institutions.map((institution, index) => <div className="institution-row" key={index}><Input value={institution.name} placeholder="机构名称" onChange={(_, data) => setInstitutions(institutions.map((item, position) => position === index ? { name: data.value } : item))} /><Button type="button" appearance="subtle" icon={<Delete20Regular />} aria-label="删除机构" onClick={() => setInstitutions(institutions.filter((_, position) => position !== index))} /></div>)}</div><div className="profile-actions"><Button appearance="primary" type="submit">保存资料</Button>{status && <span role="status">{status}</span>}</div></form></section>;
}

function ConversationDrawer({ conversation, onClose, onInboxChange, session }: { conversation: ConversationSelection; onClose: () => void; onInboxChange: () => void; session: IdentitySession }) {
  const [refresh, setRefresh] = useState(0);
  const [body, setBody] = useState("");
  const [status, setStatus] = useState("");
  const [inviteOpen, setInviteOpen] = useState(false);
  const [organizationId, setOrganizationId] = useState("");
  const [role, setRole] = useState("member");
  const messageEnd = useRef<HTMLDivElement | null>(null);
  const { data, error } = usePollingRemote(() => communityApi.messages(conversation.id), `${conversation.id}-${refresh}`, 3_000);
  const latestMessageId = data?.messages[data.messages.length - 1]?.id ?? null;
  useEffect(() => {
    if (!latestMessageId) return;
    messageEnd.current?.scrollIntoView({ behavior: "smooth", block: "end" });
    void communityApi.markConversationRead(conversation.id, latestMessageId).then(onInboxChange).catch(() => undefined);
  }, [conversation.id, latestMessageId]);
  async function send(event: FormEvent) {
    event.preventDefault();
    if (conversation.canSend === false) return;
    try {
      await communityApi.sendMessage(conversation.id, inviteOpen ? { body, invitation: { organizationId, role }, kind: "organization_invitation" } : { body, kind: "text" });
      setBody(""); setInviteOpen(false); setRefresh((value) => value + 1);
    } catch (reason) { setStatus(reason instanceof Error ? reason.message : "发送失败"); }
  }
  return <div className="drawer-backdrop"><aside className="message-drawer" role="dialog" aria-modal="true"><header><div className="author-avatar">{conversation.participant.initials}</div><div><strong>{conversation.participant.name}</strong><span>{conversation.canSend === false ? "历史会话" : "私聊"}</span></div><Button appearance="subtle" icon={<Dismiss20Regular />} aria-label="关闭" onClick={onClose} /></header><div className="message-list">{error && !data ? <ErrorNotice message={error} /> : !data ? <Loading /> : <>{data.messages.map((message) => <article className={message.senderId === session.userId ? "mine" : ""} key={message.id}><p>{message.body}</p>{message.invitation && <div className="invitation-card"><strong>组织邀请</strong><span>{message.invitation.organizationId} · {message.invitation.role}</span></div>}<time>{new Date(message.createdAt).toLocaleString("zh-CN")}</time></article>)}<div className="message-end" ref={messageEnd} /></>}</div><form className="message-form" onSubmit={send}>{conversation.canSend === false && <p className="conversation-locked" role="status">已解除互关，历史消息仍可查看。</p>}{inviteOpen && <div className="invitation-fields"><Input value={organizationId} onChange={(_, data) => setOrganizationId(data.value)} placeholder="组织 ID" required /><Input value={role} onChange={(_, data) => setRole(data.value)} placeholder="角色" required /></div>}<Textarea value={body} disabled={conversation.canSend === false} onChange={(_, data) => setBody(data.value)} placeholder="输入消息" required={!inviteOpen} /><div><Checkbox checked={inviteOpen} disabled={conversation.canSend === false} label="组织邀请" onChange={(_, data) => setInviteOpen(Boolean(data.checked))} /><Button appearance="primary" disabled={conversation.canSend === false} icon={<Send20Regular />} type="submit">发送</Button></div>{status && <p className="form-error">{status}</p>}</form></aside></div>;
}

function AuthDialog({ identityMode, onAuthenticated, onClose }: { identityMode: IdentityMode | null; onAuthenticated: (session: IdentitySession) => void; onClose: () => void }) {
  const [status, setStatus] = useState("");
  return <div className="modal-backdrop"><section className="auth-dialog-v2" role="dialog" aria-modal="true" aria-labelledby="auth-title"><Button appearance="subtle" icon={<Dismiss20Regular />} aria-label="关闭" className="modal-close" onClick={onClose} /><span>Intuecho</span><h2 id="auth-title">登录</h2>{identityMode === "oauth" ? <Button appearance="primary" onClick={() => void identityApi.beginOAuthLogin().catch((reason) => setStatus(reason.message))}>使用统一账号登录</Button> : identityMode === "development" && DevelopmentAuthForm ? <Suspense fallback={<Loading />}><DevelopmentAuthForm onAuthenticated={onAuthenticated} /></Suspense> : <p>{identityMode === null ? "正在连接身份服务" : "统一身份服务暂时不可用"}</p>}{status && <p className="form-error">{status}</p>}</section></div>;
}

function profileLine(profile: CommunityAnnotation["author"]["profile"]) {
  return [profile.institutions.map((item) => item.name).join("、"), profile.educationStage].filter(Boolean).join(" · ") || "未填写学术资料";
}

function SignedOut({ onLogin }: { onLogin: () => void }) { return <section className="signed-out"><h1>登录后查看</h1><Button appearance="primary" onClick={onLogin}>登录</Button></section>; }
function Loading() { return <div className="loading-v2"><Spinner size="small" /><span>正在加载</span></div>; }
function EmptyState({ icon = <Library20Regular />, text }: { icon?: ReactNode; text: string }) { return <div className="empty-v2">{icon}<span>{text}</span></div>; }
function ErrorNotice({ message }: { message: string }) { return <div className="error-v2" role="alert">{message}</div>; }
