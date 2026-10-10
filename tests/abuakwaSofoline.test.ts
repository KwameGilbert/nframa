import { describe, expect, it } from "vitest";
import { api, auth, expectStatus } from "./helpers/api.js";
import { bookableCommute, bookingRider } from "./helpers/trips.js";

type AvailableTripItem = { commuteId: string };

// Exact coordinates for Abuakwa, Tanoso, Sofoline (Kumasi)
const ABUAKWA = {
  address: "Abuakwa Police station, Kumasi",
  lat: 6.701014,
  lng: -1.715833,
};

const TANOSO_MARKET = {
  address: "Tanoso Market, Kumasi",
  lat: 6.7001,
  lng: -1.683,
};

const SOFOLINE = {
  address: "Sofoline Lorry Station, Kumasi",
  lat: 6.699254,
  lng: -1.650524,
};

// Mock Accra coordinates commonly found hardcoded in frontend
const ACCRA_MOCK = {
  lat: 5.6051,
  lng: -0.1757,
};

describe("Abuakwa to Sofoline Commute Matching & Booking", () => {
  it("runs the full Abuakwa -> Sofoline flow and demonstrates why trips appear or do not appear", async () => {
    // 1. Set up approved Driver with vehicle and approved profile
    const { commute } = await bookableCommute({
      startAddress: ABUAKWA.address,
      startLat: ABUAKWA.lat,
      startLng: ABUAKWA.lng,
      endAddress: SOFOLINE.address,
      endLat: SOFOLINE.lat,
      endLng: SOFOLINE.lng,
      departureTime: "07:45",
      recurrenceDays: [1, 2, 3, 4], // Monday to Thursday
      capacity: 3,
    });

    // 2. Set up Rider with rider profile and funds
    const rider = await bookingRider(100);

    // ── SCENARIO A: Rider searches on Monday (2026-10-12) at Abuakwa (Driver's start location) ──
    const searchAbuakwa = await api.get("/trips/available").set(auth(rider.token)).query({
      lat: ABUAKWA.lat,
      lng: ABUAKWA.lng,
      date: "2026-10-12", // Monday (isoWeekday = 1)
      page: 1,
      limit: 10,
    });

    expectStatus(searchAbuakwa, 200);
    const foundAtAbuakwa = searchAbuakwa.body.data.items.find(
      (item: AvailableTripItem) => item.commuteId === commute.id,
    );
    expect(foundAtAbuakwa).toBeDefined();
    console.log("✅ SCENARIO A: Commute FOUND when rider searches at Abuakwa on Monday!");

    // ── SCENARIO B: Rider searches on Monday at Tanoso Market (~3.6 km along route) ──
    const searchTanoso = await api.get("/trips/available").set(auth(rider.token)).query({
      lat: TANOSO_MARKET.lat,
      lng: TANOSO_MARKET.lng,
      date: "2026-10-12", // Monday
      page: 1,
      limit: 10,
    });

    expectStatus(searchTanoso, 200);
    const foundAtTanoso = searchTanoso.body.data.items.find(
      (item: AvailableTripItem) => item.commuteId === commute.id,
    );
    expect(foundAtTanoso).toBeDefined();
    console.log("✅ SCENARIO B: Commute FOUND when rider searches at Tanoso Market on Monday!");

    // ── SCENARIO C: Rider searches on Saturday (2026-10-10, weekend) ──
    const searchSaturday = await api.get("/trips/available").set(auth(rider.token)).query({
      lat: ABUAKWA.lat,
      lng: ABUAKWA.lng,
      date: "2026-10-10", // Saturday (isoWeekday = 6)
      page: 1,
      limit: 10,
    });

    expectStatus(searchSaturday, 200);
    const foundOnSaturday = searchSaturday.body.data.items.find(
      (item: AvailableTripItem) => item.commuteId === commute.id,
    );
    expect(foundOnSaturday).toBeUndefined();
    console.log(
      "❌ SCENARIO C: Commute NOT found on Saturday because driver only drives Mon-Thu [1,2,3,4]!",
    );

    // ── SCENARIO D: Rider app sends hardcoded Accra mock coordinates (5.6051, -0.1757) ──
    const searchMockAccra = await api.get("/trips/available").set(auth(rider.token)).query({
      lat: ACCRA_MOCK.lat,
      lng: ACCRA_MOCK.lng,
      date: "2026-10-12",
      page: 1,
      limit: 10,
    });

    expectStatus(searchMockAccra, 200);
    const foundWithMock = searchMockAccra.body.data.items.find(
      (item: AvailableTripItem) => item.commuteId === commute.id,
    );
    expect(foundWithMock).toBeUndefined();
    console.log(
      "❌ SCENARIO D: Commute NOT found when app sends hardcoded Accra coordinates (~200 km away)!",
    );

    // ── SCENARIO E: Rider books trip (Pickup: Abuakwa, Drop-off: Tanoso Market) ──
    const bookingRes = await api
      .post("/trips")
      .set(auth(rider.token))
      .send({
        commuteId: commute.id,
        tripDate: "2026-10-12",
        pickup: {
          address: ABUAKWA.address,
          lat: ABUAKWA.lat,
          lng: ABUAKWA.lng,
        },
        dropoff: {
          address: TANOSO_MARKET.address,
          lat: TANOSO_MARKET.lat,
          lng: TANOSO_MARKET.lng,
        },
      });

    expectStatus(bookingRes, 201);
    expect(bookingRes.body.data.id).toBeDefined();
    expect(bookingRes.body.data.status).toBe("pending");
    console.log("✅ SCENARIO E: Trip successfully booked from Abuakwa to Tanoso Market!");

    // ── SCENARIO F: Rider searches without specifying date (defaults to today, does not 400) ──
    const searchNoDate = await api.get("/trips/available").set(auth(rider.token)).query({
      lat: ABUAKWA.lat,
      lng: ABUAKWA.lng,
      page: 1,
      limit: 10,
    });

    expectStatus(searchNoDate, 200);
    expect(searchNoDate.body.data.items).toBeDefined();
    console.log("✅ SCENARIO F: Omitting date succeeds with 200 and defaults to today!");
  });
});
