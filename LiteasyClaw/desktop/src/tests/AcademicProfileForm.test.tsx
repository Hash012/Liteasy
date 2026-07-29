import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { AcademicProfileForm } from "../app/features/profile/AcademicProfileForm";
import { defaultAcademicProfile } from "../app/features/profile/profile.types";

test("limits an academic profile to 12 selected disciplines", async () => {
  const user = userEvent.setup();
  render(<AcademicProfileForm academicProfile={defaultAcademicProfile} onSave={vi.fn()} />);
  const catalog = screen.getByLabelText("国家学科目录");
  const checkboxes = within(catalog).getAllByRole("checkbox");

  for (const checkbox of checkboxes.slice(0, 12)) {
    await user.click(checkbox);
  }

  expect(checkboxes.slice(0, 12).every((checkbox) => checkbox.checked)).toBe(true);
  expect(checkboxes[12]).toBeDisabled();
  await user.click(checkboxes[12]);
  expect(within(screen.getByLabelText("已选研究学科")).getAllByRole("textbox")).toHaveLength(12);
});

test("limits discipline descriptions to 240 characters", async () => {
  const user = userEvent.setup();
  render(<AcademicProfileForm academicProfile={defaultAcademicProfile} onSave={vi.fn()} />);
  await user.click(within(screen.getByLabelText("国家学科目录")).getAllByRole("checkbox")[0]);
  const description = within(screen.getByLabelText("已选研究学科")).getByRole("textbox");

  expect(description).toHaveAttribute("maxlength", "240");
  await user.type(description, "a".repeat(241));
  expect(description).toHaveValue("a".repeat(240));
});
