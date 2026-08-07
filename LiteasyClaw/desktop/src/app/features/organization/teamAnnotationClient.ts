import type { PdfAnnotation } from "../pdf/pdfAnnotationStorage";
import { CloudServiceError, readCloudServiceError } from "../network/cloudErrorMessage";

export type TeamAnnotationBody = Pick<
  PdfAnnotation,
  "color" | "excerpt" | "kind" | "note" | "page" | "rects" | "text" | "updatedAt"
> & {
  clientAnnotationId: string;
};

export type TeamAnnotation = {
  annotationId: string;
  body: TeamAnnotationBody;
  createdAt: string;
  documentId: string;
  organizationId: string;
  revision: number;
  updatedAt: string;
  uploadedBy: string;
};

type TeamAnnotationClientInput = {
  accessToken: string;
  endpoint: string;
  fetchImpl?: typeof fetch;
};

function stableHash(value: string) {
  let hash = 2166136261;
  for (const character of value) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function teamAnnotationBody(annotation: PdfAnnotation): TeamAnnotationBody {
  return {
    clientAnnotationId: annotation.id,
    color: annotation.color,
    excerpt: annotation.excerpt,
    kind: annotation.kind,
    note: annotation.note,
    page: annotation.page,
    rects: annotation.rects.map((rect) => ({ ...rect })),
    text: annotation.text,
    updatedAt: annotation.updatedAt
  };
}

async function jsonResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    throw await readCloudServiceError(response, {
      code: "team_annotation_request_failed",
      message: "团队批注请求未完成，请稍后重试。"
    });
  }
  return await response.json() as T;
}

export function createTeamAnnotationClient({
  accessToken,
  endpoint,
  fetchImpl = fetch
}: TeamAnnotationClientInput) {
  async function post<T>(path: string, body: Record<string, unknown>) {
    let response: Response;
    try {
      response = await fetchImpl(`${endpoint.replace(/\/+$/, "")}${path}`, {
        body: JSON.stringify(body),
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json"
        },
        method: "POST"
      });
    } catch {
      throw new CloudServiceError({
        code: "team_annotation_unavailable",
        message: "团队批注服务暂时无法连接，请检查网络后重试。",
        status: 0
      });
    }
    return jsonResponse<T>(response);
  }

  return {
    create(input: {
      annotation: PdfAnnotation;
      documentId: string;
      organizationId: string;
    }) {
      const body = teamAnnotationBody(input.annotation);
      return post<TeamAnnotation>("/v1/org/annotations/create", {
        body,
        documentId: input.documentId,
        idempotencyKey: `team-annotation:${stableHash(JSON.stringify({
          body,
          documentId: input.documentId,
          organizationId: input.organizationId
        }))}`,
        organizationId: input.organizationId
      });
    },
    remove(input: {
      annotationId: string;
      expectedRevision: number;
      organizationId: string;
    }) {
      return post<TeamAnnotation & { deleted: true }>("/v1/org/annotations/delete", {
        ...input,
        idempotencyKey: `team-annotation-delete:${stableHash(JSON.stringify(input))}`
      });
    },
    list(input: { documentId: string; organizationId: string }) {
      return post<{ annotations: TeamAnnotation[] }>("/v1/org/annotations/list", input);
    },
    update(input: {
      annotationId: string;
      body: TeamAnnotationBody;
      expectedRevision: number;
      organizationId: string;
    }) {
      return post<TeamAnnotation>("/v1/org/annotations/update", {
        ...input,
        idempotencyKey: `team-annotation-update:${stableHash(JSON.stringify(input))}`
      });
    }
  };
}

export function resolveOrganizationDocument(paper: { id: string; sourcePath?: string }) {
  const match = paper.sourcePath?.match(/^org:\/\/([^/]+)\/shared-library\//);
  return match ? { documentId: paper.id, organizationId: match[1] } : undefined;
}
