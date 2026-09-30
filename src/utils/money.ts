// Money is GHS with 2 decimals (numeric(12,2) in the database). Paystack counts in pesewas.
export const CURRENCY = "GHS";

export function roundMoney(amount: number) {
  return Math.round((amount + Number.EPSILON) * 100) / 100;
}

export function toPesewas(amount: number) {
  return Math.round(amount * 100);
}
