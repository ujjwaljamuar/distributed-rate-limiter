import http from "k6/http";
import { sleep, check } from "k6";
import { Counter } from "k6/metrics";
import { BASE_URLS, ENDPOINT, TOKENS } from "./config.js";
import { commonOptions } from "./options.js";

export const options = commonOptions;

const rateLimited = new Counter("rate_limited");

export default function () {
  const url =
    BASE_URLS[Math.floor(Math.random() * BASE_URLS.length)] + ENDPOINT;

  const useAuth = Math.random() > 0.3;

  let headers = {};

  if (useAuth) {
    const token = TOKENS[Math.floor(Math.random() * TOKENS.length)];
    headers["Authorization"] = `Bearer ${token}`;
  }

  const res = http.get(url, { headers });

  if (res.status === 429) {
    rateLimited.add(1);
  }

  check(res, {
    "status is 200": (r) => r.status === 200,
    "rate limited": (r) => r.status === 429,
  });

  sleep(0.1);
}
