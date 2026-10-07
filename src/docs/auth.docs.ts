import { errorResponse, rateLimitedResponse, registry, successResponse } from "./registry.js";
import {
  loginSchema,
  requestOtpSchema,
  verifyOtpSchema,
  socialLoginSchema,
  addPhoneSchema,
  verifyPhoneSchema,
  refreshTokenSchema,
  logoutSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  changePasswordSchema,
  authTokensResponseSchema,
  loginResponseSchema,
  accountResponseSchema,
} from "../schemas/auth.schema.js";

const loginResponseDescription =
  "Returns the token pair along with the account, including its role-specific profile at user.profile (driver/rider/admin extension record). user.profile is null if the account hasn't completed that step yet (e.g. a brand-new signup with no driver profile created yet). For admins, user.adminRole and user.permissions say what they can access. isNewUser is true only when this call just signed up the account (phone OTP signup, including a deleted account re-registering, or a Google/Apple signup); it's always false for password login and email-OTP login.";

const reRegistration =
  "A deleted rider or driver account can sign up again with the same phone number: role is required as for a new number, and on verify the same account (same id, since the number is unique) is reactivated with the role chosen now and a clean profile (name, email, date of birth, picture and password cleared), every old session and linked Google/Apple sign-in is revoked, and the driver side is reset (driver profile back to unverified with no Ghana card number, address or terms acceptance; verification documents deleted; commutes paused; vehicles retired). The wallet balance, transactions and trips stay with the account. A suspended account stays suspended (403) even if it was deleted, and deleted admin accounts or email identifiers are never reactivated (403).";

const accountBlocked = errorResponse(
  "Account is suspended or deleted, or the admin account is not active",
  "Account is not active",
);

registry.registerPath({
  method: "post",
  path: "/auth/login",
  tags: ["Auth"],
  summary: "Log in with email and password",
  description: `Works for any account that has a password set — admins get one at provisioning (POST /admin) or via /auth/password/forgot. Rate limited to 10 failed attempts per email per 15 minutes. ${loginResponseDescription}`,
  request: {
    body: {
      content: { "application/json": { schema: loginSchema } },
    },
  },
  responses: {
    200: successResponse("Login successful", loginResponseSchema),
    400: errorResponse("Validation error"),
    401: errorResponse("Invalid email or password", "Invalid email or password"),
    403: accountBlocked,
    429: rateLimitedResponse,
  },
});

registry.registerPath({
  method: "post",
  path: "/auth/login/otp",
  tags: ["Auth"],
  summary: "Send a login OTP code (step 1 of OTP login)",
  description: `For phone identifiers, if no account exists yet, role is required and this becomes a signup attempt (the account is created on successful verify). ${reRegistration} Email identifiers are login-only — admin accounts are provisioned via POST /admin, never self-signed-up. The code expires after 5 minutes. A code requested with a phone number is texted, and also emailed to the account's email address if it has one (the same code, so either copy works; an account with no email, a deleted account signing up again and a brand-new number get the text only). The request fails only if no copy could be delivered. Rate limited to 5 codes per phone/email per 15 minutes.`,
  request: {
    body: {
      content: {
        "application/json": {
          schema: requestOtpSchema,
          examples: {
            phoneSignup: {
              summary: "Phone — new account (role required)",
              value: { phoneCountryCode: "+233", phoneNumber: "541436414", role: "rider" },
            },
            phoneLogin: {
              summary: "Phone — existing account",
              value: { phoneCountryCode: "+233", phoneNumber: "541436414" },
            },
            adminEmail: {
              summary: "Email — admin login",
              value: { email: "admin@nframa.com" },
            },
          },
        },
      },
    },
  },
  responses: {
    200: successResponse("Verification code sent"),
    400: errorResponse(
      "Validation error, or role missing when signing up (a new or deleted rider/driver number)",
      "role is required to sign up",
    ),
    403: accountBlocked,
    404: errorResponse(
      "No account found for this identifier (email identifiers only)",
      "No account found for this identifier",
    ),
    429: rateLimitedResponse,
  },
});

