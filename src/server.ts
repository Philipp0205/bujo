import http from "node:http";
import { installGracefulShutdown } from "./app-kit/shutdown.ts";
import { createMailer } from "./accounts/mail.ts";
import { createApp } from "./app.ts";
import { loadCalDavConfig } from "./caldav/config.ts";
import { caldavSource, demoSource } from "./caldav/source.ts";
import { openDb } from "./db.ts";

const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || "127.0.0.1";
const origin = (process.env.BUJO_ORIGIN || `http://localhost:${port}`).replace(/\/+$/, "");
const dbFile = process.env.BUJO_DB || "data/bujo.db";
const trustProxy = process.env.BUJO_TRUST_PROXY === "1" || process.env.BUJO_TRUST_PROXY === "true";

const config = loadCalDavConfig();
const source = config ? caldavSource(config) : demoSource();
const db = openDb(dbFile);

const server = http.createServer(createApp({ source, db, origin, mailer: createMailer(), trustProxy }));

server.listen(port, host, () => {
  console.log("bujo");
  console.log(`  listening   http://${host}:${port}`);
  console.log(`  origin      ${origin}`);
  console.log(`  database    ${dbFile}`);
  if (config) console.log(`  tasks       CalDAV, lists: ${source.listNames.join(", ")}`);
  else console.log("  tasks       demo data (set BUJO_CALDAV_BASE and BUJO_CALDAV_LISTS to use CalDAV)");
  if (process.env.OCR_URL) console.log(`  ocr         ${process.env.OCR_URL}`);
  else console.log("  ocr         off (set OCR_URL to use the evening scan)");
});

installGracefulShutdown({ server, onClose: () => db.close() });
