export class PdfUploadError extends Error {
  constructor(code, status = 400) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

function validProofText(value) {
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:/+ -]{0,99}$/.test(value);
}

function workflowSecurityProof(workflow) {
  const values = [
    workflow.security_scan_hash,
    workflow.security_scanned_at,
    workflow.security_scanner,
    workflow.security_scanner_version
  ];
  if (values.every((value) => value === null || value === undefined)) return null;
  const scannedAt = workflow.security_scanned_at instanceof Date
    ? workflow.security_scanned_at
    : new Date(workflow.security_scanned_at);
  if (workflow.security_scan_hash !== workflow.content_hash ||
    !Number.isFinite(scannedAt.getTime()) ||
    !validProofText(workflow.security_scanner) ||
    !validProofText(workflow.security_scanner_version)) {
    throw new PdfUploadError("storage_security_scan_required", 503);
  }
  return {
    contentHash: workflow.security_scan_hash,
    scannedAt: scannedAt.toISOString(),
    scanner: workflow.security_scanner,
    version: workflow.security_scanner_version
  };
}

export class PdfUploadService {
  constructor(repository, objectStore, securityScanner) {
    this.repository = repository;
    this.objectStore = objectStore;
    this.securityScanner = securityScanner;
  }

  async scanStoredPdf(staged) {
    let object;
    try {
      object = await this.objectStore.openObject(staged.storageKey);
      const mediaType = object.mediaType?.split(";", 1)[0].trim().toLowerCase();
      if (object.byteLength !== staged.byteLength || mediaType !== "application/pdf") {
        object.body?.destroy?.();
        throw new Error("staging object metadata mismatch");
      }
      if (!this.securityScanner || typeof this.securityScanner.scan !== "function") {
        throw new Error("scanner missing");
      }
      return await this.securityScanner.scan(object.body, staged);
    } catch (error) {
      object?.body?.destroy?.();
      const cancellation = object?.body?.cancel?.();
      await cancellation?.catch(() => {});
      if (error?.code === "pdf_security_rejected") {
        throw new PdfUploadError("pdf_security_rejected", 422);
      }
      throw new PdfUploadError("pdf_security_scanner_unavailable", 503);
    }
  }

  async ensureWorkflowSecurityProof(workflow) {
    const existing = workflowSecurityProof(workflow);
    if (existing) return workflow;
    const storageKey = workflow.state === "object_published" ? workflow.final_key : workflow.staging_key;
    const proof = await this.scanStoredPdf({
      byteLength: Number(workflow.byte_length),
      contentHash: workflow.content_hash,
      mediaType: "application/pdf",
      storageKey
    });
    await this.repository.recordPdfSecurityScan(workflow.workflow_id, proof);
    return {
      ...workflow,
      security_scan_hash: proof.contentHash,
      security_scanned_at: proof.scannedAt,
      security_scanner: proof.scanner,
      security_scanner_version: proof.version
    };
  }

  async publishWorkflow(workflowInput, traceId) {
    const workflow = await this.ensureWorkflowSecurityProof(workflowInput);
    try {
      await this.objectStore.publishStagedPdf({
        byteLength: Number(workflow.byte_length),
        contentHash: workflow.content_hash,
        mediaType: "application/pdf",
        storageKey: workflow.staging_key
      });
      await this.repository.markPdfObjectPublished(workflow.workflow_id);
      return await this.repository.completePdfUpload(workflow, traceId);
    } catch (error) {
      if (error instanceof PdfUploadError) throw error;
      await this.repository.markPdfUploadRepairRequired(workflow.workflow_id, "storage_publish_failed");
      throw new PdfUploadError("storage_publish_failed", 503);
    }
  }