registry.registerPath({
  method: "post",
  path: "/auth/login/verify",
  tags: ["Auth"],
  summary: "Verify a login OTP code and get tokens (step 2 of OTP login)",
  description: `Send the same identifier used for /auth/login/otp, plus the code. Creates the account first if this was a phone signup (or reactivates a deleted rider/driver account — see POST /auth/login/otp). Each code allows 5 wrong attempts; rate limited to 10 failed attempts per phone/email per 15 minutes. ${loginResponseDescription}`,
  request: {
    body: {
      content: {
        "application/json": {
          schema: verifyOtpSchema,
          examples: {
            phoneSignup: {
              summary: "Phone — new account (role required)",
              value: {
                phoneCountryCode: "+233",
                phoneNumber: "541436414",
                role: "rider",
                code: "123456",
              },
            },
            phoneLogin: {
              summary: "Phone — existing account",
              value: { phoneCountryCode: "+233", phoneNumber: "541436414", code: "123456" },
            },
            adminEmail: {
              summary: "Email — admin login",
              value: { email: "admin@nframa.com", code: "123456" },
            },
          },
        },
      },
    },
  },
  responses: {
    200: successResponse("Login successful", loginResponseSchema),
    400: errorResponse(
      "Validation error, role missing when signing up, or the code is missing, expired, wrong, already used, or out of attempts",
      "Invalid verification code",
    ),
    403: accountBlocked,
    404: errorResponse(
      "No account found for this identifier (email identifiers only)",
      "No account found for this identifier",
    ),
    429: rateLimitedResponse,
  },
});

registry.registerPath({
  method: "post",
  path: "/auth/social-login",
  tags: ["Auth"],
  summary: "Sign in or sign up with Google or Apple",
  description: `Send the ID token the Google or Apple SDK gave the app. It's checked against the provider's keys and this app's client ids (GOOGLE_CLIENT_IDS / APPLE_CLIENT_IDS). It signs in to the account this Google/Apple sign-in is linked to; failing that, to the rider or driver account with the email the provider verified, which links it from then on (and marks that email verified). Otherwise it signs up a new account (role required) with the name, verified email and picture from the token, and no phone number: phoneCountryCode/phoneNumber are null until the app adds one (POST /auth/phone/otp, then /auth/phone/verify). Admin accounts can't sign in this way (403). Rate limited to 100 requests per IP per 15 minutes. ${loginResponseDescription}`,
  request: {
    body: {
      content: {
        "application/json": {
          schema: socialLoginSchema,
          examples: {
            googleSignup: {
              summary: "Google — new account (role required)",
              value: {
                provider: "google",
                providerToken:
                  "eyJhbGciOiJSUzI1NiIsImtpZCI6IjFlOWdkazcifQ.eyJzdWIiOiIxMDk4NzY1NDMyMSJ9.sig",
                role: "rider",
              },
            },
            appleFirstSignIn: {
              summary: "Apple — first sign-in, with the name Apple gave the app",
              value: {
                provider: "apple",
                providerToken:
                  "eyJhbGciOiJSUzI1NiIsImtpZCI6IllxN0w0In0.eyJzdWIiOiIwMDE0MjMuYWJjIn0.sig",
                role: "rider",
                fullName: "Ama Mensah",
              },
            },
            signIn: {
              summary: "Existing account",
              value: {
                provider: "google",
                providerToken:
                  "eyJhbGciOiJSUzI1NiIsImtpZCI6IjFlOWdkazcifQ.eyJzdWIiOiIxMDk4NzY1NDMyMSJ9.sig",
              },
            },
          },
        },
      },
    },
  },
  responses: {
    200: successResponse("Login successful", loginResponseSchema),
    400: errorResponse(
      "Validation error, or role missing when signing up",
      "role is required to sign up",
    ),
    401: errorResponse(
      "The token is malformed, expired, not signed by the provider, or issued to another app",
      "Invalid Google token",
    ),
    403: errorResponse(
      "Account is suspended or deleted, or it's an admin account",
      "Account is not active",
    ),
    409: errorResponse(
      "The same Google/Apple account is signing up in a concurrent request",
      "This account is already being set up, try signing in again",
    ),
    429: rateLimitedResponse,
    502: errorResponse(
      "Google or Apple couldn't be reached to check the token",
      "Couldn't reach Google to check the sign-in, try again",
    ),
    503: errorResponse(
      "Sign-in with this provider isn't configured on the server",
      "Google sign-in is not configured",
    ),
  },
});

