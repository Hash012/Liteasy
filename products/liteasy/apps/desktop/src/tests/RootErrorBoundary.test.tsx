import { render, screen } from "@testing-library/react";
import { RootErrorBoundary } from "../RootErrorBoundary";

function BrokenStartup() {
  throw new Error("desktop_cloud_endpoint_required");
}

test("shows a stable startup error instead of a blank window", () => {
  const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

  render(
    <RootErrorBoundary>
      <BrokenStartup />
    </RootErrorBoundary>
  );

  expect(screen.getByRole("alert")).toHaveTextContent("Liteasy 启动失败");
  expect(screen.getByText("desktop_cloud_endpoint_required")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "重新启动" })).toBeInTheDocument();
  consoleError.mockRestore();
});
