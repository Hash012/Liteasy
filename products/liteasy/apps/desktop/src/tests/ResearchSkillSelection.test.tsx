import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ResearchSkillSelectionView } from "../app/features/research-skills/ResearchSkillSelection";
import type { ResearchSkillSelection } from "../app/features/research-skills/researchDocument";

test("an unavailable persisted skill keeps its reference but never uses the machine key as a title", async () => {
  const selection = { skill: { id: "skill-internal-38de1", version: "0.1.0", packageDigest: "missing-digest" }, roles: {} } as ResearchSkillSelection;
  const onChange = vi.fn();
  render(<ResearchSkillSelectionView selection={selection} sources={[]} destinations={[]} onChange={onChange} />);
  await userEvent.click(screen.getByRole("button", { name: "科研方法暂不可用" }));
  expect(screen.getByText("此方法版本不可用，请重新选择。")).toBeVisible();
  expect(screen.queryByText(selection.skill.id)).not.toBeInTheDocument();
  expect(onChange).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole("button", { name: "移除科研方法" }));
  expect(onChange).toHaveBeenCalledWith(undefined);
});
