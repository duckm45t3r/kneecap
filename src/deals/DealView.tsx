import { useCallback, useEffect, useRef, useState } from "react";
import type { ComponentType } from "react";
import {
  getDeal,
  renameDeal,
  deleteDeal,
  addSource,
  removeSource,
  updateVersionContent,
  deleteVersion,
  generateVersion,
  versionAsReport,
  type DealDetail,
  type DealSource,
  type DealVersion,
  type SourceKind,
  type VersionKind,
} from "./dealStore";
import { getFirmLogo } from "../templates/templateStore";
import { exportReportToPdf, exportReportToDocx } from "../reports/exportReport";
import { useT } from "../i18n";
import type { MessageKey } from "../i18n/messages";

// ─── Deal view ────────────────────────────────────────────────────────
//
// A saved report becomes a DEAL that evolves: v1 from the deck, v2 + data room,
// v3 + supplements. This view is the deal's home — a header (name / rename /
// delete) over two panels:
//   1. SOURCES  — the accumulated deck / text / URL sources, with add + remove.
//   2. VERSIONS — the v1…vN history (newest first); click one to read it.
// Selecting a version drops into the read-only viewer (markdown + Export +
// Edit). "New version" re-generates from ALL the deal's sources at once.

const PROVIDER_LABELS: Record<string, string> = {
  anthropic: "Anthropic",
  openai: "OpenAI",
  nvidia: "Nvidia (Nemotron)",
  gemini: "Gemini",
  local: "Local (Ollama)",
  vhs: "VHS-hosted",
};

// Providers that read a PDF natively (vision/document-capable). Mirrors App's
// NATIVE_PDF_PROVIDERS and the Rust provider_supports_native_pdf split — kept
// local to avoid coupling this view back to App.tsx. Anything outside this set
// is text-only (nvidia / local): a PDF is reduced to extracted text.
const NATIVE_PDF_PROVIDERS: ReadonlySet<string> = new Set([
  "anthropic",
  "openai",
  "gemini",
  "vhs",
]);

function isTextOnlyProvider(provider: string): boolean {
  return !NATIVE_PDF_PROVIDERS.has(provider);
}

// `t` is threaded in from the calling component's `useT()` — PROVIDER_LABELS is
// a plain module-level object, so it can't call useT() itself. "local"/"vhs"
// are our own descriptive labels (translated); the rest are brand names.
function providerLabel(
  id: string,
  t: (key: MessageKey, params?: Record<string, string | number>) => string,
): string {
  if (id === "local") return t("provider.local");
  if (id === "vhs") return t("provider.vhs");
  return PROVIDER_LABELS[id] ?? id;
}

const KIND_EMOJI: Record<SourceKind, string> = {
  pdf: "📄",
  text: "✎",
  url: "🔗",
};

function fmtDate(iso: string): string {
  const ms = Date.parse(iso);
  if (!ms) return "";
  return new Date(ms).toLocaleString();
}

// Read a File → base64 (no data: prefix). Same contract as App.fileToBase64;
// duplicated here to keep the deals module self-contained.
function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== "string") {
        reject(new Error("FileReader returned non-string"));
        return;
      }
      const comma = result.indexOf(",");
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

