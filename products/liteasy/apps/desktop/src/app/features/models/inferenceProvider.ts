/** Native messages belong to inference supply, independently of the Agent loop owner. */
export type NativeInferenceMessage = {
  role: "user" | "assistant" | "developer";
  content: string | Array<{ type: "input_text" | "output_text"; text: string } | { type: "input_image"; image_url: string }>;
};
export type NativeInferenceItem = NativeInferenceMessage
  | { type: "function_call"; call_id: string; name: string; arguments: string }
  | { type: "function_call_output"; call_id: string; output: string }
  | { type: "reasoning"; id: string; encrypted_content: string; summary: [] };
export type NativeToolNamespace = { type: "namespace"; name: string; description?: string;
  tools: Array<{ type: "function"; name: string; description?: string; parameters: Record<string, unknown>; strict?: boolean }> };
export type InferenceTerminal = { status: "completed"; usage?: unknown; output?: unknown[]; model: string; provider: string };
export type InferenceRequest = { model: string; messages: NativeInferenceItem[]; tools?: NativeToolNamespace[];
  signal?: AbortSignal; onDelta?: (text: string) => void };
export interface InferenceProvider {
  readonly providerId: string;
  infer(input: InferenceRequest): Promise<InferenceTerminal>;
}
