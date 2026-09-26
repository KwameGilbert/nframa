import { beforeAll, describe, expect, it } from "vitest";
import { api, auth, expectStatus } from "./helpers/api.js";
import { createSignedInAdmin, loginAsSuperAdmin, signUpByPhone } from "./helpers/actors.js";
import { newPromotion } from "./helpers/unique.js";
import { trackForCleanup } from "./helpers/cleanup.js";

let superAdmin: Awaited<ReturnType<typeof loginAsSuperAdmin>>;
let financeViewer: Awaited<ReturnType<typeof createSignedInAdmin>>; // settings: read

// Creates the setting as the super admin and returns it.
async function createSetting(setting: {
  key: string;
  type: string;
  value: unknown;
  description?: string;
}) {
  const res = await api.post("/settings").set(auth(superAdmin.token)).send(setting);
  expectStatus(res, 201);
  trackForCleanup("settings", { key: res.body.data.key });
  return res.body.data;
}

async function discountSetting() {
  const promo = await newPromotion();
  return {
    key: `${promo.keyPrefix}.discountPercent`,
    type: "number",
    value: promo.discountPercent,
    description: `${promo.label} discount on intercity fares, in percent`,
  };
}

beforeAll(async () => {
  superAdmin = await loginAsSuperAdmin();
  financeViewer = await createSignedInAdmin(superAdmin.token, { settings: { read: true } });
});

describe("POST /settings", () => {
  it("creates a setting of each type, recording who created it", async () => {
    const promo = await newPromotion();
    const settings = [
      {
        key: `${promo.keyPrefix}.discountPercent`,
        type: "number",
        value: promo.discountPercent,
        description: `${promo.label} discount on intercity fares, in percent`,
      },
      // Inactive, so a future promotions feature never treats a test promotion as live.
      { key: `${promo.keyPrefix}.isActive`, type: "boolean", value: false },
      { key: `${promo.keyPrefix}.eligibleCorridors`, type: "json", value: promo.corridors },
      { key: `${promo.keyPrefix}.bannerText`, type: "string", value: promo.bannerText },
    ];

    for (const setting of settings) {
      const res = await api.post("/settings").set(auth(superAdmin.token)).send(setting);

      expectStatus(res, 201);
      trackForCleanup("settings", { key: res.body.data.key });
      expect(res.body.message).toBe("Setting created successfully");
      expect(res.body.data).toMatchObject({
        description: null,
        ...setting,
        updatedBy: superAdmin.userId,
      });
    }
  });

  it("stores JSON objects as well as arrays", async () => {
    const promo = await newPromotion();

    const res = await api
      .post("/settings")
      .set(auth(superAdmin.token))
      .send({
        key: `${promo.keyPrefix}.schedule`,
        type: "json",
        value: { startsOn: "2026-12-01", endsOn: "2026-12-31", daysOfWeek: ["fri", "sat"] },
      });

    expectStatus(res, 201);
    trackForCleanup("settings", { key: res.body.data.key });
    expect(res.body.data.value).toEqual({
      startsOn: "2026-12-01",
      endsOn: "2026-12-31",
      daysOfWeek: ["fri", "sat"],
    });
  });

  it("rejects a value that doesn't match the type", async () => {
    const res = await api
      .post("/settings")
      .set(auth(superAdmin.token))
      .send({ ...(await discountSetting()), value: "15" });

    expectStatus(res, 400);
    expect(res.body.error).toBe("value: Expected a number for a number setting");
  });

  it("only accepts an object or array for a json setting", async () => {
    const promo = await newPromotion();

    const res = await api
      .post("/settings")
      .set(auth(superAdmin.token))
      .send({ key: `${promo.keyPrefix}.eligibleCorridors`, type: "json", value: "accra-kumasi" });

    expectStatus(res, 400);
    expect(res.body.error).toBe("value: Expected a JSON object or array for a json setting");
  });

  it("rejects a key that isn't dotted camelCase", async () => {
    const res = await api
      .post("/settings")
      .set(auth(superAdmin.token))
      .send({ ...(await discountSetting()), key: "Promotions.Homowo-Discount" });

    expectStatus(res, 400);
    expect(res.body.error).toMatch(/^key:/);
  });

  it("keeps keys unique", async () => {
    const setting = await createSetting(await discountSetting());

    const res = await api
      .post("/settings")
      .set(auth(superAdmin.token))
      .send({ key: setting.key, type: "number", value: 10 });

    expectStatus(res, 409);
    expect(res.body.error).toBe(`Setting already exists: ${setting.key}`);
  });

  it("needs settings: create", async () => {
    const res = await api
      .post("/settings")
      .set(auth(financeViewer.token))
      .send(await discountSetting());

    expectStatus(res, 403);
    expect(res.body.error).toBe("Missing permission: create on settings");
  });
});

