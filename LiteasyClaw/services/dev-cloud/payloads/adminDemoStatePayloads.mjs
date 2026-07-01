import { listAdminActivities } from "../db/adminActivityRepository.mjs";
import { listCollection } from "../db/collectionRepository.mjs";
import { readJsonFile } from "../db/jsonFileStore.mjs";
import { listOrganizations } from "../db/organizationRepository.mjs";
import { listSessions } from "../db/sessionRepository.mjs";

function countRecommendationCacheEntries() {
  const state = readJsonFile("recommendation-cache.json", {});
  return Object.keys(state).length;
}

export function buildAdminDemoStatePayload() {
  const organizations = listOrganizations("demo-session-1").organizations;
  const sessions = listSessions();
  const activities = listAdminActivities();
  const collectionItems = listCollection("demo-session-1");

  return {
    summary: {
      activeSessionCount: sessions.length,
      collectionItemCount: collectionItems.length,
      organizationCount: organizations.length,
      recommendationCacheEntryCount: countRecommendationCacheEntries()
    },
    activities,
    organizations,
    sessions
  };
}
