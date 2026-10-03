import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { OrganizationAnnotations } from "./AnnotationApp";
import { communityApi } from "./communityApi";
import { annotationFixture } from "./reading-group/readingGroupFixtures";
import type { IdentitySession } from "./identity.types";

vi.mock("./communityApi", () => ({ communityApi: {
  organizationAnnotations: vi.fn(), organizationChoices: vi.fn(), replies: vi.fn(async () => ({ replies: [] }))
} }));
afterEach(cleanup);
const session: IdentitySession = { audience: "intuecho-web", email: "host@example.test", expiresAt: "2099-01-01T00:00:00Z", name: "Synthetic host", sessionId: "token-host", userId: "host_1" };

test("reading groups require the matching live access result and hide old account contents while loading", async () => {
  vi.mocked(communityApi.organizationAnnotations).mockResolvedValue({ organizations: [{ organizationId: "org_x", name: "Synthetic Group", role: "member", annotations: [annotationFixture()] }] });
  vi.mocked(communityApi.organizationChoices).mockResolvedValue({ organizations: [{ organizationId: "org_x", name: "Synthetic Group", role: "member", allowedActions: ["read_body", "comment"], denialReasons: {}, policyRevision: 1, authorizationRevision: "1", policyExceptions: [], actionConstraints: { inviteRoles: [] } }] } as never);
  const view = render(<OrganizationAnnotations onCompose={vi.fn()} refresh={0} session={session} />);
  expect((await screen.findAllByText(/Read and compare/)).length).toBeGreaterThan(0);
  vi.mocked(communityApi.organizationAnnotations).mockReturnValue(new Promise(() => undefined));
  vi.mocked(communityApi.organizationChoices).mockReturnValue(new Promise(() => undefined));
  await act(async () => { view.rerender(<OrganizationAnnotations onCompose={vi.fn()} refresh={0} session={{ ...session, userId: "different", sessionId: "other-token" }} />); });
  expect(screen.queryAllByText(/Read and compare/)).toHaveLength(0);
  expect(screen.queryByText("Synthetic Group")).not.toBeInTheDocument();
});
