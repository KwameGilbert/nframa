
BEGIN;

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================================
-- Group 1: Extensions + identity
-- ============================================================================

-- users — Shared identity for riders and car owners, keyed by phone. Role is not a column — it's the existence of a riderProfiles/carOwnerProfiles row.
CREATE TABLE "users" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "fullName" text,
  "email" text UNIQUE,
  "phoneCountryCode" text NOT NULL,
  "phoneNumber" text NOT NULL,
  "dateOfBirth" date,
  "passwordHash" text,
  "passwordSalt" text,
  "status" text NOT NULL DEFAULT 'active' CHECK ("status" IN ('active', 'suspended')),
  "profilePicture" text,
  "oauthProvider" text CHECK ("oauthProvider" IN ('google', 'facebook', 'apple')),
  "role" ENUM('riders', 'drivers', 'admin'),
  "isPhoneVerified" boolean NOT NULL DEFAULT FALSE,
  "isEmailVerified" boolean NOT NULL DEFAULT FALSE,
  "isProfileComplete" boolean NOT NULL DEFAULT FALSE,
  "lastActiveAt" timestamptz,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now(),
  "deletedAt" timestamptz,   -- soft delete + scrub PII
  UNIQUE ("phoneCountryCode", "phoneNumber")
);

-- emergencyContacts
CREATE TABLE "emergencyContacts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "userId" uuid NOT NULL REFERENCES "users"("id"),
  "name" text NOT NULL,
  "phoneCountryCode" text NOT NULL,
  "phoneNumber" text NOT NULL,
  "relationship" text NOT NULL,
  "updatedAt" timestamptz NOT NULL DEFAULT now(),
  "createdAt" timestamptz NOT NULL DEFAULT now(),
);

-- carOwnerProfiles — 1:1 car-owner-specific profile, keyed by users.id.
CREATE TABLE "carOwnerProfiles" (
  "userId" uuid PRIMARY KEY REFERENCES "users"("id"),
  "code" text NOT NULL UNIQUE,
  "verificationStatus" text NOT NULL DEFAULT 'unverified' CHECK ("verificationStatus" IN ('unverified', 'pending', 'approved', 'rejected', 'expiring')),
  "ghanaCardNumber" text,   -- e.g. GHA-123456789-0
  "address" text,
  "isOnline" boolean NOT NULL DEFAULT FALSE,   -- "Go Online" shift toggle
  "autoAcceptBookings" boolean NOT NULL DEFAULT FALSE,
  "termsAcceptedAt" timestamptz   -- post-approval /acceptance step
);

-- vehicles — A car owner's vehicle. Separate table for photos + future multi-vehicle support.
CREATE TABLE "vehicles" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "userId" uuid NOT NULL REFERENCES "users"("id"),
  "make" text NOT NULL,
  "model" text NOT NULL,
  "year" integer,
  "color" text NOT NULL,
  "plate" text NOT NULL UNIQUE,   -- e.g. GW-1234-24
  "seats" smallint NOT NULL,
  "status" text NOT NULL DEFAULT 'active' CHECK ("status" IN ('active', 'retired')),

  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now()
);


-- savedCommutes — A rider's saved default commute ("Home to Work"). Own table so multiple could coexist later.
CREATE TABLE "savedCommutes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "riderUserId" uuid NOT NULL REFERENCES "users"("id"),
  "label" text NOT NULL,   -- e.g. "Home to Work"
  "startAddress" text NOT NULL,
  "startLat" numeric(9,6) NOT NULL,
  "startLng" numeric(9,6) NOT NULL,
  "endAddress" text NOT NULL,
  "endLat" numeric(9,6) NOT NULL,
  "endLng" numeric(9,6) NOT NULL,
  "days" smallint[] NOT NULL,   -- ISO 1–7
  "departTime" time NOT NULL,
  "isActive" boolean NOT NULL DEFAULT TRUE,
  "isDefault" boolean NOT NULL DEFAULT FALSE
);

CREATE UNIQUE INDEX "uq_savedCommutes_riderUserId_partial" ON "savedCommutes" ("riderUserId") WHERE isDefault = true; -- exactly one default commute per rider

-- files — Generic upload registry (S3-style object storage; this table stores only the pointer, not bytes).
CREATE TABLE "files" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "ownerType" text NOT NULL CHECK ("ownerType" IN ('user', 'admin', 'vehicle')),
  "ownerId" uuid NOT NULL,
  "purpose" text NOT NULL CHECK ("purpose" IN ('verificationDocument', 'selfie', 'ghanaCardFront', 'ghanaCardBack', 'vehiclePhoto', 'avatar')),
  "storageKey" text NOT NULL,
  "mimeType" text NOT NULL,
  "sizeBytes" bigint NOT NULL,
  "createdAt" timestamptz NOT NULL DEFAULT now()
);

