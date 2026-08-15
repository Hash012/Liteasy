import type { AnalysisEvidence } from "../paper-analysis/analysis.types";
import type { ThinReadingExternalSource } from "./thinReading.types";

export type ThinReadingNumericFidelityCode =
  | "comparator_mismatch"
  | "incomplete_numeric_group"
  | "metric_mismatch"
  | "qualifier_dropped"
  | "relation_mismatch"
  | "scope_mismatch"
  | "subject_mismatch"
  | "uncertainty_dropped"
  | "unanchored_quantitative_magnitude"
  | "unit_mismatch"
  | "unsupported_numeric_value";

export type ThinReadingNumericFidelityDiagnostic = {
  code: ThinReadingNumericFidelityCode;
  sentenceIndex: number;
  sentenceText: string;
  sourceIds: readonly string[];
  value?: string;
};

export class ThinReadingNumericFidelityError extends Error {
  diagnostics: readonly ThinReadingNumericFidelityDiagnostic[];

  constructor(diagnostics: readonly ThinReadingNumericFidelityDiagnostic[]) {
    super(diagnostics.slice(0, 3).map(formatNumericDiagnostic).join("；"));
    this.name = "ThinReadingNumericFidelityError";
    this.diagnostics = diagnostics;
  }
}

type NumericQualifier = "approximate" | "exact" | "lower_bound" | "upper_bound";

type NumericMetric =
  | "accuracy"
  | "count"
  | "dimension"
  | "error_rate"
  | "f1"
  | "inference_speedup"
  | "latency"
  | "loss"
  | "map"
  | "memory"
  | "mrr"
  | "ndcg"
  | "parameter_count"
  | "precision"
  | "ratio"
  | "recall"
  | "score"
  | "speedup"
  | "throughput"
  | "time"
  | "training_speedup";

type NumericRelation = "decrease" | "greater" | "increase" | "less";

type Rational = {
  denominator: bigint;
  numerator: bigint;
};

type NumericUnit = {
  dimension: string;
  denominator: bigint;
  numerator: bigint;
};

type NumericMention = {
  comparator?: string;
  hasAttachedUncertainty: boolean;
  metric?: NumericMetric;
  qualifier: NumericQualifier;
  rawValue: string;
  relation?: NumericRelation;
  scopes: readonly string[];
  subject?: string;
  unit?: NumericUnit;
  value: Rational;
};

const englishNumberWords = new Map<string, number>([
  ["zero", 0],
  ["one", 1],
  ["two", 2],
  ["three", 3],
  ["four", 4],
  ["five", 5],
  ["six", 6],
  ["seven", 7],
  ["eight", 8],
  ["nine", 9],
  ["ten", 10],
  ["eleven", 11],
  ["twelve", 12],
  ["thirteen", 13],
  ["fourteen", 14],
  ["fifteen", 15],
  ["sixteen", 16],
  ["seventeen", 17],
  ["eighteen", 18],
  ["nineteen", 19],
  ["twenty", 20]
]);
const chineseNumberWords = new Map<string, number>([
  ["零", 0],
  ["一", 1],
  ["二", 2],
  ["两", 2],
  ["三", 3],
  ["四", 4],
  ["五", 5],
  ["六", 6],
  ["七", 7],
  ["八", 8],
  ["九", 9],
  ["十", 10]
]);
const englishNumberWordPatternSource = [...englishNumberWords.keys()].join("|");
const chineseNumberWordPatternSource = "[零一二两三四五六七八九十]{1,3}";
const numberWordPattern = new RegExp(
  `\\b(?:${englishNumberWordPatternSource})\\b|${chineseNumberWordPatternSource}`,
  "giu"
);
const numberWordRangeEndpoint = `(?:\\d|${englishNumberWordPatternSource}|${chineseNumberWordPatternSource})`;
const followingNumberWordRangeEndpointPattern = new RegExp(
  `^\\s*(?:-|–|—|~|〜|to|至|到)\\s*${numberWordRangeEndpoint}`,
  "i"
);
const betweenNumberWordRangeStartPattern = new RegExp(
  `^\\s*(?:and|与|和|至|到)\\s*${numberWordRangeEndpoint}`,
  "i"
);

type NumericSentence = {
  evidenceIds: readonly string[];
  externalKnowledge: readonly string[];
  text: string;
};

