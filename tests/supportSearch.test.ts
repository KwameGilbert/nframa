import { beforeAll, describe, expect, it } from "vitest";
import db from "../src/database/knex.js";
import { searchTerms } from "../src/models/supportSearch.js";
import { api, auth, expectStatus } from "./helpers/api.js";
import { createPhoneAccount, createSignedInAdmin, loginAsSuperAdmin, signUpByPhone } from "./helpers/actors.js";
import { seedCategory, seedMessage, seedTicket, uniqueWord } from "./helpers/support.js";

type Raiser = { id: string; fullName: string; phoneNumber: string };

let agent: { userId: string; token: string; fullName: string };
let rider: { userId: string; token: string };
let raiser: Raiser;
let categoryId: string;

beforeAll(async () => {
  const superAdmin = await loginAsSuperAdmin();
  let category;
  [agent, rider, raiser, category] = await Promise.all([
    createSignedInAdmin(superAdmin.token, { support: { read: true, update: true } }),
    signUpByPhone("rider"),
    createPhoneAccount(superAdmin.token, "rider"),
    seedCategory(),
  ]);
  categoryId = category.id;
});

// Each search is scoped to one raiser, so other tests' tickets never show up.
async function staffSearch(q: string, userId = raiser.id) {
  const res = await api
    .get("/admin/support/tickets")
    .query({ q, userId })
    .set(auth(agent.token));
  expectStatus(res, 200);
  return res.body.data.items as { id: string; matchedMessage: { snippet: string; internal: boolean; seq: number } | null }[];
}
const ids = (items: { id: string }[]) => items.map((t) => t.id);
const ticketOf = (over: Record<string, unknown> = {}, userId = raiser.id) => seedTicket(userId, categoryId, over);

describe("searchTerms", () => {
  it("reads ticket codes in any common form", () => {
    for (const q of ["ST-7KQ2MX", "7kq2mx", "st 7kq2mx", "St-7kq2mx"]) expect(searchTerms(q).code).toBe("ST-7KQ2MX");
    expect(searchTerms("receipt").code).toBeNull();
  });

  it("normalizes Ghana phone numbers", () => {
    expect(searchTerms("0241234567").phone).toBe("241234567");
    expect(searchTerms("+233 24 123 4567").phone).toBe("241234567");
    expect(searchTerms("12345").phone).toBeNull();
  });

  it("uses web search syntax only when it's used, and prefix tokens otherwise", () => {
    expect(searchTerms('"double charge"')).toMatchObject({ operators: true, tsquery: { bindings: ['"double charge"'] } });
    expect(searchTerms("refund -wallet").operators).toBe(true);
    expect(searchTerms("card OR momo").operators).toBe(true);
    expect(searchTerms("refu card").tsquery.bindings).toEqual(["refu:* & card:*", "refu:* & card:*"]);
    expect(searchTerms("a-b's (test)!").tsquery.bindings[0]).toBe("a:* & b:* & s:* & test:*");
  });

  it("escapes LIKE wildcards", () => {
    expect(searchTerms("50%_off").like).toBe("%50\\%\\_off%");
  });
});

