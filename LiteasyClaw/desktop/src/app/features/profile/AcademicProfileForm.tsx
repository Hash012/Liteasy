import type { AcademicProfile } from "./profile.types";
import { useAcademicProfileDraft } from "./useAcademicProfileDraft";

type AcademicProfileFormProps = {
  academicProfile: AcademicProfile;
  onSave: (profile: AcademicProfile) => void;
};

export function AcademicProfileForm({ academicProfile, onSave }: AcademicProfileFormProps) {
  const { draftProfile, saveAcademicProfile, updateDraftProfile, visibleAge } = useAcademicProfileDraft({
    academicProfile,
    onSave
  });

  return (
    <div className="personal-profile-form" aria-label="画像配置表单">
      <label className="personal-profile-field">
        性别
        <select
          className="personal-profile-control"
          onChange={(event) => updateDraftProfile("gender", event.target.value)}
          value={draftProfile.gender}
        >
          <option value="未设置">未设置</option>
          <option value="女">女</option>
          <option value="男">男</option>
          <option value="非二元/不便透露">非二元/不便透露</option>
        </select>
      </label>
      <label className="personal-profile-field">
        年龄
        <input
          className="personal-profile-control"
          inputMode="numeric"
          onChange={(event) => updateDraftProfile("age", event.target.value)}
          placeholder="未设置"
          value={visibleAge}
        />
      </label>
      <label className="personal-profile-field">
        学段
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
        保存画像配置
      </button>
    </div>
  );
}
