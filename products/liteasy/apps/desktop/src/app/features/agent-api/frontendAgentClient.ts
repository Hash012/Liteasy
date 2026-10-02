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
  close: () => Promise<AgentApiResult<AgentSession>>;
  connect: () => Promise<AgentApiResult<AgentSession>>;
  confirm: (
    confirmationId: string,
    decision: ResolveAgentConfirmationRequest["decision"]
  ) => Promise<AgentApiResult<AgentRun>>;
  createSessionClient: (clientSessionId: string) => FrontendAgentClient;
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
  const listeners = new Set<AgentEventListener>();
  let unsubscribeApi: (() => void) | null = null;

  const createIdempotencyKey = (sessionId: string) => {
    requestSequence += 1;
    const randomPart = globalThis.crypto?.randomUUID?.() ??
      `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    return `${sessionId}:frontend-turn:${requestSequence}:${randomPart}`;
  };

  const connect = async () => {
    if (session?.status === "active") {
      return { data: session, ok: true } as const;
    }
    const result = await api.createSession({
      clientSessionId: options.clientSessionId,
      consumer: "frontend",
      principalId: options.principalId
    });
    if (result.ok) {
      session = result.data;
      unsubscribeApi = api.subscribe(session.sessionId, (event) => {
        listeners.forEach((listener) => listener(event));
      });
    }
    return result;
  };


  return {
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
