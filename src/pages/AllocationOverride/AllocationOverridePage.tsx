import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import AppShell from "../../app/AppShell";
import PageHeader from "../../components/common/PageHeader";
import Panel from "../../components/common/Panel";
import { useApiClient } from "../../api/useApiClient";
import {
  createProjectAllocationOverrideRow,
  fetchProjectAllocationOverride,
  removeProjectAllocationOverrideRow,
  requestArtworkUploadUrl,
  updateProjectAllocationOverrideRow,
  type ApiAllocationOverrideInventoryItem,
  type ApiAllocationOverrideResponse,
  type ApiAllocationOverrideRow,
} from "../../api/projects";

type EditorRow = {
  id: string;
  overrideId?: string;
  sourceType: "proof" | "creative" | "manual";
  sourceProofLineId?: string | null;
  sourceCreativeId?: string | null;
  sourceLineNumber?: number | null;
  sourceLiftOrderLineId?: number | null;
  sourceLiftProofingId?: number | null;
  productLabel: string;
  dimensionsLabel: string;
  quantity: number;
  mediaVariantKey: string;
  assignedInventoryIds: string[];
  hidden: boolean;
  asset: ApiAllocationOverrideRow["asset"];
  updatedAt?: string;
  updatedByName?: string;
  adminNote?: string | null;
  isPersisted: boolean;
};

function formatDimensionPair(heightLike?: number | string | null, widthLike?: number | string | null) {
  const height = Number(heightLike || 0);
  const width = Number(widthLike || 0);
  if (!height && !width) return "";
  if (!height) return `${width}"w`;
  if (!width) return `${height}"h`;
  return `${height}"h x ${width}"w`;
}

function parseVariantKeyLabel(key?: string | null) {
  const parts = String(key || "")
    .split("||")
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length >= 3) {
    return `${parts[0]} · ${formatDimensionPair(parts[1], parts[2])}`;
  }
  return String(key || "").replace(/\|\|/g, " · ");
}

function isImagePreviewUrl(url?: string | null, contentType?: string | null) {
  if (!url) return false;
  if (contentType) return contentType.startsWith("image/");
  const path = url.split("?")[0]?.toLowerCase() || "";
  return /\.(avif|gif|jpe?g|png|webp)$/i.test(path);
}

function assetPreviewUrl(asset: ApiAllocationOverrideRow["asset"]) {
  if (isImagePreviewUrl(asset.fullUrl, asset.contentType)) return asset.fullUrl || "";
  return asset.thumbUrl || asset.fullUrl || "";
}

function proofToEditorRow(proof: ApiAllocationOverrideResponse["proofLines"][number], override?: ApiAllocationOverrideRow): EditorRow {
  if (override) return overrideToEditorRow(override);
  return {
    id: `proof:${proof.lineItemId}`,
    sourceType: "proof",
    sourceProofLineId: proof.lineItemId,
    sourceCreativeId: proof.clientCreativeId || null,
    sourceLineNumber: proof.lineNumber,
    sourceLiftOrderLineId: proof.liftOrderLineId ?? null,
    sourceLiftProofingId: proof.liftProofingId ?? null,
    productLabel: proof.mediaVariantLabel || proof.mediaName || `Line ${proof.lineNumber}`,
    dimensionsLabel: formatDimensionPair(proof.w, proof.h),
    quantity: Math.max(1, (proof.locations || []).length || 1),
    mediaVariantKey: proof.mediaVariantKey,
    assignedInventoryIds: proof.locations || [],
    hidden: false,
    asset: {
      filename: proof.clientFileName,
      thumbUrl: proof.proofThumbUrl || proof.clientThumbUrl || null,
      fullUrl: proof.proofFullUrl || proof.clientFullUrl || null,
      source: proof.proofThumbUrl || proof.proofFullUrl ? "proof" : "creative",
      contentType: null,
    },
    updatedAt: proof.updatedAt,
    updatedByName: proof.updatedByName || undefined,
    isPersisted: false,
  };
}

