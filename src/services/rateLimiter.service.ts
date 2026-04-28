import fs from "fs";
import path from "path";
import redis from "./redisClient";

const script = fs.readFileSync(
  path.join(__dirname, "../lua/tokenBucket.lua"),
  "utf8",
);

let sha: string;

export const loadLuaScript = async () => {
  const loadedSha = await redis.script("LOAD", script);

  if (typeof loadedSha !== "string") {
    throw new Error("Redis returned an invalid Lua script SHA");
  }

  sha = loadedSha;
};

export const checkRateLimit = async (key: string) => {
  const now = Math.floor(Date.now() / 1000);

  const maxTokens = 10;
  const refillRate = 1; // tokens per second

  const result = await redis.evalsha(
    sha,
    2,
    `tokens:${key}`,
    `timestamp:${key}`,
    maxTokens,
    refillRate,
    now,
  );

  return result === 1;
};
