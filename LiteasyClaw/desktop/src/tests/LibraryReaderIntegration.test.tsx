import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, test } from "vitest";
import { AppShell } from "../app/layout/AppShell";

afterEach(() => {
  window.localStorage.clear();
});

test("opens multiple PDFs as independent document tabs while the selection remains locked", async () => {
  const user = userEvent.setup();
  const colbertTitle =
    "ColBERT: Efficient and Effective Passage Search via Contextualized Late Interaction over BERT";
  const acornTitle =
    "ACORN: Performant and Predicate-Agnostic Search Over Vector Embeddings and Structured Data";

  render(<AppShell />);

  const library = screen.getByLabelText("我的文献库投放区");
  await user.click(within(library).getByLabelText(colbertTitle));
  await user.click(within(library).getByLabelText(acornTitle));
  await user.click(screen.getByRole("button", { name: "锁定选择" }));

  await user.click(within(library).getByRole("button", { name: acornTitle }));
  await user.click(within(library).getByRole("button", { name: colbertTitle }));

  const acornTab = screen.getByRole("tab", { name: acornTitle });
  expect(acornTab).toHaveClass("dock-document-tab");
  expect(screen.getByRole("tab", { name: colbertTitle })).toBeInTheDocument();
  expect(acornTab).toHaveAttribute("aria-selected", "false");
  expect(screen.getByRole("tab", { name: colbertTitle })).toHaveAttribute("aria-selected", "true");
  await user.click(acornTab);
  expect(within(screen.getByLabelText("PDF 标题栏")).getByText(acornTitle)).toBeInTheDocument();
  expect(within(library).getByLabelText(colbertTitle)).toBeChecked();
  expect(within(library).getByLabelText(acornTitle)).toBeChecked();
  expect(within(library).getByLabelText(colbertTitle)).toBeDisabled();
  expect(within(library).getByLabelText(acornTitle)).toBeDisabled();
});
