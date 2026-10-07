import { beforeAll, describe, expect, it } from "vitest";
import { api, auth, expectError, expectStatus } from "./helpers/api.js";
import { captureCode, messageCountTo, wrongCode } from "./helpers/outbox.js";
import {
  createSignedInAdmin,
  fullPhone,
  loginAsSuperAdmin,
  signUpByPhone,
} from "./helpers/actors.js";
import { newIdentity, providerToken, signUpWithGoogle, type Identity } from "./helpers/social.js";
import { newPhone } from "./helpers/unique.js";
import { trackForCleanup } from "./helpers/cleanup.js";

type Phone = { phoneCountryCode: string; phoneNumber: string };

let superAdmin: Awaited<ReturnType<typeof loginAsSuperAdmin>>;

beforeAll(async () => {
  superAdmin = await loginAsSuperAdmin();
});

// A number no account has, whose codes are cleaned up after the run.
async function freshPhone() {
  const phone = await newPhone();
  trackForCleanup("otpCodes", { identifier: fullPhone(phone) });
  return phone;
}

function requestCode(token: string, phone: Phone) {
  return api.post("/auth/phone/otp").set(auth(token)).send(phone);
}

// Texts a code to the number for the signed-in account and returns it.
function textedCode(token: string, phone: Phone) {
  return captureCode(fullPhone(phone), async () => {
    expectStatus(await requestCode(token, phone), 200);
  });
}

function verify(token: string, phone: Phone, code: string, identity: Identity) {
  return api
    .post("/auth/phone/verify")
    .set(auth(token))
    .send({ ...phone, code, provider: "google", providerToken: providerToken(identity) });
}

describe("POST /auth/phone/otp + /auth/phone/verify", () => {
  it("adds a verified phone number to a Google account, which then signs in with it too", async () => {
    const google = await signUpWithGoogle();
    const phone = await freshPhone();

    const code = await textedCode(google.token, phone);
    const res = await verify(google.token, phone, code, google.identity);

    expectStatus(res, 200);
    expect(res.body.message).toBe("Phone number added");
    expect(res.body.data).toMatchObject({
      id: google.userId,
      ...phone,
      isPhoneVerified: true,
      email: google.identity.email,
      role: "rider",
      permissions: {},
    });

    // The number is a sign-in for the same account now.
    const loginCode = await captureCode(fullPhone(phone), async () => {
      expectStatus(await api.post("/auth/login/otp").send(phone), 200);
    });
    const login = await api.post("/auth/login/verify").send({ ...phone, code: loginCode });
    expectStatus(login, 200);
    expect(login.body.data).toMatchObject({ isNewUser: false, user: { id: google.userId } });
  });

  it("needs the account's own Google sign-in, and a refused one leaves the code usable", async () => {
    const google = await signUpWithGoogle();
    const someoneElse = await signUpWithGoogle();
    const phone = await freshPhone();
    const code = await textedCode(google.token, phone);

    for (const identity of [await newIdentity(), someoneElse.identity]) {
      expectError(
        await verify(google.token, phone, code, identity),
        403,
        "This Google sign-in isn't linked to your account",
      );
    }
    const forged = await api
      .post("/auth/phone/verify")
      .set(auth(google.token))
      .send({ ...phone, code, provider: "google", providerToken: "forged" });
    expectError(forged, 401, "Invalid Google token");

    expectStatus(await verify(google.token, phone, code, google.identity), 200);
  });

  it("refuses a wrong code", async () => {
    const google = await signUpWithGoogle();
    const phone = await freshPhone();
    const code = await textedCode(google.token, phone);

    const res = await verify(google.token, phone, wrongCode(code), google.identity);

    expectError(res, 400, "Invalid verification code");
  });

  it("doesn't take a sign-in code for the number", async () => {
    const google = await signUpWithGoogle();
    const phone = await freshPhone();
    const signInCode = await captureCode(fullPhone(phone), async () => {
      expectStatus(await api.post("/auth/login/otp").send({ ...phone, role: "rider" }), 200);
    });

    const res = await verify(google.token, phone, signInCode, google.identity);

    expectError(res, 400, "No pending verification code for this identifier");
  });

  it("refuses an account that already has a phone number", async () => {
    const rider = await signUpByPhone("rider");
    const phone = await freshPhone();

    expectError(
      await requestCode(rider.token, phone),
      409,
      "This account already has a phone number",
    );
    expect(messageCountTo(fullPhone(phone))).toBe(0);
  });

  it("refuses a number another account has, and texts it nothing", async () => {
    const rider = await signUpByPhone("rider");
    const google = await signUpWithGoogle();
    const texted = messageCountTo(fullPhone(rider));

    expectError(
      await requestCode(google.token, {
        phoneCountryCode: rider.phoneCountryCode,
        phoneNumber: rider.phoneNumber,
      }),
      409,
      "This phone number is already in use",
    );
    expect(messageCountTo(fullPhone(rider))).toBe(texted);
  });

  it("refuses a number once another Google account has added it", async () => {
    const first = await signUpWithGoogle();
    const second = await signUpWithGoogle();
    const phone = await freshPhone();
    const code = await textedCode(first.token, phone);
    expectStatus(await verify(first.token, phone, code, first.identity), 200);

    expectError(await requestCode(second.token, phone), 409, "This phone number is already in use");
  });

  it("refuses admin accounts", async () => {
    const admin = await createSignedInAdmin(superAdmin.token, {});

    expectError(
      await requestCode(admin.token, await freshPhone()),
      403,
      "An admin's phone number is set by an admin with users: update",
    );
  });

  it("needs a signed-in account", async () => {
    const res = await api.post("/auth/phone/otp").send(await freshPhone());

    expectStatus(res, 401);
  });
});
