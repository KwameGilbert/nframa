import { settingModel } from "../models/setting.model.js";
import { CURRENCY, roundMoney } from "../utils/money.js";
import type { TripSettingKey, TripSettingValue } from "../config/tripSettings.js";

const FARE_SETTING_KEYS = [
  "fares.baseFare",
  "fares.perKmRate",
  "fares.perMinuteRate",
  "fares.waitPerMinuteRate",
  "fares.waitGraceMinutes",
  "fees.platformFeeType",
  "fees.platformFeeValue",
  "fees.bookingFeeType",
  "fees.bookingFeeValue",
] as const satisfies readonly TripSettingKey[];

export type FareSettings = { [K in (typeof FARE_SETTING_KEYS)[number]]: TripSettingValue<K> };

export interface FareLeg {
  distanceMeters: number;
  durationSeconds: number;
  waitMinutes?: number;
}

// A fee is either a fixed amount or a percentage of the fare.
function fee(type: string, value: number, fare: number) {
  return type === "percent" ? (fare * value) / 100 : value;
}

// Pure. The rider pays the fees on top of the fare; the driver earns the fare.
export function calculateFare(leg: FareLeg, s: FareSettings) {
  const base = s["fares.baseFare"];
  const distance = (leg.distanceMeters / 1000) * s["fares.perKmRate"];
  const time = (leg.durationSeconds / 60) * s["fares.perMinuteRate"];
  const chargeableWait = Math.max(0, (leg.waitMinutes ?? 0) - s["fares.waitGraceMinutes"]);
  const wait = chargeableWait * s["fares.waitPerMinuteRate"];
  const fare = roundMoney(base + distance + time + wait);
  const platformFee = roundMoney(fee(s["fees.platformFeeType"], s["fees.platformFeeValue"], fare));
  const bookingFee = roundMoney(fee(s["fees.bookingFeeType"], s["fees.bookingFeeValue"], fare));

  return {
    currency: CURRENCY,
    base: roundMoney(base),
    distance: roundMoney(distance),
    time: roundMoney(time),
    wait: roundMoney(wait),
    fare,
    platformFee,
    bookingFee,
    total: roundMoney(fare + platformFee + bookingFee),
    driverEarnings: fare,
  };
}

export function getFareSettings(): Promise<FareSettings> {
  return settingModel.getValues(FARE_SETTING_KEYS);
}
