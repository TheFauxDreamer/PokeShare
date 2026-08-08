import { createPokeShareServer } from "./server.js";

const port = Number(process.env["PORT"] ?? 8080);
const server = createPokeShareServer();

const bound = await server.listen(port);
process.stdout.write(`PokeShare server listening on :${bound}\n`);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    void server.close().then(() => process.exit(0));
  });
}
