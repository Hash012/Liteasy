import { describe, expect, test } from "vitest";
import { createAcademicProfileExport } from "../app/features/profile/profileExport";
import { defaultAcademicProfile } from "../app/features/profile/profile.types";

describe("createAcademicProfileExport", () => {
  test("exports only selected disciplines and research stage", () => {
    const profileExport = createAcademicProfileExport({
      academicProfile: {
        ...defaultAcademicProfile,
        disciplines: [{
          categoryCode: "08",
          categoryName: "工学",
          code: "0812",
          description: "自然语言处理",
          name: "计算机科学与技术"
        }]
      },
      exportedAt: "2026-07-23T00:00:00.000Z"
    });

    expect(profileExport).toMatchObject({
        academicProfile: {
          disciplines: [{
            code: "0812",
            description: "自然语言处理"
          }]
        },
        exportedAt: "2026-07-23T00:00:00.000Z"
    });
  });
});
