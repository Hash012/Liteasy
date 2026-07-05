import {
  createGeneratedThemeStyle,
  parseGeneratedThemeInput,
  type GeneratedThemeInput
} from "../app/features/theme/generatedTheme";

const validTheme: GeneratedThemeInput = {
  buttons: {
    borderWidth: 1,
    fill: "solid",
    hoverLift: 2,
    radius: 5,
    shadow: "crisp",
    weight: "strong"
  },
  density: "comfortable",
  intent: "冷静的赛博实验室",
  name: "冷静赛博实验室",
  palette: {
    accent1: "#1B66B3",
    accent2: "#2F8F61",
    accent3: "#B06B19",
    ink1: "#101820",
    ink2: "#526071",
    line1: "#C7D3DF",
    line2: "#AEBCCD",
    paper0: "#F8FBFC",
    paper1: "#EEF5F8",
    paper2: "#E2EDF3"
  },
  rationale: "更冷静，按钮更锐利。",
  scope: ["global", "buttons"],
  surfaces: {
    blur: 8,
    surface1Alpha: 0.92,
    surface2Alpha: 0.86
  }
};

test("accepts a bounded generated theme and creates CSS variables", () => {
  const parsed = parseGeneratedThemeInput(validTheme);
  expect(parsed.ok).toBe(true);
  if (!parsed.ok) {
    return;
  }

  expect(parsed.theme.scope).toEqual(["global", "buttons"]);
  expect(createGeneratedThemeStyle(parsed.theme)).toMatchObject({
    "--accent-1": "#1B66B3",
    "--button-border-width": "1px",
    "--button-hover-transform": "translateY(-2px)",
    "--button-radius": "5px"
  });
});

test("rejects arbitrary CSS strings and invalid color values", () => {
  const parsed = parseGeneratedThemeInput({
    ...validTheme,
    palette: {
      ...validTheme.palette,
      accent1: "url(javascript:alert(1))"
    }
  });

  expect(parsed).toMatchObject({
    ok: false
  });
});

test("rejects unreadable generated palettes", () => {
  const parsed = parseGeneratedThemeInput({
    ...validTheme,
    palette: {
      ...validTheme.palette,
      ink1: "#F8FBFC"
    }
  });

  expect(parsed).toMatchObject({
    ok: false
  });
});
