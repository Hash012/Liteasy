import type {
  AgentApiResult,
  AgentEventListener,
  AgentPublicApi,
  PublicWorkflowAuditSummary,
  AgentRun,
  AgentSession,
  ResolveAgentConfirmationRequest,
  SubmitAgentTurnRequest
} from "./agentApi.types";

export type FrontendAgentClient = {
  cancel: (runId: string, reason?: string) => Promise<AgentApiResult<AgentRun>>;
  detach?: () => void;
  close: () => Promise<AgentApiResult<AgentSession>>;
  connect: () => Promise<AgentApiResult<AgentSession>>;
  confirm: (
    confirmationId: string,
    decision: ResolveAgentConfirmationRequest["decision"]
  ) => Promise<AgentApiResult<AgentRun>>;
  createSessionClient: (clientSessionId: string) => FrontendAgentClient;
  getRun?: (runId: string) => Promise<AgentApiResult<AgentRun>>;
  findRunByRequest?: (idempotencyKey: string) => Promise<AgentApiResult<AgentRun | null>>;
  getSession: () => AgentSession | null;
  listPublicWorkflowAuditSummaries: (input: {
    runId?: string;
    sessionId: string;
  }) => Promise<AgentApiResult<PublicWorkflowAuditSummary[]>>;
  send: (
    input: SubmitAgentTurnRequest["input"],
    options?: {
      attachments?: SubmitAgentTurnRequest["attachments"];
      contextRefs?: SubmitAgentTurnRequest["contextRefs"];
      contextPurpose?: string;
      idempotencyKey?: string;
    }
  ) => Promise<AgentApiResult<AgentRun>>;
  subscribe: (listener: AgentEventListener) => () => void;
};

export function createFrontendAgentClient(
  api: AgentPublicApi,
  options: {
    clientSessionId?: string;
    principalId?: string;
  } = {}
): FrontendAgentClient {
  let session: AgentSession | null = null;
  let requestSequence = 0;
  let connecting: Promise<AgentApiResult<AgentSession>> | undefined;
  const listeners = new Set<AgentEventListener>();
  let unsubscribeApi: (() => void) | null = null;

  const createIdempotencyKey = (sessionId: string) => {
    requestSequence += 1;
    const randomPart = globalThis.crypto?.randomUUID?.() ??
      `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    return `${sessionId}:frontend-turn:${requestSequence}:${randomPart}`;
  };

  const attach = () => {
    if (session && !unsubscribeApi) unsubscribeApi = api.subscribe(session.sessionId, (event) => listeners.forEach((listener) => listener(event)));
  };
  const connect = async (): Promise<AgentApiResult<AgentSession>> => {
    if (session?.status === "active") { attach(); return { data: session, ok: true }; }
    connecting ??= api.createSession({ clientSessionId: options.clientSessionId, consumer: "frontend", principalId: options.principalId })
      .then((result) => { if (result.ok) { session = result.data; attach(); } return result; })
      .finally(() => { connecting = undefined; });
    return connecting;
  };



  return {
    detach() { unsubscribeApi?.(); unsubscribeApi = null; listeners.clear(); },
    async cancel(runId, reason) {
      const connected = await connect();
      if (!connected.ok) return connected;
      const activeSession = connected.data;
      return api.cancelRun({ reason, runId, sessionId: activeSession.sessionId });
    },

    async close() {
      if (!session) {
        return {
          error: {
            code: "session_not_found",
            message: "Frontend Agent session has not been created",
            retryable: false
          },
          ok: false
        };
      }
      unsubscribeApi?.();
      unsubscribeApi = null;
      const result = await api.closeSession(session.sessionId);
      if (result.ok) {
        session = result.data;
      }
      return result;
    },

    connect,

    createSessionClient(clientSessionId) {
      return createFrontendAgentClient(api, {
        ...options,
        clientSessionId
      });
    },

    async confirm(confirmationId, decision) {
      const connected = await connect();
      if (!connected.ok) return connected;
      const activeSession = connected.data;
      return api.resolveConfirmation({
        confirmationId,
        decision,
        sessionId: activeSession.sessionId
      });
    },

    async getRun(runId) {
      const connected = await connect();
      if (!connected.ok) return connected;
      return api.getRun({ runId, sessionId: connected.data.sessionId });
    },

    async findRunByRequest(idempotencyKey) {
      const connected = await connect();
      if (!connected.ok) return connected;
      if (!api.findRunByRequest) return { ok: false, error: { code: "unsupported_operation", message: "执行方不支持核对发送回执。", retryable: false } };
      return api.findRunByRequest({ sessionId: connected.data.sessionId, idempotencyKey });
    },

    getSession() {
      return session;
    },

    async listPublicWorkflowAuditSummaries(input) {
      return api.listPublicWorkflowAuditSummaries(input);
    },

    async send(input, sendOptions = {}) {
      const connected = await connect();
      if (!connected.ok) return connected;
      const activeSession = connected.data;
      return api.submitTurn({
        attachments: sendOptions.attachments,
        contextRefs: sendOptions.contextRefs,
        contextPurpose: sendOptions.contextPurpose,
        idempotencyKey:
          sendOptions.idempotencyKey ??
          createIdempotencyKey(activeSession.sessionId),
        input,
        sessionId: activeSession.sessionId
      });
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }
  };
}
