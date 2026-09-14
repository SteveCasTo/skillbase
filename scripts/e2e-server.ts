import { dev } from "astro";

const server = await dev({
  server: {
    host: "127.0.0.1",
    port: 4321,
  },
});

async function close() {
  await server.stop();
  process.exit(0);
}

process.once("SIGINT", close);
process.once("SIGTERM", close);
