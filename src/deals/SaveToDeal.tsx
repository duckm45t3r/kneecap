import { useEffect, useState } from "react";
import {
  listDeals,
  createDeal,
  addSource,
  createVersionFromContent,
  type DealListRow,
  type SourceKind,
  type VersionKind,
} from "./dealStore";

// ─── Save to deal (entry from the one-shot generate flows) ────────────
//
// When a Quick Memo / Full IC / template run finishes, the user can fold the
// result into a DEAL — either a brand-new deal (seeded with this run's source as
// the deal's first source + the result captured as v1) or an existing one (the
// source is appended and the result becomes the next version). Both paths reuse
// the already-generated markdown, so no second LLM call is made.

// The source the result was generated from, described enough to re-attach it to
// a deal. content is base64 for pdf, the URL for url, the pasted text for text.
export type RunSource = {
  kind: SourceKind;
  name: string;
  content: string;
};

export function SaveToDealModal({
  result,
  kind,
  provider,
  templateId,
  source,
  suggestedName,
  showToast,
  onClose,
  onSaved,
}: {
  result: string; // the generated markdown
  kind: VersionKind;
  provider: string;
  templateId: string;
  // The run's source. Optional — if the flow can't describe its source (rare),
  // the deal is still created with just the version captured.
  source: RunSource | null;
  // A sensible default deal name (e.g. derived from the first heading).
  suggestedName: string;
  showToast: (m: string) => void;
  onClose: () => void;
  // Called with the saved deal id so the caller can jump to it.
  onSaved: (dealId: string) => void;
}) {
  const [target, setTarget] = useState<"new" | "existing">("new");
  const [deals, setDeals] = useState<DealListRow[]>([]);
  const [newName, setNewName] = useState(suggestedName);
  const [existingId, setExistingId] = useState<string>("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    listDeals()
      .then((rows) => {
        setDeals(rows);
        if (rows.length > 0) setExistingId(rows[0].deal.id);
        // If there are no deals yet, force the "new" path.
        if (rows.length === 0) setTarget("new");
      })
      .catch(() => setDeals([]));
  }, []);

  const canSave =
    !busy &&
    (target === "new" ? newName.trim().length > 0 : existingId.length > 0);

  const save = async () => {
    setBusy(true);
    setErr(null);
    try {
      let dealId: string;
      if (target === "new") {
        const deal = await createDeal(newName.trim());
        dealId = deal.id;
      } else {
        dealId = existingId;
      }

      // Attach the run's source (so a later "New version" re-uses it).
      if (source) {
        await addSource(dealId, source.kind, source.name, source.content);
      }

      // Capture the already-generated result as the next version.
      const defaultNote =
        target === "new" ? "from deck" : "+ added source";
      await createVersionFromContent({
        dealId,
        kind,
        templateId,
        provider,
        content: result,
        note: note.trim() || defaultNote,
      });

      showToast(target === "new" ? "Saved as a new deal" : "Added to deal");
      onSaved(dealId);
    } catch (e) {
      setErr(String(e));
      setBusy(false);
    }
  };

  return (
    <div className="kn-modal-overlay" onClick={busy ? undefined : onClose}>
      <div
        className="kn-modal kn-savedeal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Save to deal"
      >
        <h3 className="kn-result-title">Save to deal</h3>
        <p className="kn-flow-sub">
          Fold this {kind === "ic" ? "IC report" : "memo"} into a deal so it can
          evolve as you gather more — a data room, supplements, a second deck.
        </p>

        <div className="kn-tabs" style={{ marginBottom: 12 }}>
          <button
            className={`kn-tab ${target === "new" ? "kn-tab--active" : ""}`}
            onClick={() => setTarget("new")}
            disabled={busy}
          >
            New deal
          </button>
          <button
            className={`kn-tab ${target === "existing" ? "kn-tab--active" : ""}`}
            onClick={() => setTarget("existing")}
            disabled={busy || deals.length === 0}
            title={deals.length === 0 ? "No deals yet" : "Add to an existing deal"}
          >
            Existing deal
          </button>
        </div>

        {target === "new" ? (
          <label className="kn-label kn-label--grow">
            Deal name
            <input
              className="kn-input"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="e.g. Acme Robotics — Seed"
              disabled={busy}
              autoFocus
            />
          </label>
        ) : (
          <label className="kn-label kn-label--grow">
            Add to
            <select
              className="kn-input kn-input--select"
              value={existingId}
              onChange={(e) => setExistingId(e.target.value)}
              disabled={busy}
            >
              {deals.map((d) => (
                <option key={d.deal.id} value={d.deal.id}>
                  {d.deal.name} (v{d.latest_seq} · {d.source_count} sources)
                </option>
              ))}
            </select>
          </label>
        )}

        {source ? (
          <p className="kn-deal-panel-hint">
            The source ({source.kind.toUpperCase()} · {source.name}) is attached
            to the deal too, so a later “New version” regenerates from it.
          </p>
        ) : (
          <p className="kn-deal-panel-hint">
            Heads up — this run's source couldn't be captured, so the version is
            saved without an attached source. Add one from the deal view to
            regenerate later.
          </p>
        )}

        <label className="kn-label kn-label--grow">
          Version note (optional)
          <input
            className="kn-input"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={target === "new" ? "from deck" : "+ added source"}
            disabled={busy}
          />
        </label>

        {err && (
          <div className="kn-form-feedback kn-form-feedback--err">✗ {err}</div>
        )}

        <div className="kn-form-actions" style={{ marginTop: 14 }}>
          <button
            className="kn-btn kn-btn--primary"
            onClick={save}
            disabled={!canSave}
          >
            {busy ? "Saving…" : target === "new" ? "Create deal" : "Add to deal"}
          </button>
          <button className="kn-btn kn-btn--ghost" onClick={onClose} disabled={busy}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
