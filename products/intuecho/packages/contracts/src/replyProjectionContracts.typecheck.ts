import { createReplySchema, updateReplyPublicationSchema, updateReplySchema } from "@intuecho/contracts";
import type { LiteratureCandidate, LiteratureResolveResult } from "@intuecho/contracts";
import type { z } from "zod";

const resolverCandidate: LiteratureCandidate = {
  candidateKey: "crossref:doi:10.1000/example",
  provider: "crossref",
  record: {
    authors: ["A. Author"],
    identifiers: [{ kind: "doi", source: "public_registry", value: "10.1000/example" }],
    title: "Example"
  }
};
const resolverResult: LiteratureResolveResult = {
  candidate: resolverCandidate,
  status: "exact",
  unavailableProviders: ["openalex"]
};
const unavailableResolverResult: LiteratureResolveResult = {
  retryable: true,
  status: "unavailable",
  unavailableProviders: ["crossref", "semantic_scholar"]
};
void resolverResult;
void unavailableResolverResult;

const pureReply = createReplySchema.parse({ body: "Thread-only response" });
const publishAsAnnotation: boolean = pureReply.publishAsAnnotation;
const replyTags: string[] = pureReply.tags;
const replyTargets: unknown[] = pureReply.targets;

const updatedReply = updateReplySchema.parse({ body: "Edited response" });
const updatedBody: string = updatedReply.body;

const sourcePassageReply: z.input<typeof createReplySchema> = {
  body: "Source passage response",
  publishAsAnnotation: true,
  targets: [{
    anchorHash: "sha256:source-passage",
    excerpt: "A source passage can use the runtime rectangle default.",
    kind: "source_passage",
    literature: { literatureId: "literature_1" }
  }]
};
createReplySchema.parse(sourcePassageReply);

const publication = updateReplyPublicationSchema.parse({
  published: true,
  tags: ["evidence"],
  targets: [{ kind: "whole_document", literature: { literatureId: "literature_1" } }]
});
if (publication.published) {
  const publicationTags: string[] = publication.tags;
  const publicationTargets: unknown[] = publication.targets;
  void publicationTags;
  void publicationTargets;
}

const derivedPassagePublication: z.input<typeof updateReplyPublicationSchema> = {
  published: true,
  tags: ["derived"],
  targets: [{
    derivedContent: {
      artifactId: "artifact_1",
      excerpt: "Derived content.",
      version: "v1"
    },
    evidence: [{
      anchorHash: "sha256:derived-evidence",
      excerpt: "Derived evidence also uses the runtime rectangle default.",
      literature: { literatureId: "literature_1" }
    }],
    kind: "derived_passage",
    literature: { literatureId: "literature_1" }
  }]
};
updateReplyPublicationSchema.parse(derivedPassagePublication);

void publishAsAnnotation;
void replyTags;
void replyTargets;
void updatedBody;
