import { communityPreferenceSchema, communityReportSchema, communityReportResolutionSchema } from "../../../packages/contracts/src/communityGovernance.js";
import { AnnotationCommunityError } from "./annotationCommunitySqlite.mjs";

const messages = {
  INVALID_COMMUNITY_PREFERENCE: "订阅或隐藏设置无效。",
  INVALID_COMMUNITY_REPORT: "请填写举报类型及 8 到 1000 字的具体说明。",
  INVALID_REPORT_RESOLUTION: "举报处理状态无效。",
  REPORT_RATE_LIMITED: "今天提交的举报已达 10 条，请稍后再试。已有举报可在处理记录中查看。",
  REPORT_REVISION_CONFLICT: "内容已修改，请重新阅读后提交举报。",
  REPORT_NOT_FOUND: "找不到可处理的举报。",
  REPORT_ALREADY_RESOLVED: "这条举报已处理。",
  NOTIFICATION_NOT_FOUND: "找不到这条通知。"
};
function validated(schema, value, code) {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new AnnotationCommunityError(code);
  return parsed.data;
}

export function registerCommunityGovernanceRoutes(app, repository, { requireUser, requireAdmin }) {
  const route = (operation) => async (request, reply) => {
    try { return await operation(request, reply); }
    catch (error) {
      if (!(error instanceof AnnotationCommunityError)) throw error;
      return reply.code(error.status).send({ code: error.code, error: error.code, message: messages[error.code] ?? "内容暂不可访问，请重新检查权限。" });
    }
  };
  app.get("/v1/me/community-preferences", route(async (request, reply) => {
    const user = requireUser(request, reply);
    return user ? { preferences: await repository.preferences(user) } : undefined;
  }));
  app.put("/v1/me/community-preferences", route(async (request, reply) => {
    const user = requireUser(request, reply);
    return user ? { preference: await repository.setPreference(user, validated(communityPreferenceSchema, request.body, "INVALID_COMMUNITY_PREFERENCE")) } : undefined;
  }));
  app.get("/v1/me/notifications", route(async (request, reply) => {
    const user = requireUser(request, reply);
    return user ? { notifications: await repository.notifications(user) } : undefined;
  }));
  app.put("/v1/me/notifications/:notificationId/read", route(async (request, reply) => {
    const user = requireUser(request, reply);
    return user ? repository.markRead(user, request.params.notificationId) : undefined;
  }));
  app.post("/v1/annotations/:annotationId/reports", route(async (request, reply) => {
    const user = requireUser(request, reply);
    return user ? reply.code(201).send({ report: await repository.submitReport(user, request.params.annotationId, validated(communityReportSchema, request.body, "INVALID_COMMUNITY_REPORT")) }) : undefined;
  }));
  app.get("/v1/me/reports", route(async (request, reply) => {
    const user = requireUser(request, reply);
    return user ? { reports: await repository.myReports(user) } : undefined;
  }));
  app.get("/v1/community-reports", route(async (request, reply) => {
    const user = requireUser(request, reply);
    return user ? { reports: await repository.reviewReports(user) } : undefined;
  }));
  app.post("/v1/community-reports/:reportId/resolve", route(async (request, reply) => {
    const user = requireUser(request, reply);
    return user ? { report: await repository.resolveReport(user, request.params.reportId, validated(communityReportResolutionSchema, request.body, "INVALID_REPORT_RESOLUTION")) } : undefined;
  }));
  // Platform review is a separate authenticated entry point. It can only inspect
  // public reports; organization moderators use the current membership gate.
  if (requireAdmin) {
    app.get("/v1/admin/community-reports", route(async (request, reply) => {
      const admin = requireAdmin(request, reply);
      return admin ? { reports: await repository.reviewReports({ id: admin.id ?? admin.subject }, { platformAdmin: true }) } : undefined;
    }));
    app.post("/v1/admin/community-reports/:reportId/resolve", route(async (request, reply) => {
      const admin = requireAdmin(request, reply);
      return admin ? { report: await repository.resolveReport({ id: admin.id ?? admin.subject }, request.params.reportId, validated(communityReportResolutionSchema, request.body, "INVALID_REPORT_RESOLUTION"), { platformAdmin: true }) } : undefined;
    }));
  }
}