describe("GET /settings", () => {
  it("lists settings in key order", async () => {
    const promo = await newPromotion();
    // Created out of order. Only this promotion's keys are checked — the rest of the table is other data.
    await createSetting({ key: `${promo.keyPrefix}.isActive`, type: "boolean", value: false });
    await createSetting({
      key: `${promo.keyPrefix}.bannerText`,
      type: "string",
      value: promo.bannerText,
    });
    await createSetting({
      key: `${promo.keyPrefix}.discountPercent`,
      type: "number",
      value: promo.discountPercent,
    });

    const res = await api.get("/settings").set(auth(financeViewer.token));

    expectStatus(res, 200);
    expect(res.body.message).toBe("Settings retrieved successfully");
    const keys = res.body.data
      .map((s: { key: string }) => s.key)
      .filter((key: string) => key.startsWith(`${promo.keyPrefix}.`));
    expect(keys).toEqual([
      `${promo.keyPrefix}.bannerText`,
      `${promo.keyPrefix}.discountPercent`,
      `${promo.keyPrefix}.isActive`,
    ]);
  });

  it("isn't open to riders", async () => {
    const rider = await signUpByPhone("rider");

    const res = await api.get("/settings").set(auth(rider.token));

    expectStatus(res, 403);
    expect(res.body.error).toBe("Missing permission: read on settings");
  });

  it("needs a signed-in user", async () => {
    expectStatus(await api.get("/settings"), 401);
  });
});

describe("GET /settings/:key", () => {
  it("returns one setting", async () => {
    const setting = await createSetting(await discountSetting());

    const res = await api.get(`/settings/${setting.key}`).set(auth(financeViewer.token));

    expectStatus(res, 200);
    expect(res.body.message).toBe("Setting retrieved successfully");
    expect(res.body.data).toMatchObject({ key: setting.key, type: "number", value: setting.value });
  });

  it("returns 404 for an unknown key", async () => {
    const key = `${(await newPromotion()).keyPrefix}.discountPercent`;

    const res = await api.get(`/settings/${key}`).set(auth(superAdmin.token));

    expectStatus(res, 404);
    expect(res.body.error).toBe(`Setting not found: ${key}`);
  });
});

describe("PATCH /settings/:key", () => {
  it("updates the value and records who changed it", async () => {
    const setting = await createSetting(await discountSetting());
    const editor = await createSignedInAdmin(superAdmin.token, {
      settings: { read: true, update: true },
    });

    const res = await api
      .patch(`/settings/${setting.key}`)
      .set(auth(editor.token))
      .send({ value: 25 });

    expectStatus(res, 200);
    expect(res.body.message).toBe("Setting updated successfully");
    expect(res.body.data).toMatchObject({ key: setting.key, value: 25, updatedBy: editor.userId });
  });

  it("keeps the setting's type", async () => {
    const setting = await createSetting(await discountSetting());

    const res = await api
      .patch(`/settings/${setting.key}`)
      .set(auth(superAdmin.token))
      .send({ value: true });

    expectStatus(res, 400);
    expect(res.body.error).toBe("value: Expected a number for a number setting");
  });

  it("clears the description with null", async () => {
    const setting = await createSetting(await discountSetting());

    const res = await api
      .patch(`/settings/${setting.key}`)
      .set(auth(superAdmin.token))
      .send({ description: null });

    expectStatus(res, 200);
    expect(res.body.data).toMatchObject({ description: null, value: setting.value });
  });

  it("rejects an empty update", async () => {
    const setting = await createSetting(await discountSetting());

    const res = await api.patch(`/settings/${setting.key}`).set(auth(superAdmin.token)).send({});

    expectStatus(res, 400);
    expect(res.body.error).toBe("At least one of value or description must be provided");
  });

  it("needs settings: update", async () => {
    const setting = await createSetting(await discountSetting());

    const res = await api
      .patch(`/settings/${setting.key}`)
      .set(auth(financeViewer.token))
      .send({ value: 30 });

    expectStatus(res, 403);
    expect(res.body.error).toBe("Missing permission: update on settings");
  });

  it("returns 404 for an unknown key", async () => {
    const res = await api
      .patch(`/settings/${(await newPromotion()).keyPrefix}.discountPercent`)
      .set(auth(superAdmin.token))
      .send({ value: 10 });

    expectStatus(res, 404);
  });
});

describe("DELETE /settings/:key", () => {
  it("deletes a setting", async () => {
    const setting = await createSetting(await discountSetting());

    const res = await api.delete(`/settings/${setting.key}`).set(auth(superAdmin.token));

    expectStatus(res, 200);
    expect(res.body).toEqual({
      success: true,
      message: "Setting deleted successfully",
      data: null,
    });
    expectStatus(await api.get(`/settings/${setting.key}`).set(auth(superAdmin.token)), 404);
  });

  it("needs settings: delete", async () => {
    const setting = await createSetting(await discountSetting());

    const res = await api.delete(`/settings/${setting.key}`).set(auth(financeViewer.token));

    expectStatus(res, 403);
    expect(res.body.error).toBe("Missing permission: delete on settings");
  });

  it("returns 404 for an unknown key", async () => {
    const res = await api
      .delete(`/settings/${(await newPromotion()).keyPrefix}.discountPercent`)
      .set(auth(superAdmin.token));

    expectStatus(res, 404);
  });
});
