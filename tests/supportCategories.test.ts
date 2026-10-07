import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import db from "../src/database/knex.js";
import { flushActivityLogs } from "../src/services/activityLog.service.js";
import { api, auth, expectError, expectStatus } from "./helpers/api.js";
import { createSignedInAdmin, loginAsSuperAdmin, signUpByPhone } from "./helpers/actors.js";
import { REQUEST_ID_PREFIX, trackForCleanup } from "./helpers/cleanup.js";
import { seedCategory, seedTicket, uniqueWord } from "./helpers/support.js";

type Session = { userId: string; token: string };

let manager: Session; // support: create, read, update, delete
let reader: Session; // support: read only
let outsider: Session; // no support access
let rider: Session;
let driver: Session;

beforeAll(async () => {
  const superAdmin = await loginAsSuperAdmin();
  [manager, reader, outsider, rider, driver] = await Promise.all([
    createSignedInAdmin(superAdmin.token, {
      support: { create: true, read: true, update: true, delete: true },
    }),
    createSignedInAdmin(superAdmin.token, { support: { read: true } }),
    createSignedInAdmin(superAdmin.token, { users: { read: true } }),
    signUpByPhone("rider"),
    signUpByPhone("driver"),
  ]);
});

const userList = (caller: Session) => api.get("/support/categories").set(auth(caller.token));
const adminList = (caller: Session) => api.get("/admin/support/categories").set(auth(caller.token));

async function create(body: object) {
  const res = await api.post("/admin/support/categories").set(auth(manager.token)).send(body);
  if (res.status === 201) trackForCleanup("supportCategories", { id: res.body.data.id });
  return res;
}

const idsOf = (res: { body: { data: { id: string }[] } }) => res.body.data.map((c) => c.id);

describe("GET /support/categories", () => {
  it("shows a user the active categories for everyone or their role, in staff's order", async () => {
    const [riderOnly, driverOnly, inactive, everyone] = await Promise.all([
      seedCategory({ audience: "rider", sortOrder: 1 }),
      seedCategory({ audience: "driver", sortOrder: 1 }),
      seedCategory({ isActive: false, sortOrder: 1 }),
      seedCategory({ sortOrder: 2 }),
    ]);

    const asRider = await userList(rider);
    expectStatus(asRider, 200);
    const riderIds = idsOf(asRider);
    expect(riderIds).toContain(riderOnly.id);
    expect(riderIds).not.toContain(driverOnly.id);
    expect(riderIds).not.toContain(inactive.id);
    expect(riderIds.indexOf(riderOnly.id)).toBeLessThan(riderIds.indexOf(everyone.id));
    // Priority and audience are staff-only.
    expect(Object.keys(asRider.body.data[0]).sort()).toEqual(["description", "id", "name"]);

    const driverIds = idsOf(await userList(driver));
    expect(driverIds).toEqual(expect.arrayContaining([driverOnly.id, everyone.id]));
    expect(driverIds).not.toContain(riderOnly.id);
  });

  it("includes the default categories", async () => {
    const names = (await userList(driver)).body.data.map((c: { name: string }) => c.name);
    expect(names).toEqual(expect.arrayContaining(["Trip issue", "Payouts & earnings", "Other"]));
    expect(names.at(-1)).toBe("Other");
    const riderNames = (await userList(rider)).body.data.map((c: { name: string }) => c.name);
    expect(riderNames).not.toContain("Payouts & earnings");
  });

  it("needs a signed-in user", async () => {
    expectStatus(await api.get("/support/categories"), 401);
  });
});

describe("GET /admin/support/categories", () => {
  it("lists inactive categories too, with how many tickets use each", async () => {
    const [used, inactive] = await Promise.all([seedCategory(), seedCategory({ isActive: false })]);
    await seedTicket(rider.userId, used.id);
    await seedTicket(rider.userId, used.id, { status: "closed", closedAt: new Date() });

    const res = await adminList(reader);
    expectStatus(res, 200);
    const byId = new Map(res.body.data.map((c: { id: string }) => [c.id, c]));
    expect(byId.get(used.id)).toMatchObject({ ticketCount: 2, isActive: true });
    expect(byId.get(inactive.id)).toMatchObject({ ticketCount: 0, isActive: false });
  });

  it("needs support: read", async () => {
    expectError(await adminList(outsider), 403, "Missing permission: read on support");
  });
});

