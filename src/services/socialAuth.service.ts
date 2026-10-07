import { createRemoteJWKSet, errors, jwtVerify } from "jose";
import { AppError } from "../utils/AppError.js";

export type SocialProvider = "google" | "apple";

// Who a Google or Apple ID token says the person is.
export interface SocialIdentity {
  provider: SocialProvider;
  providerUserId: string;
  // Only an address the provider has verified; null otherwise.
  email: string | null;
  fullName: string | null;
  picture: string | null;
}

// audienceEnv: the app's OAuth client ids, comma-separated (Google: the iOS, Android and web client ids; Apple:
// the bundle id and any services id). A token issued to any other app is refused.
const PROVIDERS = {
  google: {
    label: "Google",
    issuer: ["https://accounts.google.com", "accounts.google.com"],
    audienceEnv: "GOOGLE_CLIENT_IDS",
    // Fetched on first use, cached, and refetched when a token names a key it doesn't have yet.
    keys: createRemoteJWKSet(new URL("https://www.googleapis.com/oauth2/v3/certs")),
  },
  apple: {
    label: "Apple",
    issuer: "https://appleid.apple.com",
    audienceEnv: "APPLE_CLIENT_IDS",
    keys: createRemoteJWKSet(new URL("https://appleid.apple.com/auth/keys")),
  },
};

export function providerLabel(provider: SocialProvider) {
  return PROVIDERS[provider].label;
}

function optionalString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

// Checks the token's signature, issuer, audience and expiry against the provider's published keys.
export async function verifySocialToken(
  provider: SocialProvider,
  idToken: string,
): Promise<SocialIdentity> {
  const { label, issuer, audienceEnv, keys } = PROVIDERS[provider];
  const audience = (process.env[audienceEnv] ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
  if (audience.length === 0) {
    throw new AppError(`${label} sign-in is not configured`, 503);
  }

  let payload;
  try {
    ({ payload } = await jwtVerify(idToken, keys, { issuer, audience }));
  } catch (err) {
    // Every problem with the token itself is a JOSEError subclass. The base class (a non-200 key response), a
    // key fetch timing out, or a network error means the provider couldn't be reached.
    const unreachable =
      !(err instanceof errors.JOSEError) ||
      err instanceof errors.JWKSTimeout ||
      err.code === errors.JOSEError.code;
    if (!unreachable) {
      throw AppError.unauthorized(`Invalid ${label} token`);
    }
    throw AppError.badGateway(`Couldn't reach ${label} to check the sign-in, try again`);
  }
  if (!payload.sub) {
    throw AppError.unauthorized(`Invalid ${label} token`);
  }

  // Apple sends email_verified as a string.
  const emailVerified = payload.email_verified === true || payload.email_verified === "true";
  const email = optionalString(payload.email);

  return {
    provider,
    providerUserId: payload.sub,
    email: email && emailVerified ? email.toLowerCase() : null,
    // Apple never puts the name in the token — the app gets it once, on the first sign-in.
    fullName: optionalString(payload.name),
    picture: optionalString(payload.picture),
  };
}