const numericTokenPattern = /[-+]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?(?:[eE][+-]?\d+)?/g;
const structuralNumberPrefixPattern = /(?:\b(?:algorithm|appendix|chapter|chunk|document|eq(?:uation)?|fig(?:ure)?|id|item|line|listing|no|number|p(?:age|assage)?|paper|para(?:graph)?|part|ref(?:erence)?|sec(?:tion)?|step|table)\.?\s*(?:no\.?\s*)?|(?:第\s*)?(?:页(?:码)?|段(?:落)?|节|章节|章|图|表|附录|块|片段|条目|公式|式|行|算法)\s*)$/i;
const structuralNumberSuffixPattern = /^\s*(?:页(?:码)?|段(?:落)?|节|章节|章|图|表|附录|块|片段|条目|公式|式|行|算法)/;
const chineseQuantitativeSuffixPattern = /^\s*(?:%|‰|(?:个\s*)?百分点|倍|次|个|例|名|位|组|层|轮|步|条|项|篇|台|核|样本|数据集|查询|文档|图像|节点|边|簇|批(?:次)?|实验|试验|折|随机种子|候选|近邻|令牌|词元|参数|维(?:度)?|特征|标签|类别|模型|任务|序列|患者|受试者|参与者|病例|观察|记录|变量|毫秒|微秒|纳秒|秒|分钟|小时|天|周|月|年|字节)/;
const physicalUnitSuffixPattern = /^\s*(?:[kMGT]?B(?:\/s)?|[munpμ]?s|ms|min|h|Hz|kHz|MHz|GHz|[kMGT]?FLOP(?:s)?|[kmunpμ]?m|cm|mm|km|kg|mg|µg|ug|mL|L|dB|W|V|A|Pa|K)\b/i;
const englishQuantitativeSuffixPattern = /^\s*(?:percentage\s+points?|percent|samples?|examples?|instances?|observations?|participants?|subjects?|patients?|tokens?|documents?|queries|images|records?|datasets?|classes|categories|labels?|layers?|heads?|epochs?|iterations?|steps?|parameters?|features?|dimensions?|variables?|models?|methods?|tasks?|trials?|runs?|folds?|seeds?|batches?|workers?|GPUs?|CPUs?|nodes?|edges?|vertices?|clusters?|experiments?|cases?|studies|papers?|citations?|words?|sentences?|passages?|retrievals?|candidates?|neighbors?|shots?|bits?|CI|confidence intervals?)\b/i;
const multiplierUnitSuffixPattern = /^\s*(?:×|x\b|-?fold\b|times?\b)/i;
const numericMetricPrefixPattern = /(?:\b(?:accuracy|auc|average|count|error|f1|latency|loss|map|mean|median|memory|mrr|ndcg|number|precision|probability|rate|ratio|recall|score|speed|speedup|std(?:\.?\s*dev(?:iation)?)?|throughput|time|top[- ]?k|total|variance)\s*(?:=|:|is|of|about|approximately)?\s*|(?:准确率|精确率|召回率|错误率|成功率|得分|分数|均值|平均|中位数|标准差|方差|误差|置信区间|显著性|p值|数量|样本数|参数量|总计|加速比|比例|比率|延迟|耗时|时间|时长|内存|吞吐量|速度|共|每|Top[- ]?k)\s*(?:为|是|约|达|至|=|：)?\s*)$/i;
const numericComparisonPrefixPattern = /(?:\b(?:p|n)\s*(?:value\s*)?[<=>≤≥]\s*|[A-Za-zα-ωΑ-Ω][A-Za-z0-9α-ωΑ-Ω_]*\s*[<=>≤≥]\s*|[±~≈≃]\s*|\b(?:from|between)\s*)$/i;
const numericRangeDelimiterPattern = /(?:-|–|—|~|〜|至|到|\bto\b)\s*$/i;
const numericRangeSuffixPattern = /^\s*(?:-|–|—|~|〜|至|到|\bto\b)\s*[-+]?(?:\d{1,3}(?:,\d{3})+|\d+)/i;
const symbolicVariablePattern = "[A-Za-zα-ωΑ-Ω][A-Za-z0-9_α-ωΑ-ΩβγδΔΓ]*";
const symbolicNumberPattern = "[-+]?(?:\\d{1,3}(?:,\\d{3})+|\\d+)(?:\\.\\d+)?";
const symbolicConstraintPattern = new RegExp(
  `(?:${symbolicVariablePattern}\\s*(?:=|<|>|≤|≥|<=|>=)\\s*${symbolicNumberPattern}|${symbolicNumberPattern}\\s*(?:=|<|>|≤|≥|<=|>=)\\s*${symbolicVariablePattern})`,
  "u"
);
const symbolicConstraintSummaryPattern = /(?:=|<|>|≤|≥|<=|>=|约束|不等式|取值范围|上下界|边界条件|lower bound|upper bound|constraint|inequality|bounded)/i;
const unsupportedMagnitudePattern = /(?:明显|大幅|显著|数量充足|样本充足|具有代表性|代表性样本|substantially|markedly|considerably|dramatically|significantly|statistically significant|strong(?:er)?|sufficient(?:ly)?|representative)/i;

const numericMetricPatterns: readonly { metric: NumericMetric; pattern: RegExp }[] = [
  { metric: "training_speedup", pattern: /training\s+(?:time\s+)?speedups?|训练(?:速度|时间)?加速比|训练加速/gi },
  { metric: "inference_speedup", pattern: /inference\s+(?:time\s+)?speedups?|推理(?:速度|时间)?加速比|推理加速/gi },
  { metric: "error_rate", pattern: /error\s+rates?|错误率/gi },
  { metric: "parameter_count", pattern: /parameter\s+(?:count|number)s?|参数量|参数数量/gi },
  { metric: "accuracy", pattern: /accurac(?:y|ies)|准确率/gi },
  { metric: "precision", pattern: /precision|精确率/gi },
  { metric: "recall", pattern: /recall|召回率/gi },
  { metric: "f1", pattern: /\bf1(?:[- ]?score)?\b/gi },
  { metric: "mrr", pattern: /\bmrr\b/gi },
  { metric: "ndcg", pattern: /\bndcg(?:@\d+)?\b/gi },
  { metric: "map", pattern: /\bmap(?:@\d+)?\b/gi },
  { metric: "latency", pattern: /latenc(?:y|ies)|延迟/gi },
  { metric: "throughput", pattern: /throughput|吞吐量/gi },
  { metric: "memory", pattern: /memory|内存/gi },
  { metric: "loss", pattern: /\bloss\b|损失/gi },
  { metric: "speedup", pattern: /speedups?|speed-ups?|加速比/gi },
  { metric: "dimension", pattern: /dimensions?|维度/gi },
  { metric: "count", pattern: /counts?|number\s+of|数量|样本数|总计/gi },
  { metric: "ratio", pattern: /ratios?|proportions?|比例|比率/gi },
  { metric: "score", pattern: /scores?|得分|分数/gi },
  { metric: "time", pattern: /times?|duration|耗时|时间|时长/gi }
];

