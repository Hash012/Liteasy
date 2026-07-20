import type { AgentApiResult, AgentPublicApi } from "./agentApi.types";

export type AgentCliResult = {
  exitCode: 0 | 1 | 2;
  lines: string[];
};

function line(value: unknown) {
  return JSON.stringify(value);
}

function resultLines<T>(result: AgentApiResult<T>): AgentCliResult {
  return result.ok
    ? { exitCode: 0, lines: [line(result.data)] }
    : { exitCode: 1, lines: [line({ error: result.error })] };
}

function usage(message?: string): AgentCliResult {
  return {
    exitCode: 2,
    lines: [
      ...(message ? [line({ error: { code: "invalid_arguments", message } })] : []),
      "liteasy-agent capabilities",
      "liteasy-agent session create [clientSessionId]",
      "liteasy-agent session close <sessionId>",
      "liteasy-agent turn <sessionId> <command|explain|qa> <idempotencyKey> <message...>",
      "liteasy-agent run get <sessionId> <runId>",
      "liteasy-agent run cancel <sessionId> <runId> [reason]",
      "liteasy-agent confirm <sessionId> <confirmationId> <approve|reject>"
    ]
  };
}

export function createAgentCliAdapter(api: AgentPublicApi) {
  return {
    async execute(argv: string[]): Promise<AgentCliResult> {
      const [command, operation, ...args] = argv;
      if (command === "capabilities" && !operation) {
        return resultLines(await api.listCapabilities());
      }
      if (command === "session" && operation === "create") {
        return resultLines(
          await api.createSession({
            clientSessionId: args[0],
            consumer: "cli"
          })
        );
      }
      if (command === "session" && operation === "close" && args.length === 1) {
        return resultLines(await api.closeSession(args[0]));
      }
      if (command === "turn" && operation && args.length >= 2) {
        const mode = args[0];
        if (mode !== "command" && mode !== "explain" && mode !== "qa") {
          return usage(`Unknown Agent mode: ${mode}`);
        }
        const idempotencyKey = args[1];
        const message = args.slice(2).join(" ");
        if (!message) {
          return usage("turn requires a message");
        }
        const events: string[] = [];
        const unsubscribe = api.subscribe(operation, (event) => events.push(line(event)));
        const result = await api.submitTurn({
          idempotencyKey,
          input: { message, mode },
          sessionId: operation
        });
        unsubscribe();
        const output = resultLines(result);
        return { ...output, lines: [...events, ...output.lines] };
      }
      if (command === "run" && operation === "get" && args.length === 2) {
        return resultLines(await api.getRun({ sessionId: args[0], runId: args[1] }));
      }
      if (command === "run" && operation === "cancel" && args.length >= 2) {
        return resultLines(
          await api.cancelRun({
            reason: args.slice(2).join(" ") || undefined,
            runId: args[1],
            sessionId: args[0]
          })
        );
      }
      if (command === "confirm" && operation && args.length === 2) {
        const decision = args[1];
        if (decision !== "approve" && decision !== "reject") {
          return usage(`Unknown confirmation decision: ${decision}`);
        }
        return resultLines(
          await api.resolveConfirmation({
            confirmationId: args[0],
            decision,
            sessionId: operation
          })
        );
      }
      return usage();
    }
  };
}
