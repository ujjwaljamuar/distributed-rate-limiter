import http from "k6/http";
import { BASE_URLS, ENDPOINT } from "./config.js";
import { sleep, check } from "k6";

import { commonOptions } from "./options.js";

export const options = commonOptions;

const TOKEN = "TOKEN_USER_1";

export default function () {
  const url =
    BASE_URLS[Math.floor(Math.random() * BASE_URLS.length)] + ENDPOINT;

  const res = http.get(url, {
    headers: {
      Authorization: `Bearer ${TOKEN}`,
    },
  });

  check(res, {
    "status is 200": (r) => r.status === 200,
    "rate limited": (r) => r.status === 429,
  });
}