const numericRelationPatterns: readonly { relation: NumericRelation; pattern: RegExp }[] = [
  { relation: "increase", pattern: /increas(?:e|es|ed|ing)|rises?|rose|improv(?:e|es|ed|ement)|gains?|higher|faster|提高|提升|增加|上升|改善|更高|更快/gi },
  { relation: "decrease", pattern: /decreas(?:e|es|ed|ing)|drops?|fell|reduc(?:e|es|ed|tion)|lower|slower|降低|下降|减少|更低|更慢/gi },
  { relation: "greater", pattern: /greater\s+than|more\s+than|高于|大于|超过/gi },
  { relation: "less", pattern: /less\s+than|低于|小于/gi }
];

const subjectPatterns = [
  /\b(?:model|system|method|framework)\s+[A-Za-z][A-Za-z0-9_.-]*/gi,
  /(?:模型|系统|方法|框架)\s*[A-Za-z][A-Za-z0-9_.-]*/gi
] as const;
const scopePatterns = [
  /\b(?:dataset|benchmark|task)\s+[A-Za-z0-9][A-Za-z0-9_.-]*/gi,
  /\b(?:MNIST|Fashion-?MNIST|CIFAR-?10|CIFAR-?100|ImageNet|COCO|A100|H100|V100)\b/gi
] as const;

function nearestPatternValue<T>(
  value: string,
  mentionStart: number,
  patterns: readonly { pattern: RegExp; value: T }[]
): T | undefined {
  let nearest: { distance: number; value: T } | undefined;
  for (const candidate of patterns) {
    const flags = candidate.pattern.flags.includes("g")
      ? candidate.pattern.flags
      : `${candidate.pattern.flags}g`;
    for (const match of value.matchAll(new RegExp(candidate.pattern.source, flags))) {
      const start = match.index ?? 0;
      const end = start + match[0].length;
      const distance = mentionStart < start
        ? start - mentionStart
        : mentionStart > end
          ? mentionStart - end
          : 0;
      if (distance <= 96 && (!nearest || distance < nearest.distance)) {
        nearest = { distance, value: candidate.value };
      }
    }
  }
  return nearest?.value;
}

function nearestPatternText(
  value: string,
  mentionStart: number,
  patterns: readonly RegExp[]
) {
  let nearest: { distance: number; text: string } | undefined;
  let preceding: { distance: number; text: string } | undefined;
  for (const pattern of patterns) {
    const flags = pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`;
    for (const match of value.matchAll(new RegExp(pattern.source, flags))) {
      const start = match.index ?? 0;
      const end = start + match[0].length;
      const distance = mentionStart < start
        ? start - mentionStart
        : mentionStart > end
          ? mentionStart - end
          : 0;
      if (distance <= 96 && (!nearest || distance < nearest.distance)) {
        nearest = { distance, text: match[0] };
      }
      if (end <= mentionStart && distance <= 96 && (!preceding || distance < preceding.distance)) {
        preceding = { distance, text: match[0] };
      }
    }
  }
  return preceding?.text ?? nearest?.text;
}

function normalizeSemanticLabel(value: string) {
  return value.normalize("NFKC").toLowerCase().replace(/[^a-z0-9\u3400-\u9fff]+/g, " ").trim();
}

function extractComparator(value: string, mentionStart: number, mentionLength: number) {
  const before = value.slice(Math.max(0, mentionStart - 96), mentionStart);
  const after = value.slice(mentionStart + mentionLength, mentionStart + mentionLength + 96);
  const afterMatch = after.match(
    /^\s*(?:%|‰|×|x\b|-?fold\b|times?\b)?\s*(?:faster|slower|higher|lower)?\s*(?:than|over|versus|vs\.?|relative\s+to|相对|相比于?|比)\s*([A-Za-z][A-Za-z0-9_.-]*)/i
  );
  const beforeMatch = before.match(
    /(?:than|over|versus|vs\.?|relative\s+to|相对|相比于?|比)\s*([A-Za-z][A-Za-z0-9_.-]*)[^.!?。！？]{0,28}$/i
  );
  return normalizeSemanticLabel(afterMatch?.[1] ?? beforeMatch?.[1] ?? "") || undefined;
}

function extractScopes(value: string, mentionStart: number) {
  return [...new Set(scopePatterns.flatMap((pattern) => {
    const flags = pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`;
    return [...value.matchAll(new RegExp(pattern.source, flags))]
      .filter((match) => Math.abs((match.index ?? 0) - mentionStart) <= 120)
      .map((match) => normalizeSemanticLabel(match[0]));
  }).filter(Boolean))];
}

