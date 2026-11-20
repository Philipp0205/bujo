// Every message the sync can put on an entry. They are shown in the entry sheet, so they are short,
// plain, and never hold a URL, a path or a credential.

export const SYNC_MESSAGES = {
  conflict: "Nextcloud changed this task at the same moment. Nothing was overwritten. Retry sync to try again.",
  readBackMismatch: "Nextcloud did not keep what was sent (title, status or due date differ).",
  gone: "This task is no longer in Nextcloud. It was not created again.",
  unreachable: "Nextcloud did not answer.",
  refused: "Nextcloud refused the sign-in. Check the CalDAV user and password.",
  unexpected: "The sync failed unexpectedly.",
  interrupted: "The sync was interrupted. Retry sync.",
  retryNotNeeded: "Only an entry with a failed sync can be retried.",
  notSetUp: "Sync to Nextcloud is not set up.",
} as const;

/** The list named for sync is not one of the configured lists. */
export const unknownListMessage = (name: string) => `The sync list "${name}" is not set up.`;

/** The hard guard refused a write to a live list. */
export const liveListMessage = (name: string) =>
  `Writes to the live list "${name}" are switched off. Nothing was written.`;

/** Nextcloud answered with a status the sync does not handle. */
export const statusMessage = (status: number) => `Nextcloud answered ${status}.`;

/** The reasons a read-back can differ, for the server log (never shown). */
export const mismatchReason = (field: string) => `read-back differs in ${field}`;
