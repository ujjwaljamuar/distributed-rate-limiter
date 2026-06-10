import fs from "fs";
import path from "path";
import redis from "./redisClient";
import { rateLimitConfig } from "../config/rateLimit.config";

const luaScriptPaths = [
  path.join(__dirname, "../lua/tokenBucket.lua"),
  path.join(process.cwd(), "src/lua/tokenBucket.lua"),
];

const scriptPath = luaScriptPaths.find((candidate) => fs.existsSync(candidate));

if (!scriptPath) {
  throw new Error("Unable to find Lua rate limiter script");
}

const script = fs.readFileSync(scriptPath, "utf8");

let sha: string;

export const loadLuaScript = async () => {
  const loadedSha = await redis.script("LOAD", script);

  if (typeof loadedSha !== "string") {
    throw new Error("Redis returned an invalid Lua script SHA");
  }

  sha = loadedSha;
};

export const checkRateLimit = async (key: string, role: string) => {
  const safeRole = role in rateLimitConfig ? role : "free";

  const config = rateLimitConfig[safeRole as keyof typeof rateLimitConfig];

  const now = Math.floor(Date.now() / 1000);

  const result = await redis.evalsha(
    sha,
    2,
    `tokens:${key}`,
    `timestamp:${key}`,
    config.maxTokens,
    config.refillRate,
    now,
  );

  return result === 1;
};
