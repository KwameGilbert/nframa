import { describe, expect, it } from "vitest";
import { api, expectStatus } from "./helpers/api.js";

describe("GET /health", () => {
  it("reports that the service is up", async () => {
    const res = await api.get("/health");

    expectStatus(res, 200);
    expect(res.body).toEqual({
      success: true,
      message: "Service is healthy",
      data: { status: "ok" },
    });
  });
});

describe("GET /", () => {
  it("returns the welcome message with the environment and server time", async () => {
    const res = await api.get("/");

    expectStatus(res, 200);
    expect(res.body).toMatchObject({
      success: true,
      message: "Welcome to the Nframa API",
      data: { status: "ok", env: "test" },
    });
    expect(Date.parse(res.body.data.timestamp)).not.toBeNaN();
  });
});

describe("Error responses", () => {
  it("returns 404 in the error shape for an unknown route", async () => {
    const res = await api.get("/trips/upcoming");

    expectStatus(res, 404);
    expect(res.body).toEqual({ success: false, error: "Route not found: GET /trips/upcoming" });
  });

  it("returns 400 for a body that isn't valid JSON", async () => {
    const res = await api
      .post("/auth/login")
      .set("Content-Type", "application/json")
      .send('{"email": "kofi.mensah@example.com",');

    expectStatus(res, 400);
    expect(res.body).toEqual({ success: false, error: "Request body is not valid JSON" });
  });

  it("returns 413 for a body over the 100kb limit", async () => {
    const res = await api
      .post("/auth/login")
      .send({ email: "kofi.mensah@example.com", password: "x".repeat(110_000) });

    expectStatus(res, 413);
    expect(res.body.success).toBe(false);
  });
});

describe("API docs", () => {
  it("GET /openapi.json documents every module", async () => {
    const res = await api.get("/openapi.json");

    expectStatus(res, 200);
    expect(Object.keys(res.body.paths)).toEqual(
      expect.arrayContaining([
        "/health",
        "/auth/login",
        "/auth/login/otp",
        "/auth/login/verify",
        "/auth/me",
        "/users",
        "/users/{id}",
        "/admin",
        "/admin/{userId}",
        "/roles",
        "/roles/{id}",
        "/roles/{id}/permissions",
        "/roles/{id}/permissions/{module}",
        "/driver",
        "/driver/{userId}",
        "/rider",
        "/rider/{userId}",
        "/vehicles",
        "/vehicles/{id}",
        "/settings",
        "/settings/{key}",
      ]),
    );
  });

  it("GET /docs/ serves Swagger UI", async () => {
    const res = await api.get("/docs/");

    expectStatus(res, 200);
    expect(res.text).toContain("swagger-ui");
  });
});
