import { expect, test } from "vitest";
import { plazaFiltersFromLocation, readCommunityRoute } from "./communityNavigation";
test("restores source revisions on browser navigation and safely rejects malformed escaped routes", () => {
  history.replaceState({}, "", "/sources/intuecho.reply/synthetic%2Freply?revision=3");
  expect(readCommunityRoute()).toEqual({ annotationId: null, source: { sourceNamespace: "intuecho.reply", sourceId: "synthetic/reply", revision: 3 } });
  history.replaceState({}, "", "/annotations/%E0");
  expect(readCommunityRoute()).toEqual({ annotationId: null, source: null });
});
test("explicit URL filters preserve latest ordering and every supported filter across refresh", () => {
  history.replaceState({}, "", "/?sort=latest&query=memory&institution=Lab&educationStage=PhD&documentType=paper&literatureId=lit&literatureIdentityKind=doi&literatureIdentityValue=10.test%2Fa&limit=30");
  expect(plazaFiltersFromLocation()).toEqual({ sort: "latest", query: "memory", institution: "Lab", educationStage: "PhD", documentType: "paper", literatureId: "lit", literatureIdentityKind: "doi", literatureIdentityValue: "10.test/a", limit: 30 });
});
