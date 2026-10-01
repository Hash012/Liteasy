/** Pure recommendation algorithms. No network, storage, app or dev-server dependency. */
export const rankingVersion = "personalized-hybrid-v1";
const stop = new Set("a an and are as at be been by can did do does for from has have how in into is it its not of on or our that the their these this those to use used using was we were what which will with without study based approach analysis research paper present propose proposed results show shows new method methods system systems general other such through across than also more most however demonstrate performance effective efficient different problem work works large novel high first one two three against existing describes compares suggest suggests directions future emphasis role useful reliable practical limitations approaches techniques empirical 的 了 和 与 在 是 对 一种 一个 如何 通过 研究 方法 本文 我们 这个".split(" "));
const aliases = new Map([["llm", "language model"], ["llms", "language model"], ["rag", "retrieval augmented generation"], ["gnn", "graph neural network"], ["gnns", "graph neural network"], ["大语言模型", "language model"], ["知识图谱", "knowledge graph"], ["数据库", "database"], ["事务", "transaction"], ["并发", "concurrency"], ["记忆", "memory"], ["情景", "episodic"], ["推理", "reasoning"], ["检索", "retrieval"], ["向量", "vector"], ["神经网络", "neural"], ["图像", "image"], ["优化", "optimization"]]);
const segmenter = new Intl.Segmenter("zh", { granularity: "word" });
export function terms(value) {
  let normalized = String(value || "").normalize("NFKC").toLowerCase();
  for (const [phrase, canonical] of [...aliases].sort((a, b) => b[0].length - a[0].length)) normalized = /[a-z]/.test(phrase) ? normalized.replace(new RegExp(`\\b${phrase}\\b`, "g"), ` ${canonical} `) : normalized.replaceAll(phrase, ` ${canonical} `);
  return [...segmenter.segment(normalized)].filter((part) => part.isWordLike).map(({ segment }) => aliases.get(segment) || (segment.length > 4 && segment.endsWith("ies") ? segment.slice(0, -3) + "y" : segment.length > 4 && segment.endsWith("s") && !/(ss|is|us)$/.test(segment) ? segment.slice(0, -1) : segment))
    .filter((word) => word.length > 1 && !stop.has(word) && !/^\d+$/.test(word));
}
export function cosine(left, right) {
  if (!left?.length || left.length !== right?.length) return 0;
  let dot = 0, a = 0, b = 0;
  for (let i = 0; i < left.length; i++) { if (!Number.isFinite(left[i]) || !Number.isFinite(right[i])) return 0; dot += left[i] * right[i]; a += left[i] ** 2; b += right[i] ** 2; }
  return a && b ? dot / Math.sqrt(a * b) : 0;
}
export function bm25TokenScorer(documents) {
  const rows=documents.map((tokens)=>{ const counts=new Map(); for(const token of tokens) counts.set(token,(counts.get(token)||0)+1); return { counts,length:tokens.length }; });
  const average=rows.reduce((sum,row)=>sum+row.length,0)/Math.max(1,rows.length), frequency=new Map();
  for(const row of rows) for(const token of row.counts.keys()) frequency.set(token,(frequency.get(token)||0)+1);
  const scoreAt=(index,query)=>[...new Set(query)].reduce((score,term)=>{
    const row=rows[index], count=row.counts.get(term)||0;
    const idf=Math.log(1+(rows.length-(frequency.get(term)||0)+.5)/((frequency.get(term)||0)+.5));
    return score+idf*count*2.2/(count+1.2*(.25+.75*row.length/Math.max(1,average)));
  },0);
  return { rows, scoreAt, scoreTokens: (query)=>rows.map((_,index)=>scoreAt(index,query)) };
}
function corpusScorer(documents) {
  const scorer=bm25TokenScorer(documents.map(terms));
  return { ...scorer, score: (query)=>scorer.scoreTokens([...new Set(terms(query))].slice(0,128)) };
}
export function bm25(query, documents) { return corpusScorer(documents).score(query); }
export const rrfContribution = (weight, rank, k = 10) => weight / (k + rank);
export function rrf(routes, k = 10) {
  const result = new Map();
  const active = routes.filter((route) => route.scores.some((row) => row.score > 0));
  const weight = active.reduce((sum, route) => sum + route.weight, 0) || 1;
  for (const route of active) {
    route.scores.filter((row) => row.score > 0).sort((a, b) => b.score - a.score || a.id.localeCompare(b.id)).forEach((row, rank) => {
      result.set(row.id, (result.get(row.id) || 0) + rrfContribution(route.weight / weight * (k + 1), rank + 1, k));
    });
  }
  return result;
}
const candidateText = (item) => [item.title, item.abstract, ...(item.subjects || []), ...(item.keywords || [])].filter(Boolean).join(" ");
const viewWeights = { document: .55, annotation: .30, profile: .15 };
export function hybridRank(candidates, views, options = {}) {
  const pool = candidates.slice(0, 200), texts = pool.map(candidateText), scorer = corpusScorer(texts), docTerms = scorer.rows.map((row) => new Set(row.counts.keys()));
  const activeViews = views.filter((view) => terms(view.text).length);
  const counts = Object.fromEntries(Object.keys(viewWeights).map((kind) => [kind, activeViews.filter((view) => view.kind === kind).reduce((sum, view) => sum + (view.importance ?? 1), 0)]));
  const routes = [], evidence = new Map(pool.map((item) => [item.id, []]));
  const eligible = new Set();
  for (const view of activeViews) {
    const lexical = scorer.score(view.text), q = [...new Set(terms(view.text))];
    const semantic = pool.map((item) => options.semanticScores?.[view.id]?.[item.id] ?? cosine(view.vector, item.vector));
    const weight = viewWeights[view.kind] * (view.importance ?? 1) / counts[view.kind];
    const participation = [];
    pool.forEach((item, index) => {
      const matched = q.filter((term) => docTerms[index].has(term));
      const sufficient = matched.length >= Math.min(q.length, q.length >= 5 ? 3 : 2) || semantic[index] >= (options.semanticFloor ?? .55);
      participation[index] = sufficient;
      if (view.kind !== "profile" && sufficient) eligible.add(item.id);
      if (sufficient) evidence.get(item.id).push({ viewId: view.id, kind: view.kind, title: view.title, path: view.path, anchorRef: view.anchorRef,
        matched: matched.slice(0, 6), lexical: lexical[index], semantic: semantic[index] });
    });
    const hasSemantic = semantic.some((value) => value > 0);
    routes.push({ id: `${view.id}:lexical`, weight: weight * (hasSemantic ? .65 : 1), scores: pool.map((item, i) => ({ id: item.id, score: participation[i] ? lexical[i] : 0 })) });
    if (hasSemantic) routes.push({ id: `${view.id}:semantic`, weight: weight * .35, scores: pool.map((item, i) => ({ id: item.id, score: participation[i] ? Math.max(0, semantic[i]) : 0 })) });
  }
  if (!activeViews.some((view) => view.kind !== "profile")) pool.forEach((item) => eligible.add(item.id));
  const fusion = rrf(routes), contributions = new Map(pool.map((item) => [item.id, []]));
  const activeRoutes = routes.filter((route) => route.scores.some((row) => row.score > 0));
  const totalWeight = activeRoutes.reduce((sum, route) => sum + route.weight, 0) || 1;
  for (const route of activeRoutes) route.scores.filter((row) => row.score > 0).sort((a,b) => b.score - a.score || a.id.localeCompare(b.id)).forEach((row,index) => {
    contributions.get(row.id).push({ id: route.id.endsWith(":semantic") ? "semantic" : route.id.startsWith("profile:") ? "personalization" : "lexical_bm25",
      rank: index + 1, score: row.score, weight: route.weight / totalWeight, contribution: rrfContribution(route.weight / totalWeight * 11,index + 1,10) });
  });
  const now = options.year || new Date().getUTCFullYear();
  const remaining = pool.filter((item) => eligible.has(item.id)).map((item) => {
    const age = Number.isFinite(item.publishedYear) && item.publishedYear <= now ? Math.max(0, now - item.publishedYear) : 5;
    const citations = Math.min(1, Math.log1p(Math.max(0, item.citationCount || 0)) / Math.log(1001));
    const preference = options.style === "frontier" ? .06 * Math.exp(-age / 2) : options.style === "classic" ? .06 * citations * Math.min(1, age / 10) : 0;
    return { ...item, hybrid: { version: rankingVersion, score: (fusion.get(item.id) || 0) + preference + (item.saved ? .015 : 0), preference, evidence: evidence.get(item.id), routes: contributions.get(item.id), diversityPenalty: 0 } };
  });
  return diversify(remaining, options);
}
export function diversify(items, options = {}) {
  const selected = [], remaining = items.map((item)=>({ item,penalty:0,tokens:new Set(terms(item.title)) }));
  const weight=options.style === "exploratory" ? .18 : .06;
  while(remaining.length) {
    let best=0;
    for(let index=1;index<remaining.length;index++) if(remaining[index].item.hybrid.score-remaining[index].penalty>remaining[best].item.hybrid.score-remaining[best].penalty) best=index;
    const next=remaining.splice(best,1)[0];
    selected.push({ ...next.item,hybrid:{ ...next.item.hybrid,diversityPenalty:next.penalty,score:next.item.hybrid.score-next.penalty } });
    for(const row of remaining) {
      const intersection=[...row.tokens].filter((token)=>next.tokens.has(token)).length;
      const similarity=row.item.vector && next.item.vector ? Math.max(0,cosine(row.item.vector,next.item.vector)) : intersection/Math.max(1,row.tokens.size+next.tokens.size-intersection);
      row.penalty=Math.max(row.penalty,similarity*weight);
    }
  }
  return selected;
}
export function keywords(item, corpus = [], vectors) {
  const provider = [...(item.keywords || []), ...(item.subjects || [])].filter((value) => typeof value === "string" && value.trim());
  const raw = [];
  for (const sentence of [item.title, item.abstract || ""].join(". ").split(/[.!?;:。！？；：\n]/)) {
    let run = [];
    const flush = () => { for (let start = 0; start < run.length; start++) for (let size = 2; size <= 3 && start + size <= run.length; size++) raw.push(run.slice(start, start + size).join(" ")); run = []; };
    for (const token of sentence.match(/[\p{L}\p{N}-]+/gu) || []) {
      if (/\p{Script=Han}/u.test(token)) { flush(); raw.push(...[...segmenter.segment(token)].filter((part) => part.isWordLike && part.segment.length >= 2 && !stop.has(part.segment)).map((part) => part.segment)); }
      else if (!terms(token).length) flush(); else run.push(token);
    }
    flush();
  }
  const frequency = new Map(); raw.forEach((phrase) => { const key = terms(phrase).join(" "); if (key) frequency.set(key, { label: phrase, count: (frequency.get(key)?.count || 0) + 1 }); });
  const corpusTerms = corpus.map((row) => new Set(terms(candidateText(row))));
  const extracted = [...frequency].map(([key, row]) => {
    const words = key.split(" "), df = corpusTerms.filter((doc) => words.every((word) => doc.has(word))).length;
    return { ...row, score: row.count * Math.log(2 + (corpusTerms.length + 1) / (df + 1)) + (String(item.title).includes(row.label) ? 1 : 0) + (vectors?.[key] || 0) };
  }).sort((a, b) => b.score - a.score || a.label.localeCompare(b.label));
  const seen = new Set(), result = [];
  for (const row of [...provider.map((label) => ({ label, source: "provider" })), ...extracted.map((row) => ({ ...row, source: "text" }))]) {
    const value = terms(row.label).join(" ");
    if (!value || seen.has(value) || [...seen].some((key) => key.includes(value) || value.includes(key)) || row.label.length > 65) continue;
    seen.add(value);
    result.push({ value, label: row.label.trim(), kind: /learning|retrieval|reasoning|optimization|algorithm|学习|检索|推理|算法|优化/i.test(row.label) ? "method" : /dataset|corpus|benchmark|数据集|语料/i.test(row.label) ? "object" : "subject", source: row.source });
    if (result.length === 8) break;
  }
  return result;
}