const phoneless =
  "Only for a rider or driver account with no phone number yet (one that signed up with Google or Apple): changing a number someone already has stays with an admin (PATCH /users/:id, users: update).";

const phonelessRefused = {
  403: errorResponse(
    "Account is suspended or deleted, or it's an admin account",
    "Account is not active",
  ),
  409: errorResponse(
    "The account already has a phone number, or another account (deleted ones included) has this one",
    "This phone number is already in use",
  ),
};

registry.registerPath({
  method: "post",
  path: "/auth/phone/otp",
  tags: ["Auth"],
  summary: "Text a code to the phone number being added (step 1 of adding a phone)",
  description: `${phoneless} The code expires after 5 minutes and only works with POST /auth/phone/verify (a sign-in code won't). Rate limited to 5 codes per phone number per 15 minutes.`,
  security: [{ bearerAuth: [] }],
  request: {
    body: {
      content: {
        "application/json": {
          schema: addPhoneSchema,
          example: { phoneCountryCode: "+233", phoneNumber: "541436414" },
        },
      },
    },
  },
  responses: {
    200: successResponse("Verification code sent"),
    400: errorResponse("Validation error"),
    401: errorResponse("Missing or invalid access token, or the user no longer exists"),
    ...phonelessRefused,
    429: rateLimitedResponse,
  },
});

registry.registerPath({
  method: "post",
  path: "/auth/phone/verify",
  tags: ["Auth"],
  summary: "Add the phone number with the texted code (step 2 of adding a phone)",
  description: `${phoneless} Send the number and code from step 1, plus a current ID token from the Google/Apple sign-in linked to the account: the code proves the number is theirs, the token that the account is (an access token alone could have been stolen). The token is checked first, so a refused one doesn't use up the code. On success the number is saved as verified, and the account signs in with it from then on too. Returns the account as GET /auth/me does. Each code allows 5 wrong attempts; rate limited to 10 failed attempts per phone number per 15 minutes.`,
  security: [{ bearerAuth: [] }],
  request: {
    body: {
      content: {
        "application/json": {
          schema: verifyPhoneSchema,
          example: {
            phoneCountryCode: "+233",
            phoneNumber: "541436414",
            code: "123456",
            provider: "google",
            providerToken:
              "eyJhbGciOiJSUzI1NiIsImtpZCI6IjFlOWdkazcifQ.eyJzdWIiOiIxMDk4NzY1NDMyMSJ9.sig",
          },
        },
      },
    },
  },
  responses: {
    200: successResponse("Phone number added", accountResponseSchema),
    400: errorResponse(
      "Validation error, or the code is missing, expired, wrong, already used, or out of attempts",
      "Invalid verification code",
    ),
    401: errorResponse(
      "Missing or invalid access token, the user no longer exists, or the Google/Apple token is invalid",
      "Invalid Google token",
    ),
    403: errorResponse(
      "Account is suspended or deleted, it's an admin account, or the Google/Apple sign-in isn't linked to it",
      "This Google sign-in isn't linked to your account",
    ),
    409: phonelessRefused[409],
    429: rateLimitedResponse,
    502: errorResponse(
      "Google or Apple couldn't be reached to check the token",
      "Couldn't reach Google to check the sign-in, try again",
    ),
    503: errorResponse(
      "Sign-in with this provider isn't configured on the server",
      "Google sign-in is not configured",
    ),
  },
});

registry.registerPath({
  method: "post",
  path: "/auth/refresh",
  tags: ["Auth"],
  summary: "Exchange a refresh token for a new access/refresh token pair",
  description:
    "The refresh token sent is revoked — store the new pair. Rate limited to 300 requests per IP per 15 minutes.",
  request: {
    body: {
      content: { "application/json": { schema: refreshTokenSchema } },
    },
  },
  responses: {
    200: successResponse("Tokens refreshed successfully", authTokensResponseSchema),
    400: errorResponse("Validation error"),
    401: errorResponse(
      "Invalid, expired, or already-used refresh token",
      "Invalid or expired refresh token",
    ),
    403: errorResponse(
      "Account is suspended or deleted, or the admin account is not active — the session is revoked",
      "Account is not active",
    ),
    429: rateLimitedResponse,
  },
});

