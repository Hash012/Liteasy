import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import { PdfReader } from "../app/features/pdf/PdfReader";
import {
  pdfAnnotationStorageKey,
  savePdfAnnotations,
  type PdfAnnotation
} from "../app/features/pdf/pdfAnnotationStorage";
import { resolvePaperIdentity } from "../app/features/paper-identity/paperIdentity";
import type { TeamAnnotation } from "../app/features/organization/teamAnnotationClient";
import type { Paper } from "../app/features/workspace/workspace.types";

const organizationPaper: Paper = {
  id: "document-1",
  sourcePath: "org://organization-1/shared-library/document-1.pdf",
  title: "Organization Paper"
};

function localAnnotation(): PdfAnnotation {
  return {
    createdAt: "2026-08-06T00:00:00.000Z",
    excerpt: "Evidence excerpt",
    id: "highlight-1",
    kind: "highlight",
    page: 2,
    paperIdentity: resolvePaperIdentity(organizationPaper),
    rects: [{ height: 0.1, left: 0.2, top: 0.3, width: 0.4 }],
    text: "高亮",
    updatedAt: "2026-08-06T00:00:00.000Z",
    visibility: "private"
  };
}

function sharedAnnotation(): TeamAnnotation {
  return {
    annotationId: "annotation-1",
    body: {
      clientAnnotationId: "highlight-1",
      excerpt: "Evidence excerpt",
      kind: "highlight",
      page: 2,
      rects: [],
      text: "高亮",
      updatedAt: "2026-08-06T00:00:00.000Z"
    },
    createdAt: "2026-08-06T00:00:00.000Z",
    documentId: "document-1",
    organizationId: "organization-1",
    revision: 1,
    updatedAt: "2026-08-06T00:00:00.000Z",
    uploadedBy: "member-1"
  };
}

beforeEach(() => {
  window.localStorage.clear();
});

test("loads team annotations and explicitly shares a local annotation", async () => {
  savePdfAnnotations(pdfAnnotationStorageKey(organizationPaper), [localAnnotation()]);
  const loadOrganizationAnnotations = vi.fn(async () => [] as TeamAnnotation[]);
  const onShareAnnotationToOrganization = vi.fn(async () => sharedAnnotation());
  render(
    <PdfReader
      loadOrganizationAnnotations={loadOrganizationAnnotations}
      onShareAnnotationToOrganization={onShareAnnotationToOrganization}
      selectedPapers={[organizationPaper]}
      zoom={100}
    />
  );

  await waitFor(() => expect(loadOrganizationAnnotations).toHaveBeenCalledWith(organizationPaper));
  const share = await screen.findByRole("button", {
    name: "共享批注到组织：Evidence excerpt"
  });
  fireEvent.click(share);

  await waitFor(() => expect(onShareAnnotationToOrganization).toHaveBeenCalled());
  expect(await screen.findByText("member-1 · 第 2 页")).toBeInTheDocument();
  expect(screen.getByText("批注已共享到组织。")).toBeInTheDocument();
});

test("does not expose organization sharing for a local paper", async () => {
  const localPaper = { ...organizationPaper, sourcePath: "/library/document-1.pdf" };
  savePdfAnnotations(pdfAnnotationStorageKey(localPaper), [{
    ...localAnnotation(),
    paperIdentity: resolvePaperIdentity(localPaper)
  }]);
  render(<PdfReader selectedPapers={[localPaper]} zoom={100} />);

  expect(await screen.findByText("Evidence excerpt")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /共享批注到组织/ })).not.toBeInTheDocument();
  expect(screen.queryByRole("region", { name: "团队批注" })).not.toBeInTheDocument();
});

test("lets an author edit and delete a shared organization annotation", async () => {
  const onUpdateOrganizationAnnotation = vi.fn(async ({ annotation, note }) => ({
    ...annotation,
    body: { ...annotation.body, note },
    revision: 2
  }));
  const onDeleteOrganizationAnnotation = vi.fn(async () => undefined);
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
  render(
    <PdfReader
      loadOrganizationAnnotations={async () => [sharedAnnotation()]}
      onDeleteOrganizationAnnotation={onDeleteOrganizationAnnotation}
      onUpdateOrganizationAnnotation={onUpdateOrganizationAnnotation}
      organizationAnnotationActorId="member-1"
      selectedPapers={[organizationPaper]}
      zoom={100}
    />
  );

  fireEvent.click(await screen.findByRole("button", { name: "编辑组织批注：Evidence excerpt" }));
  fireEvent.change(screen.getByRole("textbox", { name: "编辑组织批注备注" }), {
    target: { value: "Reviewed by the team" }
  });
  fireEvent.click(screen.getByRole("button", { name: "保存" }));
  await waitFor(() => expect(onUpdateOrganizationAnnotation).toHaveBeenCalledWith(expect.objectContaining({
    note: "Reviewed by the team"
  })));
  expect(await screen.findByText("Reviewed by the team")).toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: "删除组织批注：Evidence excerpt" }));
  await waitFor(() => expect(onDeleteOrganizationAnnotation).toHaveBeenCalled());
  expect(confirm).toHaveBeenCalled();
  expect(screen.getByText("组织批注已删除。")).toBeInTheDocument();
  expect(screen.queryByText("member-1 · 第 2 页")).not.toBeInTheDocument();
  confirm.mockRestore();
});
