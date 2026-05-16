import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { AppBrand } from "../app/layout/AppBrand";

describe("AppBrand", () => {
  test("renders Liteasy brand and compact cloud-model indicator", () => {
    render(<AppBrand modelAccessMode="cloud_proxy" />);

    expect(screen.getByAltText("LiteasyClaw Logo")).toBeInTheDocument();
    expect(screen.getByText("LiteasyClaw")).toBeInTheDocument();
    expect(screen.getByText("AI-driven paper-assisted reading platform")).toBeInTheDocument();
    expect(screen.getByText(/云端模型能力/)).toBeInTheDocument();
  });
});
