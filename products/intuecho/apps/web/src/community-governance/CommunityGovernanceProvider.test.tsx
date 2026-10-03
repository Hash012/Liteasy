import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { CommunityGovernanceProvider, useCommunityGovernance } from "./CommunityGovernanceProvider";
import type { CommunityGovernanceApi, CommunityPreference } from "./governance.types";

afterEach(cleanup);
function Consumer() {
  const context = useCommunityGovernance();
  return <div>{context?.preferences.map((preference) => <span key={preference.targetId}>{preference.targetId}</span>)}</div>;
}
test("never exposes old account preferences when its response arrives after switching accounts", async () => {
  let resolveA!: (value: { preferences: CommunityPreference[] }) => void;
  const preferences = vi.fn().mockImplementationOnce(() => new Promise((resolve) => { resolveA = resolve; }))
    .mockResolvedValue({ preferences: [{ targetKind: "thread", targetId: "B-private-thread", subscribed: true, muted: false, blocked: false }] });
  const api = { preferences } as unknown as CommunityGovernanceApi;
  const { rerender } = render(<CommunityGovernanceProvider actorBinding="A:1" api={api}><Consumer /><Consumer /></CommunityGovernanceProvider>);
  expect(preferences).toHaveBeenCalledTimes(1);
  rerender(<CommunityGovernanceProvider actorBinding="B:2" api={api}><Consumer /></CommunityGovernanceProvider>);
  expect(await screen.findByText("B-private-thread")).toBeInTheDocument();
  await act(async () => resolveA({ preferences: [{ targetKind: "thread", targetId: "A-private-thread", subscribed: true, muted: false, blocked: false }] }));
  expect(screen.queryByText("A-private-thread")).not.toBeInTheDocument();
  expect(screen.getByText("B-private-thread")).toBeInTheDocument();
});
