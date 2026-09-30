/* Annotation schema and validation. Shared by worker, UI, and tests. */
((root) => {
  'use strict';
  const MAX_BODY = 262144, MAX_QUOTE = 4000;
  const ID = /^[a-zA-Z0-9_-]{12,100}$/;
  const SCOPE = /^(?:[csd]-[0-9a-f]{16}|general)$/;
  function fail(message) { throw new Error(message); }
  function str(v, max, label, fallback = '') {
    if (v == null) return fallback;
    if (typeof v !== 'string' || v.length > max) fail(`${label}格式不正确或过长（上限 ${max} 字符）`);
    return v;
  }
  function safeURL(value) {
    if (!value) return '';
    try {
      const u = new URL(value);
      if (u.origin !== 'https://chatgpt.com' || u.username || u.password) return '';
      return u.origin + u.pathname;
    } catch { return ''; }
  }
  function source(raw) {
    const r = raw || {}, scope = str(r.scope, 30, '会话标识', 'general');
    if (!SCOPE.test(scope)) fail('会话标识不正确');
    const progressKey = str(r.progressKey, 100, '消息标识');
    const sectionId = str(r.sectionId, 16, '章节标识');
    if (progressKey && (!CGRCore.KEY_RE.test(progressKey) || progressKey.split(':')[2] !== scope)) fail('章节与会话不匹配');
    if (sectionId && !CGRCore.SECTION_RE.test(sectionId)) fail('章节标识不正确');
    return {scope, progressKey, sectionId,
      messageId: str(r.messageId, 600, '消息定位标识'), heading: str(r.heading, 600, '章节标题'),
      title: str(r.title, 300, '会话标题'), url: safeURL(str(r.url, 2048, '来源地址')),
      quote: str(r.quote, MAX_QUOTE, '原文摘录'),
      headingIndex: Number.isSafeInteger(r.headingIndex) && r.headingIndex >= 0 ? r.headingIndex : 0};
  }
  function draft(raw) {
    if (!raw || !ID.test(raw.id || '') || !ID.test(raw.noteId || '')) fail('草稿标识不正确');
    return {id: raw.id, noteId: raw.noteId, token: str(raw.token, 120, '草稿版本'),
      baseRevision: str(raw.baseRevision, 140, '基础版本'), title: str(raw.title, 300, '批注标题'),
      tags: tags(raw.tags), markdown: str(raw.markdown, MAX_BODY, '批注正文'), source: source(raw.source),
      pinned: !!raw.pinned, updatedAt: Date.now()};
  }
  function tags(value) {
    if (value == null) return [];
    if (!Array.isArray(value) || value.length > 12) fail('最多支持 12 个标签');
    return [...new Set(value.map(t => str(t, 40, '标签').trim()).filter(Boolean))];
  }
  function note(raw, backup = false) {
    if (!raw || !ID.test(raw.id || '')) fail('批注标识不正确');
    const n = {id: raw.id, title: str(raw.title, 300, '批注标题').trim(), tags: tags(raw.tags),
      markdown: str(raw.markdown, MAX_BODY, '批注正文'), source: source(raw.source), pinned: !!raw.pinned,
      deleted: !!raw.deleted};
    if (backup) {
      for (const k of ['createdAt','updatedAt']) if (!Number.isSafeInteger(raw[k]) || raw[k] < 0) fail('备份中的时间戳不正确');
      Object.assign(n, {createdAt: raw.createdAt, updatedAt: raw.updatedAt, revision: str(raw.revision, 140, '批注版本')});
      if (!n.revision) fail('备份缺少批注版本');
    }
    return n;
  }
  function header(n) {
    const {markdown, ...h} = n;
    return {...h, preview: markdown.replace(/\s+/g, ' ').slice(0, 220), chars: markdown.length,
      scope: n.source.scope, messageKey: n.source.progressKey};
  }
  function toMarkdown(notes) {
    const esc = s => String(s).replace(/[\\`*_{}\[\]()#+.!|<>~-]/g, '\\$&').replace(/\r?\n/g, ' ');
    const lines = ['# ChatGPT 阅读批注', '', `导出时间：${new Date().toISOString()}`, ''];
    for (const n of notes) {
      if (n.deleted) continue;
      lines.push('---', '', `## ${esc(n.title || n.source.heading || '未命名批注')}`, '',
        `会话：${esc(n.source.title || '未命名会话')}  `,
        `章节：${esc(n.source.heading || '独立批注')}  `,
        `更新：${new Date(n.updatedAt).toISOString()}  `,
        `批注 ID：\`${n.id}\``, '');
      if (n.source.url) lines.push(`[打开原会话](<${n.source.url}>)`, '');
      if (n.tags.length) lines.push(`标签：${n.tags.map(esc).join(' · ')}`, '');
      if (n.source.quote) lines.push('### 原文摘录', '', ...n.source.quote.split('\n').map(x => '> ' + x), '');
      lines.push('### 批注', '', n.markdown, '');
    }
    return lines.join('\n');
  }
  const api = {MAX_BODY, MAX_QUOTE, ID, SCOPE, source, draft, note, header, safeURL, tags, toMarkdown};
  root.CGRNotes = Object.freeze(api);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(globalThis);
