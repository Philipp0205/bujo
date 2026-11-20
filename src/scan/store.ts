import type { Draft } from "./draft.ts";

/** Drafts live 24 hours and only in memory. At most a few are kept: the oldest goes when a new one does not fit. */
export const DRAFT_TTL_MS = 24 * 60 * 60 * 1000;
export const DRAFT_MAX = 5;

/** What the store needs of a draft. The backlog scan and the rapid-log scan each keep their own kind. */
type Stored = { id: string; expires: number };

export type DraftStore<T extends Stored = Draft> = {
  add(draft: T): void;
  get(id: string): T | undefined;
  size(): number;
};

export function createDraftStore<T extends Stored = Draft>(options: { now?: () => number; max?: number } = {}): DraftStore<T> {
  const now = options.now ?? Date.now;
  const max = options.max ?? DRAFT_MAX;
  const drafts = new Map<string, T>();

  function prune(): void {
    const t = now();
    for (const [id, draft] of drafts) if (draft.expires <= t) drafts.delete(id);
  }

  return {
    add(draft) {
      prune();
      drafts.set(draft.id, draft);
      // A Map keeps insertion order, so the first key is the oldest.
      while (drafts.size > max) drafts.delete(drafts.keys().next().value as string);
    },
    get(id) {
      prune();
      return drafts.get(id);
    },
    size() {
      prune();
      return drafts.size;
    },
  };
}