describe("POST /admin/support/categories", () => {
  it("creates a category with defaults and records it", async () => {
    const name = `Promo ${uniqueWord()}`;
    const res = await create({ name: `  ${name} ` });

    expectStatus(res, 201);
    expect(res.body.data).toMatchObject({
      name,
      description: null,
      audience: "all",
      defaultPriority: "normal",
      isActive: true,
      sortOrder: 0,
      ticketCount: 0,
    });

    await flushActivityLogs();
    const [entry] = await db("activityLogs")
      .where("requestId", "like", `${REQUEST_ID_PREFIX}%`)
      .where({ action: "supportCategory.create", targetId: res.body.data.id });
    expect(entry).toMatchObject({ module: "support", actorId: manager.userId });
  });

  it("refuses a name another category has, ignoring case", async () => {
    const existing = await seedCategory();
    expectError(
      await create({ name: existing.name.toUpperCase() }),
      409,
      `A support category named "${existing.name.toUpperCase()}" already exists`,
    );
  });

  it("400s on a bad body", async () => {
    expectStatus(await create({ name: "x" }), 400);
    expectStatus(await create({ name: `Bad ${uniqueWord()}`, defaultPriority: "asap" }), 400);
    expectStatus(await create({ name: `Bad ${uniqueWord()}`, audience: "admin" }), 400);
  });

  it("needs support: create", async () => {
    const res = await api
      .post("/admin/support/categories")
      .set(auth(reader.token))
      .send({ name: `Nope ${uniqueWord()}` });
    expectError(res, 403, "Missing permission: create on support");
  });
});

describe("PATCH /admin/support/categories/:id", () => {
  const patch = (caller: Session, id: string, body: object) =>
    api.patch(`/admin/support/categories/${id}`).set(auth(caller.token)).send(body);

  it("deactivates a category, which hides it from users", async () => {
    const category = await seedCategory();

    const res = await patch(manager, category.id, { isActive: false, defaultPriority: "high" });
    expectStatus(res, 200);
    expect(res.body.data).toMatchObject({ isActive: false, defaultPriority: "high" });
    expect(idsOf(await userList(rider))).not.toContain(category.id);

    await flushActivityLogs();
    const [entry] = await db("activityLogs").where({
      action: "supportCategory.update",
      targetId: category.id,
    });
    expect(entry.changedFields).toEqual(expect.arrayContaining(["isActive", "defaultPriority"]));
  });

  it("refuses another category's name, an empty body and an unknown id", async () => {
    const [a, b] = await Promise.all([seedCategory(), seedCategory()]);
    expectStatus(await patch(manager, a.id, { name: b.name.toLowerCase() }), 409);
    expectError(await patch(manager, a.id, {}), 400, "At least one field must be provided");
    const id = randomUUID();
    expectError(
      await patch(manager, id, { isActive: false }),
      404,
      `Support category not found: ${id}`,
    );
  });

  it("needs support: update", async () => {
    const category = await seedCategory();
    expectError(
      await patch(reader, category.id, { isActive: false }),
      403,
      "Missing permission: update on support",
    );
  });
});

describe("DELETE /admin/support/categories/:id", () => {
  const remove = (caller: Session, id: string) =>
    api.delete(`/admin/support/categories/${id}`).set(auth(caller.token));

  it("deletes an unused category and records it", async () => {
    const category = await seedCategory();

    expectStatus(await remove(manager, category.id), 200);
    expect(await db("supportCategories").where({ id: category.id }).first()).toBeUndefined();

    await flushActivityLogs();
    const entries = await db("activityLogs").where({
      action: "supportCategory.delete",
      targetId: category.id,
    });
    expect(entries).toHaveLength(1);
  });

  it("refuses a category tickets were filed under", async () => {
    const category = await seedCategory();
    await seedTicket(rider.userId, category.id);

    expectError(
      await remove(manager, category.id),
      409,
      "This category is used by 1 ticket; deactivate it instead",
    );
  });

  it("404s for an unknown id and needs support: delete", async () => {
    const id = randomUUID();
    expectError(await remove(manager, id), 404, `Support category not found: ${id}`);
    const category = await seedCategory();
    expectError(await remove(reader, category.id), 403, "Missing permission: delete on support");
  });
});
