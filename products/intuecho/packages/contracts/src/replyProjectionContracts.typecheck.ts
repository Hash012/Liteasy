import { createReplySchema, updateReplyPublicationSchema, updateReplySchema } from "@intuecho/contracts";

const pureReply = createReplySchema.parse({ body: "Thread-only response" });
const publishAsAnnotation: boolean = pureReply.publishAsAnnotation;
const replyTags: string[] = pureReply.tags;
const replyTargets: unknown[] = pureReply.targets;

const updatedReply = updateReplySchema.parse({ body: "Edited response" });
const updatedBody: string = updatedReply.body;

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

void publishAsAnnotation;
void replyTags;
void replyTargets;
void updatedBody;
