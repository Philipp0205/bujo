import { HttpError, readJson, sendJson } from "../app-kit/http.ts";
import { applyCollect, checkCollectTarget, planCollect } from "../log/collect.ts";
import type { EntryStore } from "../log/store.ts";
import type { Entry } from "../log/types.ts";
import { syncKind } from "../sync/mapping.ts";
import { SYNC_MESSAGES } from "../sync/strings.ts";
import type { RouteContext } from "./context.ts";

/**
 * Makes sure Nextcloud no longer shows a task that is leaving the log as open: the entry is set to dropped and pushed, which writes
 * STATUS:CANCELLED on its VTODO (nothing is ever deleted there). An entry that was never pushed has nothing to cancel. An event
 * stays in the calendar, so it is refused. A push that does not end synced stops the move, with the entry left as dropped to retry.
 */
async function cancelRemote(ctx: RouteContext, store: EntryStore, userId: string, entry: Entry): Promise<void> {
  if (!store.getRemote(userId, entry.id)) return;
  if (syncKind(entry.type) === "event") throw new HttpError(409, SYNC_MESSAGES.eventStays);
  if (!ctx.sync) throw new HttpError(503, SYNC_MESSAGES.notSetUp);
  const dropped = store.update(userId, entry.id, { type: "dropped" }, ctx.accounts.now()) ?? entry;
  ctx.sync.enqueue(userId, dropped);
  await ctx.sync.idle();
  if (store.get(userId, entry.id)?.sync !== "synced") throw new HttpError(502, SYNC_MESSAGES.cancelFailed);
}

/**
 * POST /api/entries/:id/collect { collectionId } or { title, date }: files the entry as a "- title" line at the end of a collection
 * (a new one for a title and day), leaves a collected trace on its old page and removes it from the log. Answers { collection }.
 * A task that lives in Nextcloud is cancelled there first. The whole body must stay within BODY_MAX, else a 400.
 */
export async function handleCollect(ctx: RouteContext, store: EntryStore, userId: string, id: string): Promise<boolean> {
  if (ctx.method !== "POST") throw new HttpError(405, "method not allowed (use POST)");
  const target = checkCollectTarget(await readJson(ctx.req));
  if (!target.ok) throw new HttpError(400, target.error);
  const plan = planCollect(ctx.accounts.db, userId, id, target.value);
  if ("error" in plan) throw new HttpError(plan.status, plan.error);
  await cancelRemote(ctx, store, userId, plan.entry);
  sendJson(ctx.res, 200, { collection: applyCollect(ctx.accounts.db, userId, plan, ctx.accounts.now()) });
  return true;
}
