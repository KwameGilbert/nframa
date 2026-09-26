import request, { type Response } from "supertest";
import { expect } from "vitest";
import { app } from "../../src/app.js";

// Calls the app in-process — no server needs to be running. Each request gets its own supertest factory:
// supertest shares one server per factory and closes it once nothing is in flight, so a request built
// before an `await` (e.g. `.send({ ...(await newPhone()) })`) could otherwise find its port closed.
export const api = {
  get: (url: string) => request(app).get(url),
  post: (url: string) => request(app).post(url),
  put: (url: string) => request(app).put(url),
  patch: (url: string) => request(app).patch(url),
  delete: (url: string) => request(app).delete(url),
};

export function auth(token: string) {
  return { Authorization: `Bearer ${token}` };
}

// Like expect(res.status).toBe(status), but a failure shows the response body (usually the error message).
export function expectStatus(res: Response, status: number) {
  expect(res.status, JSON.stringify(res.body)).toBe(status);
}