-- vehicles — A car owner's vehicle. Separate table for photos + future multi-vehicle support.
CREATE TABLE "vehicles" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "carOwnerUserId" uuid NOT NULL REFERENCES "users"("id"),
  "make" text NOT NULL,
  "model" text NOT NULL,
  "year" integer,
  "color" text NOT NULL,
  "plate" text NOT NULL UNIQUE,   -- e.g. GW-1234-24
  "seats" smallint NOT NULL,
  "status" text NOT NULL DEFAULT 'active' CHECK ("status" IN ('active', 'retired')),
  "isVerified" boolean NOT NULL DEFAULT FALSE,
  "verificationDate" timestamptz,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now()
);

-- ============================================================================
-- Group 2: Admin & auth
-- ============================================================================

-- roles — Admin-creatable role definitions driving sidebar/module visibility.
CREATE TABLE "roles" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "slug" text NOT NULL UNIQUE,   -- e.g. "support-admin"
  "name" text NOT NULL UNIQUE,
  "description" text NOT NULL,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now()
);

-- permissions — Admin-creatable permission definitions, assigned to roles.
CREATE TABLE "rolePermissions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "roleId" uuid NOT NULL REFERENCES "roles"("id"),
  "permission" json NOT NULL
);

-- adminUsers — Administration-console operators. A separate identity realm from users (email + password/OTP, not phone).
CREATE TABLE "adminUsers" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "roleId" uuid NOT NULL REFERENCES "roles"("id") ON DELETE RESTRICT,
  "department" text,
  "status" text NOT NULL DEFAULT 'invited' CHECK ("status" IN ('active', 'suspended', 'invited')),

  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now()
);

-- otpCodes — One-time login/verification codes for phone (rider/driver) and email (admin) auth.
CREATE TABLE "otpCodes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "identifier" text NOT NULL,   -- phone (phoneCountryCode+phoneNumber concatenated, no separators) or email
  "channel" text NOT NULL CHECK ("channel" IN ('sms', 'email')),
  "purpose" text NOT NULL CHECK ("purpose" IN ('riderLogin', 'driverLogin', 'adminLogin', 'passwordReset')),
  "codeHash" text NOT NULL,
  "expiresAt" timestamptz NOT NULL,
  "consumedAt" timestamptz,
  "attemptCount" smallint NOT NULL DEFAULT 0,
  "createdAt" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX "idx_otpCodes_identifier_purpose_createdAt" ON "otpCodes" ("identifier", "purpose", "createdAt");

-- oneTimeTokens — Short-lived single-use tokens: admin forgot-password step-2 resetToken, future invite-activation links.
CREATE TABLE "oneTimeTokens" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "userType" text NOT NULL CHECK ("userType" IN ('admin', 'user')),
  "userId" uuid NOT NULL,   -- polymorphic — may reference: adminUsers.id, users.id (no FK constraint)
  "kind" text NOT NULL CHECK ("kind" IN ('passwordReset', 'adminInvite')),
  "tokenHash" text NOT NULL UNIQUE,
  "expiresAt" timestamptz NOT NULL,
  "consumedAt" timestamptz,
  "createdAt" timestamptz NOT NULL DEFAULT now()
);

-- authSessions — Refresh-token sessions for both the user (rider/driver) and admin realms.
CREATE TABLE "authSessions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "userType" text NOT NULL CHECK ("userType" IN ('user', 'admin')),
  "userId" uuid NOT NULL,   -- polymorphic — may reference: users.id, adminUsers.id (no FK constraint)
  "refreshTokenHash" text NOT NULL UNIQUE,
  "userAgent" text,
  "ipAddress" inet NOT NULL,
  "lastUsedAt" timestamptz NOT NULL,
  "expiresAt" timestamptz NOT NULL,
  "revokedAt" timestamptz,
  "createdAt" timestamptz NOT NULL DEFAULT now()
);

-- activityLogs — Auditable log of user/admin actions, for security and compliance.
CREATE TABLE "activityLogs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "userType" text NOT NULL CHECK ("userType" IN ('user', 'admin')),
  "userId" uuid NOT NULL,   -- polymorphic — may reference: users.id, adminUsers.id (no FK constraint)
  "actionType" text NOT NULL,
  "action" text NOT NULL,
  "beforeData" json,
  "afterdata" json,
  "ipAddress" inet,
  "userAgent" text,
  "createdAt" timestamptz NOT NULL DEFAULT now()
);
