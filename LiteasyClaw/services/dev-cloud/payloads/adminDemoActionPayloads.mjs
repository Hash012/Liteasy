import { resetCollectionData, reseedCollectionData } from "../db/collectionRepository.mjs";
import {
  resetAdminActivities,
  reseedAdminActivities
} from "../db/adminActivityRepository.mjs";
import {
  resetOrganizationData,
  reseedOrganizationData
} from "../db/organizationRepository.mjs";
import {
  resetRecommendationCacheData
} from "../db/recommendationCacheRepository.mjs";
import { resetRecommendationCandidateData } from "../db/recommendationCandidateRepository.mjs";
import { resetRecommendationFeedbackData } from "../db/recommendationFeedbackRepository.mjs";
import { resetSessions, reseedSessions } from "../db/sessionRepository.mjs";

export function buildAdminDemoResetPayload() {
  resetCollectionData();
  resetRecommendationCacheData();
  resetRecommendationCandidateData();
  resetRecommendationFeedbackData();
  resetOrganizationData();
  resetSessions();
  resetAdminActivities();

  return {
    reset: true
  };
}

export function buildAdminDemoReseedPayload() {
  reseedCollectionData();
  reseedOrganizationData();
  reseedSessions();
  reseedAdminActivities();

  return {
    reseeded: true
  };
}
