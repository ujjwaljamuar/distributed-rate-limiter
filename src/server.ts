import app from "./app";
import { loadLuaScript } from "./services/rateLimiter.service";

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || "0.0.0.0";

const start = async () => {
  await loadLuaScript();

  const server = app.listen(PORT, HOST, () => {
    console.log(`Gateway running at http://${HOST}:${PORT}`);
  });

  server.on("error", (error) => {
    console.error("Gateway failed to start:", error);
  });
};

start().catch((error) => {
  console.error("Failed to start gateway:", error);
  process.exit(1);
});
