import { randomUUID } from "node:crypto";
import request, { type Response } from "supertest";
import { expect } from "vitest";
import { app } from "../../src/app.js";
import { REQUEST_ID_PREFIX } from "./cleanup.js";

type Method = "get" | "post" | "put" | "patch" | "delete";

// Calls the app in-process — no server needs to be running. Each request gets its own supertest factory:
// supertest shares one server per factory and closes it once nothing is in flight, so a request built
// before an `await` (e.g. `.send({ ...(await newPhone()) })`) could otherwise find its port closed.
function send(method: Method) {
  return (url: string) =>
    request(app)[method](url).set("X-Request-Id", `${REQUEST_ID_PREFIX}${randomUUID()}`);
}

export const api = {
  get: send("get"),
  post: send("post"),
  put: send("put"),
  patch: send("patch"),
  delete: send("delete"),
};

export function auth(token: string) {
  return { Authorization: `Bearer ${token}` };
}

// Like expect(res.status).toBe(status), but a failure shows the response body (usually the error message).
export function expectStatus(res: Response, status: number) {
  expect(res.status, JSON.stringify(res.body)).toBe(status);
}