function overrideToEditorRow(row: ApiAllocationOverrideRow): EditorRow {
  return {
    id: row.id,
    overrideId: row.id,
    sourceType: row.sourceType,
    sourceProofLineId: row.sourceProofLineId || null,
    sourceCreativeId: row.sourceCreativeId || null,
    sourceLineNumber: row.sourceLineNumber ?? null,
    sourceLiftOrderLineId: row.sourceLiftOrderLineId ?? null,
    sourceLiftProofingId: row.sourceLiftProofingId ?? null,
    productLabel: row.productLabel,
    dimensionsLabel: row.dimensionsLabel,
    quantity: row.quantity,
    mediaVariantKey: row.mediaVariantKey,
    assignedInventoryIds: row.assignedInventoryIds || [],
    hidden: row.hidden,
    asset: row.asset,
    updatedAt: row.updatedAt,
    updatedByName: row.updatedByName,
    adminNote: row.adminNote || null,
    isPersisted: true,
  };
}

function buildEditorRows(data: ApiAllocationOverrideResponse | null): EditorRow[] {
  if (!data) return [];
  const overridesByProof = new Map(
    data.override.rows
      .filter((row) => row.sourceProofLineId)
      .map((row) => [row.sourceProofLineId as string, row] as const)
  );
  const proofRows = data.proofLines
    .map((proof) => proofToEditorRow(proof, overridesByProof.get(proof.lineItemId)))
    .filter((row) => !row.hidden);
  const nonProofRows = data.override.rows
    .filter((row) => !row.sourceProofLineId)
    .map(overrideToEditorRow)
    .filter((row) => !row.hidden);
  return [...proofRows, ...nonProofRows].sort(
    (a, b) => (a.sourceLineNumber ?? 999999) - (b.sourceLineNumber ?? 999999) || a.productLabel.localeCompare(b.productLabel)
  );
}

function displayInventoryLabel(item: ApiAllocationOverrideInventoryItem) {
  return item.locationName ? `${item.id} · ${item.locationName}` : item.id;
}

