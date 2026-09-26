import db from "../../src/database/knex.js";
import * as data from "./data.js";

// Test records are never deleted, so realistic values would eventually repeat across runs — and a repeated
// phone number or email would sign a test into someone else's account. These pick one that isn't in the
// database yet and hasn't been handed out earlier in this run. They only read from the database.

const handedOut = new Set<string>();

async function unused<T>(
  generate: () => T,
  idOf: (value: T) => string,
  taken: (value: T) => Promise<unknown>,
): Promise<T> {
  for (let attempt = 0; attempt < 50; attempt++) {
    const value = generate();
    const id = idOf(value);
    if (!handedOut.has(id) && !(await taken(value))) {
      handedOut.add(id);
      return value;
    }
  }
  throw new Error("Couldn't find an unused value after 50 tries");
}

// A Ghana mobile number no account has.
export function newPhone() {
  return unused(
    () => ({ phoneCountryCode: data.GHANA_COUNTRY_CODE, phoneNumber: data.ghanaPhoneNumber() }),
    (phone) => `phone:${phone.phoneNumber}`,
    (phone) => db("users").where(phone).first(),
  );
}

// An email for this person that no account has.
export function newEmail(person: { firstName: string; lastName: string }) {
  return unused(
    () => data.email(person),
    (email) => `email:${email}`,
    (email) => db("users").where({ email }).first(),
  );
}

export async function newVehicle(carOwnerUserId: string) {
  const plate = await unused(
    data.plate,
    (p) => `plate:${p}`,
    (p) => db("vehicles").where({ plate: p }).first(),
  );
  return { ...data.vehicle(carOwnerUserId), plate };
}

export function newRole() {
  return unused(
    data.role,
    (role) => `role:${role.slug}`,
    (role) => db("roles").where({ slug: role.slug }).orWhere({ name: role.name }).first(),
  );
}

// A promotion whose key prefix (promotions.homowo4821) no setting uses yet.
export function newPromotion() {
  return unused(
    data.promotion,
    (promo) => `promotion:${promo.keyPrefix}`,
    (promo) => db("settings").whereLike("key", `${promo.keyPrefix}.%`).first(),
  );
}
