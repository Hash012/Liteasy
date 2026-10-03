# Intuecho API

Intuecho 的独立论坛后端。开发入口 `src/server.mjs` 使用外置 SQLite；正式入口 `src/productionServer.mjs` 只接受 PostgreSQL，并在监听前验证迁移、OIDC/JWKS、token introspection 和 Liteasy 管理 API readiness。

## 运行与验证

```bash
cd products/intuecho
npm install
LITEASY_IDENTITY_ENDPOINT=http://127.0.0.1:8787 npm run dev:api
```

在另一个终端验证：

```bash
cd products/intuecho
npm test
npm run check --workspace=@intuecho/api
```

开发 API 默认位于 `http://127.0.0.1:4040`。写接口联调前还需启动 `development/dev-cloud`；未设置 `LITEASY_IDENTITY_ENDPOINT` 时写操作会失败关闭。SQLite 数据路径和其他开发变量见上级 [README](../../README.md)。

正式迁移和启动：

```bash
npm run migrate --workspace=@intuecho/api
npm start --workspace=@intuecho/api
```

论坛必须使用独立数据库、在线角色和 migrator。组织权限通过专用机器身份调用 Liteasy API，不能转交用户 token。完整路由、数据模型和环境变量见上级 [README](../../README.md) 与 `.env.example`。

## 开发测试账号

API 本身不创建账号、不保存密码。公开读取不需要账号；写接口使用 dev-cloud/统一 IdP 签发的 `intuecho-web` Bearer token。测试人员通过 Web 注册 `qa.<姓名或工号>@liteasy.local`，不要使用数据库角色或 confidential client 凭据登录。治理接口还要求 Liteasy 平台管理员身份和新鲜 MFA，没有仓库固定管理员。
# Platform governance read boundaries

Platform annotation lists and tag-appeal material require a currently public annotation with a consistent public parent audience. A tag appeal also records its submission audience and revision. Historical appeals with an unknown submission audience expose status and identifiers only; their text stays redacted until the author explicitly resubmits it. Changing an annotation from private to public does not publish an earlier private appeal reason.

This read boundary preserves the existing, separately audited platform withdrawal authority, organization moderation authority, and author withdrawal/retained-access rules. It does not grant platform reviewers access to organization or private bodies through list or appeal endpoints.


Structured work notifications use persisted reply, reading-pack, report, tag-appeal, or moderation-audit identifiers. Creating a reading task requires explicit `notificationIntent: "reading_task"` on an organization reading pack; ordinary creation generates no task reminder. Replies may explicitly name up to five existing thread participants in `mentionedUserIds`; names in the body are never parsed. A mention replaces the same recipient's ordinary reply notification. Governance results target the original reporter, appellant, or content author.

All event kinds honor explicit scope subscriptions, overlapping opt-outs, mute, and author hiding. They contain no copied body, title, or private review evidence, and inbox reads recheck current content and organization access. Unavailable events expose only an opaque notification identifier and remain markable as read. These notifications do not send email, push, or invitations. Migration 026 preserves existing reply events and read state while adding source and recipient constraints.


### Scoped platform-tag upgrade (028)

`local-semantic-scope-v2` constrains candidate selection before its limit: public
output does not sample user posts (there is no explicit classifier-corpus opt-in);
organization output uses the exact same
organization; private and mutual-followers output uses the same visibility and
author. Reply projections are not samples because their inherited audience needs
additional ancestry validation. No new training permission is implied. The tag
response includes `classifierVersion` and `sourceScope`; user tags have no derived
provenance. Withdrawn samples cannot contribute to new assignments.

Migration 028 preserves historical tags, pending appeals and append-only audits.
A legacy platform tag with no `sourceScope` is **not** evidence of safe derivation.
Before reopening affected existing data, inventory these assignments by audience,
review their candidate history offline, and explicitly recompute selected active
assignments using the scoped classifier. Existing normal annotation edits already
recompute active platform tags. Appealed/removed tags and their audit history must
be preserved; do not bulk delete user labels or automatically run a production
recompute. Back up, dry-run a scoped diff, and review before any approved data repair.


### Browser command protocol (029)

New browser creates send `command: {protocolVersion:1, operationId, bodyDigest}`
on the existing annotation/reply POST routes. Hash the UTF-8 shared
`communityCommandPayload(type, targetId, input)` with SHA-256 before sending.
The verified actor, command type and UUID identify a retry; a fresh UUID is a new
user intention even if its body is identical. Different payloads under one key
return `409 COMMAND_PAYLOAD_CONFLICT`. The receipt and content/event commit in the
same transaction. PostgreSQL serializes concurrent keys with a transaction lock
and enforces a composite primary key; SQLite performs receipt insertion in its
existing synchronous write transaction. No body is copied into the receipt.

`GET /v1/community-commands/:operationType/:operationId` performs no writes and
returns `not_found` or a committed receipt. Returned content is read through
current authorization; withdrawn/deleted/inaccessible targets have
`available:false` and no result. Retrying such a receipt cannot recreate content.
The browser must persist its frozen command before sending and resolve unknown
outcomes using lookup, without minting another operation ID.

Compatibility: legacy POSTs without `command` remain accepted during rollout and
have **no retry guarantee**. Existing readers are unchanged. HTTP content PUTs
without `expectedRevision` are rejected with 428; stale revisions return 409.
Internal repository callers remain source-compatible when the field is omitted;
all new browser edits supply it. Reply publication accepts its own expected
revision, parent snapshot, and expected author-profile revision. Projection reads
include the actual `originalReply.revision`, which can differ from the projection.


### Structured collaboration and versioned references (030)

Optional schema-version-1 `collaboration` metadata lives on existing annotations
and replies. A `reading_pack` is an organization annotation; `question`,
`host_summary`, `dissent`, and `reflection` are replies with the exact `parentPackId`.
Only the pack author may label a reply as the host summary. Tags and Markdown do
not determine type; legacy rows stay `collaboration:null` without changing body.
Dates are ISO discussion deadlines; source references include namespace, ID,
revision and an optional locator. This does not grant new organization privileges.

`GET /v1/organizations/:id/reading-sources?query=...` requires current organization
access and returns matching confirmed public-registry literature, independent of
annotation count. Existing resolver confirmation can add a verified source;
unconfirmed local chapters are not fabricated as confirmed records.

Writes validate references against actual current versions and current read
access, rejecting stale references with `SOURCE_REVISION_CONFLICT`. Organization
references cannot import another organization's or a private source. PostgreSQL
locks referenced rows while committing; SQLite rechecks versions and tombstones
inside its write transaction after async permission checks.
`GET /v1/community-sources/:namespace/:id/revisions/:revision` checks current access
before returning history, distinguishes `revision` from `currentRevision`, and
includes `historical`, current `visibility` and `organizationId`. Deleted/withdrawn
sources are unavailable. Historical annotation snapshots whose audience differs
from the current one are unavailable, so publishing a revision cannot expose an
older private body. This endpoint is a controlled read, not an export exception.
