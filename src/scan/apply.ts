import { completeTask, createTask, getTask, guard, SUMMARY_MAX, updateTask, type Raw } from "../api/tasks.ts";
import { HttpError } from "../app-kit/http.ts";
import { isIsoDate } from "../caldav/ics.ts";
import type { TaskSource } from "../caldav/source.ts";
import { actionFor, type Action, type ApplyResult, type Draft } from "./draft.ts";
import { OCR_SYMBOLS, type OcrSymbol } from "./ocr-client.ts";

/**
 * Applies the accepted items of a draft through the same task functions /api/v1 uses (src/api/tasks.ts),
 * so every write follows the CalDAV write rules: a fresh UID with If-None-Match, If-Match on edits,
 * unknown properties kept, a read back after the write. There is no delete here, and nothing can become one.
 *
 * The whole request is checked first. If one item is not valid, nothing is written and the draft stays open.
 * Writes then run one by one. The first failure stops the run: items after it are reported as not tried.
 * Nothing is retried. A draft can be applied once.
 */

export type AcceptedItem = {
  id: string;
  symbol: OcrSymbol;
  action: Action;
  text: string;
  list: string;
  match: { list: string; uid: string } | null;
  due: string | null;
};

const CONTROL_LINE = /[\u0000-\u001f\u007f\u2028\u2029]/;
const ITEM_KEYS = ["id", "symbol", "action", "text", "list", "match", "due", "include"];

function bad(message: string): never {
  throw new HttpError(400, message);
}

function parseItem(raw: unknown, index: number, source: TaskSource, draft: Draft): AcceptedItem {
  const at = `items[${index}]`;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) bad(`${at} must be an object`);
  const item = raw as Raw;
  for (const key of Object.keys(item)) if (!ITEM_KEYS.includes(key)) bad(`${at}: unknown field ${key.slice(0, 40)}`);

  if (typeof item.id !== "string" || !draft.items.some((entry) => entry.id === item.id)) bad(`${at}: unknown item id`);
  const symbol = item.symbol;
  if (typeof symbol !== "string" || !(OCR_SYMBOLS as readonly string[]).includes(symbol)) bad(`${at}: symbol must be one of • x > < ○ – none`);

  let match: AcceptedItem["match"] = null;
  if (item.match !== undefined && item.match !== null) {
    const m = item.match as Raw;
    if (typeof m !== "object" || Array.isArray(m) || typeof m.uid !== "string" || m.uid === "" || typeof m.list !== "string") {
      bad(`${at}: match must be { list, uid } or null`);
    }
    if (!source.listNames.includes(m.list as string)) bad(`${at}: match has an unknown list`);
    match = { list: m.list as string, uid: m.uid as string };
  }

  const action = actionFor(symbol as OcrSymbol, match !== null);
  if (item.action !== undefined && item.action !== action) {
    bad(`${at}: action ${String(item.action).slice(0, 20)} does not fit symbol ${symbol}${match ? " with a match" : " without a match"}`);
  }
  if (action === "ignore") bad(`${at}: a ${symbol} line is never synced`);
  if (action === "complete" && !match) bad(`${at}: choose the task to mark done`);

  const list = item.list === undefined ? draft.defaultList : item.list;
  if (typeof list !== "string" || !source.listNames.includes(list)) bad(`${at}: unknown list`);

  let text = "";
  if (action === "create" || (action === "schedule" && !match)) {
    if (typeof item.text !== "string") bad(`${at}: text is required`);
    text = (item.text as string).trim();
    if (text === "") bad(`${at}: text must not be empty`);
    if (text.length > SUMMARY_MAX) bad(`${at}: text is too long (at most ${SUMMARY_MAX} characters)`);
    if (CONTROL_LINE.test(text)) bad(`${at}: text must be a single line of plain text`);
  }

  let due: string | null = null;
  if (action === "schedule") {
    if (typeof item.due !== "string" || !isIsoDate(item.due)) bad(`${at}: a scheduled line needs a due date (YYYY-MM-DD)`);
    due = item.due as string;
  }

  return { id: item.id as string, symbol: symbol as OcrSymbol, action, text, list: list as string, match, due };
}

export function parseAccepted(body: Raw, source: TaskSource, draft: Draft): AcceptedItem[] {
  for (const key of Object.keys(body)) if (key !== "items") bad(`unknown field: ${key.slice(0, 40)}`);
  if (!Array.isArray(body.items)) bad("items must be an array");
  const raw = body.items as unknown[];
  if (raw.length === 0) bad("nothing to apply: accept at least one line");
  if (raw.length > 200) bad("too many items");
  const seen = new Set<string>();
  return raw.map((entry, index) => {
    const item = parseItem(entry, index, source, draft);
    if (seen.has(item.id)) bad(`items[${index}]: ${item.id} was sent twice`);
    seen.add(item.id);
    return item;
  });
}

function messageOf(error: unknown): string {
  if (error instanceof HttpError) return error.message;
  console.error("scan apply failed:", error instanceof Error ? error.name : "error");
  return "Writing this item failed.";
}

async function applyOne(source: TaskSource, item: AcceptedItem): Promise<ApplyResult> {
  switch (item.action) {
    case "create": {
      const { task } = await createTask(source, { list: item.list, summary: item.text });
      return { id: item.id, ok: true, status: "written", action: item.action, task };
    }
    case "keep": {
      // Nothing to write. The match is read, so a task that has gone away is reported, not hidden.
      const { task } = await getTask(source, item.match!.list, item.match!.uid);
      return { id: item.id, ok: true, status: "kept", action: item.action, task };
    }
    case "complete": {
      const { task } = await completeTask(source, item.match!.list, item.match!.uid);
      return { id: item.id, ok: true, status: "written", action: item.action, task };
    }
    case "schedule": {
      if (item.match) {
        const { task } = await updateTask(source, item.match.list, item.match.uid, { due: item.due });
        return { id: item.id, ok: true, status: "written", action: item.action, task };
      }
      const { task } = await createTask(source, { list: item.list, summary: item.text, due: item.due });
      return { id: item.id, ok: true, status: "written", action: item.action, task };
    }
    default:
      throw new HttpError(400, "this line is never synced");
  }
}

/**
 * Checks the request, then writes. Throws HttpError 409 for a draft that was applied already and 400 for a bad
 * request, both before any write. After that it always returns: failures are in the results.
 */
export async function applyDraft(source: TaskSource, draft: Draft, body: Raw): Promise<Draft> {
  if (draft.applied) throw new HttpError(409, "This scan was already applied.");
  const accepted = parseAccepted(body, source, draft);
  // Marked before the first write: a second request while this one runs, or after a failure, is a 409.
  draft.applied = true;

  const results: ApplyResult[] = [];
  let failed = false;
  for (const item of accepted) {
    if (failed) {
      results.push({ id: item.id, ok: false, status: "skipped", action: item.action, error: "Not tried: an earlier item failed." });
      continue;
    }
    try {
      results.push(await guard(() => applyOne(source, item)));
    } catch (error) {
      failed = true;
      results.push({ id: item.id, ok: false, status: "failed", action: item.action, error: messageOf(error) });
    }
  }
  draft.results = results;
  return draft;
}