function hasAttachedUncertainty(value: string, mentionStart: number, mentionLength: number) {
  const before = value.slice(Math.max(0, mentionStart - 24), mentionStart);
  const after = value.slice(mentionStart + mentionLength, mentionStart + mentionLength + 40);
  return /^\s*(?:%|‰)?\s*±\s*[-+]?\d/i.test(after) ||
    /±\s*$/.test(before) ||
    /(?:confidence\s+interval|置信区间)[^.!?。！？]{0,20}$/i.test(before);
}

function isHardSemanticBoundary(value: string, index: number) {
  const character = value[index];
  if (character === ".") {
    return !/\d/.test(value[index - 1] ?? "") || !/\d/.test(value[index + 1] ?? "");
  }
  return character === ";" || character === "；" || character === "。" ||
    character === "!" || character === "！" || character === "?" ||
    character === "？" || character === "\n";
}

function numericFactClause(value: string, mentionStart: number, mentionLength: number) {
  let start = 0;
  for (let index = mentionStart - 1; index >= 0; index -= 1) {
    if (isHardSemanticBoundary(value, index)) {
      start = index + 1;
      break;
    }
  }
  let end = value.length;
  for (let index = mentionStart + mentionLength; index < value.length; index += 1) {
    if (isHardSemanticBoundary(value, index)) {
      end = index;
      break;
    }
  }
  return {
    mentionStart: mentionStart - start,
    text: value.slice(start, end)
  };
}

function numericSemanticContext(value: string, mentionStart: number, mentionLength: number) {
  const clause = numericFactClause(value, mentionStart, mentionLength);
  const metricPatterns = numericMetricPatterns.map((item) => ({
    pattern: item.pattern,
    value: item.metric
  }));
  const relationPatterns = numericRelationPatterns.map((item) => ({
    pattern: item.pattern,
    value: item.relation
  }));
  const metric = nearestPatternValue(clause.text, clause.mentionStart, metricPatterns) ??
    nearestPatternValue(value, mentionStart, metricPatterns);
  const relation = nearestPatternValue(clause.text, clause.mentionStart, relationPatterns) ??
    nearestPatternValue(value, mentionStart, relationPatterns);
  const subject = nearestPatternText(clause.text, clause.mentionStart, subjectPatterns) ??
    nearestPatternText(value, mentionStart, subjectPatterns);
  const clauseScopes = extractScopes(clause.text, clause.mentionStart);
  return {
    comparator: extractComparator(clause.text, clause.mentionStart, mentionLength) ??
      extractComparator(value, mentionStart, mentionLength),
    hasAttachedUncertainty: hasAttachedUncertainty(value, mentionStart, mentionLength),
    metric,
    relation,
    scopes: clauseScopes.length > 0 ? clauseScopes : extractScopes(value, mentionStart),
    subject: subject ? normalizeSemanticLabel(subject) : undefined
  };
}

const unitPatterns: readonly {
  pattern: RegExp;
  unit: NumericUnit;
}[] = [
  { pattern: /^\s*(?:个\s*)?百分点|^\s*percentage\s+points?\b/i, unit: unit("percentage_point") },
  { pattern: /^\s*%|^\s*percent\b/i, unit: unit("ratio", 1n, 100n) },
  { pattern: /^\s*‰/, unit: unit("ratio", 1n, 1000n) },
  { pattern: /^\s*(?:×|x\b|倍|-?fold\b|times?\b)/i, unit: unit("multiplier") },
  { pattern: /^\s*(?:ns\b|纳秒)/i, unit: unit("time", 1n, 1_000_000_000n) },
  { pattern: /^\s*(?:us\b|μs\b|µs\b|微秒)/i, unit: unit("time", 1n, 1_000_000n) },
  { pattern: /^\s*(?:ms\b|毫秒)/i, unit: unit("time", 1n, 1000n) },
  { pattern: /^\s*(?:s\b|sec(?:ond)?s?\b|秒)/i, unit: unit("time") },
  { pattern: /^\s*(?:min(?:ute)?s?\b|分钟)/i, unit: unit("time", 60n) },
  { pattern: /^\s*(?:h\b|hours?\b|小时)/i, unit: unit("time", 3600n) },
  { pattern: /^\s*(?:KiB)\b/i, unit: unit("bytes", 1024n) },
  { pattern: /^\s*(?:MiB)\b/i, unit: unit("bytes", 1_048_576n) },
  { pattern: /^\s*(?:GiB)\b/i, unit: unit("bytes", 1_073_741_824n) },
  { pattern: /^\s*(?:TiB)\b/i, unit: unit("bytes", 1_099_511_627_776n) },
  { pattern: /^\s*(?:KB)\b/i, unit: unit("bytes", 1000n) },
  { pattern: /^\s*(?:MB)\b/i, unit: unit("bytes", 1_000_000n) },
  { pattern: /^\s*(?:GB)\b/i, unit: unit("bytes", 1_000_000_000n) },
  { pattern: /^\s*(?:TB)\b/i, unit: unit("bytes", 1_000_000_000_000n) },
  { pattern: /^\s*(?:bytes?\b|字节)/i, unit: unit("bytes") },
  { pattern: /^\s*(?:samples?\b|(?:个\s*)?样本)/i, unit: unit("count:sample") },
  { pattern: /^\s*(?:dimensions?\b|维(?:度)?)/i, unit: unit("count:dimension") }
];

