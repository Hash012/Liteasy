import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
/** Open the real popup and click an enabled option, then let the business handler commit. */
export async function selectPickerValue(control: HTMLElement, value: string) {
  const user = userEvent.setup();
  await user.click(control);
  const listbox = await screen.findByRole("listbox");
  const option = within(listbox).getAllByRole("option").find(node => node.dataset.optionValue === value);
  if (!option) throw new Error(`No rendered picker option for ${value}`);
  await user.click(option);
}