export function DealView({
  dealId,
  availableProviders,
  activeProvider,
  setActiveProvider,
  templateOptions,
  MarkdownView,
  showToast,
  onBack,
  onDeleted,
  onChanged,
}: {
  dealId: string;
  availableProviders: string[];
  // Shared app-level provider (read/write), forwarded to the New-Version modal
  // so picking a provider there is the app's current provider everywhere.
  activeProvider: string;
  setActiveProvider: (p: string) => void;
  // Custom templates the New-Version flow can target (id + name). Built-in
  // memo/ic kinds are always available; these extend the picker.
  templateOptions: { id: string; name: string }[];
  // App owns MarkdownView (chart-aware). Passed in so the version viewer renders
  // identically to the rest of the app without lifting it out of App.tsx.
  MarkdownView: ComponentType<{ source: string }>;
  showToast: (m: string) => void;
  onBack: () => void;
  onDeleted: () => void;
  // Bump the sidebar after any mutation (rename / source / version edit).
  onChanged: () => void;
}) {
  const [detail, setDetail] = useState<DealDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  // The version currently open in the viewer (null = panel overview).
  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(null);
  const [showNewVersion, setShowNewVersion] = useState(false);
  const { t } = useT();

  const firmLogo = getFirmLogo();

  const refresh = useCallback(async () => {
    try {
      const d = await getDeal(dealId);
      setDetail(d);
      setNotFound(false);
    } catch {
      setNotFound(true);
      setDetail(null);
    } finally {
      setLoading(false);
    }
  }, [dealId]);

  useEffect(() => {
    setLoading(true);
    setSelectedVersionId(null);
    refresh();
  }, [refresh]);

  const selectedVersion =
    detail?.versions.find((v) => v.id === selectedVersionId) ?? null;

  if (loading) {
    return (
      <div className="kn-flow">
        <button className="kn-back" onClick={onBack}>
          ← Back
        </button>
        <p className="kn-flow-sub">{t("deal.loading")}</p>
      </div>
    );
  }

  if (notFound || !detail) {
    return (
      <div className="kn-flow">
        <button className="kn-back" onClick={onBack}>
          ← Back
        </button>
        <div className="kn-form-feedback kn-form-feedback--err">
          ✗ {t("deal.notFound")}
        </div>
      </div>
    );
  }

  // A version is open → show the version viewer instead of the deal overview.
  if (selectedVersion) {
    return (
      <VersionViewer
        version={selectedVersion}
        dealName={detail.deal.name}
        templateOptions={templateOptions}
        firmLogoUrl={firmLogo?.dataUrl ?? null}
        MarkdownView={MarkdownView}
        showToast={showToast}
        onBack={() => setSelectedVersionId(null)}
        onSaved={async () => {
          await refresh();
          onChanged();
        }}
        onDeleted={async () => {
          setSelectedVersionId(null);
          await refresh();
          onChanged();
        }}
      />
    );
  }

  return (
    <div className="kn-flow">
      <button className="kn-back" onClick={onBack}>
        ← Back
      </button>

      <DealHeader
        deal={detail.deal}
        showToast={showToast}
        onRenamed={async () => {
          await refresh();
          onChanged();
        }}
        onDeleted={async () => {
          await deleteDeal(detail.deal.id);
          onDeleted();
        }}
      />

      <div className="kn-deal-panels">
        <SourcesPanel
          sources={detail.sources}
          dealId={detail.deal.id}
          showToast={showToast}
          onChanged={async () => {
            await refresh();
            onChanged();
          }}
        />

        <VersionsPanel
          versions={detail.versions}
          onOpen={(id) => setSelectedVersionId(id)}
          onNewVersion={() => setShowNewVersion(true)}
          canGenerate={detail.sources.length > 0}
        />
      </div>

      {showNewVersion && (
        <NewVersionModal
          deal={detail.deal}
          sourceCount={detail.sources.length}
          hasPdfSource={detail.sources.some((s) => s.kind === "pdf")}
          nextSeq={(detail.versions[0]?.seq ?? 0) + 1}
          availableProviders={availableProviders}
          activeProvider={activeProvider}
          setActiveProvider={setActiveProvider}
          templateOptions={templateOptions}
          showToast={showToast}
          onClose={() => setShowNewVersion(false)}
          onGenerated={async (newVersion) => {
            setShowNewVersion(false);
            await refresh();
            onChanged();
            setSelectedVersionId(newVersion.id); // open the fresh version
          }}
        />
      )}
    </div>
  );
}

// ─── Header: name + rename + delete ───────────────────────────────────

