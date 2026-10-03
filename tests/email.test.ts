import { randomInt, randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { sendOtpEmail } from "../src/services/email.service.js";
import { sendViaResend } from "../src/services/resend.service.js";
import { api, auth, expectStatus } from "./helpers/api.js";
import { loginAsSuperAdmin, signUpByPhone, signUpDriverWithProfile } from "./helpers/actors.js";
import { trackForCleanup } from "./helpers/cleanup.js";
import * as data from "./helpers/data.js";
import { newEmail } from "./helpers/unique.js";

// Mails land in the sendViaResend mock (tests/setup.ts); email.service.ts and its templates run for real.

let superAdmin: Awaited<ReturnType<typeof loginAsSuperAdmin>>;
let rider: Awaited<ReturnType<typeof signUpByPhone>>;
let driver: Awaited<ReturnType<typeof signUpDriverWithProfile>>;

const failingRecipients = new Set<string>();

const sentTo = (email: string) =>
  vi
    .mocked(sendViaResend)
    .mock.calls.map(([message]) => message)
    .filter((message) => message.to === email);

// Notifications go out in the background after the response, so wait for them.
const mailTo = (email: string, count = 1) =>
  vi.waitFor(
    () => {
      const mails = sentTo(email);
      if (mails.length < count) throw new Error(`Expected ${count} mail(s) to ${email}`);
      return mails;
    },
    { timeout: 10_000, interval: 50 },
  );

const settle = () => new Promise((resolve) => setTimeout(resolve, 400));

async function giveEmail(userId: string) {
  const email = await newEmail(data.person());
  const res = await api
    .patch(`/users/${userId}`)
    .set(auth(superAdmin.token))
    .send({ email });
  expectStatus(res, 200);
  return email;
}

function setStatus(userId: string, body: { status: string; reason?: string }) {
  return api.patch(`/users/${userId}/status`).set(auth(superAdmin.token)).send(body);
}

beforeAll(async () => {
  vi.mocked(sendViaResend).mockImplementation(async ({ to }) => {
    if (failingRecipients.has(to)) throw new Error("Resend is unavailable");
  });
  superAdmin = await loginAsSuperAdmin();
  [rider, driver] = await Promise.all([signUpByPhone("rider"), signUpDriverWithProfile()]);
});

describe("sendOtpEmail", () => {
  it("sends the code in a branded mail, with no other six-digit number in it", async () => {
    const to = `otp.${randomUUID()}@example.com`;

    await sendOtpEmail(to, "verification code", "483920", 10);

    const [mail] = sentTo(to);
    expect(mail.subject).toBe("Your Nframa verification code");
    expect(mail.html).toContain("483920");
    expect(mail.html).toContain("expires in 10 minutes");
    expect(mail.html.match(/\b\d{6}\b/g)).toEqual(["483920"]);
  });

  it("throws when the mail can't be sent, so the request that asked for the code fails", async () => {
    const to = `otp.${randomUUID()}@example.com`;
    failingRecipients.add(to);

    await expect(sendOtpEmail(to, "verification code", "123456", 10)).rejects.toThrow(
      "Resend is unavailable",
    );
  });
});

describe("account status mails", () => {
  it("tells a suspended person why, escaping what an admin typed, and tells them when they're back", async () => {
    const target = await signUpByPhone("rider");
    const email = await giveEmail(target.userId);

    const suspended = await setStatus(target.userId, {
      status: "suspended",
      reason: "Used <b>another</b> person's card & more",
    });
    expectStatus(suspended, 200);
    const [suspension] = await mailTo(email);

    expect(suspension.subject).toBe("Your Nframa account has been suspended");
    expect(suspension.html).toContain(target.fullName.split(" ")[0]);
    expect(suspension.html).toContain("Used &lt;b&gt;another&lt;/b&gt; person&#39;s card &amp; more");
    expect(suspension.html).not.toContain("<b>another</b>");

    const reactivated = await setStatus(target.userId, { status: "active" });
    expectStatus(reactivated, 200);
    const mails = await mailTo(email, 2);

    expect(mails[1].subject).toBe("Your Nframa account is active again");
  });

  it("sends nothing to an account without an email address", async () => {
    const target = await signUpByPhone("rider");
    const marker = `Nomail${randomInt(100_000, 1_000_000)}`;
    await api
      .patch(`/users/${target.userId}`)
      .set(auth(superAdmin.token))
      .send({ fullName: `${marker} Tester` })
      .expect(200);

    const res = await setStatus(target.userId, { status: "suspended", reason: "Testing" });
    await settle();

    expectStatus(res, 200);
    const everything = vi.mocked(sendViaResend).mock.calls.map(([message]) => message.html);
    expect(everything.some((html) => html.includes(marker))).toBe(false);
  });

  it("doesn't fail the request when the mail can't be sent", async () => {
    const target = await signUpByPhone("rider");
    const email = await giveEmail(target.userId);
    failingRecipients.add(email);

    const res = await setStatus(target.userId, { status: "suspended" });

    expectStatus(res, 200);
    expect(res.body.data.status).toBe("suspended");
    await mailTo(email);
  });
});

describe("driver verification mails", () => {
  it("emails the driver when they're rejected, but not for a move back to pending", async () => {
    const email = await giveEmail(driver.userId);

    const rejected = await api
      .patch(`/admin/driver/${driver.userId}/verification`)
      .set(auth(superAdmin.token))
      .send({ verificationStatus: "rejected" });
    expectStatus(rejected, 200);
    const [mail] = await mailTo(email);

    expect(mail.subject).toBe("A driver document needs your attention");
    expect(mail.html).toContain("one of your documents was rejected");

    const pending = await api
      .patch(`/admin/driver/${driver.userId}/verification`)
      .set(auth(superAdmin.token))
      .send({ verificationStatus: "pending" });
    await settle();

    expectStatus(pending, 200);
    expect(sentTo(email)).toHaveLength(1);
  });
});

describe("payment method review mails", () => {
  async function savedMethod(owner: { token: string }, displayName: string) {
    const res = await api
      .post("/payment-methods")
      .set(auth(owner.token))
      .send({
        type: "mobile_money",
        network: "mtn",
        phoneNumber: `+233${data.ghanaPhoneNumber()}`,
        displayName,
      });
    expectStatus(res, 201);
    trackForCleanup("paymentMethods", { id: res.body.data.id });
    return res.body.data.id as string;
  }

  const review = (id: string, verificationStatus: string) =>
    api
      .patch(`/admin/payment-methods/${id}`)
      .set(auth(superAdmin.token))
      .send({ verificationStatus });

  it("tells the owner when it's verified or rejected, with their label escaped, and stays quiet on a reset", async () => {
    const owner = await signUpByPhone("rider");
    const email = await giveEmail(owner.userId);
    const id = await savedMethod(owner, "My <i>MoMo</i>");

    expectStatus(await review(id, "verified"), 200);
    const [verified] = await mailTo(email);
    expect(verified.subject).toBe("Your payment method is verified");
    expect(verified.html).toContain("My &lt;i&gt;MoMo&lt;/i&gt;");

    expectStatus(await review(id, "failed"), 200);
    const mails = await mailTo(email, 2);
    expect(mails[1].subject).toBe("Your payment method couldn't be verified");

    expectStatus(await review(id, "pending"), 200);
    await settle();
    expect(sentTo(email)).toHaveLength(2);
  });

  it("doesn't repeat itself when the status doesn't change", async () => {
    const owner = await signUpByPhone("rider");
    const email = await giveEmail(owner.userId);
    const id = await savedMethod(owner, "Repeat check");

    expectStatus(await review(id, "verified"), 200);
    await mailTo(email);
    expectStatus(await review(id, "verified"), 200);
    await settle();

    expect(sentTo(email)).toHaveLength(1);
  });
});

describe("wallet top-up receipts", () => {
  it("sends one receipt however many times the top-up is confirmed", async () => {
    const email = await giveEmail(rider.userId);
    trackForCleanup("transactions", { userId: rider.userId });
    trackForCleanup("wallets", { userId: rider.userId });
    const started = await api
      .post("/wallet/topup")
      .set(auth(rider.token))
      .send({ amount: 25.5 });
    expectStatus(started, 201);
    const { reference } = started.body.data as { reference: string };

    await Promise.all([
      api.post(`/wallet/topup/${reference}/verify`).set(auth(rider.token)),
      api.post(`/wallet/topup/${reference}/verify`).set(auth(rider.token)),
    ]);
    await api.post(`/wallet/topup/${reference}/verify`).set(auth(rider.token));
    await mailTo(email);
    await settle();

    const mails = sentTo(email);
    expect(mails).toHaveLength(1);
    expect(mails[0].subject).toBe("Your Nframa wallet was topped up");
    expect(mails[0].html).toContain("GHS 25.50");
  });
});
