export type ArtifactWorkflowTraceDetailValue = number | string | string[];

export type ArtifactWorkflowTraceStep<StepKind extends string = string> = {
  completedAt: string;
  details?: Record<string, ArtifactWorkflowTraceDetailValue>;
  kind: StepKind;
  startedAt: string;
  status: "blocked" | "completed";
  stepId: string;
  summary: string;
};

export type ArtifactWorkflowTrace<
  StepKind extends string = string,
  TraceVersion extends string = string
> = {
  artifactId: string;
  internalOnly: true;
  runId: string;
  steps: ArtifactWorkflowTraceStep<StepKind>[];
  traceId: string;
  version: TraceVersion;
};

export type ArtifactWorkflowHarness<
  StepKind extends string = string,
  TraceVersion extends string = string
> = {
  step<T>(input: {
    details?: ArtifactWorkflowTraceStep<StepKind>["details"];
    kind: StepKind;
    run: () => Promise<T>;
    signal?: AbortSignal;
    summary: string;
  }): Promise<T>;
  step<T>(input: {
    details?: ArtifactWorkflowTraceStep<StepKind>["details"];
    kind: StepKind;
    run: () => T;
    signal?: AbortSignal;
    summary: string;
  }): T;
  trace(): ArtifactWorkflowTrace<StepKind, TraceVersion>;
};

export function createArtifactWorkflowHarness<
  StepKind extends string = string,
  TraceVersion extends string = string
>(input: {
  artifactId: string;
  now?: () => Date;
  runId: string;
  tracePrefix: string;
  traceVersion: TraceVersion;
}): ArtifactWorkflowHarness<StepKind, TraceVersion> {
  const now = input.now ?? (() => new Date());
  const steps: ArtifactWorkflowTraceStep<StepKind>[] = [];

  function appendStep(step: Omit<ArtifactWorkflowTraceStep<StepKind>, "stepId">) {
    steps.push({
      ...step,
      stepId: `${steps.length + 1}-${step.kind}`
    });
  }

  function recordFailure(kind: StepKind, summary: string, startedAt: string, error: unknown) {
    appendStep({
      completedAt: now().toISOString(),
      details: { error: error instanceof Error ? error.message : "unknown error" },
      kind,
      startedAt,
      status: "blocked",
      summary
    });
  }

  return {
    step<T>(stepInput: {
      details?: ArtifactWorkflowTraceStep<StepKind>["details"];
      kind: StepKind;
      run: () => T | Promise<T>;
      signal?: AbortSignal;
      summary: string;
    }): T | Promise<T> {
      const startedAt = now().toISOString();
      try {
        if (stepInput.signal?.aborted) throw new Error("artifact_workflow_cancelled");
        const result = stepInput.run();
        if (result instanceof Promise) {
          return result.then((value) => {
            if (stepInput.signal?.aborted) throw new Error("artifact_workflow_cancelled");
            appendStep({
              completedAt: now().toISOString(),
              details: stepInput.details,
              kind: stepInput.kind,
              startedAt,
              status: "completed",
              summary: stepInput.summary
            });
            return value;
          }).catch((error) => {
            recordFailure(stepInput.kind, stepInput.summary, startedAt, error);
            throw error;
          });
        }

        if (stepInput.signal?.aborted) throw new Error("artifact_workflow_cancelled");
        appendStep({
          completedAt: now().toISOString(),
          details: stepInput.details,
          kind: stepInput.kind,
          startedAt,
          status: "completed",
          summary: stepInput.summary
        });
        return result;
      } catch (error) {
        recordFailure(stepInput.kind, stepInput.summary, startedAt, error);
        throw error;
      }
    },
    trace(): ArtifactWorkflowTrace<StepKind, TraceVersion> {
      return {
        artifactId: input.artifactId,
        internalOnly: true,
        runId: input.runId,
        steps,
        traceId: `${input.tracePrefix}:${input.runId}:${input.artifactId}`,
        version: input.traceVersion
      };
    }
  };
}
