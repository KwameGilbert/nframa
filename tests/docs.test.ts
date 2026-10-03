import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { api, auth, expectStatus } from "./helpers/api.js";
import { createSignedInAdmin, loginAsSuperAdmin } from "./helpers/actors.js";

interface ErrorExample {
  method: string;
  path: string;
  status: number;
  example: { success?: unknown; error?: unknown } | undefined;
}

async function errorExamples(): Promise<ErrorExample[]> {
  const res = await api.get("/openapi.json");
  expectStatus(res, 200);
  const found: ErrorExample[] = [];
  for (const [path, item] of Object.entries<Record<string, { responses?: object }>>(
    res.body.paths,
  )) {
    for (const [method, operation] of Object.entries(item)) {
      for (const [status, response] of Object.entries<{
        content?: { "application/json"?: { example?: ErrorExample["example"] } };
      }>((operation.responses ?? {}) as never)) {
        if (Number(status) < 400) continue;
        found.push({
          method,
          path,
          status: Number(status),
          example: response.content?.["application/json"]?.example,
        });
      }
    }
  }
  return found;
}

describe("OpenAPI error examples", () => {
  it("gives every error response an example in the error envelope", async () => {
    const all = await errorExamples();

    expect(all.length).toBeGreaterThan(100);
    for (const { method, path, status, example } of all) {
      const label = `${method.toUpperCase()} ${path} ${status}`;
      expect(example?.success, label).toBe(false);
      expect(typeof example?.error === "string" && example.error.length > 0, label).toBe(true);
    }
  });

  it("only shows the validation example on 400 responses", async () => {
    const all = await errorExamples();

    for (const { method, path, status, example } of all.filter((e) => e.status !== 400)) {
      expect(String(example?.error), `${method.toUpperCase()} ${path} ${status}`).not.toContain(
        "Invalid email address",
      );
    }
  });

  it("documents the exact message where the API returns a specific one", async () => {
    const all = await errorExamples();
    const example = (method: string, path: string, status: number) =>
      all.find((e) => e.method === method && e.path === path && e.status === status)?.example;

    expect(example("post", "/auth/login", 401)?.error).toBe("Invalid email or password");
    expect(example("post", "/auth/refresh", 401)?.error).toBe("Invalid or expired refresh token");
    expect(example("post", "/webhooks/paystack", 401)?.error).toBe("Invalid webhook signature");
    expect(example("post", "/auth/login", 429)?.error).toBe("Too many requests, try again later");
    expect(example("get", "/users", 403)?.error).toMatch(/^Missing permission: /);
    expect(example("get", "/users/{id}", 404)?.error).toMatch(/^User not found: /);
    expect(example("post", "/trips", 403)?.error).toBe("Only riders can request trips");
    expect(example("get", "/trips/{id}", 403)?.error).toBe("Missing permission: read on trips");
    expect(example("get", "/trips/{id}", 404)?.error).toMatch(/^Trip not found: /);
  });

  it("derives 400 and 409 examples per endpoint, and they match what the app returns", async () => {
    const all = await errorExamples();
    const documented = (method: string, path: string, status: number) =>
      String(
        all.find((e) => e.method === method && e.path === path && e.status === status)?.example
          ?.error,
      );
    const { token } = await loginAsSuperAdmin();

    // Missing body field: the real message lists every missing field, the docs show the first one.
    for (const path of ["/vehicles", "/commutes"]) {
      const res = await api.post(path).set(auth(token)).send({});
      expectStatus(res, 400);
      const example = documented("post", path, 400);
      expect(example).toContain("received undefined");
      expect(res.body.error.startsWith(example), `${path}: ${res.body.error}`).toBe(true);
    }

    const badId = await api.get("/users/not-a-uuid").set(auth(token));
    expectStatus(badId, 400);
    expect(badId.body.error).toBe(documented("get", "/users/{id}", 400));

    const badPage = await api.get("/wallet/transactions?page=0").set(auth(token));
    expectStatus(badPage, 400);
    expect(badPage.body.error).toBe(documented("get", "/wallet/transactions", 400));

    expect(documented("post", "/users", 409)).toBe("A users record with this value already exists");
    expect(documented("post", "/vehicles", 409)).toContain("vehicles");
    expect(documented("post", "/users", 409)).not.toContain("vehicles");
  });

  it("documents the real not-found message for a commute", async () => {
    const all = await errorExamples();
    const example = String(
      all.find((e) => e.method === "get" && e.path === "/commutes/{id}" && e.status === 404)
        ?.example?.error,
    );
    const { token } = await loginAsSuperAdmin();
    const id = randomUUID();

    const res = await api.get(`/commutes/${id}`).set(auth(token));

    expectStatus(res, 404);
    expect(res.body.error).toBe(`Commute not found: ${id}`);
    expect(example).toMatch(/^Commute not found: [0-9a-f-]{36}$/);
  });

  it("derives 403 examples from the module guarding each path", async () => {
    const all = await errorExamples();
    const forbidden = (method: string, path: string) =>
      String(
        all.find((e) => e.method === method && e.path === path && e.status === 403)?.example?.error,
      );

    expect(forbidden("post", "/roles")).toBe("Missing permission: create on roles");
    expect(forbidden("get", "/commutes")).toContain("on commutes");
    expect(forbidden("get", "/admin/driver/verification/pending")).toContain("on verification");
    expect(forbidden("get", "/admin/activity-logs")).toContain("on activityLogs");
    expect(forbidden("get", "/users/{id}/activity-logs")).toBe(
      "Missing permission: read on activityLogs",
    );
    expect(forbidden("post", "/auth/login")).toBe("Account is not active");

    const onUsers = all
      .filter((e) => e.status === 403 && String(e.example?.error).endsWith(" on users"))
      .map((e) => e.path);
    for (const path of onUsers) {
      expect(path, "guarded by the users module").toMatch(/^\/(users|drivers?|rider|vehicles|emergency-contacts|reviews|safety|admin\/safety|admin\/payment-methods)/);
    }
  });

  it("documents the permission message the app returns to a caller lacking it", async () => {
    const all = await errorExamples();
    const example = all.find((e) => e.method === "get" && e.path === "/roles" && e.status === 403)
      ?.example?.error;
    const { token: superToken } = await loginAsSuperAdmin();
    const noGrants = await createSignedInAdmin(superToken, {});

    const res = await api.get("/roles").set(auth(noGrants.token));

    expectStatus(res, 403);
    expect(res.body.error).toBe(example);
  });
});
