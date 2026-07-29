import { useMemo, useState } from "react";
import disciplineCatalog from "../../../../../shared/disciplineCatalog.json";
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
      <div className="personal-profile-fieldset">
        <div className="personal-profile-field-label">研究学科</div>
        <div className="personal-profile-inline-controls">
          <label className="personal-profile-field">
            学科门类
            <select
              className="personal-profile-control"
              onChange={(event) => setCategoryCode(event.target.value)}
              value={categoryCode}
            >
              <option value="">全部门类</option>
              {categories.map(([code, name]) => (
                <option key={code} value={code}>{`${code} · ${name}`}</option>
              ))}
            </select>
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
                <input checked={checked} onChange={() => toggleDiscipline(discipline)} type="checkbox" />
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
                  onChange={(event) => updateDescription(discipline.code, event.target.value)}
                  placeholder="例如：自然语言处理与信息检索"
                  value={discipline.description}
                />
              </label>
            ))}
          </div>
        ) : null}
      </div>
      <label className="personal-profile-field">
        研究阶段
        <select
          className="personal-profile-control"
          onChange={(event) => updateDraftProfile("stage", event.target.value)}
          value={draftProfile.stage}
        >
          <option value="未设置">未设置</option>
          <option value="本科生">本科生</option>
          <option value="硕士研究生">硕士研究生</option>
          <option value="博士研究生">博士研究生</option>
          <option value="教师/研究员">教师/研究员</option>
          <option value="产业研发">产业研发</option>
        </select>
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
      <button className="left-rail-button" onClick={saveAcademicProfile} type="button">
        保存学术档案
      </button>
    </div>
  );
}
