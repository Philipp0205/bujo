import http from "node:http";
import { installGracefulShutdown } from "./app-kit/shutdown.ts";
import { createApp } from "./app.ts";
import { loadCalDavConfig } from "./caldav/config.ts";
import { caldavSource, demoSource } from "./caldav/source.ts";

const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? "127.0.0.1";

const config = loadCalDavConfig();
const source = config ? caldavSource(config) : demoSource();

const server = http.createServer(createApp({ source }));

server.listen(port, host, () => {
  console.log("bujo");
  console.log(`  listening   http://${host}:${port}`);
  if (config) console.log(`  tasks       CalDAV, lists: ${source.listNames.join(", ")} (read-only)`);
  else console.log("  tasks       demo data (set BUJO_CALDAV_BASE and BUJO_CALDAV_LISTS to use CalDAV)");
});

installGracefulShutdown({ server });
