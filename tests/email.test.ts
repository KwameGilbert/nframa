import { randomInt, randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { sendOtpEmail } from "../src/services/email.service.js";
import { sendViaResend } from "../src/services/resend.service.js";
import { sendSms } from "../src/services/sms.service.js";
import { addDays, today } from "../src/utils/tripTime.js";
import { api, auth, expectStatus } from "./helpers/api.js";
import {
  createAdminAccount,
  createRole,
  createSignedInAdmin,
  fullPhone,
  loginAsSuperAdmin,
  signUpByPhone,
  signUpDriverWithProfile,
} from "./helpers/actors.js";
import { trackForCleanup } from "./helpers/cleanup.js";
import * as data from "./helpers/data.js";
import { captureCode } from "./helpers/outbox.js";
import { forcePaystackResult } from "./helpers/paystack.js";
import { bookableCommute, bookingRider, insertTrip, requestTrip } from "./helpers/trips.js";
import { newEmail, newPhone } from "./helpers/unique.js";

// Mails land in the sendViaResend mock (tests/setup.ts); email.service.ts and its templates run for real.

let superAdmin: Awaited<ReturnType<typeof loginAsSuperAdmin>>;
let rider: Awaited<ReturnType<typeof signUpByPhone>>;
let driver: Awaited<ReturnType<typeof signUpDriverWithProfile>>;
let tripSetup: Awaited<ReturnType<typeof bookableCommute>>;
let tripRider: Awaited<ReturnType<typeof bookingRider>>;
let driverEmail: string;
let riderEmail: string;

const failingRecipients = new Set<string>();

const sentTo = (email: string) =>
  vi
    .mocked(sendViaResend)
    .mock.calls.map(([message]) => message)
    .filter((message) => message.to === email);

// Notifications go out in the background after the response, so wait for them. Tests that share an inbox tell
// their mail apart by subject and by something only they put in it (a trip date, a reason).
const waitForMail = (email: string, subject: string, contains = "") =>
  vi.waitFor(
    () => {
      const mail = sentTo(email).find((m) => m.subject === subject && m.html.includes(contains));
      if (!mail) throw new Error(`No "${subject}" mail to ${email}`);
      return mail;
    },
    { timeout: 10_000, interval: 50 },
  );

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
  const res = await api.patch(`/users/${userId}`).set(auth(superAdmin.token)).send({ email });
  expectStatus(res, 200);
  return email;
}

function setStatus(userId: string, body: { status: string; reason?: string }) {
  return api.patch(`/users/${userId}/status`).set(auth(superAdmin.token)).send(body);
}

const failingPhones = new Set<string>();