function unit(
  dimension: string,
  numerator = 1n,
  denominator = 1n
): NumericUnit {
  return { denominator, dimension, numerator };
}

function normalizeNumericToken(value: string, match: RegExpMatchArray) {
  let token = match[0];
  const index = match.index ?? 0;
  if (/^[+-]/.test(token) && index > 0 && /[\p{L}\p{N}]/u.test(value[index - 1])) {
    token = token.slice(1);
  }
  return token.replace(/,/g, "");
}

function hasQuantitativeUnitSuffix(value: string) {
  return chineseQuantitativeSuffixPattern.test(value) ||
    physicalUnitSuffixPattern.test(value) ||
    englishQuantitativeSuffixPattern.test(value) ||
    multiplierUnitSuffixPattern.test(value);
}

function isStructuralNumber(value: string, match: RegExpMatchArray) {
  const index = match.index ?? 0;
  const before = value.slice(Math.max(0, index - 80), index);
  const after = value.slice(index + match[0].length, index + match[0].length + 80);
  const startsListItem = /(?:^|\n)\s*(?:[-*]\s*)?$/.test(before) && /^\s*(?:[.)、:]\s+)[^\d]/.test(after);
  const isBracketedReference = /[[(]\s*$/.test(before) && /^\s*[\])]/.test(after);
  const isOrdinal = /第\s*$/.test(before) && structuralNumberSuffixPattern.test(after);
  return structuralNumberPrefixPattern.test(before) || startsListItem || isBracketedReference || isOrdinal;
}

