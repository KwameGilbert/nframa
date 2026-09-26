import { randomInt } from "node:crypto";

// Realistic Ghanaian test data. Tests never clear the database, so every run adds new records — anything
// with a unique constraint (phone, email, plate, role name, setting key) gets a random part.

export function pick<T>(items: readonly T[]): T {
  return items[randomInt(items.length)];
}

function digits(count: number) {
  return Array.from({ length: count }, () => randomInt(10)).join("");
}

const FIRST_NAMES = [
  "Kwame",
  "Kofi",
  "Kwabena",
  "Kwaku",
  "Yaw",
  "Kwadwo",
  "Kojo",
  "Kwesi",
  "Fiifi",
  "Ekow",
  "Ama",
  "Abena",
  "Akosua",
  "Adwoa",
  "Yaa",
  "Afua",
  "Efua",
  "Esi",
  "Araba",
  "Akua",
  "Nii",
  "Naa",
  "Dede",
  "Selasi",
  "Elikem",
  "Edem",
  "Dzifa",
  "Mawuli",
  "Ibrahim",
  "Zainab",
];

const LAST_NAMES = [
  "Mensah",
  "Asante",
  "Owusu",
  "Boateng",
  "Osei",
  "Agyeman",
  "Appiah",
  "Darko",
  "Addo",
  "Quaye",
  "Tetteh",
  "Ansah",
  "Amoah",
  "Frimpong",
  "Adjei",
  "Ofori",
  "Sarpong",
  "Acheampong",
  "Danso",
  "Opoku",
  "Nkansah",
  "Amponsah",
  "Lamptey",
  "Aryee",
  "Quartey",
  "Agbeko",
  "Dzokoto",
  "Abdulai",
  "Iddrisu",
  "Kumi",
];

const TOWNS = [
  "Accra",
  "Kumasi",
  "Tamale",
  "Takoradi",
  "Cape Coast",
  "Ho",
  "Koforidua",
  "Sunyani",
  "Tema",
  "Bolgatanga",
  "Wa",
  "Techiman",
];

export function person() {
  const firstName = pick(FIRST_NAMES);
  const lastName = pick(LAST_NAMES);
  return { firstName, lastName, fullName: `${firstName} ${lastName}` };
}

// example.com is reserved for examples (RFC 2606), so these addresses can never reach a real inbox — even
// if one of these accounts is used outside the tests later.
export function email({ firstName, lastName }: { firstName: string; lastName: string }) {
  return `${firstName}.${lastName}${randomInt(10, 10_000)}@example.com`.toLowerCase();
}

export const GHANA_COUNTRY_CODE = "+233";

// MTN, Telecel and AirtelTigo mobile prefixes, in the 9-digit form without the leading 0.
const MOBILE_PREFIXES = ["24", "54", "55", "59", "20", "50", "26", "56", "27", "57"];

export function ghanaPhoneNumber() {
  return `${pick(MOBILE_PREFIXES)}${digits(7)}`;
}

export function ghanaCardNumber() {
  return `GHA-${digits(9)}-${digits(1)}`;
}

const STREETS = [
  "Oxford Street, Osu, Accra",
  "Lagos Avenue, East Legon, Accra",
  "Spintex Road, Accra",
  "Ring Road Central, Accra",
  "Prempeh II Street, Adum, Kumasi",
  "Lake Road, Kumasi",
  "Harper Road, Kumasi",
  "Commercial Street, Cape Coast",
  "Liberation Road, Takoradi",
  "Bolgatanga Road, Tamale",
  "Harbour Road, Tema",
];

export function address() {
  return `${randomInt(1, 120)} ${pick(STREETS)}`;
}

export function password() {
  return `${pick(["Sankofa", "Adinkra", "Akwaaba", "Kente", "Nyame", "Asafo"])}-${pick(TOWNS)}-${digits(4)}!`;
}

