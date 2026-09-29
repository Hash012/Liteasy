import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { AcademicProfileForm } from "../app/features/profile/AcademicProfileForm";
import { defaultAcademicProfile } from "../app/features/profile/profile.types";
import { loadAcademicProfile, saveAcademicProfile } from "../app/features/profile/profileStorage";

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
  // Pasted rather than typed. Sending 241 individual keystrokes took ~3.7s on its own and timed
  // out under parallel load, which made every full run fail somewhere unrelated to the change
  // being tested. Paste is also how anyone actually enters a description this long.
  await user.click(description);
  await user.paste("a".repeat(241));
  expect(description).toHaveValue("a".repeat(240));
});

test("reading preferences are optional and persist without changing legacy or other accounts' profiles", async () => {
  const user = userEvent.setup();
  const onSave = vi.fn((profile) => saveAcademicProfile(profile, "user:reader"));
  render(<AcademicProfileForm academicProfile={defaultAcademicProfile} onSave={onSave} />);
  const summary = screen.getByText("阅读讲解（可选）");
  expect(summary.closest("details")).not.toHaveAttribute("open");
  await user.click(summary);
  await user.selectOptions(screen.getByLabelText("自动标注的讲解深度"), "advanced");
  await user.type(screen.getByLabelText("领域熟悉度"), "熟悉数据库，机器学习刚入门");
  await user.click(screen.getByRole("button", { name: "保存学术档案" }));
  expect(loadAcademicProfile("user:reader")).toMatchObject({ readingExplanation: "advanced", researchFamiliarity: "熟悉数据库，机器学习刚入门" });
  expect(loadAcademicProfile("user:other").readingExplanation).toBeUndefined();
  saveAcademicProfile(defaultAcademicProfile, "legacy");
  expect(loadAcademicProfile("legacy").stage).toBe(defaultAcademicProfile.stage);
  localStorage.clear();
});
