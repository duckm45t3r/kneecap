// Report shape (P1 legacy → superseded by deals/SQLite).
//
// The old flat-file report store (save_report / list_reports / load_report /
// delete_report on the Rust side, writing {app_data_dir}/reports/<id>.json) was
// retired once a saved report became a DEAL with version history in SQLite. The
// runtime read/write functions are gone; what remains is the `SavedReport`
// *shape*, which is still the lingua franca for two live paths:
//   - dealStore.versionAsReport adapts a DealVersion into this shape, and
//   - reports/exportReport.ts (PDF / DOCX export) consumes it.
// The Rust one-time legacy migration (run_legacy_migration in lib.rs) still
// reads the old reports/*.json files directly to import them as deals — it owns
// its own deserialiser and does NOT depend on anything in this file.

export type SavedReport = {
  id: string;
  title: string;
  templateId: string;
  templateName: string;
  provider: string;
  createdAt: number; // epoch ms
  markdown: string;
  // Optional per-block raw output, keyed by block id, so a future editor can
  // re-render block-by-block. The compiled `markdown` is the source of truth
  // for the read-only viewer.
  blocks?: Record<string, string>;
};