function DealHeader({
  deal,
  showToast,
  onRenamed,
  onDeleted,
}: {
  deal: { id: string; name: string; updated_at: string };
  showToast: (m: string) => void;
  onRenamed: () => void;
  onDeleted: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(deal.name);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const { t } = useT();

  const save = async () => {
    const name = draft.trim();
    if (!name) {
      showToast(t("deal.nameRequired"));
      return;
    }
    try {
      await renameDeal(deal.id, name);
      setEditing(false);
      showToast(t("deal.renamed"));
      onRenamed();
    } catch (e) {
      showToast(t("deal.renameFailed", { error: String(e) }));
    }
  };

  return (
    <div className="kn-deal-header">
      {editing ? (
        <div className="kn-deal-rename">
          <input
            className="kn-input"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") save();
              if (e.key === "Escape") {
                setDraft(deal.name);
                setEditing(false);
              }
            }}
            autoFocus
          />
          <button className="kn-btn kn-btn--primary" onClick={save}>
            {t("deal.save")}
          </button>
          <button
            className="kn-btn kn-btn--ghost"
            onClick={() => {
              setDraft(deal.name);
              setEditing(false);
            }}
          >
            {t("deal.cancel")}
          </button>
        </div>
      ) : (
        <>
          <h2 className="kn-flow-title kn-deal-title">{deal.name}</h2>
          <div className="kn-deal-header-actions">
            <button
              className="kn-btn kn-btn--ghost"
              onClick={() => {
                setDraft(deal.name);
                setEditing(true);
              }}
            >
              {t("deal.rename")}
            </button>
            {confirmDelete ? (
              <>
                <button className="kn-btn kn-btn--danger" onClick={onDeleted}>
                  {t("deal.confirmDelete")}
                </button>
                <button
                  className="kn-btn kn-btn--ghost"
                  onClick={() => setConfirmDelete(false)}
                >
                  {t("deal.cancel")}
                </button>
              </>
            ) : (
              <button
                className="kn-btn kn-btn--ghost"
                onClick={() => setConfirmDelete(true)}
              >
                {t("deal.deleteReport")}
              </button>
            )}
          </div>
        </>
      )}
      {!editing && (
        <p className="kn-flow-sub">{t("deal.lastUpdated", { date: fmtDate(deal.updated_at) })}</p>
      )}
    </div>
  );
}

// ─── Sources panel ────────────────────────────────────────────────────

