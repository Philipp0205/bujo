/**
 * Known OCR misreadings, corrected before a scanned line is matched against the backlog.
 * Keys and values are normalised words (lowercase, no punctuation, umlauts as ae oe ue ss).
 * Handwritten "Task" comes out of the OCR as "Tush", "Tash" or "Tosh". To teach it a new one, add a line.
 */
export const CORRECTIONS: Readonly<Record<string, string>> = {
  tush: "task",
  tash: "task",
  tosh: "task",
};
