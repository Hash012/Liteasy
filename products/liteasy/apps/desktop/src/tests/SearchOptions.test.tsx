import { useState } from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test } from "vitest";
import { SearchOptions } from "../app/features/search/SearchOptions";
import { compileSearchQuery } from "../app/features/search/searchQuery";

function Harness({ query = "memory", inline = true }: { query?: string; inline?: boolean }) {
  const [value, setValue] = useState(query);
  const compiled = compileSearchQuery(value);
  const items = [
    { title: "Memory research", tags: ["精读", "My tag"], format: "markdown", assetType: "note" },
    { title: "Memory translation", tags: ["精读", "翻译"], format: "markdown", assetType: "note" },
    { title: "Memory book", tags: ["精读"], format: "epub", assetType: "book" },
  ];
  return <><SearchOptions query={value} onChange={setValue} tags={["精读", "翻译", "用户修改", "AI 导读"]} presentation={inline ? "inline" : "popover"} />
    <output data-testid="query">{value}</output>
    <ul aria-label="筛选结果">{items.filter((item) => compiled.matches(item.title, item)).map((item) => <li key={item.title}>{item.title}</li>)}</ul>
    <button onClick={() => setValue('"memory research" format:md -tag:翻译')}>恢复保存的查询</button>
  </>;
}

const enter = (label: string, value: string) => {
  fireEvent.change(screen.getByRole("combobox", { name: label, exact: true }), { target: { value } });
  fireEvent.click(screen.getByRole("button", { name: `添加${label}`, exact: true }));
};

test("visual filters combine multiple tags, formats, types and exclusions and retain search text", async () => {
  const user = userEvent.setup();
  render(<Harness />);
  await user.click(screen.getByRole("button", { name: "高级检索条件" }));
  await user.click(screen.getByRole("combobox", { name: "包含标签", exact: true }));
  await user.click(screen.getByRole("menuitemcheckbox", { name: "精读", exact: true }));
  enter("排除标签", "翻译");
  enter("包含格式", "md");
  enter("包含格式", "epub");
  enter("排除类别", "图书");
  expect(screen.getByTestId("query")).toHaveTextContent('memory tag:"精读" -tag:"翻译" format:"markdown" format:"epub" -type:"book"');
  expect(within(screen.getByRole("list", { name: "筛选结果" })).getAllByRole("listitem").map((item) => item.textContent)).toEqual(["Memory research"]);
  enter("包含标签", "My tag");
  expect(screen.getByTestId("query")).toHaveTextContent('tag:"My tag"');
  await user.click(screen.getByRole("button", { name: "高级检索条件" }));
  const chips = screen.getByLabelText("当前筛选条件");
  await user.click(within(chips).getByRole("button", { name: "移除排除类别：图书" }));
  expect(screen.getByTestId("query")).not.toHaveTextContent('type:');
  await user.click(screen.getByRole("button", { name: "高级检索条件" }));
  await user.click(screen.getByRole("button", { name: "清除筛选条件" }));
  expect(screen.getByTestId("query").textContent).toBe("memory");
});

test("saved queries populate the fields and equivalent format aliases cannot contradict each other", async () => {
  const user = userEvent.setup();
  render(<Harness />);
  await user.click(screen.getByRole("button", { name: "恢复保存的查询" }));
  await user.click(screen.getByRole("button", { name: "高级检索条件" }));
  expect(screen.getByRole("button", { name: "移除包含格式：MARKDOWN" })).toBeVisible();
  expect(screen.getByRole("button", { name: "移除排除标签：翻译" })).toBeVisible();
  enter("排除格式", "markdown");
  expect(screen.getByTestId("query").textContent).toBe('"memory research" -tag:翻译 -format:"markdown"');
  await user.click(screen.getByRole("button", { name: "清除筛选条件" }));
  expect(screen.getByTestId("query").textContent).toBe('"memory research"');
});

test("local search popovers expose all candidates, support keyboard custom tags and preserve regex", async () => {
  const user = userEvent.setup();
  render(<Harness query="/memory|记忆/i" inline={false} />);
  await user.click(screen.getByRole("button", { name: "高级检索条件" }));
  await user.click(screen.getByRole("combobox", { name: "包含标签", exact: true }));
  expect(screen.getAllByRole("menuitemcheckbox").map((option) => option.textContent)).toEqual(expect.arrayContaining(["精读", "翻译", "用户修改", "AI 导读"]));
  const custom = screen.getByRole("combobox", { name: "排除标签", exact: true });
  fireEvent.change(custom, { target: { value: "My custom tag" } });
  fireEvent.keyDown(custom, { key: "Enter" });
  expect(screen.getByTestId("query").textContent).toBe('/memory|记忆/i -tag:"My custom tag"');
  await user.click(custom);
  await user.type(custom, "my custom tag");
  expect(screen.getByRole("menuitemcheckbox", { name: "使用“My custom tag”", exact: true })).toHaveAttribute("aria-checked", "true");
  await user.click(screen.getByRole("button", { name: "清除筛选条件" }));
  expect(screen.getByTestId("query").textContent).toBe('/memory|记忆/i');
});
