import { readJsonFile, writeJsonFile } from "./jsonFileStore.mjs";

const sessionsFilename = "sessions.json";

function readSessionState() {
  return readJsonFile(sessionsFilename, {
    sessions: [
      {
        lastActiveAt: "2026-05-16T08:00:00Z",
        name: "Liteasy Researcher",
        sessionId: "demo-session-1"
      }
    ]
  });
}

export function listSessions() {
  return readSessionState().sessions;
}

export function resetSessions() {
  writeJsonFile(sessionsFilename, { sessions: [] });
  return {
    reset: true
  };
}

export function reseedSessions() {
  const nextState = {
    sessions: [
      {
        lastActiveAt: "2026-05-16T08:00:00Z",
        name: "Liteasy Researcher",
        sessionId: "demo-session-1"
      }
    ]
  };
  writeJsonFile(sessionsFilename, nextState);
  return nextState;
}
