import { OptionPicker } from "../../shared/ui/productPrimitives";
import { ActionButton as Button } from "../../shared/ui/productPrimitives";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Field, Spinner, Tooltip } from "@fluentui/react-components";
import { ArrowSyncRegular, SaveRegular } from "@fluentui/react-icons";
import { createCloudLibraryStorageClient } from "../library/cloudLibraryStorageClient";
import type { OrganizationSummary } from "./organization.types";
import type {
  OrganizationExportPolicy,
  OrganizationStorageAccess,
  OrganizationUploadPolicy
} from "./organizationStoragePolicy";

type OrganizationStoragePolicyRecord = OrganizationStorageAccess & {
  revision: number;
  updatedAt: string;
  updatedBy: string;
};

export type OrganizationStoragePolicyClient = {
  getOrganizationStoragePolicy: (organizationId: string) => Promise<OrganizationStoragePolicyRecord>;
  updateOrganizationStoragePolicy: (input: {
    expectedRevision: number;
    exportPolicy: OrganizationExportPolicy;
    organizationId: string;
    uploadPolicy: OrganizationUploadPolicy;
  }) => Promise<OrganizationStoragePolicyRecord>;
};

type OrganizationStoragePolicyPanelProps = {
  client?: OrganizationStoragePolicyClient;
  endpoint: string;
  summary: OrganizationSummary;
};

export function OrganizationStoragePolicyPanel({
  client: clientOverride,
  endpoint,
  summary
}: OrganizationStoragePolicyPanelProps) {
  const client = useMemo(
    () => clientOverride ?? createCloudLibraryStorageClient({ endpoint }),
    [clientOverride, endpoint]
  );
  const [policy, setPolicy] = useState<OrganizationStoragePolicyRecord | null>(null);
  const [uploadPolicy, setUploadPolicy] = useState<OrganizationUploadPolicy>(
    summary.policy?.uploadPolicy ?? "owner_admins"
  );
  const [exportPolicy, setExportPolicy] = useState<OrganizationExportPolicy>(
    summary.policy?.exportPolicy ?? "disabled"
  );
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const canEdit = summary.myRole === "owner";

  const loadPolicy = useCallback(async () => {
    setPending(true);
    setMessage("");
    try {
      const next = await client.getOrganizationStoragePolicy(summary.organizationId);
      setPolicy(next);
      setUploadPolicy(next.uploadPolicy);
      setExportPolicy(next.exportPolicy);
    } catch (error) {
      setPolicy(null);
      setMessage(error instanceof Error ? error.message : "无法加载组织存储策略。");
    } finally {
      setPending(false);
    }
  }, [client, summary.organizationId]);

  useEffect(() => {
    if (canEdit) {
      void loadPolicy();
    }
  }, [canEdit, loadPolicy]);

  async function savePolicy() {
    if (!canEdit || !policy) return;
    setPending(true);
    setMessage("");
    try {
      const next = await client.updateOrganizationStoragePolicy({
        expectedRevision: policy.revision,
        exportPolicy,
        organizationId: summary.organizationId,
        uploadPolicy
      });
      setPolicy(next);
      setUploadPolicy(next.uploadPolicy);
      setExportPolicy(next.exportPolicy);
      setMessage("组织存储策略已更新。");
    } catch (error) {
      const reason = error instanceof Error ? error.message : "更新失败。";
      setMessage(`${reason} 正在刷新服务器策略。`);
      try {
        const latest = await client.getOrganizationStoragePolicy(summary.organizationId);
        setPolicy(latest);
        setUploadPolicy(latest.uploadPolicy);
        setExportPolicy(latest.exportPolicy);
      } catch {
        setPolicy(null);
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <section aria-label="组织文献库策略" className="organization-storage-policy-panel">
      <div className="organization-storage-policy-header">
        <span>文献库策略</span>
        <Tooltip content="刷新组织文献库策略" relationship="label">
          <Button
            appearance="subtle"
            aria-label="刷新组织文献库策略"
            disabled={pending}
            icon={pending ? <Spinner size="tiny" /> : <ArrowSyncRegular />}
            onClick={() => void loadPolicy()}
            size="small"
          />
        </Tooltip>
      </div>
      <Field label="允许上传">
        <OptionPicker aria-label="允许上传" disabled={!canEdit || pending || !policy} density="compact" value={uploadPolicy}
          onValueChange={(value) => setUploadPolicy(value as OrganizationUploadPolicy)}
          options={[{ value: "owner_admins", label: "负责人和管理员" }, { value: "all_members", label: "所有成员" }]} />
      </Field>
      <Field label="允许复制出库">
        <OptionPicker aria-label="允许复制出库" disabled={!canEdit || pending || !policy} density="compact" value={exportPolicy}
          onValueChange={(value) => setExportPolicy(value as OrganizationExportPolicy)}
          options={[{ value: "disabled", label: "禁止" }, { value: "admins_only", label: "负责人和管理员" }, { value: "all_members", label: "所有成员" }]} />
      </Field>
      {!canEdit ? <p className="organization-muted">仅组织所有者可修改文献库策略。</p> : null}
      {canEdit ? (
        <Button
          appearance="primary"
          disabled={pending || !policy || (
            policy.uploadPolicy === uploadPolicy && policy.exportPolicy === exportPolicy
          )}
          icon={<SaveRegular />}
          onClick={() => void savePolicy()}
          size="small"
        >
          保存策略
        </Button>
      ) : null}
      {message ? <p aria-live="polite" className="organization-storage-policy-message">{message}</p> : null}
    </section>
  );
}
