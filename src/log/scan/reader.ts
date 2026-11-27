import { addDays } from "../../app-kit/time.ts";
import type { EntryStore } from "../store.ts";
import { CARRY_WINDOW_DAYS } from "./carry.ts";
import type { TraceStore } from "../trace.ts";
import type { SlotReader } from "./plan.ts";

/** Reads the entries and traces of a slot from the stores, once per slot for the life of the reader (one request). */
export function storeReader(store: EntryStore, traces: TraceStore, userId: string): SlotReader {
  const entries = new Map<string, ReturnType<SlotReader["entries"]>>();
  const traceLists = new Map<string, ReturnType<SlotReader["traces"]>>();
  const earlier = new Map<string, ReturnType<SlotReader["entries"]>>();
  return {
    earlier(date) {
      if (!earlier.has(date)) earlier.set(date, store.listScan(userId, { from: addDays(date, -CARRY_WINDOW_DAYS), to: addDays(date, -1) }));
      return earlier.get(date)!;
    },
    entries(slot) {
      const key = `${slot.horizon}|${slot.date}`;
      if (!entries.has(key)) entries.set(key, store.listScan(userId, { from: slot.date, to: slot.date }, slot.horizon));
      return entries.get(key)!;
    },
    traces(slot) {
      const key = `${slot.horizon}|${slot.date}`;
      if (!traceLists.has(key)) traceLists.set(key, traces.list(userId, { from: slot.date, to: slot.date }).filter((trace) => trace.horizon === slot.horizon));
      return traceLists.get(key)!;
    },
  };
}
