import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { AppBrand } from "../app/layout/AppBrand";

describe("AppBrand", () => {
  test("renders Liteasy brand and compact model channel indicator", () => {
    render(<AppBrand modelAccessMode="cloud_proxy" />);

    expect(screen.getByAltText("LiteasyClaw Logo")).toBeInTheDocument();
    expect(screen.getByText("LiteasyClaw")).toBeInTheDocument();
    expect(screen.getByText("AI-driven paper-assisted reading platform")).toBeInTheDocument();
    expect(screen.getByText(/模型：云代理/)).toBeInTheDocument();
  });

  test("shows local-direct channel when selected", () => {
    render(<AppBrand modelAccessMode="local_direct" />);

    expect(screen.getByText(/模型：本地直连/)).toBeInTheDocument();
  });
});
