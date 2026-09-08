import { createServer } from "http";
import next from "next";
import { attachSshWebSocketServer } from "./src/server/ssh-ws";

const dev = process.env.NODE_ENV !== "production";
const hostname = process.env.HOST || "0.0.0.0";
const port = Number(process.env.PORT || 3000);

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

app.prepare().then(() => {
  const server = createServer((req, res) => {
    handle(req, res);
  });

  attachSshWebSocketServer(server);

  server.listen(port, hostname, () => {
    console.log(`Homelab Panel prêt sur http://${hostname}:${port}`);
  });
});