beforeAll(async () => {
  vi.mocked(sendViaResend).mockImplementation(async ({ to }) => {
    if (failingRecipients.has(to)) throw new Error("Resend is unavailable");
  });
  vi.mocked(sendSms).mockImplementation(async (to) => {
    if (failingPhones.has(to)) throw new Error("The SMS provider is unavailable");
  });
  superAdmin = await loginAsSuperAdmin();
  [rider, driver, tripSetup, tripRider] = await Promise.all([
    signUpByPhone("rider"),
    signUpDriverWithProfile(),
    bookableCommute(),
    bookingRider(500),
  ]);
  [driverEmail, riderEmail] = await Promise.all([
    giveEmail(tripSetup.driver.userId),
    giveEmail(tripRider.userId),
  ]);
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

describe("sign-in codes", () => {
  type Phone = { phoneCountryCode: string; phoneNumber: string };
  const phoneOf = ({ phoneCountryCode, phoneNumber }: Phone) => ({ phoneCountryCode, phoneNumber });
  const requestCode = (body: object) => api.post("/auth/login/otp").send(body);

  async function accountWithEmail() {
    const person = await signUpByPhone("rider");
    return { person, phone: phoneOf(person), email: await giveEmail(person.userId) };
  }

  it("mails the code that is texted, and either copy signs in", async () => {
    const { phone, email } = await accountWithEmail();
    let smsCode = "";

    const emailCode = await captureCode(email, async () => {
      smsCode = await captureCode(fullPhone(phone), () => requestCode(phone).expect(200));
    });

    expect(emailCode).toBe(smsCode);
    const signedIn = await api.post("/auth/login/verify").send({ ...phone, code: emailCode });
    expectStatus(signedIn, 200);
  });

  it("sends an email sign-in code once, not twice", async () => {
    const admin = await createSignedInAdmin(superAdmin.token, {});

    const code = await captureCode(admin.email, () =>
      requestCode({ email: admin.email }).expect(200),
    );
    await settle();

    const codeMails = sentTo(admin.email).filter((m) => m.subject === "Your Nframa verification code");
    expect(codeMails).toHaveLength(1);
    expect(codeMails[0].html).toContain(code);
  });

  it("still delivers by SMS when the email copy can't be sent", async () => {
    const { phone, email } = await accountWithEmail();
    failingRecipients.add(email);

    const code = await captureCode(fullPhone(phone), () => requestCode(phone).expect(200));

    expect(code).toMatch(/^\d{6}$/);
    expectStatus(await api.post("/auth/login/verify").send({ ...phone, code }), 200);
  });

  it("still delivers by email when the SMS can't be sent", async () => {
    const { phone, email } = await accountWithEmail();
    failingPhones.add(fullPhone(phone));

    const code = await captureCode(email, () => requestCode(phone).expect(200));

    expectStatus(await api.post("/auth/login/verify").send({ ...phone, code }), 200);
  });

  it("fails only when no copy could be delivered", async () => {
    const { phone, email } = await accountWithEmail();
    failingRecipients.add(email);
    failingPhones.add(fullPhone(phone));

    const res = await requestCode(phone);

    expectStatus(res, 500);
  });

  it("doesn't mail a deleted account when its number signs up again", async () => {
    const { person, phone, email } = await accountWithEmail();
    await api.delete(`/users/${person.userId}`).set(auth(superAdmin.token)).expect(200);

    const code = await captureCode(fullPhone(phone), () =>
      requestCode({ ...phone, role: "rider" }).expect(200),
    );
    await settle();

    expect(code).toMatch(/^\d{6}$/);
    expect(sentTo(email).some((m) => /\b\d{6}\b/.test(m.html))).toBe(false);
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
    const suspension = await waitForMail(email, "Your Nframa account has been suspended");

    expect(suspension.html).toContain(target.fullName.split(" ")[0]);
    expect(suspension.html).toContain("Used &lt;b&gt;another&lt;/b&gt; person&#39;s card &amp; more");
    expect(suspension.html).not.toContain("<b>another</b>");

    const reactivated = await setStatus(target.userId, { status: "active" });
    expectStatus(reactivated, 200);

    await waitForMail(email, "Your Nframa account is active again");
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

describe("security mails", () => {
  it("tells the owner when their password was reset with a code", async () => {
    const target = await signUpByPhone("rider");
    const email = await giveEmail(target.userId);

    const code = await captureCode(email, () =>
      api.post("/auth/password/forgot").send({ email }).expect(200),
    );
    const reset = await api
      .post("/auth/password/reset")
      .send({ email, code, newPassword: data.password() });

    expectStatus(reset, 200);
    const mail = await waitForMail(email, "Your Nframa password was changed");
    expect(mail.html).toContain("contact Nframa support");
  });

  it("tells an admin when they change their own password", async () => {
    const admin = await createSignedInAdmin(superAdmin.token, {});

    const res = await api
      .post("/auth/password/change")
      .set(auth(admin.token))
      .send({ currentPassword: admin.password, newPassword: data.password() });

    expectStatus(res, 200);
    await waitForMail(admin.email, "Your Nframa password was changed");
  });

  it("warns the old email when the email or phone number changes", async () => {
    const target = await signUpByPhone("rider");
    const oldEmail = await giveEmail(target.userId);
    const nextEmail = await newEmail(data.person());

    const emailChange = await api
      .patch(`/users/${target.userId}`)
      .set(auth(superAdmin.token))
      .send({ email: nextEmail });
    expectStatus(emailChange, 200);
    const first = await waitForMail(oldEmail, "Your Nframa account details were changed");
    expect(first.html).toContain("email address");

    const phoneChange = await api
      .patch(`/users/${target.userId}`)
      .set(auth(superAdmin.token))
      .send(await newPhone());
    expectStatus(phoneChange, 200);
    const second = await waitForMail(nextEmail, "Your Nframa account details were changed");
    expect(second.html).toContain("phone number");
  });

  it("doesn't warn when nothing about the contact details changed", async () => {
    const target = await signUpByPhone("rider");
    const email = await giveEmail(target.userId);

    const res = await api
      .patch(`/users/${target.userId}`)
      .set(auth(superAdmin.token))
      .send({ email, fullName: "Ama Boateng" });
    await settle();

    expectStatus(res, 200);
    expect(sentTo(email).map((m) => m.subject)).not.toContain(
      "Your Nframa account details were changed",
    );
  });

  it("confirms an account deletion", async () => {
    const target = await signUpByPhone("rider");
    const email = await giveEmail(target.userId);

    const res = await api.delete(`/users/${target.userId}`).set(auth(superAdmin.token));

    expectStatus(res, 200);
    await waitForMail(email, "Your Nframa account was deleted");
  });

  it("tells a new admin they have access, and again when their access changes", async () => {
    const role = await createRole(superAdmin.token, {});
    const admin = await createAdminAccount(superAdmin.token, {
      roleId: role.id,
      status: "invited",
    });

    const granted = await waitForMail(admin.email, "You now have Nframa admin access");
    expect(granted.html).toContain(role.name);
    expect(granted.html).not.toContain(admin.password);

    const suspended = await api
      .patch(`/admin/${admin.userId}`)
      .set(auth(superAdmin.token))
      .send({ status: "suspended" });
    expectStatus(suspended, 200);
    const changed = await waitForMail(admin.email, "Your Nframa admin access changed");
    expect(changed.html).toContain("suspended");

    const same = await api
      .patch(`/admin/${admin.userId}`)
      .set(auth(superAdmin.token))
      .send({ status: "suspended" });
    await settle();
    expectStatus(same, 200);
    expect(sentTo(admin.email).filter((m) => m.subject === "Your Nframa admin access changed"))
      .toHaveLength(1);
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

describe("payment and payout method mails", () => {
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
    const verified = await waitForMail(email, "Your payment method is verified");
    expect(verified.html).toContain("My &lt;i&gt;MoMo&lt;/i&gt;");

    expectStatus(await review(id, "failed"), 200);
    await waitForMail(email, "Your payment method couldn't be verified");

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

  it("warns a driver when a payout method is added or removed", async () => {
    const owner = await signUpByPhone("driver");
    const email = await giveEmail(owner.userId);
    const paymentMethodId = await savedMethod(owner, "Payout <b>MoMo</b>");
    expectStatus(await review(paymentMethodId, "verified"), 200);

    const added = await api
      .post("/payout-methods")
      .set(auth(owner.token))
      .send({ paymentMethodId });
    expectStatus(added, 201);
    trackForCleanup("payoutMethods", { id: added.body.data.id });
    const addedMail = await waitForMail(email, "A payout method was added on your Nframa account");
    expect(addedMail.html).toContain("Payout &lt;b&gt;MoMo&lt;/b&gt;");
    expect(addedMail.html).toContain("contact Nframa support");

    const removed = await api
      .delete(`/payout-methods/${added.body.data.id}`)
      .set(auth(owner.token));
    expectStatus(removed, 200);
    await waitForMail(email, "A payout method was removed on your Nframa account");
  });
});

describe("wallet mails", () => {
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

  it("tells the owner when a top-up fails", async () => {
    const owner = await signUpByPhone("rider");
    const email = await giveEmail(owner.userId);
    trackForCleanup("transactions", { userId: owner.userId });
    trackForCleanup("wallets", { userId: owner.userId });
    const started = await api
      .post("/wallet/topup")
      .set(auth(owner.token))
      .send({ amount: 12 });
    expectStatus(started, 201);
    const { reference } = started.body.data as { reference: string };
    forcePaystackResult(reference, { status: "reversed" });

    await api.post(`/wallet/topup/${reference}/verify`).set(auth(owner.token));

    const mail = await waitForMail(email, "Your Nframa wallet top-up didn't go through");
    expect(mail.html).toContain("GHS 12.00");
  });
});

describe("trip mails", () => {
  // Each test books its own date, so its mails can be told apart in the shared inboxes.
  let dayOffset = 0;
  const nextDate = () => addDays(today(), ++dayOffset);

  async function bookTrip(tripDate: string) {
    const res = await requestTrip(tripRider, tripSetup.commute, { tripDate });
    expectStatus(res, 201);
    return res.body.data.id as string;
  }

  const asDriver = () => auth(tripSetup.driver.token);
  const asRider = () => auth(tripRider.token);

  it("emails the driver a request, and the rider when it's accepted", async () => {
    const tripDate = nextDate();
    const id = await bookTrip(tripDate);

    const request = await waitForMail(driverEmail, "New booking request", tripDate);
    expect(request.html).toContain("Danquah Circle, Osu, Accra");

    expectStatus(await api.post(`/trips/${id}/accept`).set(asDriver()), 200);
    const accepted = await waitForMail(riderEmail, "Your trip was accepted", tripDate);
    expect(accepted.html).toContain("held from your wallet");
    expect(accepted.html).toMatch(/GHS \d+\.\d{2}/);
  });

  it("emails the rider when the driver declines, with the reason escaped", async () => {
    const tripDate = nextDate();
    const id = await bookTrip(tripDate);

    const res = await api
      .post(`/trips/${id}/decline`)
      .set(asDriver())
      .send({ reason: "Car <trouble>" });

    expectStatus(res, 200);
    const mail = await waitForMail(riderEmail, "Your trip request was declined", tripDate);
    expect(mail.html).toContain("Car &lt;trouble&gt;");
  });

  it("emails the other side when a trip is cancelled", async () => {
    const byRider = nextDate();
    const byDriver = nextDate();
    const first = await bookTrip(byRider);
    const second = await bookTrip(byDriver);
    await api.post(`/trips/${first}/accept`).set(asDriver()).expect(200);
    await api.post(`/trips/${second}/accept`).set(asDriver()).expect(200);

    await api.post(`/trips/${first}/cancel`).set(asRider()).send({ reason: "Plans changed" }).expect(200);
    await api.post(`/trips/${second}/cancel`).set(asDriver()).send({ reason: "Flat tyre" }).expect(200);

    const toDriver = await waitForMail(driverEmail, "A trip was cancelled", byRider);
    expect(toDriver.html).toContain("cancelled by the rider");
    expect(toDriver.html).toContain("Plans changed");
    const toRider = await waitForMail(riderEmail, "A trip was cancelled", byDriver);
    expect(toRider.html).toContain("cancelled by the driver");
    expect(toRider.html).toContain("Flat tyre");
  });

  it("emails both sides when support cancels a trip", async () => {
    const tripDate = nextDate();
    const id = await bookTrip(tripDate);

    const res = await api
      .post(`/admin/trips/${id}/cancel`)
      .set(auth(superAdmin.token))
      .send({ reason: "Safety check" });

    expectStatus(res, 200);
    const toRider = await waitForMail(riderEmail, "A trip was cancelled", tripDate);
    const toDriver = await waitForMail(driverEmail, "A trip was cancelled", tripDate);
    expect(toRider.html).toContain("cancelled by Nframa support");
    expect(toDriver.html).toContain("Safety check");
  });

  it("sends the rider a receipt and the driver their earnings on completion", async () => {
    const id = (
      await insertTrip(tripSetup.commute, tripRider.userId, {
        status: "boarded",
        heldAmount: 0,
        scheduledPickupAt: new Date(Date.now() - 30 * 60_000),
        scheduledDropoffAt: new Date(Date.now() + 30 * 60_000),
      })
    ).id;

    const res = await api.post(`/trips/${id}/complete`).set(asDriver());

    expectStatus(res, 200);
    const receipt = await waitForMail(riderEmail, "Your trip is complete");
    expect(receipt.html).toContain("Total charged: GHS 30.04");
    const paid = await waitForMail(driverEmail, "Trip complete: you've been paid");
    expect(paid.html).toContain("GHS 26.40 was added to your wallet");
  });

  it("tells the rider they were reported as a no-show", async () => {
    const tripDate = addDays(today(), -1);
    const id = (
      await insertTrip(tripSetup.commute, tripRider.userId, {
        status: "accepted",
        heldAmount: 0,
        tripDate,
        scheduledPickupAt: new Date(Date.now() - 3 * 3_600_000),
        scheduledDropoffAt: new Date(Date.now() + 3 * 3_600_000),
      })
    ).id;

    const res = await api.post(`/trips/${id}/no-show`).set(asDriver());

    expectStatus(res, 200);
    const mail = await waitForMail(riderEmail, "You were marked as a no-show", tripDate);
    expect(mail.html).toContain("You weren't charged");
  });
});

describe("review mails", () => {
  let pastDay = 0;
  const completedTrip = () =>
    insertTrip(tripSetup.commute, tripRider.userId, {
      status: "completed",
      heldAmount: 0,
      tripDate: addDays(today(), -(10 + ++pastDay)),
    });

  it("tells a driver about a review, and about a tip when there is one", async () => {
    const plain = await completedTrip();
    const tipped = await completedTrip();

    const first = await api
      .post(`/trips/${plain.id}/reviews`)
      .set(auth(tripRider.token))
      .send({ rating: 4 });
    const second = await api
      .post(`/trips/${tipped.id}/reviews`)
      .set(auth(tripRider.token))
      .send({ rating: 5, tip: 5 });

    expectStatus(first, 201);
    expectStatus(second, 201);
    const review = await waitForMail(driverEmail, "You got a new review");
    expect(review.html).toContain("4-star");
    const tip = await waitForMail(driverEmail, "You got a review and a tip");
    expect(tip.html).toContain("tipped you GHS 5.00");
  });

  it("tells a rider about the driver's review of them", async () => {
    const trip = await completedTrip();

    const res = await api
      .post(`/trips/${trip.id}/reviews`)
      .set(auth(tripSetup.driver.token))
      .send({ rating: 3 });

    expectStatus(res, 201);
    const mail = await waitForMail(riderEmail, "You got a new review");
    expect(mail.html).toContain("3-star");
  });
});

describe("safety mails", () => {
  it("keeps the person informed from the alert to its resolution", async () => {
    const person = await signUpByPhone("rider");
    const email = await giveEmail(person.userId);
    trackForCleanup("sosIncidents", { userId: person.userId });

    const triggered = await api
      .post("/safety/sos")
      .set(auth(person.token))
      .send({ latitude: 5.60372, longitude: -0.17837 });
    expectStatus(triggered, 201);
    const received = await waitForMail(email, "We received your SOS alert");
    expect(received.html).toContain("call 112");

    const incidentId = triggered.body.data.id as string;
    const steps: [string, string][] = [
      ["underReview", "Your SOS alert is being handled"],
      ["servicesContacted", "Emergency services were contacted"],
      ["resolved", "Your SOS alert was closed"],
    ];
    for (const [status, subject] of steps) {
      const res = await api
        .patch(`/admin/safety/incidents/${incidentId}`)
        .set(auth(superAdmin.token))
        .send({ status });
      expectStatus(res, 200);
      await waitForMail(email, subject);
    }
  });
});

describe("safety mails when staff cancel", () => {
  it("tells the person their alert was cancelled, and that they can raise a new one", async () => {
    const person = await signUpByPhone("rider");
    const email = await giveEmail(person.userId);
    trackForCleanup("sosIncidents", { userId: person.userId });
    const triggered = await api
      .post("/safety/sos")
      .set(auth(person.token))
      .send({ latitude: 5.60372, longitude: -0.17837 });
    expectStatus(triggered, 201);

    const res = await api
      .post(`/admin/safety/incidents/${triggered.body.data.id}/cancel`)
      .set(auth(superAdmin.token))
      .send({ resolutionNotes: "Duplicate" });

    expectStatus(res, 200);
    const mail = await waitForMail(email, "Your SOS alert was cancelled");
    expect(mail.html).toContain("raise a new alert or call 112");
    expect(mail.html).not.toContain("Duplicate");
  });
});
