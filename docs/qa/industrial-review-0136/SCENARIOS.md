# 逐项验收范围

代码候选：`a2864a38cefd9118d312deacac8be1d3cff68786`。`pass` 仅表示本表列出的实际验证层；真人、原生和真实云端验证不从合成环境推导。

| 场景 | 任务 | 状态 | 实际证据 |
| --- | --- | --- | --- |
| IQ01 | M00 | pass | M00-red, web-all; corrected valid-fixture P01–P05. |
| IQ02 | M00 | pass | P01-independent-intents-and-cross-tab-locks; SQLite service command tests. Identity/events in browser remain fixture data, not PG proof. |
| IQ03 | M00 | pass | P03, P02 export, useLocalDraft late-cleanup and quota regressions. |
| IQ04 | M01 | pass | M01-three-pages-retry-back-refresh, filter-change, revocation. |
| IQ05 | M01 | pass | M01-operation-original-and-reauthorized-result and CommunityOperationCenter tests. |
| IQ06 | M02 | not_run | This full journey was not exercised in this bounded candidate; no inference from existing tests or build success. |
| IQ07 | M02 | not_run | This full journey was not exercised in this bounded candidate; no inference from existing tests or build success. |
| IQ08 | M02 | not_run | This full journey was not exercised in this bounded candidate; no inference from existing tests or build success. |
| IQ09 | M03 | pass | AnnotationComposer tests: single explicit ordinary reply, publication approval, actor/profile/parent/audience changes. |
| IQ10 | M03 | not_run | This full journey was not exercised in this bounded candidate; no inference from existing tests or build success. |
| IQ11 | M03 | not_run | This full journey was not exercised in this bounded candidate; no inference from existing tests or build success. |
| IQ12 | M04 | pass | Desktop 20 focused tests + Web OrganizationReadingGroup tests; not native UI acceptance. |
| IQ13 | M04 | pass | SourceRevision and useCommunitySourceController tests: fixed citation, fresh authorization, body cleared on denial. |
| IQ14 | M04 | pass | OrganizationReadingGroup return-visit card/filter tests: host summary, recorded unresolved items and fixed evidence; no actual human second meeting. |
| IQ15 | M05 | not_run | This full journey was not exercised in this bounded candidate; no inference from existing tests or build success. |
| IQ16 | M05 | not_run | This full journey was not exercised in this bounded candidate; no inference from existing tests or build success. |
| IQ17 | M05 | not_run | This full journey was not exercised in this bounded candidate; no inference from existing tests or build success. |
| IQ18 | M06 | not_run | This full journey was not exercised in this bounded candidate; no inference from existing tests or build success. |
| IQ19 | M06 | not_run | This full journey was not exercised in this bounded candidate; no inference from existing tests or build success. |
| IQ20 | M06 | not_run | This full journey was not exercised in this bounded candidate; no inference from existing tests or build success. |
| IQ21 | M07 | partial | Existing protocol1 command/expectedRevision tests pass. Some legacy creates remain accepted; no complete minClientVersion negotiation. See M07-compatibility.md. |
| IQ22 | M07 | not_run | This full journey was not exercised in this bounded candidate; no inference from existing tests or build success. |
| IQ23 | M07 | not_run | This full journey was not exercised in this bounded candidate; no inference from existing tests or build success. |
| IQ24 | M08 | not_run | This full journey was not exercised in this bounded candidate; no inference from existing tests or build success. |
| IQ25 | M08 | not_run | This full journey was not exercised in this bounded candidate; no inference from existing tests or build success. |
| IQ26 | M08 | not_run | This full journey was not exercised in this bounded candidate; no inference from existing tests or build success. |
| IQ27 | M00 | pass | P01: unrelated organization intent proceeds; original frozen intent preserved. |
| IQ28 | M00 | pass | P02: healthy list/send and explicit damaged-record export. |
| IQ29 | M00 | pass | P03 + conditional deletion and late callback tests. |
| IQ30 | M00 | pass | P04: delayed not_found cannot regress a committed operation. |
| IQ31 | M00 | pass | P05: malformed lookup stays unknown; no automatic resend. |

完整命令、日志 SHA-256 与浏览器报告见 [verification.json](verification.json)。原始逐项要求与层次见 [scenarios.json](scenarios.json)。

M00/M01 和 M04 最小旅程已实现。M02/M03/M05/M06 的完整范围、真实 PG/IdP/S3/scanner、Windows 安装运行及 M08 真人观察未在本轮验收；不得把这些 not_run 改写成“全部完成”。
