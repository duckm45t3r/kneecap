import { invoke } from "@tauri-apps/api/core";

// Saved-report persistence (P1). Reports are written to the Tauri filesystem
// (`{app_data_dir}/reports/<id>.json`) via hand-rolled #[tauri::command]
// functions — NOT localStorage, so a generated report survives navigation and
// app restarts. The frontend owns the JSON schema below; the Rust side treats
// each file as an opaque string, so adding a field here never touches Rust.

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

// The backend sanitiser only accepts [A-Za-z0-9_-]; crypto.randomUUID() emits
// hyphenated hex which is already in-range. Fall back to timestamp+counter on
// the off chance randomUUID is unavailable in the webview runtime.
let idCounter = 0;
export function newReportId(): string {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return `rpt-${crypto.randomUUID()}`;
    }
  } catch {
    /* fall through */
  }
  idCounter += 1;
  return `rpt-${Date.now().toString(36)}-${idCounter.toString(36)}`;
}

/**
 * Tolerant parse of one stored report. A corrupt / hand-edited file shouldn't
 * crash the whole list — we return null and the caller filters it out.
 */
function parseReport(raw: string): SavedReport | null {
  try {
    const obj = JSON.parse(raw) as Partial<SavedReport>;
    if (
      obj &&
      typeof obj.id === "string" &&
      typeof obj.title === "string" &&
      typeof obj.markdown === "string"
    ) {
      return {
        id: obj.id,
        title: obj.title,
        templateId: typeof obj.templateId === "string" ? obj.templateId : "",
        templateName: typeof obj.templateName === "string" ? obj.templateName : "",
        provider: typeof obj.provider === "string" ? obj.provider : "",
        createdAt: typeof obj.createdAt === "number" ? obj.createdAt : 0,
        markdown: obj.markdown,
        blocks:
          obj.blocks && typeof obj.blocks === "object"
            ? (obj.blocks as Record<string, string>)
            : undefined,
      };
    }
  } catch {
    /* fall through */
  }
  return null;
}

/** List all saved reports, newest first. */
export async function listReports(): Promise<SavedReport[]> {
  const rows = (await invoke<string[]>("list_reports")) ?? [];
  return rows
    .map(parseReport)
    .filter((r): r is SavedReport => r !== null)
    .sort((a, b) => b.createdAt - a.createdAt);
}

/** Load one saved report by id, or null if missing / unparseable. */
export async function getReport(id: string): Promise<SavedReport | null> {
  try {
    const raw = await invoke<string>("load_report", { id });
    return parseReport(raw);
  } catch {
    return null;
  }
}

/** Persist a report (create or overwrite by id). */
export async function saveReport(report: SavedReport): Promise<void> {
  await invoke("save_report", { id: report.id, json: JSON.stringify(report) });
}

/** Delete a report by id (a missing file is a no-op success backend-side). */
export async function deleteReport(id: string): Promise<void> {
  await invoke("delete_report", { id });
}
