import {
  Usage,
  type AgentInputItem,
  type AgentOutputItem,
  type Model,
  type ModelProvider,
  type ModelRequest,
  type ModelResponse,
  type StreamEvent
} from "@openai/agents";
import type { ReturnTypeOfModelGateway } from "../../models/modelGateway";

const agentModelOutputSchema = {
  additionalProperties: false,
  properties: {
    message: { type: "string" },
    toolCalls: {
      items: {
        additionalProperties: false,
        properties: {
          argumentsJson: { type: "string" },
          name: { type: "string" }
        },
        required: ["name", "argumentsJson"],
        type: "object"
      },
      type: "array"
    }
  },
  required: ["message", "toolCalls"],
  type: "object"
} as const;

type LiteasyAgentModelOutput = {
  message: string;
  toolCalls: Array<{
    argumentsJson: string;
    name: string;
  }>;
};

function serializeInput(input: string | AgentInputItem[]) {
  return typeof input === "string" ? input : JSON.stringify(input);
}

function parseOutput(answer: string): LiteasyAgentModelOutput {
  const parsed = JSON.parse(answer) as Partial<LiteasyAgentModelOutput>;
  return {
    message: typeof parsed.message === "string" ? parsed.message : "",
    toolCalls: Array.isArray(parsed.toolCalls)
      ? parsed.toolCalls.filter(
          (call): call is LiteasyAgentModelOutput["toolCalls"][number] =>
            Boolean(
              call &&
              typeof call.name === "string" &&
              typeof call.argumentsJson === "string"
            )
        )
      : []
  };
}

function createPrompt(request: ModelRequest) {
  const functionTools = request.tools.filter((candidate) => candidate.type === "function");
  return [
    request.systemInstructions ?? "",
    "Return exactly one JSON object matching the requested output schema.",
    "Use toolCalls for the next Liteasy actions. Each argumentsJson value must be valid JSON.",
    "Use message only when replying to the user; otherwise set message to an empty string.",
    `Available Liteasy tools: ${JSON.stringify(functionTools)}`,
    `Conversation input: ${serializeInput(request.input)}`
  ].filter(Boolean).join("\n\n");
}

class LiteasyGatewayModel implements Model {
  private callSequence = 0;

  constructor(
    private readonly gateway: ReturnTypeOfModelGateway,
    private readonly model: string,
    private readonly provider: string
  ) {}

  async getResponse(request: ModelRequest): Promise<ModelResponse> {
    const generated = await this.gateway.generateAnswer({
      model: this.model,
      outputFormat: {
        name: "liteasy_command_agent_turn",
        schema: agentModelOutputSchema,
        strict: true
      },
      prompt: createPrompt(request),
      provider: this.provider,
      requireLive: true,
      signal: request.signal
    });
    const parsed = parseOutput(generated.answer);
    this.callSequence += 1;
    const responseId = `liteasy-agent-model-${this.callSequence}`;
    const output: AgentOutputItem[] = parsed.toolCalls.length > 0
      ? parsed.toolCalls.map((call, index) => ({
          arguments: call.argumentsJson,
          callId: `${responseId}-tool-${index + 1}`,
          name: call.name,
          type: "function_call" as const
        }))
      : [{
          content: [{ text: parsed.message, type: "output_text" as const }],
          role: "assistant" as const,
          status: "completed" as const,
          type: "message" as const
        }];
    return {
      output,
      providerData: {
        execution: generated.trace
      },
      responseId,
      usage: new Usage({ requests: 1 })
    };
  }

  async *getStreamedResponse(_request: ModelRequest): AsyncIterable<StreamEvent> {
    throw new Error("Liteasy ModelGateway adapter does not expose SDK streaming");
  }
}

export type LiteasyModelProviderOptions = {
  gateway: ReturnTypeOfModelGateway;
  model: string;
  provider: string;
};

export function createLiteasyModelProvider(
  options: LiteasyModelProviderOptions
): ModelProvider {
  const models = new Map<string, Model>();
  return {
    getModel(modelName = options.model) {
      const activeModel = modelName || options.model;
      const cached = models.get(activeModel);
      if (cached) {
        return cached;
      }
      const model = new LiteasyGatewayModel(
        options.gateway,
        activeModel,
        options.provider
      );
      models.set(activeModel, model);
      return model;
    }
  };
}
