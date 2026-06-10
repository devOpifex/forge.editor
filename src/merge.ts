import { unifiedMergeView } from "@codemirror/merge";

/** Payload reported once a programmatic merge is fully resolved. */
export interface MergeResolveEvent {
  /** The final merged document. */
  code: string;
  /** Number of chunks the user (or accept-all) accepted. */
  accepted: number;
  /** Number of chunks the user (or reject-all) reverted. */
  rejected: number;
}

/**
 * Build the unified merge view extension diffing the live document (the "new"
 * side) against `original` (the base). Inline per-chunk Accept/Reject controls
 * are disabled — resolution is all-or-nothing via the editor's
 * `acceptAllChanges()` / `rejectAllChanges()` API.
 */
export function buildUnifiedMerge(original: string) {
  return unifiedMergeView({ original, mergeControls: false, gutter: true });
}