describe("staff search", () => {
  it("finds a ticket by its code, written any way", async () => {
    const ticket = await ticketOf();
    const bare = ticket.code.slice(3);
    for (const q of [ticket.code, bare.toLowerCase(), `st ${bare}`]) expect(ids(await staffSearch(q))).toEqual([ticket.id]);
  });

  it("matches word starts and stems in messages, with a plain snippet", async () => {
    const word = uniqueWord();
    const ticket = await ticketOf();
    const message = await seedMessage(ticket.id, { senderSide: "user", body: `I was ${word} charged twice for the trip` });

    const byPrefix = await staffSearch(word.slice(0, 5));
    expect(ids(byPrefix)).toEqual([ticket.id]);
    expect(byPrefix[0].matchedMessage).toMatchObject({ seq: message.seq, internal: false });
    expect(byPrefix[0].matchedMessage!.snippet).toContain(word);
    expect(byPrefix[0].matchedMessage!.snippet).not.toMatch(/<b>|<\/b>/);
    expect(ids(await staffSearch(`${word} charges`))).toEqual([ticket.id]);

    // The stemmer turns a prefix ending in y into i ("kwxly" to "kwxli"), which alone would miss "kwxlyabc".
    const yWord = `${word.slice(0, 4)}y${uniqueWord(5)}`;
    const other = await ticketOf();
    await seedMessage(other.id, { body: `About ${yWord}` });
    expect(ids(await staffSearch(yWord.slice(0, 5)))).toEqual([other.id]);
  });

  it("forgives a typo in the subject from 4 characters on", async () => {
    const word = uniqueWord();
    const ticket = await ticketOf({ subject: `Problem with ${word}` });
    expect(ids(await staffSearch(`${word.slice(0, -1)}q`))).toEqual([ticket.id]);
    expect(await staffSearch("zqx")).toEqual([]);
  });

  it("finds the raiser by phone (0… or +233…), name and email, and the agent by name", async () => {
    const ticket = await ticketOf({ assignedAdminId: agent.userId, status: "inProgress" });
    const email = `${uniqueWord()}@example.com`;
    await db("users").where({ id: raiser.id }).update({ email });

    for (const q of [`0${raiser.phoneNumber}`, `+233${raiser.phoneNumber}`, raiser.fullName, email.toUpperCase(), agent.fullName]) {
      expect(ids(await staffSearch(q))).toContain(ticket.id);
    }
  });

  it("finds notes for staff only", async () => {
    const word = uniqueWord();
    const theirs = await ticketOf({}, rider.userId);
    await seedMessage(theirs.id, { kind: "note", body: `Checked ${word} with Paystack` });

    const found = await staffSearch(word, rider.userId);
    expect(ids(found)).toEqual([theirs.id]);
    expect(found[0].matchedMessage!.internal).toBe(true);

    const mine = await api.get("/support/tickets").query({ q: word }).set(auth(rider.token));
    expectStatus(mine, 200);
    expect(mine.body.data.items).toEqual([]);
  });

  it("honours phrases, OR and exclusions without fuzzy matches sneaking back", async () => {
    const [w1, w2, w3] = [uniqueWord(), uniqueWord(), uniqueWord()];
    const inOrder = await ticketOf();
    const reversed = await ticketOf();
    const onlyFirst = await ticketOf({ subject: `About ${w1}${w2.slice(0, 1)}` });
    await seedMessage(inOrder.id, { body: `${w1} ${w2}` });
    await seedMessage(reversed.id, { body: `${w2} ${w1} ${w3}` });
    await seedMessage(onlyFirst.id, { body: w1 });

    expect(ids(await staffSearch(`"${w1} ${w2}"`))).toEqual([inOrder.id]);
    expect(ids(await staffSearch(`${w3} OR ${w2}`)).sort()).toEqual([inOrder.id, reversed.id].sort());
    expect(ids(await staffSearch(`${w1} -${w2}`))).toEqual([onlyFirst.id]);
  });

  it("ranks a subject match above a message-only match", async () => {
    const word = uniqueWord();
    const inMessage = await ticketOf();
    await seedMessage(inMessage.id, { body: `About ${word}` });
    const inSubject = await ticketOf({ subject: `Refund for ${word}`, lastMessageAt: new Date(Date.now() - 86_400_000) });

    expect(ids(await staffSearch(word))).toEqual([inSubject.id, inMessage.id]);
  });

  it("treats stopwords and wildcards as plain text", async () => {
    await ticketOf();
    expect(await staffSearch("the")).toEqual([]);
    expect(await staffSearch("%_")).toEqual([]);
    const tooShort = await api.get("/admin/support/tickets").query({ q: "a" }).set(auth(agent.token));
    expectStatus(tooShort, 400);
  });
});

describe("a user's own search", () => {
  it("finds only the caller's tickets, by subject or their public messages", async () => {
    const word = uniqueWord();
    const mine = await ticketOf({ subject: `Card ${word}` }, rider.userId);
    const viaMessage = await ticketOf({}, rider.userId);
    await seedMessage(viaMessage.id, { body: `Your ${word} refund is on its way` });
    await ticketOf({ subject: `Card ${word}` });

    const res = await api.get("/support/tickets").query({ q: word }).set(auth(rider.token));
    expectStatus(res, 200);
    expect(ids(res.body.data.items).sort()).toEqual([mine.id, viaMessage.id].sort());
    expect(res.body.data.pagination.totalItems).toBe(2);
  });
});
