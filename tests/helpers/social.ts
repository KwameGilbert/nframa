import { randomUUID } from "node:crypto";
import { api, expectStatus } from "./api.js";
import * as data from "./data.js";
import { newEmail } from "./unique.js";
import { trackForCleanup } from "./cleanup.js";
import type { SocialIdentity, SocialProvider } from "../../src/services/socialAuth.service.js";

// Google/Apple sign-in in tests. tests/setup.ts mocks the token check: a token is the identity it stands for, as
// JSON — providerToken() makes one.

export type Identity = Omit<SocialIdentity, "provider">;

// A Google/Apple person no account knows yet, with a verified email unless told otherwise.
export async function newIdentity(overrides: Partial<Identity> = {}): Promise<Identity> {
  const person = data.person();
  return {
    providerUserId: `test-${randomUUID()}`,
    email: await newEmail(person),
    fullName: person.fullName,
    picture: "https://lh3.googleusercontent.com/a/test-avatar",
    ...overrides,
  };
}

export function providerToken(identity: Identity) {
  return JSON.stringify(identity);
}

export async function socialLogin(
  identity: Identity,
  body: { provider?: SocialProvider; role?: "rider" | "driver"; fullName?: string } = {},
) {
  const { provider = "google", ...rest } = body;
  const res = await api
    .post("/auth/social-login")
    .send({ provider, providerToken: providerToken(identity), ...rest });
  const userId: string | undefined = res.body.data?.user?.id;
  if (userId) {
    trackForCleanup("users", { id: userId });
    trackForCleanup("authSessions", { userId });
    trackForCleanup("socialAccounts", { userId });
  }
  return res;
}

// A new rider or driver who signed up with Google: no phone number yet.
export async function signUpWithGoogle(role: "rider" | "driver" = "rider") {
  const identity = await newIdentity();
  const res = await socialLogin(identity, { role });
  expectStatus(res, 200);
  return {
    identity,
    userId: res.body.data.user.id as string,
    token: res.body.data.accessToken as string,
  };
}