export default function AllocationOverridePage() {
  const { projectId } = useParams();
  const navigate = useNavigate();
  const api = useApiClient();
  const [data, setData] = useState<ApiAllocationOverrideResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<EditorRow | null>(null);
  const [inventoryQuery, setInventoryQuery] = useState("");
  const [inventoryFilter, setInventoryFilter] = useState<"all" | "active" | "scope" | "assigned">("all");
  const [saving, setSaving] = useState(false);
  const [uploadFile, setUploadFile] = useState<File | null>(null);

  async function reload() {
    if (!projectId) return;
    setLoading(true);
    setError(null);
    try {
      const response = await fetchProjectAllocationOverride(api, projectId);
      setData(response);
      setSelectedId((current) => current || buildEditorRows(response)[0]?.id || null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load allocation overrides.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void reload();
  }, [api, projectId]);

  const rows = useMemo(() => buildEditorRows(data), [data]);
  const selected = useMemo(() => rows.find((row) => row.id === selectedId) || rows[0] || null, [rows, selectedId]);

  useEffect(() => {
    setDraft(selected ? { ...selected, assignedInventoryIds: [...selected.assignedInventoryIds] } : null);
    setUploadFile(null);
  }, [selected?.id]);

  const inventoryById = useMemo(() => {
    const map = new Map<string, ApiAllocationOverrideInventoryItem>();
    (data?.workspace.inventory || []).forEach((item) => map.set(item.recordId || item.id, item));
    return map;
  }, [data]);

  const visibleInventory = useMemo(() => {
    const q = inventoryQuery.trim().toLowerCase();
    return (data?.workspace.inventory || [])
      .filter((item) => {
        if (inventoryFilter === "active" && item.isActive === false) return false;
        if (inventoryFilter === "scope" && item.isInScope !== true) return false;
        if (inventoryFilter === "assigned" && !draft?.assignedInventoryIds.includes(item.recordId || item.id)) return false;
        if (!q) return true;
        return [item.id, item.locationName, item.mediaVariantKey, item.unitNumber].some((value) => String(value || "").toLowerCase().includes(q));
      })
      .slice(0, 250);
  }, [data, draft?.assignedInventoryIds, inventoryFilter, inventoryQuery]);

  const selectedLocationLabels = useMemo(() => {
    return (draft?.assignedInventoryIds || []).map((id) => inventoryById.get(id)?.id || id);
  }, [draft?.assignedInventoryIds, inventoryById]);

  function patchDraft(patch: Partial<EditorRow>) {
    setDraft((current) => (current ? { ...current, ...patch } : current));
  }

  function toggleInventory(id: string) {
    if (!draft) return;
    const existing = new Set(draft.assignedInventoryIds);
    if (existing.has(id)) existing.delete(id);
    else existing.add(id);
    patchDraft({ assignedInventoryIds: Array.from(existing) });
  }

  function addManualRow() {
    const variant = data?.workspace.variants[0];
    const row: EditorRow = {
      id: `manual:${Date.now()}`,
      sourceType: "manual",
      productLabel: "Manual override line",
      dimensionsLabel: variant ? formatDimensionPair(variant.w, variant.h) : "",
      quantity: 1,
      mediaVariantKey: variant?.key || "",
      assignedInventoryIds: [],
      hidden: false,
      asset: { filename: "Artwork pending", thumbUrl: null, fullUrl: null, source: "manual", contentType: null },
      isPersisted: false,
    };
    setSelectedId(row.id);
    setDraft(row);
  }

  async function uploadOverrideAsset(file: File) {
    if (!projectId) return null;
    const signed = await requestArtworkUploadUrl(api, {
      projectId,
      filename: file.name,
      contentType: file.type || "application/octet-stream",
      assetKind: "artwork",
    });
    const response = await fetch(signed.uploadUrl, {
      method: "PUT",
      headers: { "Content-Type": file.type || "application/octet-stream" },
      body: file,
    });
    if (!response.ok) throw new Error("Artwork upload failed.");
    return {
      bucketName: signed.bucket,
      objectKey: signed.key,
      filename: file.name,
      contentType: file.type || "application/octet-stream",
      sizeBytes: file.size,
    };
  }

  async function saveDraft() {
    if (!projectId || !draft) return;
    setSaving(true);
    try {
      const overrideAsset = uploadFile ? await uploadOverrideAsset(uploadFile) : undefined;
      const payload = {
        sourceType: draft.sourceType,
        sourceProofLineId: draft.sourceProofLineId || null,
        sourceCreativeId: draft.sourceCreativeId || null,
        sourceLineNumber: draft.sourceLineNumber ?? null,
        sourceLiftOrderLineId: draft.sourceLiftOrderLineId ?? null,
        sourceLiftProofingId: draft.sourceLiftProofingId ?? null,
        productLabel: draft.productLabel,
        dimensionsLabel: draft.dimensionsLabel,
        quantity: draft.quantity,
        mediaVariantKey: draft.mediaVariantKey,
        assignedInventoryIds: draft.assignedInventoryIds,
        adminNote: draft.adminNote || null,
        ...(overrideAsset ? { overrideAsset } : {}),
      };
      if (draft.overrideId) await updateProjectAllocationOverrideRow(api, projectId, draft.overrideId, payload);
      else await createProjectAllocationOverrideRow(api, projectId, payload);
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to save override row.");
    } finally {
      setSaving(false);
    }
  }

  async function removeSelected() {
    if (!projectId || !draft) return;
    const note = window.prompt("Internal reason for removing this allocation line");
    if (!note?.trim()) return;
    setSaving(true);
    try {
      if (draft.overrideId) {
        await removeProjectAllocationOverrideRow(api, projectId, draft.overrideId, note.trim());
      } else {
        await createProjectAllocationOverrideRow(api, projectId, {
          sourceType: draft.sourceType,
          sourceProofLineId: draft.sourceProofLineId || null,
          sourceCreativeId: draft.sourceCreativeId || null,
          sourceLineNumber: draft.sourceLineNumber ?? null,
          sourceLiftOrderLineId: draft.sourceLiftOrderLineId ?? null,
          sourceLiftProofingId: draft.sourceLiftProofingId ?? null,
          productLabel: draft.productLabel,
          dimensionsLabel: draft.dimensionsLabel,
          quantity: draft.quantity,
          mediaVariantKey: draft.mediaVariantKey,
          assignedInventoryIds: draft.assignedInventoryIds,
          adminNote: note.trim(),
          hidden: true,
        });
      }
      await reload();
      setSelectedId(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to remove override row.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <AppShell pageClassName="workspace">
      <PageHeader
        variant="workspace"
        eyebrow="Internal allocation repair"
        title="Artwork Allocation Override"
        subtitle={data ? `${data.project.title} · ${data.project.venueName}` : "Loading project allocation context"}
        backLabel="Back to Hub"
        onBack={() => projectId && navigate(`/p/${projectId}`)}
        actions={<button className="btn btn-ghost btn-soft" type="button" onClick={reload} disabled={loading}>Refresh</button>}
      />

      <div className="alloc-override-page">
        {error ? <div className="alloc-override-alert">{error}</div> : null}
        <div className="alloc-override-summary">
          <div><span>Lift order</span><strong>{data?.project.liftOrderId || "Not linked"}</strong></div>
          <div><span>Active overrides</span><strong>{data?.override.activeCount ?? 0}</strong></div>
          <div><span>Hidden rows</span><strong>{data?.override.hiddenCount ?? 0}</strong></div>
          <div><span>Lift sync</span><strong>Not supported yet</strong></div>
        </div>

        <div className="alloc-override-grid">
          <Panel
            className="alloc-override-listPanel"
            title="Allocation rows"
            subtitle="Proof-backed rows become overrides on first save. Manual rows are Adspace-only."
            right={<button className="btn btn-primary" type="button" onClick={addManualRow}>Add line</button>}
          >
            {loading ? <div className="alloc-override-empty">Loading allocation rows...</div> : null}
            {!loading && rows.length === 0 ? <div className="alloc-override-empty">No proof or override rows are available yet.</div> : null}
            <div className="alloc-override-rows">
              {rows.map((row) => (
                <button
                  key={row.id}
                  className={`alloc-override-row ${selected?.id === row.id ? "is-selected" : ""}`}
                  type="button"
                  onClick={() => setSelectedId(row.id)}
                >
                  <div
                    className="alloc-override-thumb"
                    style={
                      assetPreviewUrl(row.asset)
                        ? { backgroundImage: `url("${assetPreviewUrl(row.asset).replace(/"/g, "%22")}")` }
                        : undefined
                    }
                    aria-label={row.asset.filename || "Artwork preview"}
                  >
                    {!assetPreviewUrl(row.asset) ? <span>Art</span> : null}
                  </div>
                  <div className="alloc-override-rowMain">
                    <div className="alloc-override-rowTop">
                      <span className="alloc-override-chip">{row.sourceType === "proof" ? `Line ${row.sourceLineNumber || "proof"}` : "Manual override"}</span>
                      {row.isPersisted ? <span className="alloc-override-chip is-green">Override</span> : <span className="alloc-override-chip">Source</span>}
                    </div>
                    <strong>{row.productLabel}</strong>
                    <span>{row.dimensionsLabel || "No dimensions"} · {row.assignedInventoryIds.length} location{row.assignedInventoryIds.length === 1 ? "" : "s"}</span>
                    <small>{row.asset.filename}</small>
                  </div>
                </button>
              ))}
            </div>
          </Panel>

          <Panel className="alloc-override-editorPanel" title="Row details" subtitle={draft?.isPersisted ? "Saved override row" : "Source row, not overridden yet"}>
            {!draft ? (
              <div className="alloc-override-empty">Select a row to edit allocation details.</div>
            ) : (
              <div className="alloc-override-editor">
                <div className="alloc-override-preview">
                  {assetPreviewUrl(draft.asset) ? <img src={assetPreviewUrl(draft.asset)} alt="" /> : <span>No artwork preview</span>}
                </div>
                <label className="alloc-override-field">
                  <span>Product</span>
                  <input value={draft.productLabel} onChange={(event) => patchDraft({ productLabel: event.target.value })} />
                </label>
                <label className="alloc-override-field">
                  <span>Dimensions</span>
                  <input value={draft.dimensionsLabel} onChange={(event) => patchDraft({ dimensionsLabel: event.target.value })} />
                </label>
                <div className="alloc-override-two">
                  <label className="alloc-override-field">
                    <span>Quantity</span>
                    <input type="number" min={1} value={draft.quantity} onChange={(event) => patchDraft({ quantity: Number(event.target.value) || 1 })} />
                  </label>
                  <label className="alloc-override-field">
                    <span>Media variant</span>
                    <select value={draft.mediaVariantKey} onChange={(event) => patchDraft({ mediaVariantKey: event.target.value })}>
                      {(data?.workspace.variants || []).map((variant) => (
                        <option key={variant.key} value={variant.key}>
                          {variant.label || `${variant.mediaName} · ${formatDimensionPair(variant.w, variant.h)}` || parseVariantKeyLabel(variant.key)}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <label className="alloc-override-field">
                  <span>Internal note</span>
                  <textarea value={draft.adminNote || ""} onChange={(event) => patchDraft({ adminNote: event.target.value })} placeholder="Optional audit note for this override" />
                </label>
                <label className="alloc-override-field">
                  <span>Replace display artwork</span>
                  <input type="file" onChange={(event) => setUploadFile(event.target.files?.[0] || null)} />
                </label>
                <div className="alloc-override-actions">
                  <button className="btn btn-primary" type="button" onClick={saveDraft} disabled={saving || !draft.productLabel || !draft.mediaVariantKey}>
                    {saving ? "Saving..." : draft.isPersisted ? "Save override" : "Create override"}
                  </button>
                  <button className="btn btn-ghost btn-soft" type="button" onClick={removeSelected} disabled={saving}>Remove line</button>
                </div>
                <div className="alloc-override-sync">
                  <strong>Lift sync not supported yet</strong>
                  <span>{data?.override.liftSync.message}</span>
                </div>
              </div>
            )}
          </Panel>

          <Panel className="alloc-override-inventoryPanel" title="Inventory assignment" subtitle={`${selectedLocationLabels.length} selected`}>
            <div className="alloc-override-inventoryTools">
              <input value={inventoryQuery} onChange={(event) => setInventoryQuery(event.target.value)} placeholder="Search inventory..." />
              <select value={inventoryFilter} onChange={(event) => setInventoryFilter(event.target.value as typeof inventoryFilter)}>
                <option value="all">All inventory</option>
                <option value="active">Active only</option>
                <option value="scope">Original scope</option>
                <option value="assigned">Selected</option>
              </select>
            </div>
            <div className="alloc-override-selected">
              {selectedLocationLabels.length ? selectedLocationLabels.slice(0, 8).map((label) => <span key={label}>{label}</span>) : <span>No locations assigned</span>}
            </div>
            <div className="alloc-override-inventoryList">
              {visibleInventory.map((item) => {
                const recordId = item.recordId || item.id;
                const checked = !!draft?.assignedInventoryIds.includes(recordId);
                return (
                  <label key={recordId} className={`alloc-override-inventoryRow ${checked ? "is-checked" : ""}`}>
                    <input type="checkbox" checked={checked} onChange={() => toggleInventory(recordId)} disabled={!draft} />
                    <span>
                      <strong>{displayInventoryLabel(item)}</strong>
                      <small>{parseVariantKeyLabel(item.mediaVariantKey)}{item.isInScope === false ? " · outside original scope" : ""}{item.isActive === false ? " · inactive" : ""}</small>
                    </span>
                  </label>
                );
              })}
            </div>
          </Panel>
        </div>
      </div>
    </AppShell>
  );
}