function SourcesPanel({
  sources,
  dealId,
  showToast,
  onChanged,
}: {
  sources: DealSource[];
  dealId: string;
  showToast: (m: string) => void;
  onChanged: () => void;
}) {
  const [adding, setAdding] = useState(false);
  const { t } = useT();

  const remove = async (s: DealSource) => {
    try {
      await removeSource(s.id);
      showToast(t("deal.sourceRemoved"));
      onChanged();
    } catch (e) {
      showToast(t("deal.sourceRemoveFailed", { error: String(e) }));
    }
  };

  return (
    <section className="kn-deal-panel">
      <div className="kn-deal-panel-head">
        <h3 className="kn-deal-panel-title">
          {t("deal.sourcesTitle")} <span className="kn-deal-panel-count">{sources.length}</span>
        </h3>
        {!adding && (
          <button className="kn-btn kn-btn--ghost" onClick={() => setAdding(true)}>
            {t("deal.addSource")}
          </button>
        )}
      </div>

      <p className="kn-deal-panel-hint">
        {t("deal.sourcesHint")}
      </p>

      {adding && (
        <AddSourceForm
          dealId={dealId}
          showToast={showToast}
          onDone={() => {
            setAdding(false);
            onChanged();
          }}
          onCancel={() => setAdding(false)}
        />
      )}

      {sources.length === 0 ? (
        <p className="kn-sidebar-empty">
          {t("deal.sourcesEmpty")}
        </p>
      ) : (
        <ul className="kn-deal-source-list">
          {sources.map((s) => (
            <li key={s.id} className="kn-deal-source">
              <span className="kn-deal-source-emoji">{KIND_EMOJI[s.kind]}</span>
              <div className="kn-deal-source-body">
                <span className="kn-deal-source-name" title={s.name}>
                  {s.name}
                </span>
                <span className="kn-deal-source-meta">
                  {s.kind.toUpperCase()}
                  {s.kind === "url" ? ` · ${s.content}` : ""}
                  {s.added_at ? ` · ${fmtDate(s.added_at)}` : ""}
                </span>
              </div>
              <button
                className="kn-deal-source-del"
                onClick={() => remove(s)}
                title={t("deal.removeSourceTooltip")}
                aria-label={t("deal.removeSourceTooltip")}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// Add-source sub-form: tab between PDF (multi-file) / text / URL.
function AddSourceForm({
  dealId,
  showToast,
  onDone,
  onCancel,
}: {
  dealId: string;
  showToast: (m: string) => void;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [mode, setMode] = useState<SourceKind>("pdf");
  const [files, setFiles] = useState<File[]>([]);
  const [text, setText] = useState("");
  const [textName, setTextName] = useState("");
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const { t } = useT();

  const canAdd =
    !busy &&
    (mode === "pdf"
      ? files.length > 0
      : mode === "text"
        ? text.trim().length > 0
        : url.trim().length > 0);

  const submit = async () => {
    setBusy(true);
    try {
      if (mode === "pdf") {
        // Multi-file: add each PDF as its own source (base64 content).
        for (const f of files) {
          const b64 = await fileToBase64(f);
          await addSource(dealId, "pdf", f.name, b64);
        }
        showToast(files.length === 1 ? t("deal.deckAdded") : t("deal.filesAdded", { n: files.length }));
      } else if (mode === "text") {
        await addSource(dealId, "text", textName.trim() || t("deal.pastedText"), text.trim());
        showToast(t("deal.textAdded"));
      } else {
        const u = url.trim();
        await addSource(dealId, "url", u, u);
        showToast(t("deal.urlAdded"));
      }
      onDone();
    } catch (e) {
      showToast(t("deal.addFailed", { error: String(e) }));
      setBusy(false);
    }
  };

  return (
    <div className="kn-deal-addsource">
      <div className="kn-tabs">
        <button
          className={`kn-tab ${mode === "pdf" ? "kn-tab--active" : ""}`}
          onClick={() => setMode("pdf")}
        >
          PDF
        </button>
        <button
          className={`kn-tab ${mode === "text" ? "kn-tab--active" : ""}`}
          onClick={() => setMode("text")}
        >
          {t("deal.addSourceTextTab")}
        </button>
        <button
          className={`kn-tab ${mode === "url" ? "kn-tab--active" : ""}`}
          onClick={() => setMode("url")}
        >
          URL
        </button>
      </div>

      {mode === "pdf" && (
        <div className="kn-pdf-picker">
          <label className="kn-pdf-picker-label">
            <input
              type="file"
              accept="application/pdf,.pdf"
              multiple
              onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
              style={{ display: "none" }}
            />
            <span className="kn-btn kn-btn--ghost">
              {files.length ? t("deal.addSourceChooseOtherPdfs") : t("deal.addSourceChoosePdfs")}
            </span>
          </label>
          {files.length > 0 ? (
            <span className="kn-pdf-filename">
              {files.map((f) => f.name).join(", ")}
            </span>
          ) : (
            <span className="kn-pdf-hint">
              {t("deal.addSourcePdfHint")}
            </span>
          )}
        </div>
      )}

      {mode === "text" && (
        <>
          <input
            className="kn-input"
            value={textName}
            onChange={(e) => setTextName(e.target.value)}
            placeholder={t("deal.addSourceTextLabelPh")}
          />
          <textarea
            className="kn-input kn-input--textarea"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={t("deal.addSourceTextPh")}
            rows={5}
            spellCheck={false}
          />
        </>
      )}

      {mode === "url" && (
        <input
          type="url"
          className="kn-input"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder={t("source.urlPlaceholder")}
          autoComplete="off"
          spellCheck={false}
        />
      )}

      <div className="kn-form-actions" style={{ marginTop: 12 }}>
        <button className="kn-btn kn-btn--primary" onClick={submit} disabled={!canAdd}>
          {busy ? t("deal.adding") : t("deal.addToReport")}
        </button>
        <button className="kn-btn kn-btn--ghost" onClick={onCancel} disabled={busy}>
          {t("deal.cancel")}
        </button>
      </div>
    </div>
  );
}

// ─── Versions panel ───────────────────────────────────────────────────

function VersionsPanel({
  versions,
  onOpen,
  onNewVersion,
  canGenerate,
}: {
  versions: DealVersion[];
  onOpen: (id: string) => void;
  onNewVersion: () => void;
  canGenerate: boolean;
}) {
  const { t } = useT();
  return (
    <section className="kn-deal-panel">
      <div className="kn-deal-panel-head">
        <h3 className="kn-deal-panel-title">
          {t("deal.versionsTitle")}{" "}
          <span className="kn-deal-panel-count">{versions.length}</span>
        </h3>
        <button
          className="kn-btn kn-btn--primary"
          onClick={onNewVersion}
          disabled={!canGenerate}
          title={
            canGenerate
              ? t("deal.newVersionTip")
              : t("deal.newVersionTipDisabled")
          }
        >
          {t("deal.newVersion")}
        </button>
      </div>

      <p className="kn-deal-panel-hint">
        {t("deal.versionsHint")}
      </p>

      {versions.length === 0 ? (
        <p className="kn-sidebar-empty">
          {t("deal.versionsEmpty")}
        </p>
      ) : (
        <ul className="kn-deal-version-list">
          {versions.map((v) => (
            <li key={v.id} className="kn-deal-version">
              <button
                className="kn-deal-version-main"
                onClick={() => onOpen(v.id)}
                title={t("deal.versionOpenTip", { n: v.seq })}
              >
                <span className="kn-deal-version-seq">v{v.seq}</span>
                <div className="kn-deal-version-body">
                  <span className="kn-deal-version-note">
                    {v.note || `v${v.seq}`}
                  </span>
                  <span className="kn-deal-version-meta">
                    {v.kind === "ic" ? t("deal.kindIc") : t("deal.kindMemo")}
                    {v.provider ? ` · ${providerLabel(v.provider, t)}` : ""}
                    {v.created_at ? ` · ${fmtDate(v.created_at)}` : ""}
                  </span>
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ─── Version viewer (read / edit / export) ────────────────────────────

function VersionViewer({
  version,
  dealName,
  templateOptions,
  firmLogoUrl,
  MarkdownView,
  showToast,
  onBack,
  onSaved,
  onDeleted,
}: {
  version: DealVersion;
  dealName: string;
  templateOptions: { id: string; name: string }[];
  firmLogoUrl: string | null;
  MarkdownView: ComponentType<{ source: string }>;
  showToast: (m: string) => void;
  onBack: () => void;
  onSaved: () => void;
  onDeleted: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(version.content);
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState<null | "pdf" | "docx">(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const { t } = useT();

  // Re-sync the edit buffer if the underlying version changes (e.g. re-opened).
  const versionId = version.id;
  const lastIdRef = useRef(versionId);
  useEffect(() => {
    if (lastIdRef.current !== versionId) {
      lastIdRef.current = versionId;
      setDraft(version.content);
      setEditing(false);
    }
  }, [versionId, version.content]);

  const templateName =
    templateOptions.find((t) => t.id === version.template_id)?.name ?? "";
  const asReport = () => versionAsReport(version, dealName, templateName);

  const handleSave = async () => {
    setSaving(true);
    try {
      await updateVersionContent(version.id, draft);
      showToast(t("deal.versionUpdated"));
      setEditing(false);
      onSaved();
    } catch (e) {
      showToast(t("deal.saveFailed", { error: String(e) }));
    } finally {
      setSaving(false);
    }
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(version.content);
    showToast(t("deal.versionCopied"));
  };

  const handleExportPdf = async () => {
    if (exporting) return;
    setExporting("pdf");
    try {
      const ok = await exportReportToPdf(asReport());
      if (ok) showToast("Opening print dialog — choose “Save as PDF”");
    } catch {
      showToast(t("generate.pdfFailed"));
    } finally {
      setExporting(null);
    }
  };

  const handleExportDocx = async () => {
    if (exporting) return;
    setExporting("docx");
    try {
      const saved = await exportReportToDocx(asReport());
      if (saved) showToast(t("generate.docxSaved"));
    } catch {
      showToast(t("generate.docxFailed"));
    } finally {
      setExporting(null);
    }
  };

  const handleDelete = async () => {
    try {
      await deleteVersion(version.id);
      showToast(t("deal.versionDeleted"));
      onDeleted();
    } catch (e) {
      showToast(t("deal.deleteFailed", { error: String(e) }));
    }
  };

  return (
    <div className="kn-flow">
      <button className="kn-back" onClick={onBack}>
        {t("deal.backToReport")}
      </button>

      <h2 className="kn-flow-title">
        {dealName} · v{version.seq}
      </h2>
      <p className="kn-flow-sub">
        {version.note || `v${version.seq}`}
        {" · "}
        {version.kind === "ic" ? t("common.dealFallbackIc") : t("common.dealFallbackMemo")}
        {version.provider
          ? ` · ${providerLabel(version.provider, t)}`
          : ""}
        {version.created_at ? ` · ${fmtDate(version.created_at)}` : ""}
      </p>

      <div className="kn-form-actions" style={{ marginBottom: 8 }}>
        {editing ? (
          <>
            <button
              className="kn-btn kn-btn--primary"
              onClick={handleSave}
              disabled={saving}
            >
              {saving ? "Saving…" : t("deal.saveChanges")}
            </button>
            <button
              className="kn-btn kn-btn--ghost"
              onClick={() => {
                setDraft(version.content);
                setEditing(false);
              }}
              disabled={saving}
            >
              {t("deal.cancel")}
            </button>
          </>
        ) : (
          <>
            <button className="kn-btn" onClick={() => setEditing(true)}>
              {t("deal.editBtn")}
            </button>
            <button className="kn-btn" onClick={handleCopy}>
              {t("deal.copyBtn")}
            </button>
            <button className="kn-btn" onClick={handleExportPdf} disabled={!!exporting}>
              {exporting === "pdf" ? t("generate.exportingPdf") : t("generate.exportPdf")}
            </button>
            <button className="kn-btn" onClick={handleExportDocx} disabled={!!exporting}>
              {exporting === "docx" ? t("generate.exportingPdf") : t("generate.exportDocx")}
            </button>
            {confirmDelete ? (
              <>
                <button className="kn-btn kn-btn--danger" onClick={handleDelete}>
                  {t("deal.confirmDelete")}
                </button>
                <button
                  className="kn-btn kn-btn--ghost"
                  onClick={() => setConfirmDelete(false)}
                >
                  {t("deal.cancel")}
                </button>
              </>
            ) : (
              <button className="kn-btn" onClick={() => setConfirmDelete(true)}>
                {t("deal.deleteVersion")}
              </button>
            )}
          </>
        )}
      </div>

      {editing ? (
        <div className="kn-result">
          <h3 className="kn-result-title">{t("deal.editMarkdown")}</h3>
          <textarea
            className="kn-prose kn-prose--editable"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            spellCheck={false}
          />
          <h3 className="kn-result-title kn-result-title--secondary">{t("quickMemo.preview")}</h3>
          <div className="kn-markdown">
            <MarkdownView source={draft} />
          </div>
        </div>
      ) : (
        <div className="kn-result" style={{ borderTop: "none", paddingTop: 0 }}>
          <div className="kn-markdown">
            {firmLogoUrl && (
              <img
                src={firmLogoUrl}
                alt=""
                className="kn-tpl-logo-img"
                style={{ marginBottom: 16 }}
              />
            )}
            <MarkdownView source={version.content} />
          </div>
        </div>
      )}
    </div>
  );
}

// ─── New-version modal ────────────────────────────────────────────────

function NewVersionModal({
  deal,
  sourceCount,
  hasPdfSource,
  nextSeq,
  availableProviders,
  activeProvider,
  setActiveProvider,
  templateOptions,
  showToast,
  onClose,
  onGenerated,
}: {
  deal: { id: string };
  sourceCount: number;
  // Whether any of the deal's sources is a PDF — drives the text-only advisory.
  hasPdfSource: boolean;
  nextSeq: number;
  availableProviders: string[];
  // Shared app-level provider (read/write). This modal's usable set is exactly
  // the global `availableProviders`, so the shared value is usable as-is; we
  // clamp defensively to the first usable one if it ever isn't.
  activeProvider: string;
  setActiveProvider: (p: string) => void;
  templateOptions: { id: string; name: string }[];
  showToast: (m: string) => void;
  onClose: () => void;
  onGenerated: (v: DealVersion) => void;
}) {
  const [kind, setKind] = useState<VersionKind>("memo");
  // template_id is free-form on the backend; "" = the built-in scaffold for the
  // chosen kind. Custom templates extend the list.
  const [templateId, setTemplateId] = useState("");
  const cloudFirst =
    availableProviders.find((p) => p !== "local") ?? availableProviders[0] ?? "anthropic";
  // Read the shared provider; fall back to a usable one for THIS run if the
  // global value somehow isn't available here (does not overwrite the global).
  const provider = availableProviders.includes(activeProvider)
    ? activeProvider
    : cloudFirst;
  const setProvider = setActiveProvider;
  const [note, setNote] = useState(`v${nextSeq} · ${sourceCount} sources`);
  const [running, setRunning] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const { t } = useT();

  const generate = async () => {
    setRunning(true);
    setErr(null);
    try {
      const v = await generateVersion({
        dealId: deal.id,
        kind,
        templateId,
        provider,
        note,
      });
      showToast(`Version v${v.seq} generated`);
      onGenerated(v);
    } catch (e) {
      setErr(String(e));
      setRunning(false);
    }
  };

  return (
    <div className="kn-modal-overlay" onClick={running ? undefined : onClose}>
      <div
        className="kn-modal kn-deal-newversion"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={t("newVersion.dialogAria")}
      >
        <h3 className="kn-result-title">{t("newVersion.title")}</h3>
        <p className="kn-flow-sub">
          Re-generates from all {sourceCount} source{sourceCount === 1 ? "" : "s"}{" "}
          in this report. This will be v{nextSeq}.
        </p>

        <div className="kn-flow-row">
          <label className="kn-label">
            {t("newVersion.kindLabel")}
            <select
              className="kn-input kn-input--select"
              value={kind}
              onChange={(e) => setKind(e.target.value as VersionKind)}
              disabled={running}
            >
              <option value="memo">{t("newVersion.kindMemoOpt")}</option>
              <option value="ic">{t("newVersion.kindIcOpt")}</option>
            </select>
          </label>

          <label className="kn-label">
            {t("quickMemo.templateLabel")}
            <select
              className="kn-input kn-input--select"
              value={templateId}
              onChange={(e) => setTemplateId(e.target.value)}
              disabled={running}
            >
              <option value="">
                {t("newVersion.templateBuiltIn", {
                  kind: kind === "ic" ? t("newVersion.templateBuiltInIc") : t("newVersion.templateBuiltInMemo"),
                })}
              </option>
              {templateOptions.map((tpl) => (
                <option key={tpl.id} value={tpl.id}>
                  {tpl.name}
                </option>
              ))}
            </select>
          </label>

          <label className="kn-label">
            {t("provider.runWith")}
            <select
              className="kn-input kn-input--select"
              value={provider}
              onChange={(e) => setProvider(e.target.value)}
              disabled={running}
            >
              {availableProviders.length === 0 ? (
                <option value="">{t("newVersion.noProviderOpt")}</option>
              ) : (
                availableProviders.map((p) => (
                  <option key={p} value={p}>
                    {providerLabel(p, t)}
                  </option>
                ))
              )}
            </select>
          </label>
        </div>

        {hasPdfSource && isTextOnlyProvider(provider) && (
          <div className="kn-advisory" role="status">
            {t("common.textOnlyPdfWarning")}
          </div>
        )}

        <label className="kn-label kn-label--grow">
          {t("newVersion.noteLabel")}
          <input
            className="kn-input"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder='e.g. "from deck" or "+ data room"'
            disabled={running}
          />
        </label>

        {running && (
          <div className="kn-gen-progress">
            <div className="kn-gen-step kn-gen-step--run">
              <span className="kn-gen-dot" />
              {kind === "ic"
                ? t("newVersion.progressIc")
                : t("newVersion.progressMemo")}
              <span className="kn-gen-run"> {t("newVersion.progressSuffix")}</span>
            </div>
          </div>
        )}

        {err && (
          <div className="kn-form-feedback kn-form-feedback--err">✗ {err}</div>
        )}

        <div className="kn-form-actions" style={{ marginTop: 14 }}>
          <button
            className="kn-btn kn-btn--primary"
            onClick={generate}
            disabled={running || availableProviders.length === 0}
          >
            {running ? t("newVersion.generating") : t("newVersion.generate")}
          </button>
          <button className="kn-btn kn-btn--ghost" onClick={onClose} disabled={running}>
            {t("deal.cancel")}
          </button>
        </div>
      </div>
    </div>
  );
}
