import { createOrganizationSharedLibraryManifestClient } from "../app/features/organization/organizationSharedLibraryManifestClient";

test("posts organization and session ids to the shared-library manifest endpoint", async () => {
  const requests: Array<{ body: string; url: string }> = [];
  const client = createOrganizationSharedLibraryManifestClient({
    endpoint: "https://liteasy.example.com/control-plane",
    transport: async (request) => {
      requests.push({ body: request.body, url: request.url });

      return {
        json: async () => ({
          manifest: {
            documents: [
              {
                folderId: "org-demo-1-rag",
                id: "org-doc-1",
                sourcePath: "org://org-demo-1/shared-library/RAG/org-doc-1.pdf",
                title: "Organization Reading List: Retrieval-Augmented Generation"
              }
            ],
            folders: [
              {
                id: "org-demo-1-root",
                name: "组织共享文献库",
                parentId: null,
                path: "org://org-demo-1/shared-library"
              },
              {
                id: "org-demo-1-rag",
                name: "RAG",
                parentId: "org-demo-1-root",
                path: "org://org-demo-1/shared-library/RAG"
              }
            ],
            name: "组织共享文献库",
            organizationId: "org-demo-1",
            rootFolderId: "org-demo-1-root",
            status: "available"
          }
        }),
        ok: true,
        status: 200
      };
    }
  });

  const manifest = await client({ organizationId: "org-demo-1", sessionId: "demo-session-1" });

  expect(manifest.name).toBe("组织共享文献库");
  expect(manifest.folders.map((folder) => folder.name)).toEqual(["组织共享文献库", "RAG"]);
  expect(manifest.documents[0].folderId).toBe("org-demo-1-rag");
  expect(requests).toEqual([
    {
      body: JSON.stringify({ organizationId: "org-demo-1", sessionId: "demo-session-1" }),
      url: "https://liteasy.example.com/control-plane/v1/org/shared-library/manifest"
    }
  ]);
});

test("rejects invalid shared-library manifest payloads", async () => {
  const client = createOrganizationSharedLibraryManifestClient({
    endpoint: "https://liteasy.example.com/control-plane",
    transport: async () => ({
      json: async () => ({ manifest: { documents: [], folders: [], name: "broken" } }),
      ok: true,
      status: 200
    })
  });

  await expect(client({ organizationId: "org-demo-1", sessionId: "demo-session-1" })).rejects.toThrow(
    "组织共享文献库目录返回格式无效"
  );
});
