import { invoke } from "@tauri-apps/api/core";
import type { SavedReport } from "../reports/reportStore";

// Deals + version history (W4/W5). A saved "report" becomes a DEAL that evolves:
// v1 from the deck, v2 + data room, v3 + supplements. Persistence lives in
// SQLite ({app_data_dir}/kneecap.db) behind hand-rolled #[tauri::command] fns
// (deal_create / deal_list / deal_get / … / deal_generate_version).
//
// The Rust structs derive Serialize with NO rename, so every field comes across
// in snake_case — these TS types mirror that exactly (deal_id, created_at, …).
// Treat them as the wire shape; don't camelCase them.

export type DealStatus = "active" | string;

export type Deal = {
  id: string;
  name: string;
  status: DealStatus;
  created_at: string; // ISO-8601
  updated_at: string; // ISO-8601
};

export type SourceKind = "pdf" | "text" | "url";

export type DealSource = {
  id: string;
  deal_id: string;
  kind: SourceKind;
  // For pdf this is base64; for url it's the URL; for text it's the pasted text.
  name: string;
  content: string;
  added_at: string;
};

export type VersionKind = "memo" | "ic";

export type DealVersion = {
  id: string;
  deal_id: string;
  seq: number;
  kind: VersionKind;
  template_id: string;
  provider: string;
  content: string; // generated markdown
  note: string; // "from deck" | "+ data room" | "v2 · 3 sources"
  source_ids: string; // JSON array string of the source ids used
  created_at: string;
};

// What deal_list returns per deal — the deal plus rolled-up counts so the
// sidebar can show "v3 · 5 sources" without a second round-trip.
export type DealListRow = {
  deal: Deal;
  latest_seq: number;
  version_count: number;
  source_count: number;
  updated_at: string;
};

// What deal_get returns: the deal, its versions (newest seq first), its sources.
export type DealDetail = {
  deal: Deal;
  versions: DealVersion[];
  sources: DealSource[];
};

// ─── Deal CRUD ───────────────────────────────────────────────────────

export async function listDeals(): Promise<DealListRow[]> {
  return (await invoke<DealListRow[]>("deal_list")) ?? [];
}

export async function getDeal(id: string): Promise<DealDetail> {
  return await invoke<DealDetail>("deal_get", { id });
}

export async function createDeal(name: string): Promise<Deal> {
  return await invoke<Deal>("deal_create", { name });
}

export async function renameDeal(id: string, name: string): Promise<void> {
  await invoke("deal_rename", { id, name });
}

export async function deleteDeal(id: string): Promise<void> {
  await invoke("deal_delete", { id });
}

// ─── Sources ─────────────────────────────────────────────────────────

export async function addSource(
  dealId: string,
  kind: SourceKind,
  name: string,
  content: string,
): Promise<DealSource> {
  return await invoke<DealSource>("deal_add_source", {
    dealId,
    kind,
    name,
    content,
  });
}

export async function removeSource(sourceId: string): Promise<void> {
  await invoke("deal_remove_source", { sourceId });
}

// ─── Versions ────────────────────────────────────────────────────────

export async function getVersion(id: string): Promise<DealVersion> {
  return await invoke<DealVersion>("version_get", { id });
}

export async function updateVersionContent(
  versionId: string,
  content: string,
): Promise<void> {
  await invoke("version_update_content", { versionId, content });
}

export async function deleteVersion(versionId: string): Promise<void> {
  await invoke("deal_delete_version", { versionId });
}

// Persist an ALREADY-generated memo/IC as a version (no LLM call). This is the
// "Save to deal" entry from the one-shot flows — the result is in hand, so we
// capture it as v1 (or the next seq) without paying to re-generate.
export async function createVersionFromContent(args: {
  dealId: string;
  kind: VersionKind;
  templateId: string;
  provider: string;
  content: string;
  note?: string;
}): Promise<DealVersion> {
  return await invoke<DealVersion>("version_create", {
    dealId: args.dealId,
    kind: args.kind,
    templateId: args.templateId,
    provider: args.provider,
    content: args.content,
    note: args.note?.trim() ? args.note.trim() : null,
  });
}

// The headline command: build a NEW version from ALL the deal's accumulated
// sources (full re-generate, not a delta). May be a multi-section IC and take a
// while — callers should show progress. `note` auto-fills server-side when
// omitted ("v{n} · {sourceCount} sources").
export async function generateVersion(args: {
  dealId: string;
  kind: VersionKind;
  templateId: string;
  provider: string;
  note?: string;
}): Promise<DealVersion> {
  return await invoke<DealVersion>("deal_generate_version", {
    dealId: args.dealId,
    kind: args.kind,
    templateId: args.templateId,
    provider: args.provider,
    note: args.note?.trim() ? args.note.trim() : null,
  });
}

// ─── Export adapter ──────────────────────────────────────────────────
//
// The PDF/DOCX export path (reports/exportReport.ts) and the read-only viewer's
// logo render path both speak SavedReport. A version IS a report at heart, so we
// adapt one into the SavedReport shape to reuse those without forking them.
export function versionAsReport(
  version: DealVersion,
  dealName: string,
  templateName: string,
): SavedReport {
  return {
    id: version.id,
    title: `${dealName} · v${version.seq}`,
    templateId: version.template_id,
    templateName: templateName || (version.kind === "ic" ? "IC report" : "Memo"),
    provider: version.provider,
    createdAt: Date.parse(version.created_at) || Date.now(),
    markdown: version.content,
  };
}

// Parse the stored source_ids JSON array; tolerant of a malformed value.
export function parseSourceIds(raw: string): string[] {
  try {
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}