export function department() {
  return pick([
    "Operations",
    "Customer Support",
    "Compliance",
    "Finance",
    "Fleet Management",
    "Safety",
  ]);
}

const TEAMS = [
  { team: "Support", description: "Answers rider and driver support requests" },
  { team: "Operations", description: "Monitors trips, drivers and daily operations" },
  { team: "Compliance", description: "Reviews driver documents and vehicle inspections" },
  { team: "Finance", description: "Handles payouts, refunds and fare settings" },
  { team: "Fleet", description: "Onboards drivers and keeps vehicle records up to date" },
  { team: "Customer Care", description: "Supervises the support team and handles escalations" },
];

// Role names are unique, so each gets a team number, e.g. "Kumasi Support Team 12".
export function role() {
  const { team, description } = pick(TEAMS);
  const name = `${pick(TOWNS)} ${team} Team ${randomInt(1, 1000)}`;
  return { name, slug: name.toLowerCase().replaceAll(" ", "-"), description };
}

const VEHICLES = [
  { make: "Toyota", model: "Corolla", seats: 4 },
  { make: "Toyota", model: "Camry", seats: 4 },
  { make: "Toyota", model: "Vitz", seats: 4 },
  { make: "Hyundai", model: "Elantra", seats: 4 },
  { make: "Hyundai", model: "Accent", seats: 4 },
  { make: "Kia", model: "Rio", seats: 4 },
  { make: "Kia", model: "Picanto", seats: 4 },
  { make: "Honda", model: "Civic", seats: 4 },
  { make: "Nissan", model: "Almera", seats: 4 },
  { make: "Toyota", model: "Sienna", seats: 7 },
  { make: "Toyota", model: "Hiace", seats: 14 },
];

const COLORS = ["Silver", "Black", "White", "Grey", "Blue", "Red", "Gold", "Wine"];

// Ghana plates: region code, number, and the last two digits of the registration year — "GR 4821-23".
const PLATE_REGIONS = [
  "GR",
  "GT",
  "GN",
  "GE",
  "GW",
  "GS",
  "GX",
  "AS",
  "AK",
  "CR",
  "WR",
  "ER",
  "VR",
  "NR",
];

export function plate() {
  return `${pick(PLATE_REGIONS)} ${randomInt(1000, 10_000)}-${randomInt(15, 26)}`;
}

export function vehicle(carOwnerUserId: string) {
  const { make, model, seats } = pick(VEHICLES);
  return {
    carOwnerUserId,
    make,
    model,
    year: randomInt(2008, 2025),
    color: pick(COLORS),
    plate: plate(),
    seats,
  };
}

export function otherColor(color: string) {
  return pick(COLORS.filter((c) => c !== color));
}

const CAMPAIGNS = [
  { key: "independenceDay", label: "Independence Day" },
  { key: "farmersDay", label: "Farmers' Day" },
  { key: "homowo", label: "Homowo" },
  { key: "aboakyir", label: "Aboakyir" },
  { key: "panafest", label: "PANAFEST" },
  { key: "chaleWote", label: "Chale Wote" },
  { key: "christmas", label: "Christmas" },
  { key: "easter", label: "Easter" },
];

const CORRIDORS = [
  "accra-kumasi",
  "accra-cape-coast",
  "accra-ho",
  "accra-takoradi",
  "kumasi-tamale",
  "kumasi-sunyani",
  "tema-koforidua",
];

// A fare promotion, used for settings keys like "promotions.homowo4821.discountPercent".
export function promotion() {
  const { key, label } = pick(CAMPAIGNS);
  const discountPercent = pick([5, 10, 15, 20]);
  const first = pick(CORRIDORS);
  return {
    keyPrefix: `promotions.${key}${randomInt(1000, 10_000)}`,
    label,
    discountPercent,
    corridors: [first, pick(CORRIDORS.filter((c) => c !== first))],
    bannerText: `${label} special: ${discountPercent}% off intercity trips`,
  };
}
