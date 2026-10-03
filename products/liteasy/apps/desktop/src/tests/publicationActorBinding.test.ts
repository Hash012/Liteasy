import { expect, test } from "vitest";
import { normalizePublicationActorBinding, samePublicationActor } from "../app/features/forum/publicationActorBinding";

const actor = {
  endpoint: "https://community.example.invalid/",
  issuer: "https://identity.example.invalid/realm/",
  subject: "synthetic-a",
  scopeType: "user" as const,
  scopeId: "synthetic-a",
  sessionGeneration: "runtime-one:3"
};

test("normalizes actor URLs without downgrading remote HTTPS or retaining credentials", () => {
  expect(normalizePublicationActorBinding(actor)).toMatchObject({
    endpoint: "https://community.example.invalid",
    issuer: "https://identity.example.invalid/realm"
  });
  for (const endpoint of ["http://community.example.invalid", "https://token@community.example.invalid", "https://community.example.invalid/?token=secret"]) {
    expect(normalizePublicationActorBinding({ ...actor, endpoint })).toBeUndefined();
  }
});

test("distinguishes issuer, subject, target environment, scope and runtime generation", () => {
  expect(samePublicationActor(actor, { ...actor, endpoint: "https://community.example.invalid" })).toBe(true);
  for (const changed of [
    { issuer: "https://identity.example.invalid/other" },
    { subject: "synthetic-b" },
    { endpoint: "https://other.example.invalid" },
    { scopeId: "organization-x", scopeType: "organization" },
    { sessionGeneration: "runtime-two:3" }
  ]) expect(samePublicationActor(actor, { ...actor, ...changed })).toBe(false);
  expect(samePublicationActor(actor, { ...actor, sessionGeneration: "runtime-two:3" }, { includeGeneration: false })).toBe(true);
  expect(samePublicationActor(undefined, actor)).toBe(false);
});
