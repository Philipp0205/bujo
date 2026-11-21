import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

/** The kit's pure helpers, as the browser gets them. */
type WhatsNewKit = {
  validId(id: unknown): boolean;
  normalizeEntries(raw: unknown): Array<{ id: string }>;
  latestId(entries: Array<{ id: string }>): string | null;
};

export type WhatsNewCatalog = {
  /** True for an id the kit accepts: 1 to 64 characters of a-z, 0-9 and "-". */
  isValidId(id: unknown): id is string;
  /** The id of the newest entry in public/whats-new.json, or null when the file is missing, broken or empty. */
  latestId(): string | null;
};

/** Runs the vendored ak-whats-new.js in a bare context, so the server applies the same rules as the page and copies none. */
function loadKit(publicDir: string): WhatsNewKit {
  const source = fs.readFileSync(path.join(publicDir, "app-kit", "ak-whats-new.js"), "utf8");
  const sandbox: { window: { AppKit?: { whatsNew?: WhatsNewKit } } } = { window: {} };
  vm.runInNewContext(source, sandbox);
  const kit = sandbox.window.AppKit?.whatsNew;
  if (!kit) throw new Error("ak-whats-new.js did not define AppKit.whatsNew");
  return kit;
}

/** The catalog the server shares with the page: the same kit rules and the same whats-new.json file. */
export function createCatalog(publicDir: string): WhatsNewCatalog {
  const kit = loadKit(publicDir);
  return {
    isValidId: (id): id is string => kit.validId(id),
    latestId() {
      try {
        const raw: unknown = JSON.parse(fs.readFileSync(path.join(publicDir, "whats-new.json"), "utf8"));
        return kit.latestId(kit.normalizeEntries(raw));
      } catch {
        return null;
      }
    },
  };
}
