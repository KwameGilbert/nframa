import { beforeAll, describe, expect, it } from "vitest";
import { api, auth, expectStatus } from "./helpers/api.js";
import { createSignedInAdmin, loginAsSuperAdmin, signUpByPhone } from "./helpers/actors.js";
import { trackForCleanup } from "./helpers/cleanup.js";
import db from "../src/database/knex.js";

let superAdmin: Awaited<ReturnType<typeof loginAsSuperAdmin>>;
let reviewer: Awaited<ReturnType<typeof createSignedInAdmin>>; // verification: read + update
let documentTypes: {
  id: number;
  code: string;
  name: string;
  hasExpiry: boolean;
  isRequired: boolean;
}[];

function typeIdFor(code: string): number {
  const type = documentTypes.find((t) => t.code === code);
  if (!type) throw new Error(`Seed data is missing document type ${code} — run pnpm migrate`);
  return type.id;
}

// A small, valid-enough buffer — multer/our validation only check mimetype (from the filename) and size,
// never decode the image, so its content doesn't need to be a real photo.
function fakeFile(filename: string) {
  return Buffer.from(`fake file contents for ${filename}`);
}

// A signed-up driver with one uploaded (still PENDING) document.
async function driverWithDocument(code = "NATIONAL_ID") {
  const driver = await signUpByPhone("driver");
  const res = await api
    .post(`/driver/verification/${typeIdFor(code)}`)
    .set(auth(driver.token))
    .attach("file", fakeFile("national-id.jpg"), "national-id.jpg");
  expectStatus(res, 201);
  trackForCleanup("verificationDocuments", { id: res.body.data.id });
  return { driver, document: res.body.data };
}

// A driver with a profile and one uploaded document of each given type, verified by the reviewer unless
// verify is false.
async function driverWithDocuments(codes: string[], { verify = true } = {}) {
  const driver = await signUpByPhone("driver");
  expectStatus(
    await api.post("/driver").set(auth(driver.token)).send({ userId: driver.userId }),
    201,
  );
  trackForCleanup("carOwnerProfiles", { userId: driver.userId });

  const documents = await Promise.all(
    codes.map(async (code) => {
      const res = await api
        .post(`/driver/verification/${typeIdFor(code)}`)
        .set(auth(driver.token))
        .attach("file", fakeFile(`${code}.pdf`), `${code}.pdf`);
      expectStatus(res, 201);
      trackForCleanup("verificationDocuments", { id: res.body.data.id });
      return res.body.data as { id: string; documentTypeId: number };
    }),
  );
  if (verify) {
    for (const document of documents) {
      expectStatus(
        await api
          .patch(`/admin/verification/document/${document.id}`)
          .set(auth(reviewer.token))
          .send({ status: "VERIFIED" }),
        200,
      );
    }
  }

  return { driver, documents };
}

function requiredTypes() {
  return documentTypes.filter((type) => type.isRequired);
}

function approve(userId: string) {
  return api
    .patch(`/admin/driver/${userId}/verification`)
    .set(auth(reviewer.token))
    .send({ verificationStatus: "approved" });
}

beforeAll(async () => {
  superAdmin = await loginAsSuperAdmin();
  [reviewer, documentTypes] = await Promise.all([
    createSignedInAdmin(superAdmin.token, { verification: { read: true, update: true } }),
    api
      .get("/document-types")
      .set(auth(superAdmin.token))
      .then((res) => res.body.data),
  ]);
});

describe("GET /document-types", () => {
  it("lists the seeded document types", async () => {
    const res = await api.get("/document-types").set(auth(superAdmin.token));

    expectStatus(res, 200);
    expect(res.body.message).toBe("Document types retrieved successfully");
    const codes = res.body.data.map((t: { code: string }) => t.code);
    expect(codes).toEqual(
      expect.arrayContaining([
        "NATIONAL_ID",
        "DRIVERS_LICENSE",
        "VEHICLE_REGISTRATION",
        "INSURANCE",
        "ROADWORTHINESS",
      ]),
    );
    const roadworthiness = res.body.data.find((t: { code: string }) => t.code === "ROADWORTHINESS");
    expect(roadworthiness.hasExpiry).toBe(false);
    const nationalId = res.body.data.find((t: { code: string }) => t.code === "NATIONAL_ID");
    expect(nationalId.hasExpiry).toBe(true);
  });

  it("needs a signed-in user", async () => {
    expectStatus(await api.get("/document-types"), 401);
  });
});

