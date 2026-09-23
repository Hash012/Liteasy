import { afterEach, beforeEach, expect, test, vi } from "vitest";
import {
  loadPaperFileMetadata,
  normalizePaperFileMetadata,
  savePaperFileMetadata
} from "../app/features/library/paperFileMetadata";
import { clearStoredAccountSession, storeAccountSession } from "../app/features/account/accountSessionStorage";
import { isUserPaperArtifactStoreAvailable, loadUserPaperArtifact, saveUserPaperArtifact } from "../app/features/library/userPaperArtifactClient";

vi.mock("../app/features/library/userPaperArtifactClient", () => ({
  isUserPaperArtifactStoreAvailable: vi.fn(),
  loadUserPaperArtifact: vi.fn(),
  saveUserPaperArtifact: vi.fn()
}));

beforeEach(() => {
  vi.mocked(isUserPaperArtifactStoreAvailable).mockReturnValue(false);
});

afterEach(() => {
  window.localStorage.clear();
  clearStoredAccountSession();
  vi.resetAllMocks();
});

test("normalizes categories and unique file tags within storage limits", () => {
  expect(normalizePaperFileMetadata({
    category: "  机器学习  ",
    tags: [" RAG ", "向量   检索", "RAG", ""]
  })).toEqual({
    category: "机器学习",
    tags: ["RAG", "向量 检索"],
    version: 1
  });
});

test("persists paper file metadata in the browser fallback", async () => {
  await savePaperFileMetadata("paper-metadata", {
    category: "待读",
    tags: ["综述", "数据库"]
  });

  await expect(loadPaperFileMetadata("paper-metadata")).resolves.toEqual({
    category: "待读",
    tags: ["综述", "数据库"],
    version: 1
  });
});

function signIn(userId: string) {
  storeAccountSession({ userId, email: `${userId}@example.test`, name: userId, sessionId: userId, expiresAt: "2099-01-01T00:00:00.000Z" });
}

const cacheKey = (userId: string) => `liteasy.paper-file-metadata/v1:user:${userId}:shared-paper`;

test("ignores delayed native metadata after an account switch without modifying either account cache", async () => {
  const original = { category: "甲账号分类", tags: ["甲"], version: 1 };
  const other = { category: "乙账号分类", tags: ["乙"], version: 1 };
  localStorage.setItem(cacheKey("A"), JSON.stringify(original));
  localStorage.setItem(cacheKey("B"), JSON.stringify(other));
  signIn("A");
  vi.mocked(isUserPaperArtifactStoreAvailable).mockReturnValue(true);
  let finish!: (value: unknown) => void;
  vi.mocked(loadUserPaperArtifact).mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
  const loading = loadPaperFileMetadata("shared-paper");
  expect(loadUserPaperArtifact).toHaveBeenCalledWith({ artifactKind: "file-metadata", paperId: "shared-paper" });
  signIn("B");
  finish({ category: "甲账号迟到的原生结果", tags: ["新标签"] });
  await expect(loading).resolves.toEqual(original);
  expect(JSON.parse(localStorage.getItem(cacheKey("A"))!)).toEqual(original);
  expect(JSON.parse(localStorage.getItem(cacheKey("B"))!)).toEqual(other);
});

test("caches a successful native read when the original account remains active", async () => {
  signIn("A");
  vi.mocked(isUserPaperArtifactStoreAvailable).mockReturnValue(true);
  vi.mocked(loadUserPaperArtifact).mockResolvedValue({ category: " 原生分类 ", tags: ["同步", "同步"] });
  await expect(loadPaperFileMetadata("shared-paper")).resolves.toEqual({ category: "原生分类", tags: ["同步"], version: 1 });
  expect(JSON.parse(localStorage.getItem(cacheKey("A"))!)).toEqual({ category: "原生分类", tags: ["同步"], version: 1 });
  expect(localStorage.getItem(cacheKey("B"))).toBeNull();
});

test("keeps an in-flight save in its original cache and rejects success after switching accounts", async () => {
  const other = { category: "乙账号分类", tags: ["乙"], version: 1 };
  localStorage.setItem(cacheKey("B"), JSON.stringify(other));
  signIn("A");
  vi.mocked(isUserPaperArtifactStoreAvailable).mockReturnValue(true);
  let finish!: () => void;
  vi.mocked(saveUserPaperArtifact).mockImplementation(() => new Promise<void>((resolve) => { finish = resolve; }));
  const saving = savePaperFileMetadata("shared-paper", { category: "甲的新分类", tags: ["甲"] });
  const rejected = expect(saving).rejects.toThrow("账号已切换");
  signIn("B");
  finish();
  await rejected;
  expect(JSON.parse(localStorage.getItem(cacheKey("A"))!)).toEqual({ category: "甲的新分类", tags: ["甲"], version: 1 });
  expect(JSON.parse(localStorage.getItem(cacheKey("B"))!)).toEqual(other);
});