function isQuantitativeNumber(value: string, match: RegExpMatchArray) {
  if (isStructuralNumber(value, match)) {
    return false;
  }
  const index = match.index ?? 0;
  const token = normalizeNumericToken(value, match);
  const before = value.slice(Math.max(0, index - 80), index);
  const after = value.slice(index + match[0].length, index + match[0].length + 80);
  if (/[.,eE]/.test(token) || /^[+-]/.test(token) || /^\s*%/.test(after)) {
    return true;
  }
  return hasQuantitativeUnitSuffix(after) ||
    numericMetricPrefixPattern.test(before) ||
    numericComparisonPrefixPattern.test(before) ||
    numericRangeDelimiterPattern.test(before) ||
    numericRangeSuffixPattern.test(after) ||
    /^\s*(?:\/|\^|x\s*[-+]?(?:\d|$))/.test(after) ||
    /(?:\/|\^)\s*$/.test(before) ||
    /(?:\b(?:top|recall|precision|hit|ndcg)@|#)\s*$/i.test(before);
}

function parseRational(value: string): Rational | undefined {
  const match = value.match(/^([+-]?)(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/i);
  if (!match) {
    return undefined;
  }
  const exponent = Number(match[4] ?? 0);
  if (!Number.isSafeInteger(exponent) || Math.abs(exponent) > 1000) {
    return undefined;
  }
  const fraction = match[3] ?? "";
  const sign = match[1] === "-" ? -1n : 1n;
  let numerator = BigInt(`${match[2]}${fraction}` || "0") * sign;
  const scale = fraction.length - exponent;
  if (scale <= 0) {
    numerator *= 10n ** BigInt(-scale);
    return { denominator: 1n, numerator };
  }
  return { denominator: 10n ** BigInt(scale), numerator };
}

function equalRational(left: Rational, right: Rational) {
  return left.numerator * right.denominator === right.numerator * left.denominator;
}

function applyUnit(value: Rational, numericUnit: NumericUnit | undefined): Rational {
  if (!numericUnit) {
    return value;
  }
  return {
    denominator: value.denominator * numericUnit.denominator,
    numerator: value.numerator * numericUnit.numerator
  };
}

function rationalToNumber(value: Rational) {
  return Number(value.numerator) / Number(value.denominator);
}

function decimalPlaces(value: string) {
  const mantissa = value.toLowerCase().split("e")[0];
  return mantissa.includes(".") ? mantissa.length - mantissa.indexOf(".") - 1 : 0;
}

function extractQualifier(before: string): NumericQualifier {
  if (/(?:up to|at most|no more than|maximum(?: of)?|最高|至多|最多|不超过)[^.!?。！？]{0,28}$/i.test(before)) {
    return "upper_bound";
  }
  if (/(?:at least|no less than|minimum(?: of)?|至少|最低|不低于)[^.!?。！？]{0,28}$/i.test(before)) {
    return "lower_bound";
  }
  if (/(?:about|approximately|around|roughly|~|≈|约|大约|近)[^.!?。！？]{0,20}$/i.test(before)) {
    return "approximate";
  }
  return "exact";
}

function extractUnit(after: string, before: string): NumericUnit | undefined {
  for (const candidate of unitPatterns) {
    if (candidate.pattern.test(after)) {
      return candidate.unit;
    }
  }
  if (/(?:speedups?|speed-up|加速比)[^.!?。！？]{0,24}$/i.test(before)) {
    return unit("multiplier");
  }
  if (/^\s*(?:-|–|—|~|〜|to|至|到).{0,24}(?:×|x\b|倍|-?fold\b|times?\b)/i.test(after)) {
    return unit("multiplier");
  }
  return undefined;
}

function chineseNumberWordValue(value: string) {
  const direct = chineseNumberWords.get(value);
  if (direct !== undefined) {
    return direct;
  }
  const tenIndex = value.indexOf("十");
  if (tenIndex < 0 || value.indexOf("十", tenIndex + 1) >= 0) {
    return undefined;
  }
  const tensText = value.slice(0, tenIndex);
  const onesText = value.slice(tenIndex + 1);
  const tens = tensText ? chineseNumberWords.get(tensText) : 1;
  const ones = onesText ? chineseNumberWords.get(onesText) : 0;
  if (tens === undefined || ones === undefined || tens <= 0 || tens >= 10 || ones >= 10) {
    return undefined;
  }
  return tens * 10 + ones;
}

function numberWordValue(value: string) {
  return englishNumberWords.get(value.toLowerCase()) ?? chineseNumberWordValue(value);
}

function numberWordParticipatesInRange(before: string, after: string) {
  const hasFollowingEndpoint = followingNumberWordRangeEndpointPattern.test(after);
  const followsRangeDelimiter = /(?:-|–|—|~|〜|to|至|到)\s*$/i.test(before);
  const startsBetweenRange = /(?:\bbetween|介于)\s*$/i.test(before) &&
    betweenNumberWordRangeStartPattern.test(after);
  const endsBetweenRange = /(?:\bbetween|介于)[^.!?。！？]{0,40}(?:\band|与|和)\s*$/i.test(before);
  return hasFollowingEndpoint || followsRangeDelimiter || startsBetweenRange || endsBetweenRange;
}

function numberWordMentions(value: string): NumericMention[] {
  const normalized = value.normalize("NFKC");
  return [...normalized.matchAll(numberWordPattern)].flatMap((match) => {
    const numericValue = numberWordValue(match[0]);
    if (numericValue === undefined) {
      return [];
    }
    const index = match.index ?? 0;
    const before = normalized.slice(Math.max(0, index - 96), index);
    const after = normalized.slice(index + match[0].length, index + match[0].length + 64);
    const numericUnit = extractUnit(after, before);
    const participatesInRange = numberWordParticipatesInRange(before, after);
    const followsExplicitMetricRelation = numericMetricPrefixPattern.test(before) && (
      /^[a-z]/i.test(match[0]) || /(?:为|是|约|达|至|=|：|\s)$/.test(before)
    );
    if (!numericUnit && !participatesInRange && !followsExplicitMetricRelation) {
      return [];
    }
    const rawValue = String(numericValue);
    const parsedValue = parseRational(rawValue);
    return parsedValue ? [{
      ...numericSemanticContext(normalized, index, match[0].length),
      qualifier: extractQualifier(before),
      rawValue,
      unit: numericUnit,
      value: parsedValue
    }] : [];
  });
}

function numericMentions(value: string): NumericMention[] {
  const normalized = value.normalize("NFKC").replace(/−/g, "-");
  const digitMentions = [...normalized.matchAll(numericTokenPattern)].flatMap((match) => {
    if (!isQuantitativeNumber(normalized, match)) {
      return [];
    }
    const rawValue = normalizeNumericToken(normalized, match);
    const parsedValue = parseRational(rawValue);
    if (!parsedValue) {
      return [];
    }
    const index = match.index ?? 0;
    const before = normalized.slice(Math.max(0, index - 96), index);
    const after = normalized.slice(index + match[0].length, index + match[0].length + 48);
    return [{
      ...numericSemanticContext(normalized, index, match[0].length),
      qualifier: extractQualifier(before),
      rawValue,
      unit: extractUnit(after, before),
      value: parsedValue
    }];
  });
  return [...digitMentions, ...numberWordMentions(normalized)];
}

export function hasThinReadingNumericMention(value: string) {
  return numericMentions(value).length > 0;
}

function unitCompatible(output: NumericUnit | undefined, source: NumericUnit | undefined) {
  if (!output) {
    return !source;
  }
  return !source || output.dimension === source.dimension;
}

function exactValueEquivalent(left: NumericMention, right: NumericMention) {
  if (!unitCompatible(left.unit, right.unit)) {
    return false;
  }
  return equalRational(applyUnit(left.value, left.unit), applyUnit(right.value, right.unit));
}

function approximateValueEquivalent(output: NumericMention, source: NumericMention) {
  if (output.qualifier !== "approximate" || !unitCompatible(output.unit, source.unit)) {
    return false;
  }
  const outputValue = rationalToNumber(applyUnit(output.value, output.unit));
  const sourceValue = rationalToNumber(applyUnit(source.value, source.unit));
  if (!Number.isFinite(outputValue) || !Number.isFinite(sourceValue)) {
    return false;
  }
  const unitScale = output.unit
    ? Number(output.unit.numerator) / Number(output.unit.denominator)
    : 1;
  const tolerance = 0.5 * 10 ** (-decimalPlaces(output.rawValue)) * unitScale;
  return Math.abs(outputValue - sourceValue) <= tolerance + Number.EPSILON;
}

function valueEquivalent(output: NumericMention, source: NumericMention) {
  return exactValueEquivalent(output, source) || approximateValueEquivalent(output, source);
}

function qualifierCompatible(output: NumericQualifier, source: NumericQualifier) {
  if (source === "exact") {
    return output === "exact" || output === "approximate";
  }
  return output === source;
}

function metricCompatible(output: NumericMetric, source: NumericMetric) {
  if (output === source) {
    return true;
  }
  const speedupMetrics = new Set<NumericMetric>([
    "speedup",
    "training_speedup",
    "inference_speedup"
  ]);
  if (speedupMetrics.has(output) && speedupMetrics.has(source)) {
    return output === "speedup" || source === "speedup";
  }
  return (output === "time" && source === "latency") ||
    (output === "latency" && source === "time");
}

type NumericSemanticMismatch = Extract<
  ThinReadingNumericFidelityCode,
  "comparator_mismatch" | "metric_mismatch" | "relation_mismatch" | "scope_mismatch" | "subject_mismatch" | "uncertainty_dropped"
>;

function narrowCandidatesByExplicitField<T>(input: {
  candidates: readonly NumericMention[];
  compatible: (output: T, source: T) => boolean;
  output: T | undefined;
  read: (mention: NumericMention) => T | undefined;
}): { candidates: readonly NumericMention[]; mismatch: boolean } {
  if (input.output === undefined) {
    return { candidates: input.candidates, mismatch: false };
  }
  const explicitCandidates = input.candidates.filter((candidate) => (
    input.read(candidate) !== undefined
  ));
  if (explicitCandidates.length === 0) {
    return { candidates: input.candidates, mismatch: false };
  }
  const compatibleCandidates = explicitCandidates.filter((candidate) => (
    input.compatible(input.output!, input.read(candidate)!)
  ));
  return compatibleCandidates.length > 0
    ? { candidates: compatibleCandidates, mismatch: false }
    : { candidates: [], mismatch: true };
}

function semanticFactCandidates(
  output: NumericMention,
  candidates: readonly NumericMention[]
): { candidates: readonly NumericMention[]; mismatch?: NumericSemanticMismatch } {
  let narrowed = candidates;
  const metricResult = narrowCandidatesByExplicitField({
    candidates: narrowed,
    compatible: metricCompatible,
    output: output.metric,
    read: (mention) => mention.metric
  });
  if (metricResult.mismatch) return { candidates: [], mismatch: "metric_mismatch" };
  narrowed = metricResult.candidates;

  const subjectResult = narrowCandidatesByExplicitField({
    candidates: narrowed,
    compatible: (left, right) => left === right,
    output: output.subject,
    read: (mention) => mention.subject
  });
  if (subjectResult.mismatch) return { candidates: [], mismatch: "subject_mismatch" };
  narrowed = subjectResult.candidates;

  const comparatorResult = narrowCandidatesByExplicitField({
    candidates: narrowed,
    compatible: (left, right) => left === right,
    output: output.comparator,
    read: (mention) => mention.comparator
  });
  if (comparatorResult.mismatch) return { candidates: [], mismatch: "comparator_mismatch" };
  narrowed = comparatorResult.candidates;

  const relationResult = narrowCandidatesByExplicitField({
    candidates: narrowed,
    compatible: (left, right) => left === right,
    output: output.relation,
    read: (mention) => mention.relation
  });
  if (relationResult.mismatch) return { candidates: [], mismatch: "relation_mismatch" };
  narrowed = relationResult.candidates;

  if (output.scopes.length > 0) {
    const explicitScopeCandidates = narrowed.filter((candidate) => candidate.scopes.length > 0);
    if (explicitScopeCandidates.length > 0) {
      const outputScopes = new Set(output.scopes);
      const matchingScopes = explicitScopeCandidates.filter((candidate) => (
        candidate.scopes.some((scope) => outputScopes.has(scope))
      ));
      if (matchingScopes.length === 0) {
        return { candidates: [], mismatch: "scope_mismatch" };
      }
      narrowed = matchingScopes;
    }
  }

  if (
    output.qualifier !== "approximate" &&
    !output.hasAttachedUncertainty &&
    narrowed.length > 0 &&
    narrowed.every((candidate) => candidate.hasAttachedUncertainty)
  ) {
    return { candidates: [], mismatch: "uncertainty_dropped" };
  }
  return { candidates: narrowed };
}

function sameRawValue(left: NumericMention, right: NumericMention) {
  return equalRational(left.value, right.value);
}

function unique(values: readonly string[]) {
  return [...new Set(values)];
}

function externalSourceTexts(source: ThinReadingExternalSource) {
  return [
    source.abstract,
    ...(source.fullTextEvidence?.map((evidence) => evidence.quote) ?? [])
  ].map((value) => value.trim()).filter(Boolean);
}

function formatNumericDiagnostic(diagnostic: ThinReadingNumericFidelityDiagnostic) {
  const location = `summarySentences[${diagnostic.sentenceIndex}]`;
  switch (diagnostic.code) {
    case "metric_mismatch":
      return `薄读 Agent 数值命题门未通过：${location} 中数值“${diagnostic.value ?? "未知"}”对应的指标与来源不一致；不得把同值从准确率、召回率、延迟或其他指标之间挪用`;
    case "subject_mismatch":
      return `薄读 Agent 数值命题门未通过：${location} 中数值“${diagnostic.value ?? "未知"}”对应的主体与来源不一致；不得把一个模型、系统或方法的结果改写成另一个主体的结果`;
    case "comparator_mismatch":
      return `薄读 Agent 数值命题门未通过：${location} 中数值“${diagnostic.value ?? "未知"}”的比较对象与来源不一致`;
    case "relation_mismatch":
      return `薄读 Agent 数值命题门未通过：${location} 中数值“${diagnostic.value ?? "未知"}”的比较或变化方向与来源不一致`;
    case "scope_mismatch":
      return `薄读 Agent 数值命题门未通过：${location} 中数值“${diagnostic.value ?? "未知"}”的实验条件或适用范围与来源不一致`;
    case "uncertainty_dropped":
      return `薄读 Agent 数值命题门未通过：${location} 中数值“${diagnostic.value ?? "未知"}”删除了来源中的误差或不确定性表达`;
    case "unsupported_numeric_value":
      return `薄读 Agent 数值命题门未通过：${location} 引入了绑定来源未直接支持的数值“${diagnostic.value ?? "未知"}”；只修复该定量从句，使用同一命题的原文值、合法等价表示或删除数值精度`;
    case "unit_mismatch":
      return `薄读 Agent 数值命题门未通过：${location} 中数值“${diagnostic.value ?? "未知"}”的单位或量纲与来源不一致`;
    case "qualifier_dropped":
      return `薄读 Agent 数值命题门未通过：${location} 中数值“${diagnostic.value ?? "未知"}”删除了来源中的必要限定词，例如最高、至少、至多或约`;
    case "incomplete_numeric_group":
      return `薄读 Agent 数值命题门未通过：${location} 提出了定量边界，但没有保留使该边界可核验的数值或符号关系`;
    case "unanchored_quantitative_magnitude":
      return `薄读 Agent 数值命题门未通过：${location} 使用了明显、大幅、显著、充足或代表性等强度判断，但来源未直接表达同等强度，正文也没有保留可验证的定量锚点`;
  }
}

export function assertThinReadingNumericFidelity(input: {
  analysisEvidence: readonly AnalysisEvidence[];
  externalSources: readonly ThinReadingExternalSource[];
  sentences: readonly NumericSentence[];
}) {
  const paperSources = new Map(input.analysisEvidence.map((evidence) => [
    evidence.id,
    [evidence.quote]
  ]));
  const externalSources = new Map(input.externalSources.map((source) => [
    source.id,
    externalSourceTexts(source)
  ]));
  const diagnostics: ThinReadingNumericFidelityDiagnostic[] = [];

  input.sentences.forEach((sentence, sentenceIndex) => {
    const sourceIds = unique([...sentence.evidenceIds, ...sentence.externalKnowledge]);
    const sourceTexts = [
      ...sentence.evidenceIds.flatMap((id) => paperSources.get(id) ?? []),
      ...sentence.externalKnowledge.flatMap((id) => externalSources.get(id) ?? [])
    ];
    const sourceMentions = sourceTexts.flatMap(numericMentions);
    const outputMentions = numericMentions(sentence.text);

    for (const outputMention of outputMentions) {
      const valueCandidates = sourceMentions.filter((sourceMention) => (
        valueEquivalent(outputMention, sourceMention)
      ));
      if (valueCandidates.length === 0) {
        const sameValueCandidates = sourceMentions.filter((sourceMention) => (
          sameRawValue(outputMention, sourceMention)
        ));
        diagnostics.push({
          code: sameValueCandidates.length > 0 && sameValueCandidates.every((sourceMention) => (
            !unitCompatible(outputMention.unit, sourceMention.unit)
          ))
            ? "unit_mismatch"
            : "unsupported_numeric_value",
          sentenceIndex,
          sentenceText: sentence.text,
          sourceIds,
          value: outputMention.rawValue
        });
        continue;
      }
      const semanticCandidates = semanticFactCandidates(outputMention, valueCandidates);
      if (semanticCandidates.mismatch) {
        diagnostics.push({
          code: semanticCandidates.mismatch,
          sentenceIndex,
          sentenceText: sentence.text,
          sourceIds,
          value: outputMention.rawValue
        });
        continue;
      }
      if (!semanticCandidates.candidates.some((sourceMention) => (
        qualifierCompatible(outputMention.qualifier, sourceMention.qualifier)
      ))) {
        diagnostics.push({
          code: "qualifier_dropped",
          sentenceIndex,
          sentenceText: sentence.text,
          sourceIds,
          value: outputMention.rawValue
        });
      }
    }

    if (
      outputMentions.length === 0 &&
      sourceMentions.length > 0 &&
      unsupportedMagnitudePattern.test(sentence.text) &&
      !sourceTexts.some((sourceText) => unsupportedMagnitudePattern.test(sourceText))
    ) {
      diagnostics.push({
        code: "unanchored_quantitative_magnitude",
        sentenceIndex,
        sentenceText: sentence.text,
        sourceIds
      });
    }

    if (
      outputMentions.length === 0 &&
      symbolicConstraintSummaryPattern.test(sentence.text) &&
      sourceTexts.some((sourceText) => symbolicConstraintPattern.test(sourceText))
    ) {
      diagnostics.push({
        code: "incomplete_numeric_group",
        sentenceIndex,
        sentenceText: sentence.text,
        sourceIds
      });
    }
  });

  if (diagnostics.length > 0) {
    throw new ThinReadingNumericFidelityError(diagnostics);
  }
}