describe("POST /driver/verification/:documentTypeId", () => {
  it("lets a signed-in user upload a document, storing none of the storage internals", async () => {
    const driver = await signUpByPhone("driver");

    const res = await api
      .post(`/driver/verification/${typeIdFor("DRIVERS_LICENSE")}`)
      .set(auth(driver.token))
      .attach("file", fakeFile("license.pdf"), "license.pdf");

    expectStatus(res, 201);
    trackForCleanup("verificationDocuments", { id: res.body.data.id });
    expect(res.body.message).toBe("Document uploaded successfully");
    expect(res.body.data).toMatchObject({
      userId: driver.userId,
      documentTypeId: typeIdFor("DRIVERS_LICENSE"),
      status: "PENDING",
      verifiedAt: null,
      verifiedBy: null,
    });
    expect(res.body.data.fileUrl).toMatch(/^https:\/\//);
    expect(res.body.data).not.toHaveProperty("storageKey");
    expect(res.body.data).not.toHaveProperty("storageDriver");
  });

  it("sets an expiry date only for a document type that has one", async () => {
    const driver = await signUpByPhone("driver");

    const expiring = await api
      .post(`/driver/verification/${typeIdFor("INSURANCE")}`)
      .set(auth(driver.token))
      .attach("file", fakeFile("insurance.pdf"), "insurance.pdf");
    const nonExpiring = await api
      .post(`/driver/verification/${typeIdFor("ROADWORTHINESS")}`)
      .set(auth(driver.token))
      .attach("file", fakeFile("roadworthy.pdf"), "roadworthy.pdf");

    expectStatus(expiring, 201);
    expectStatus(nonExpiring, 201);
    trackForCleanup("verificationDocuments", { id: expiring.body.data.id });
    trackForCleanup("verificationDocuments", { id: nonExpiring.body.data.id });
    expect(expiring.body.data.expiresAt).not.toBeNull();
    expect(nonExpiring.body.data.expiresAt).toBeNull();
  });

  it("rejects an unsupported file type", async () => {
    const driver = await signUpByPhone("driver");

    const res = await api
      .post(`/driver/verification/${typeIdFor("NATIONAL_ID")}`)
      .set(auth(driver.token))
      .attach("file", fakeFile("notes.txt"), "notes.txt");

    expectStatus(res, 400);
    expect(res.body.error).toMatch(/^Unsupported file type/);
  });

  it("rejects a request with no file", async () => {
    const driver = await signUpByPhone("driver");

    const res = await api
      .post(`/driver/verification/${typeIdFor("NATIONAL_ID")}`)
      .set(auth(driver.token));

    expectStatus(res, 400);
    expect(res.body.error).toMatch(/^No file uploaded/);
  });

  it("won't accept a second submission of the same document type", async () => {
    const { driver } = await driverWithDocument("NATIONAL_ID");

    const res = await api
      .post(`/driver/verification/${typeIdFor("NATIONAL_ID")}`)
      .set(auth(driver.token))
      .attach("file", fakeFile("national-id-2.jpg"), "national-id-2.jpg");

    expectStatus(res, 409);
    expect(res.body.error).toBe(
      "You already submitted a National ID. Contact support to resubmit.",
    );
  });

  it("rejects a document type that doesn't exist", async () => {
    const driver = await signUpByPhone("driver");

    const res = await api
      .post("/driver/verification/999999")
      .set(auth(driver.token))
      .attach("file", fakeFile("doc.jpg"), "doc.jpg");

    expectStatus(res, 400);
    expect(res.body.error).toBe("Document type not found: 999999");
  });

  it("needs a signed-in user", async () => {
    const res = await api
      .post(`/driver/verification/${typeIdFor("NATIONAL_ID")}`)
      .attach("file", fakeFile("doc.jpg"), "doc.jpg");

    expectStatus(res, 401);
  });
});

describe("GET /driver/verification", () => {
  it("returns the driver's own documents, each with its (still empty) history", async () => {
    const { driver, document } = await driverWithDocument("VEHICLE_REGISTRATION");

    const res = await api.get("/driver/verification").set(auth(driver.token));

    expectStatus(res, 200);
    expect(res.body.message).toBe("Documents retrieved successfully");
    const found = res.body.data.find((d: { id: string }) => d.id === document.id);
    expect(found).toMatchObject({ id: document.id, status: "PENDING" });
    expect(found.history).toEqual([]);
  });

  it("doesn't return another driver's documents", async () => {
    const [{ driver: first }, { driver: second }] = await Promise.all([
      driverWithDocument("NATIONAL_ID"),
      driverWithDocument("NATIONAL_ID"),
    ]);

    const res = await api.get("/driver/verification").set(auth(second.token));

    expect(res.body.data.every((d: { userId: string }) => d.userId === second.userId)).toBe(true);
    expect(res.body.data.some((d: { userId: string }) => d.userId === first.userId)).toBe(false);
  });

  it("needs a signed-in user", async () => {
    expectStatus(await api.get("/driver/verification"), 401);
  });
});

describe("PATCH /admin/verification/document/:documentId", () => {
  it("verifies a document and records who verified it, with a history entry", async () => {
    const { document } = await driverWithDocument("DRIVERS_LICENSE");

    const res = await api
      .patch(`/admin/verification/document/${document.id}`)
      .set(auth(reviewer.token))
      .send({ status: "VERIFIED", notes: "Matches the selfie on file" });

    expectStatus(res, 200);
    expect(res.body.message).toBe("Document status updated successfully");
    expect(res.body.data).toMatchObject({
      id: document.id,
      status: "VERIFIED",
      notes: "Matches the selfie on file",
      verifiedBy: reviewer.userId,
    });
    expect(res.body.data.verifiedAt).not.toBeNull();

    const history = await api.get(`/verification/${document.id}/history`).set(auth(reviewer.token));
    expect(history.body.data).toMatchObject([
      {
        documentId: document.id,
        previousStatus: "PENDING",
        newStatus: "VERIFIED",
        changedBy: reviewer.userId,
        notes: "Matches the selfie on file",
      },
    ]);
  });

  it("records a rejection reason and updates the driver's overall verification status", async () => {
    const { driver, document } = await driverWithDocument("INSURANCE");
    expectStatus(
      await api.post("/driver").set(auth(driver.token)).send({ userId: driver.userId }),
      201,
    );
    trackForCleanup("carOwnerProfiles", { userId: driver.userId });

    const res = await api
      .patch(`/admin/verification/document/${document.id}`)
      .set(auth(reviewer.token))
      .send({ status: "REJECTED", notes: "Photo is too blurry to read" });

    expectStatus(res, 200);
    expect(res.body.data).toMatchObject({
      status: "REJECTED",
      notes: "Photo is too blurry to read",
    });
    const profile = await api.get(`/driver/${driver.userId}`).set(auth(superAdmin.token));
    expect(profile.body.data.driver.verificationStatus).toBe("rejected");
  });

  it("needs verification: update", async () => {
    const [{ document }, viewer] = await Promise.all([
      driverWithDocument("ROADWORTHINESS"),
      createSignedInAdmin(superAdmin.token, { verification: { read: true } }),
    ]);

    const res = await api
      .patch(`/admin/verification/document/${document.id}`)
      .set(auth(viewer.token))
      .send({ status: "VERIFIED" });

    expectStatus(res, 403);
    expect(res.body.error).toBe("Missing permission: update on verification");
  });

  it("returns 404 for an unknown document", async () => {
    const id = "3f9a1c2e-6b4d-4a8f-9c1e-2d5b7a9c3e1f";

    const res = await api
      .patch(`/admin/verification/document/${id}`)
      .set(auth(reviewer.token))
      .send({ status: "VERIFIED" });

    expectStatus(res, 404);
    expect(res.body.error).toBe(`Document not found: ${id}`);
  });
});

describe("GET /admin/driver/verification/pending", () => {
  it("lists pending documents with the driver's details", async () => {
    const { driver, document } = await driverWithDocument("NATIONAL_ID");

    const res = await api.get("/admin/driver/verification/pending").set(auth(reviewer.token));

    expectStatus(res, 200);
    const found = res.body.data.find((d: { id: string }) => d.id === document.id);
    expect(found).toMatchObject({
      status: "PENDING",
      fullName: driver.fullName,
      documentTypeCode: "NATIONAL_ID",
      documentTypeName: "National ID",
    });
  });

  it("doesn't include a verified document", async () => {
    const { document } = await driverWithDocument("DRIVERS_LICENSE");
    expectStatus(
      await api
        .patch(`/admin/verification/document/${document.id}`)
        .set(auth(reviewer.token))
        .send({ status: "VERIFIED" }),
      200,
    );

    const res = await api.get("/admin/driver/verification/pending").set(auth(reviewer.token));

    expect(res.body.data.some((d: { id: string }) => d.id === document.id)).toBe(false);
  });

  it("needs verification: read", async () => {
    const viewer = await signUpByPhone("driver");

    const res = await api.get("/admin/driver/verification/pending").set(auth(viewer.token));

    expectStatus(res, 403);
    expect(res.body.error).toBe("Missing permission: read on verification");
  });
});

describe("PATCH /admin/driver/:userId/verification", () => {
  it("approves a driver only when an admin does, once every required document is verified", async () => {
    const { driver } = await driverWithDocuments(requiredTypes().map((type) => type.code));

    // Verifying every document leaves the driver waiting for an admin, not approved.
    const waiting = await api.get(`/driver/${driver.userId}`).set(auth(superAdmin.token));
    expect(waiting.body.data.driver.verificationStatus).toBe("pending");

    const res = await approve(driver.userId);

    expectStatus(res, 200);
    expect(res.body.message).toBe("Driver verification status updated successfully");
    expect(res.body.data.driver.verificationStatus).toBe("approved");
  });

  it("refuses approval while a required document type is missing, naming it", async () => {
    const [missing, ...submitted] = requiredTypes();
    const { driver } = await driverWithDocuments(submitted.map((type) => type.code));

    const res = await approve(driver.userId);

    expectStatus(res, 400);
    expect(res.body.error).toBe(
      `Cannot approve driver: missing required document(s): ${missing.name}`,
    );
  });

  it("refuses approval while a submitted document isn't verified", async () => {
    const required = requiredTypes();
    const { driver } = await driverWithDocuments(
      required.map((type) => type.code),
      { verify: false },
    );

    const res = await approve(driver.userId);

    expectStatus(res, 400);
    expect(res.body.error).toBe(
      `Cannot approve driver: ${required.length} document(s) not yet verified`,
    );
  });

  it("refuses approval when a document has expired", async () => {
    const { driver, documents } = await driverWithDocuments(
      requiredTypes().map((type) => type.code),
    );
    // Backdated directly: expiry is a year out from upload, and this document is the test's own.
    await db("verificationDocuments")
      .where({ id: documents[0].id })
      .update({ expiresAt: new Date(Date.now() - 24 * 60 * 60 * 1000) });

    const res = await approve(driver.userId);

    expectStatus(res, 400);
    expect(res.body.error).toBe("Cannot approve driver: 1 document(s) have expired");
  });

  it("needs verification: update", async () => {
    const viewer = await createSignedInAdmin(superAdmin.token, { verification: { read: true } });

    const res = await api
      .patch(`/admin/driver/5d1e8a3c-7b2f-4c9d-8e6a-1f3b5c7d9e2a/verification`)
      .set(auth(viewer.token))
      .send({ verificationStatus: "approved" });

    expectStatus(res, 403);
    expect(res.body.error).toBe("Missing permission: update on verification");
  });

  it("returns 404 for a user with no driver profile", async () => {
    const driver = await signUpByPhone("driver");

    const res = await approve(driver.userId);

    expectStatus(res, 404);
    expect(res.body.error).toBe(`Driver profile not found for user: ${driver.userId}`);
  });
});

describe("GET /verification/:documentId/history", () => {
  it("is empty right after upload, before any review", async () => {
    const { document } = await driverWithDocument("VEHICLE_REGISTRATION");

    const res = await api.get(`/verification/${document.id}/history`).set(auth(reviewer.token));

    expectStatus(res, 200);
    expect(res.body.data).toEqual([]);
  });

  it("lets the document's own driver see its history", async () => {
    const { driver, document } = await driverWithDocument("NATIONAL_ID");

    const res = await api.get(`/verification/${document.id}/history`).set(auth(driver.token));

    expectStatus(res, 200);
  });

  it("doesn't let another driver see it", async () => {
    const [{ document }, otherDriver] = await Promise.all([
      driverWithDocument("DRIVERS_LICENSE"),
      signUpByPhone("driver"),
    ]);

    const res = await api.get(`/verification/${document.id}/history`).set(auth(otherDriver.token));

    expectStatus(res, 403);
    expect(res.body.error).toBe("Missing permission: read on verification");
  });

  it("lets an admin with verification: read see any driver's history", async () => {
    const { document } = await driverWithDocument("INSURANCE");

    const res = await api.get(`/verification/${document.id}/history`).set(auth(reviewer.token));

    expectStatus(res, 200);
  });

  it("returns 404 for an unknown document", async () => {
    const id = "8b2d4f6a-1c3e-4d5b-9a7c-0e2f4b6d8a1c";

    const res = await api.get(`/verification/${id}/history`).set(auth(reviewer.token));

    expectStatus(res, 404);
  });
});