registry.registerPath({
  method: "get",
  path: "/auth/me",
  tags: ["Auth"],
  summary: "Get the signed-in account",
  description:
    "Same account shape as login returns (profile, and for admins adminRole + permissions) — use it to refresh the admin app's view of what the user can do after roles change.",
  security: [{ bearerAuth: [] }],
  responses: {
    200: successResponse("Account retrieved successfully", accountResponseSchema),
    401: errorResponse("Missing or invalid access token, or the user no longer exists"),
    403: accountBlocked,
  },
});

registry.registerPath({
  method: "post",
  path: "/auth/logout",
  tags: ["Auth"],
  summary: "Revoke a refresh token session (and stop this device's push notifications)",
  description:
    "Anyone holding the refresh token may call it; no access token needed (the refresh token is the authorization). Revokes that session. Send pushToken (the Expo push token, or a browser's subscription endpoint, as registered with POST /devices) to also stop push notifications to this device: it is removed in the same step, and only from the session's own account, so someone else's device is never touched. The device is not removed when the refresh token is already revoked, expired or unknown. Always 200, even if the refresh token was already invalid or the device wasn't registered, so the response says nothing about either. Recorded in the audit trail as auth.logout (tokens blanked) when a live session was signed out. Not rate limited.",
  request: {
    body: {
      content: { "application/json": { schema: logoutSchema } },
    },
  },
  responses: {
    200: successResponse("Logged out successfully"),
    400: errorResponse(
      "Validation error: a missing or empty refreshToken, or a pushToken over 2048 characters",
      "refreshToken: Invalid input: expected string, received undefined",
    ),
  },
});

registry.registerPath({
  method: "post",
  path: "/auth/password/forgot",
  tags: ["Auth"],
  summary: "Email a password reset code",
  description:
    "Always responds 200 whether or not the email has an account, so it can't be used to discover accounts. Also how a provisioned admin without a password sets their first one. The code expires after 5 minutes. Rate limited to 5 requests per email per 15 minutes.",
  request: {
    body: {
      content: { "application/json": { schema: forgotPasswordSchema } },
    },
  },
  responses: {
    200: successResponse("If an account exists for this email, a reset code has been sent"),
    400: errorResponse("Validation error"),
    429: rateLimitedResponse,
  },
});

registry.registerPath({
  method: "post",
  path: "/auth/password/reset",
  tags: ["Auth"],
  summary: "Set a new password using the emailed reset code",
  description:
    "Signs the account out of every session; log in again with the new password. Rate limited to 10 failed attempts per email per 15 minutes.",
  request: {
    body: {
      content: { "application/json": { schema: resetPasswordSchema } },
    },
  },
  responses: {
    200: successResponse("Password reset successfully. Sign in with your new password."),
    400: errorResponse(
      "Validation error, or the code is missing, expired, wrong, already used, or out of attempts",
      "Invalid verification code",
    ),
    404: errorResponse("No account found for this email", "No account found for this email"),
    429: rateLimitedResponse,
  },
});

registry.registerPath({
  method: "post",
  path: "/auth/password/change",
  tags: ["Auth"],
  summary: "Change the signed-in account's password",
  description:
    "Signs out every other session and returns a fresh token pair — replace the stored tokens with these. Rate limited to 5 failed attempts per account per 15 minutes.",
  security: [{ bearerAuth: [] }],
  request: {
    body: {
      content: { "application/json": { schema: changePasswordSchema } },
    },
  },
  responses: {
    200: successResponse("Password changed successfully", authTokensResponseSchema),
    400: errorResponse(
      "Validation error, current password incorrect, or the account has no password yet",
    ),
    401: errorResponse("Missing or invalid access token, or the user no longer exists"),
    429: rateLimitedResponse,
  },
});
