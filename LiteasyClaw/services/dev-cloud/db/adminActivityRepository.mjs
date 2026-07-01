import { readJsonFile, writeJsonFile } from "./jsonFileStore.mjs";

const adminActivityFilename = "admin-activity.json";

function readAdminActivityState() {
  return readJsonFile(adminActivityFilename, {
    activities: [
      {
        at: "2026-05-16T08:05:00Z",
        label: "Demo reseed completed",
        type: "ops"
      }
    ]
  });
}

export function listAdminActivities() {
  return readAdminActivityState().activities;
}

export function appendAdminActivity(activity) {
  const state = readAdminActivityState();
  state.activities = [activity, ...state.activities].slice(0, 20);
  writeJsonFile(adminActivityFilename, state);
  return state.activities;
}

export function resetAdminActivities() {
  writeJsonFile(adminActivityFilename, { activities: [] });
  return {
    reset: true
  };
}

export function reseedAdminActivities() {
  const nextState = {
    activities: [
      {
        at: "2026-05-16T08:05:00Z",
        label: "Demo reseed completed",
        type: "ops"
      }
    ]
  };
  writeJsonFile(adminActivityFilename, nextState);
  return nextState;
}
