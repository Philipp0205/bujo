import http from "node:http";
import path from "node:path";
import { installGracefulShutdown } from "./app-kit/shutdown.ts";
import { createMailer } from "./accounts/mail.ts";
import { createApp } from "./app.ts";
import { loadCalDavConfig } from "./caldav/config.ts";
import { caldavSource, demoSource } from "./caldav/source.ts";
import { openDb } from "./db.ts";
import { loadSyncConfig } from "./sync/config.ts";
import { createSyncService, failInterrupted } from "./sync/service.ts";
import { eventsStartupText } from "./sync/startup.ts";

const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || "127.0.0.1";
const origin = (process.env.BUJO_ORIGIN || `http://localhost:${port}`).replace(/\/+$/, "");
const dbFile = process.env.BUJO_DB || "data/bujo.db";
const trustProxy = process.env.BUJO_TRUST_PROXY === "1" || process.env.BUJO_TRUST_PROXY === "true";
// Page photos are files next to the database (on the /data volume on Railway). An in-memory database has no such place.
const photoDir = dbFile === ":memory:" ? undefined : path.join(path.dirname(path.resolve(dbFile)), "page-photos");

const config = loadCalDavConfig();
const source = config ? caldavSource(config) : demoSource();
const db = openDb(dbFile);
const syncConfig = loadSyncConfig();
// Without CalDAV there is no sync: task entries stay local. A push cut short by a stop is left as an error to retry.
const sync = config ? createSyncService({ db, caldav: config, sync: syncConfig }) : undefined;
failInterrupted(db);

const server = http.createServer(createApp({ source, db, origin, mailer: createMailer(), trustProxy, sync, photoDir }));

server.listen(port, host, () => {
  console.log("bujo");
  console.log(`  listening   http://${host}:${port}`);
  console.log(`  origin      ${origin}`);
  console.log(`  database    ${dbFile}`);
  if (config) console.log(`  tasks       CalDAV, lists: ${source.listNames.join(", ")}`);
  else console.log("  tasks       demo data (set BUJO_CALDAV_BASE and BUJO_CALDAV_LISTS to use CalDAV)");
  if (config) console.log(`  sync        task entries to list "${syncConfig.listName}"${syncConfig.live ? " (live writes on)" : ""}`);
  else console.log("  sync        off (task entries stay local)");
  console.log(`  events      ${eventsStartupText(config, syncConfig)}`);
  if (process.env.OCR_URL) console.log(`  ocr         ${process.env.OCR_URL}`);
  else console.log("  ocr         off (set OCR_URL to use the evening scan)");
});

installGracefulShutdown({ server, onClose: () => db.close() });
