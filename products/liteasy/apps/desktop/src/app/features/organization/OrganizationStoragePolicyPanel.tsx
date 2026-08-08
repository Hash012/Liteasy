import { useCallback, useEffect, useMemo, useState } from "react";
import { Button, Field, Select, Spinner, Tooltip } from "@fluentui/react-components";
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
        <Select
          aria-label="允许上传"
          disabled={!canEdit || pending || !policy}
          onChange={(_event, data) => setUploadPolicy(data.value as OrganizationUploadPolicy)}
          size="small"
          value={uploadPolicy}
        >
          <option value="owner_admins">负责人和管理员</option>
          <option value="all_members">所有成员</option>
        </Select>
      </Field>
      <Field label="允许复制出库">
        <Select
          aria-label="允许复制出库"
          disabled={!canEdit || pending || !policy}
          onChange={(_event, data) => setExportPolicy(data.value as OrganizationExportPolicy)}
          size="small"
          value={exportPolicy}
        >
          <option value="disabled">禁止</option>
          <option value="admins_only">负责人和管理员</option>
          <option value="all_members">所有成员</option>
        </Select>
      </Field>
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