  async upload(scope, input) {
    const stagedObject = await this.objectStore.stagePdf(input.readable, { operationId: input.operationId });
    let keepStagingForRepair = false;
    try {
      const staged = { ...stagedObject, securityScan: await this.scanStoredPdf(stagedObject) };
      const duplicates = await this.repository.findPdfDuplicates(scope, staged.contentHash);
      if (duplicates.length > 0 && input.duplicateAction !== "save_copy") {
        await this.objectStore.deleteKey(staged.storageKey);
        return {
          duplicates,
          status: input.duplicateAction === "cancel" ? "cancelled" : "duplicate"
        };
      }
      const finalKey = this.objectStore.objectKey(staged.contentHash);
      const prepared = await this.repository.preparePdfUpload(scope, {
        actorId: input.actorId,
        expectedRevision: input.expectedRevision,
        fileName: input.fileName,
        finalKey,
        folderId: input.folderId,
        idempotencyKey: input.idempotencyKey,
        traceId: input.traceId
      }, staged);
      if (prepared.kind === "complete") {
        await this.objectStore.deleteKey(staged.storageKey);
        return prepared.response;
      }

      const workflow = prepared.workflow;
      if (workflow.staging_key !== staged.storageKey) {
        await this.objectStore.deleteKey(staged.storageKey);
      }
      keepStagingForRepair = true;
      return await this.publishWorkflow(workflow, input.traceId);
    } catch (error) {
      if (!keepStagingForRepair) await this.objectStore.deleteKey(stagedObject.storageKey).catch(() => {});
      throw error;
    }
  }

  async attach(scope, input) {
    const stagedObject = await this.objectStore.stagePdf(input.readable, { operationId: input.operationId });
    let keepStagingForRepair = false;
    try {
      const staged = { ...stagedObject, securityScan: await this.scanStoredPdf(stagedObject) };
      const prepared = await this.repository.prepareMetadataPdfAttachment(scope, {
        actorId: input.actorId,
        documentId: input.documentId,
        expectedRevision: input.expectedRevision,
        fileName: input.fileName,
        finalKey: this.objectStore.objectKey(staged.contentHash),
        idempotencyKey: input.idempotencyKey,
        traceId: input.traceId
      }, staged);
      if (prepared.kind === "complete") {
        await this.objectStore.deleteKey(staged.storageKey);
        return prepared.response;
      }
      const workflow = prepared.workflow;
      if (workflow.staging_key !== staged.storageKey) await this.objectStore.deleteKey(staged.storageKey);
      keepStagingForRepair = true;
      return await this.publishWorkflow(workflow, input.traceId);
    } catch (error) {
      if (!keepStagingForRepair) await this.objectStore.deleteKey(stagedObject.storageKey).catch(() => {});
      throw error;
    }
  }

  async scanUnverifiedObjects({ limit = 100 } = {}) {
    const objects = await this.repository.listUnverifiedPdfObjects(limit);
    const failures = [];
    let scanned = 0;
    for (const object of objects) {
      try {
        const proof = await this.scanStoredPdf({
          byteLength: Number(object.byte_length),
          contentHash: object.content_hash,
          mediaType: object.media_type,
          storageKey: object.storage_key
        });
        await this.repository.recordObjectSecurityScan(object.content_hash, proof);
        scanned += 1;
      } catch (error) {
        failures.push({
          code: error instanceof PdfUploadError ? error.code : "pdf_security_scanner_unavailable",
          contentHash: object.content_hash
        });
      }
    }
    return {
      failures,
      remaining: await this.repository.countUnverifiedPdfObjects(),
      scanned
    };
  }

  async assertNoUnverifiedObjects() {
    const unverified = await this.repository.countUnverifiedPdfObjects();
    if (unverified > 0) throw new PdfUploadError("storage_security_backfill_required", 503);
    return { unverified };
  }

  async repairPendingWorkflows({ limit = 100 } = {}) {
    const workflows = await this.repository.listRecoverablePdfUploads(limit);
    const failures = [];
    let repaired = 0;
    for (const pendingWorkflow of workflows) {
      try {
        const workflow = await this.ensureWorkflowSecurityProof(pendingWorkflow);
        if (workflow.state !== "object_published") {
          await this.objectStore.publishStagedPdf({
            byteLength: Number(workflow.byte_length),
            contentHash: workflow.content_hash,
            mediaType: "application/pdf",
            storageKey: workflow.staging_key
          });
          await this.repository.markPdfObjectPublished(workflow.workflow_id);
        }
        await this.repository.completePdfUpload(workflow, `trace_repair_${workflow.workflow_id}`);
        repaired += 1;
      } catch (error) {
        failures.push(pendingWorkflow.workflow_id);
        const code = error instanceof PdfUploadError ? error.code : "storage_repair_failed";
        await this.repository.markPdfUploadRepairRequired(pendingWorkflow.workflow_id, code);
      }
    }
    if (failures.length > 0) {
      throw new PdfUploadError(`storage_workflow_repair_failed:${failures.join(",")}`, 503);
    }
    return { repaired, scanned: workflows.length };
  }
}
