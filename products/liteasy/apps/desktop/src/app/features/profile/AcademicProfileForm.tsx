import { DisclosureSection, OptionPicker } from "../../shared/ui/productPrimitives";
import { Button } from "@fluentui/react-components";
import { useMemo, useState } from "react";
import disciplineCatalog from "../../../../../../packages/shared/disciplineCatalog.json";
import type { AcademicDiscipline, AcademicProfile, DisciplineCatalogItem } from "./profile.types";
import { useAcademicProfileDraft } from "./useAcademicProfileDraft";

type AcademicProfileFormProps = {
  academicProfile: AcademicProfile;
  onSave: (profile: AcademicProfile) => void | Promise<void>;
};

export function AcademicProfileForm({ academicProfile, onSave }: AcademicProfileFormProps) {
  const { draftProfile, saveAcademicProfile, updateDraftProfile } = useAcademicProfileDraft({
    academicProfile,
    onSave
  });
  const [categoryCode, setCategoryCode] = useState("");
  const [query, setQuery] = useState("");
  const categories = useMemo(
    () =>
      Array.from(
        new Map(
          disciplineCatalog.items.map((item) => [item.categoryCode, item.categoryName])
        ).entries()
      ),
    []
  );
  const normalizedQuery = query.trim().toLowerCase();
  const matchingDisciplines = useMemo(
    () =>
      disciplineCatalog.items.filter((discipline) => {
        if (categoryCode && discipline.categoryCode !== categoryCode) {
          return false;
        }
        if (!normalizedQuery) {
          return true;
        }
        return `${discipline.categoryName} ${discipline.name} ${discipline.code}`
          .toLowerCase()
          .includes(normalizedQuery);
      }),
    [categoryCode, normalizedQuery]
  );

  function disciplineText(discipline: DisciplineCatalogItem | AcademicDiscipline) {
    return `${discipline.categoryName} · ${discipline.name}（${discipline.code}）`;
  }

  function toggleDiscipline(discipline: DisciplineCatalogItem) {
    const selected = draftProfile.disciplines.some((item) => item.code === discipline.code);
    if (!selected && draftProfile.disciplines.length >= 12) {
      return;
    }
    updateDraftProfile(
      "disciplines",
      selected
        ? draftProfile.disciplines.filter((item) => item.code !== discipline.code)
        : [...draftProfile.disciplines, { ...discipline, description: "" }]
    );
  }

  function updateDescription(code: string, description: string) {
    updateDraftProfile(
      "disciplines",
      draftProfile.disciplines.map((discipline) =>
        discipline.code === code ? { ...discipline, description } : discipline
      )
    );
  }

  return (
    <div className="personal-profile-form" aria-label="学术档案编辑表单">
      <label className="personal-profile-field">
        研究阶段
        <OptionPicker aria-label="研究阶段" value={draftProfile.stage} onValueChange={(value) => updateDraftProfile("stage", value)} options={[{ value: "未设置", label: "未设置" }, { value: "本科生", label: "本科生" }, { value: "硕士研究生", label: "硕士研究生" }, { value: "博士研究生", label: "博士研究生" }, { value: "教师/研究员", label: "教师/研究员" }, { value: "产业研发", label: "产业研发" }]} />
      </label>
      <label className="personal-profile-field">
        研究主题
        <textarea
          className="personal-profile-control personal-profile-textarea"
          onChange={(event) => updateDraftProfile("researchTopics", event.target.value)}
          placeholder="例如：神经信息检索、向量数据库"
          rows={2}
          value={draftProfile.researchTopics}
        />
      </label>
      <label className="personal-profile-field">
        常用方法
        <textarea
          className="personal-profile-control personal-profile-textarea"
          onChange={(event) => updateDraftProfile("researchMethods", event.target.value)}
          placeholder="例如：对比学习、混合检索"
          rows={2}
          value={draftProfile.researchMethods}
        />
      </label>
      <label className="personal-profile-field">
        关注数据集
        <input
          className="personal-profile-control"
          onChange={(event) => updateDraftProfile("researchDatasets", event.target.value)}
          placeholder="例如：MS MARCO、BEIR"
          value={draftProfile.researchDatasets}
        />
      </label>
      <label className="personal-profile-field">
        阅读语言
        <input
          className="personal-profile-control"
          onChange={(event) => updateDraftProfile("preferredLanguages", event.target.value)}
          placeholder="例如：中文、English"
          value={draftProfile.preferredLanguages}
        />
      </label>
      <div className="personal-profile-fieldset">
        <div className="personal-profile-field-label">研究学科（最多 12 个）</div>
        <div className="personal-profile-inline-controls">
          <label className="personal-profile-field">
            学科门类
            <OptionPicker aria-label="学科门类" value={categoryCode} onValueChange={setCategoryCode}
              options={[{ value: "", label: "全部门类" }, ...categories.map(([code, name]) => ({ value: code, label: `${code} · ${name}` }))]} />
          </label>
          <label className="personal-profile-field">
            搜索二级学科
            <input
              className="personal-profile-control"
              onChange={(event) => setQuery(event.target.value)}
              placeholder="名称或代码，例如 0812"
              value={query}
            />
          </label>
        </div>
        <div aria-label="国家学科目录" className="discipline-option-list">
          {matchingDisciplines.map((discipline) => {
            const checked = draftProfile.disciplines.some((item) => item.code === discipline.code);
            return (
              <label className="discipline-option" key={discipline.code}>
                <input
                  checked={checked}
                  disabled={!checked && draftProfile.disciplines.length >= 12}
                  onChange={() => toggleDiscipline(discipline)}
                  type="checkbox"
                />
                <span>{disciplineText(discipline)}</span>
              </label>
            );
          })}
        </div>
        {draftProfile.disciplines.length > 0 ? (
          <div aria-label="已选研究学科" className="discipline-selection-list">
            {draftProfile.disciplines.map((discipline) => (
              <label className="personal-profile-field" key={discipline.code}>
                {disciplineText(discipline)} 的补充说明（可选）
                <input
                  className="personal-profile-control"
                  maxLength={240}
                  onChange={(event) => updateDescription(discipline.code, event.target.value)}
                  placeholder="例如：自然语言处理与信息检索"
                  value={discipline.description}
                />
              </label>
            ))}
          </div>
        ) : null}
      </div>
      <DisclosureSection className="profile-optional" title="阅读讲解（可选）">
        <label className="personal-profile-field">自动标注的讲解深度
          <OptionPicker aria-label="自动标注的讲解深度" value={draftProfile.readingExplanation ?? "auto"}
            onValueChange={(value) => updateDraftProfile("readingExplanation", value as AcademicProfile["readingExplanation"])}
            options={[{ value: "auto", label: "根据领域熟悉度调整" }, { value: "detailed", label: "详细 · 补足背景与推理" }, { value: "balanced", label: "均衡 · 讲清关键概念" }, { value: "advanced", label: "高阶 · 评析精妙之处" }]} />
        </label>
        <label className="personal-profile-field">领域熟悉度
          <textarea className="personal-profile-control personal-profile-textarea" rows={2} maxLength={600}
            placeholder="例如：熟悉数据库并发控制；机器学习还在入门。留空时默认均衡讲解。"
            value={draftProfile.researchFamiliarity ?? ""} onChange={(event) => updateDraftProfile("researchFamiliarity", event.target.value)} />
        </label>
      </DisclosureSection>
      <DisclosureSection className="profile-optional" title="其他个人信息（可选）">
      <label className="personal-profile-field">
        性别
        <OptionPicker aria-label="性别" value={draftProfile.gender} onValueChange={(value) => updateDraftProfile("gender", value)} options={[{ value: "未设置", label: "未设置" }, { value: "女", label: "女" }, { value: "男", label: "男" }, { value: "非二元/不便透露", label: "非二元/不便透露" }]} />
      </label>
      <label className="personal-profile-field">
        年龄
        <input
          className="personal-profile-control"
          inputMode="numeric"
          onChange={(event) => updateDraftProfile("age", event.target.value)}
          placeholder="未设置"
          value={draftProfile.age === "未设置" ? "" : draftProfile.age}
        />
      </label>
      </DisclosureSection>
      <Button appearance="primary" onClick={saveAcademicProfile} type="button">
        保存学术档案
      </Button>
    </div>
  );
}
