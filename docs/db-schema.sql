-- ============================================================================
-- Nframa — PostgreSQL schema (generated from docs/db-schema.json)
--
-- This file is a reference DDL dump, generated mechanically from the single
-- source of truth at docs/db-schema.json. Per CLAUDE.md, this project runs
-- migrations as Knex TypeScript files under database/migrations/, NOT raw
-- .sql files — use this as the authoritative reference when authoring those
-- migrations (via `pnpm db:migrate:make <name>`), or to stand up a scratch
-- database for prototyping / ERD generation.
--
-- Naming: every table/column is camelCase and therefore double-quoted
-- throughout — Postgres folds unquoted identifiers to lowercase.
-- Enums are modeled as `text` + CHECK constraints, not native Postgres enums,
-- matching this project's convention (see docs/db-schema.md §1).
-- ============================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ----------------------------------------------------------------------------
-- Sequences backing human-facing display codes (e.g. TRP-7210). These are
-- NEVER primary keys — see the `code` column on each table below.
-- ----------------------------------------------------------------------------
CREATE SEQUENCE IF NOT EXISTS "riderProfilesCodeSeq";
CREATE SEQUENCE IF NOT EXISTS "carOwnerProfilesCodeSeq";
CREATE SEQUENCE IF NOT EXISTS "suspensionCasesCodeSeq";
CREATE SEQUENCE IF NOT EXISTS "adminUsersCodeSeq";
CREATE SEQUENCE IF NOT EXISTS "routesCodeSeq";
CREATE SEQUENCE IF NOT EXISTS "verificationApplicationsCodeSeq";
CREATE SEQUENCE IF NOT EXISTS "tripsCodeSeq";
CREATE SEQUENCE IF NOT EXISTS "bookingsCodeSeq";
CREATE SEQUENCE IF NOT EXISTS "boardingScansCodeSeq";
CREATE SEQUENCE IF NOT EXISTS "tripUpdateFailuresCodeSeq";
CREATE SEQUENCE IF NOT EXISTS "misconductReportsCodeSeq";
CREATE SEQUENCE IF NOT EXISTS "tripDisputesCodeSeq";
CREATE SEQUENCE IF NOT EXISTS "withdrawalRequestsCodeSeq";
CREATE SEQUENCE IF NOT EXISTS "payoutApprovalsCodeSeq";
CREATE SEQUENCE IF NOT EXISTS "refundRequestsCodeSeq";
CREATE SEQUENCE IF NOT EXISTS "sosAlertsCodeSeq";
CREATE SEQUENCE IF NOT EXISTS "supportTicketsCodeSeq";
CREATE SEQUENCE IF NOT EXISTS "broadcastsCodeSeq";
CREATE SEQUENCE IF NOT EXISTS "settingsChangeLogsCodeSeq";

-- ============================================================================
-- Group 1: Extensions + identity
-- ============================================================================

-- users — Shared identity for riders and car owners, keyed by phone. Role is not a column — it's the existence of a riderProfiles/carOwnerProfiles row.
CREATE TABLE "users" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),   -- used in QR payloads and JWT `sub`
  "phoneCountryCode" text NOT NULL,   -- numeric calling code, no + (e.g. "233")
  "phoneNumber" text NOT NULL,   -- national significant number only, no leading 0 (e.g. "201234567")
  "fullName" text,
  "email" text UNIQUE,
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


-- driversProfile — 1:1 driver-specific profile, keyed by users.id.
CREATE TABLE "driversProfile" (
  "userId" uuid PRIMARY KEY REFERENCES "users"("id"),
  "code" text NOT NULL UNIQUE DEFAULT ('CAR-' || nextval('"carOwnerProfilesCodeSeq"')),
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
  "ownerId" uuid NOT NULL,   -- polymorphic — may reference: users.id, adminUsers.id, vehicles.id (no FK constraint)
  "purpose" text NOT NULL CHECK ("purpose" IN ('verificationDocument', 'selfie', 'ghanaCardFront', 'ghanaCardBack', 'vehiclePhoto', 'avatar')),
  "storageKey" text NOT NULL,
  "mimeType" text NOT NULL,
  "sizeBytes" bigint NOT NULL,
  "createdAt" timestamptz NOT NULL DEFAULT now()
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
  "permittedModules" jsonb NOT NULL,   -- array of navConfig module ids
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now()
);

-- adminUsers — Administration-console operators. A separate identity realm from users (email + password/OTP, not phone).
CREATE TABLE "adminUsers" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "code" text NOT NULL UNIQUE DEFAULT ('ADM-' || nextval('"adminUsersCodeSeq"')),
  "name" text NOT NULL,
  "email" text NOT NULL UNIQUE,
  "passwordHash" text NOT NULL,   -- argon2/bcrypt
  "avatarFileId" uuid REFERENCES "files"("id"),
  "roleId" uuid NOT NULL REFERENCES "roles"("id") ON DELETE RESTRICT,
  "department" text,
  "status" text NOT NULL DEFAULT 'invited' CHECK ("status" IN ('active', 'suspended', 'invited')),
  "lastLoginAt" timestamptz,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now()
);

ALTER SEQUENCE "adminUsersCodeSeq" OWNED BY "adminUsers"."code";

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
  "subjectType" text NOT NULL CHECK ("subjectType" IN ('admin', 'user')),
  "subjectId" uuid NOT NULL,   -- polymorphic — may reference: adminUsers.id, users.id (no FK constraint)
  "kind" text NOT NULL CHECK ("kind" IN ('passwordReset', 'adminInvite')),
  "tokenHash" text NOT NULL UNIQUE,
  "expiresAt" timestamptz NOT NULL,
  "consumedAt" timestamptz,
  "createdAt" timestamptz NOT NULL DEFAULT now()
);

-- authSessions — Refresh-token sessions for both the user (rider/driver) and admin realms.
CREATE TABLE "authSessions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "subjectType" text NOT NULL CHECK ("subjectType" IN ('user', 'admin')),
  "subjectId" uuid NOT NULL,   -- polymorphic — may reference: users.id, adminUsers.id (no FK constraint)
  "refreshTokenHash" text NOT NULL UNIQUE,
  "userAgent" text,
  "ipAddress" inet NOT NULL,
  "lastUsedAt" timestamptz NOT NULL,
  "expiresAt" timestamptz NOT NULL,
  "revokedAt" timestamptz,
  "createdAt" timestamptz NOT NULL DEFAULT now()
);

-- suspensionCases — A user account suspension. Reinstating closes the case (reinstatedAt set) rather than deleting it, so history survives.
CREATE TABLE "suspensionCases" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "code" text NOT NULL UNIQUE DEFAULT ('SUS-' || nextval('"suspensionCasesCodeSeq"')),
  "userId" uuid NOT NULL REFERENCES "users"("id"),
  "reason" text NOT NULL,
  "reviewStatus" text NOT NULL CHECK ("reviewStatus" IN ('appealPending', 'underReview', 'actionRequired', 'escalated', 'noAppeal', 'cleared')),
  "restrictions" text NOT NULL,
  "notes" text NOT NULL,
  "suspendedByAdminId" uuid REFERENCES "adminUsers"("id"),   -- NULL = "System"
  "suspendedAt" timestamptz NOT NULL DEFAULT now(),
  "reinstatedAt" timestamptz,
  "reinstatedByAdminId" uuid REFERENCES "adminUsers"("id")
);

ALTER SEQUENCE "suspensionCasesCodeSeq" OWNED BY "suspensionCases"."code";

CREATE UNIQUE INDEX "uq_suspensionCases_userId_partial" ON "suspensionCases" ("userId") WHERE "reinstatedAt" IS NULL; -- at most one open case per user

-- ============================================================================
-- Group 3: Catalog
-- ============================================================================

-- operatingCities — Cities the platform operates in.
CREATE TABLE "operatingCities" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "name" text NOT NULL UNIQUE,
  "createdAt" timestamptz NOT NULL DEFAULT now()
);

-- routes — Admin-managed fixed corridors that trips run on.
CREATE TABLE "routes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "code" text NOT NULL UNIQUE DEFAULT ('RTE-' || nextval('"routesCodeSeq"')),
  "name" text NOT NULL,   -- e.g. "Accra–Tema Express"
  "corridor" text NOT NULL,   -- grouping/filter label, e.g. "Accra–Tema" — see open question about promoting to its own table
  "originName" text NOT NULL,
  "originLat" numeric(9,6),
  "originLng" numeric(9,6),
  "destinationName" text NOT NULL,
  "destinationLat" numeric(9,6),
  "destinationLng" numeric(9,6),
  "cityId" uuid REFERENCES "operatingCities"("id") ON DELETE RESTRICT,
  "distanceKm" numeric(6,2) NOT NULL,
  "baseFarePesewas" bigint NOT NULL,
  "perKmRatePesewas" bigint NOT NULL,
  "status" text NOT NULL DEFAULT 'active' CHECK ("status" IN ('active', 'inactive', 'underReview')),
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now()
);

ALTER SEQUENCE "routesCodeSeq" OWNED BY "routes"."code";

-- routeAssignments — Which car owners currently serve which route.
CREATE TABLE "routeAssignments" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "routeId" uuid NOT NULL REFERENCES "routes"("id"),
  "carOwnerUserId" uuid NOT NULL REFERENCES "users"("id"),
  "assignedAt" timestamptz NOT NULL DEFAULT now(),
  "unassignedAt" timestamptz
);

CREATE UNIQUE INDEX "uq_routeAssignments_routeId_carOwnerUserId_partial" ON "routeAssignments" ("routeId", "carOwnerUserId") WHERE "unassignedAt" IS NULL; -- a car owner has at most one active assignment to a given route at a time

-- ============================================================================
-- Group 4: Verification
-- ============================================================================

-- verificationApplications — A car owner's driver-verification application.
CREATE TABLE "verificationApplications" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "code" text NOT NULL UNIQUE DEFAULT ('VER-' || nextval('"verificationApplicationsCodeSeq"')),
  "carOwnerUserId" uuid NOT NULL REFERENCES "users"("id"),
  "vehicleId" uuid NOT NULL REFERENCES "vehicles"("id"),
  "status" text NOT NULL DEFAULT 'pending' CHECK ("status" IN ('pending', 'approved', 'rejected', 'expiring', 'resubmitted')),
  "priority" text NOT NULL CHECK ("priority" IN ('low', 'medium', 'high')),   -- computed by a scheduled job (wait-time + document expiry proximity), never admin-set
  "submittedAt" timestamptz NOT NULL DEFAULT now(),
  "reviewerAdminId" uuid REFERENCES "adminUsers"("id"),
  "decidedAt" timestamptz,
  "rejectionReason" text,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now(),
  "deletedAt" timestamptz
);

ALTER SEQUENCE "verificationApplicationsCodeSeq" OWNED BY "verificationApplications"."code";

-- verificationDocuments — One row per submitted document VERSION — a resubmission inserts a new row pointing at the one it replaces.
CREATE TABLE "verificationDocuments" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "applicationId" uuid NOT NULL REFERENCES "verificationApplications"("id"),
  "type" text NOT NULL CHECK ("type" IN ('drivingLicence', 'registration', 'insurance', 'roadworthy', 'selfie', 'ghanaCardFront', 'ghanaCardBack', 'vehiclePhoto')),
  "fileId" uuid NOT NULL REFERENCES "files"("id"),
  "issueDate" date,
  "expiryDate" date,
  "status" text NOT NULL DEFAULT 'pendingReview' CHECK ("status" IN ('pendingReview', 'approved', 'rejected', 'expiringSoon', 'resubmitted')),
  "reviewerAdminId" uuid REFERENCES "adminUsers"("id"),
  "reviewedAt" timestamptz,
  "rejectionReasonCode" text CHECK ("rejectionReasonCode" IN ('unverifiable', 'mismatch', 'expired', 'illegible', 'other')),
  "rejectionNotes" text,
  "checks" jsonb,   -- pipeline/automated verification check labels
  "replacesDocumentId" uuid REFERENCES "verificationDocuments"("id"),   -- self-referencing; "current" doc per type = latest with no row referencing it
  "createdAt" timestamptz NOT NULL DEFAULT now()
);

-- verificationEvents — Append-only timeline/activity log for a verification application.
CREATE TABLE "verificationEvents" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "applicationId" uuid NOT NULL REFERENCES "verificationApplications"("id"),
  "label" text NOT NULL,
  "detail" text,   -- e.g. a sent-notification's full HTML body
  "tone" text NOT NULL CHECK ("tone" IN ('success', 'danger', 'warning', 'info', 'neutral')),
  "actorType" text NOT NULL CHECK ("actorType" IN ('admin', 'carOwner', 'system')),
  "actorAdminId" uuid REFERENCES "adminUsers"("id"),
  "createdAt" timestamptz NOT NULL DEFAULT now()
);

-- ============================================================================
-- Group 5: Trips
-- ============================================================================

-- schedules — A car owner's commute template — one-off or recurring (e.g. Mon–Fri). A background job materializes concrete trips from active schedules.
CREATE TABLE "schedules" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "carOwnerUserId" uuid NOT NULL REFERENCES "users"("id"),
  "routeId" uuid NOT NULL REFERENCES "routes"("id"),
  "vehicleId" uuid NOT NULL REFERENCES "vehicles"("id"),
  "departTime" time NOT NULL,
  "recurrenceDays" smallint[],   -- ISO 1–7; NULL = one-off
  "oneOffDate" date,
  "startsOn" date NOT NULL,
  "endsOn" date,
  "seatsOffered" smallint NOT NULL,
  "status" text NOT NULL DEFAULT 'active' CHECK ("status" IN ('active', 'paused', 'cancelled')),
  CHECK ((("recurrenceDays" IS NOT NULL) AND ("oneOffDate" IS NULL)) OR (("recurrenceDays" IS NULL) AND ("oneOffDate" IS NOT NULL)))
);

-- trips — One concrete departure on a date. Route facts are snapshotted at creation so later route edits can't rewrite history.
CREATE TABLE "trips" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "code" text NOT NULL UNIQUE DEFAULT ('TRP-' || nextval('"tripsCodeSeq"')),
  "scheduleId" uuid REFERENCES "schedules"("id"),   -- NULL for ad-hoc one-offs
  "routeId" uuid NOT NULL REFERENCES "routes"("id"),
  "carOwnerUserId" uuid NOT NULL REFERENCES "users"("id"),
  "vehicleId" uuid NOT NULL REFERENCES "vehicles"("id"),
  "originName" text NOT NULL,   -- snapshot of route.originName at trip creation
  "originDetail" text,   -- e.g. "Achimota, Accra"
  "destinationName" text NOT NULL,
  "destinationDetail" text,
  "corridor" text NOT NULL,
  "departureAt" timestamptz NOT NULL,   -- the 2-hour freeze rule's anchor
  "seatsTotal" smallint NOT NULL,
  "farePesewas" bigint NOT NULL,   -- per seat, snapshotted from route pricing
  "status" text NOT NULL DEFAULT 'scheduled' CHECK ("status" IN ('scheduled', 'inTransit', 'completed', 'cancelled')),
  "startedAt" timestamptz,
  "completedAt" timestamptz,
  "cancelledAt" timestamptz,
  "cancelledByType" text CHECK ("cancelledByType" IN ('rider', 'carOwner', 'system', 'admin')),
  "cancelledById" uuid,   -- polymorphic — may reference: users.id, adminUsers.id (no FK constraint)
  "cancelReason" text,
  "lastLat" numeric(9,6),
  "lastLng" numeric(9,6),
  "positionUpdatedAt" timestamptz,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now()
);

ALTER SEQUENCE "tripsCodeSeq" OWNED BY "trips"."code";

CREATE INDEX "idx_trips_status_departureAt" ON "trips" ("status", "departureAt");
CREATE INDEX "idx_trips_carOwnerUserId_departureAt" ON "trips" ("carOwnerUserId", "departureAt");
CREATE INDEX "idx_trips_routeId" ON "trips" ("routeId");

-- bookings — One rider's seat reservation on a trip.
CREATE TABLE "bookings" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "code" text NOT NULL UNIQUE DEFAULT ('BKG-' || nextval('"bookingsCodeSeq"')),
  "tripId" uuid NOT NULL REFERENCES "trips"("id"),
  "riderUserId" uuid NOT NULL REFERENCES "users"("id"),
  "seats" smallint NOT NULL DEFAULT 1,
  "status" text NOT NULL DEFAULT 'requested' CHECK ("status" IN ('requested', 'confirmed', 'boarded', 'completed', 'rejected', 'cancelled', 'noShow')),
  "farePesewas" bigint NOT NULL,   -- snapshot: trip fare × seats
  "paidWith" text CHECK ("paidWith" IN ('walletCash', 'walletCredit', 'transitPass')),
  "transitPassId" uuid,
  "qrToken" text NOT NULL UNIQUE,   -- random opaque server-issued token encoded in the boarding QR — NOT the guessable NFR-USERID-SCHEDULEID display format
  "confirmedAt" timestamptz,
  "boardedAt" timestamptz,
  "cancelledAt" timestamptz,
  "cancelledBy" text CHECK ("cancelledBy" IN ('rider', 'carOwner', 'system', 'admin')),
  "cancelReason" text,   -- standardized reasons, e.g. "Personal Emergency"
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now(),
  UNIQUE ("tripId", "riderUserId")
);

ALTER SEQUENCE "bookingsCodeSeq" OWNED BY "bookings"."code";

CREATE INDEX "idx_bookings_riderUserId_status" ON "bookings" ("riderUserId", "status");
CREATE INDEX "idx_bookings_tripId_status" ON "bookings" ("tripId", "status");

-- boardingScans — Append-only log of every QR boarding scan attempt, including failed ones.
CREATE TABLE "boardingScans" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "code" text NOT NULL UNIQUE DEFAULT ('QR-' || nextval('"boardingScansCodeSeq"')),
  "tripId" uuid NOT NULL REFERENCES "trips"("id"),
  "bookingId" uuid REFERENCES "bookings"("id"),   -- NULL when the scan matched nothing
  "scannedByUserId" uuid NOT NULL REFERENCES "users"("id"),   -- the driver
  "payloadRaw" text NOT NULL,
  "result" text NOT NULL CHECK ("result" IN ('valid', 'invalidFare', 'duplicate', 'noMatch')),
  "scannedAt" timestamptz NOT NULL DEFAULT now()
);

ALTER SEQUENCE "boardingScansCodeSeq" OWNED BY "boardingScans"."code";

-- tripUpdateFailures — Telemetry/status-sync failures needing manual admin attention.
CREATE TABLE "tripUpdateFailures" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "code" text NOT NULL UNIQUE DEFAULT ('FLR-' || nextval('"tripUpdateFailuresCodeSeq"')),
  "tripId" uuid NOT NULL REFERENCES "trips"("id"),
  "failureType" text NOT NULL CHECK ("failureType" IN ('gpsTimeout', 'statusSyncError', 'paymentWebhookFailed')),
  "details" jsonb,
  "occurredAt" timestamptz NOT NULL,
  "resolved" boolean NOT NULL DEFAULT FALSE,
  "resolvedByAdminId" uuid REFERENCES "adminUsers"("id"),
  "resolvedAt" timestamptz
);

ALTER SEQUENCE "tripUpdateFailuresCodeSeq" OWNED BY "tripUpdateFailures"."code";

-- ratings — A trip-participant rating another participant after a completed trip.
CREATE TABLE "ratings" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tripId" uuid NOT NULL REFERENCES "trips"("id"),
  "bookingId" uuid NOT NULL REFERENCES "bookings"("id"),
  "raterUserId" uuid NOT NULL REFERENCES "users"("id"),
  "rateeUserId" uuid NOT NULL REFERENCES "users"("id"),
  "score" smallint NOT NULL CHECK ("score" BETWEEN 1 AND 5),   -- CHECK 1–5
  "comment" text,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  UNIQUE ("bookingId", "raterUserId")
);

-- misconductReports — A rider-filed misconduct report against a car owner. Governs a PERSON (behavior, account consequences) — see tripDisputes for trip-facts issues.
CREATE TABLE "misconductReports" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "code" text NOT NULL UNIQUE DEFAULT ('MIS-' || nextval('"misconductReportsCodeSeq"')),
  "tripId" uuid NOT NULL REFERENCES "trips"("id"),
  "reportedByUserId" uuid NOT NULL REFERENCES "users"("id"),   -- the rider
  "againstUserId" uuid NOT NULL REFERENCES "users"("id"),   -- the car owner
  "category" text NOT NULL,   -- curated picklist in the app, stored as free text
  "description" text NOT NULL,
  "severity" text NOT NULL CHECK ("severity" IN ('high', 'medium', 'low')),
  "status" text NOT NULL DEFAULT 'open' CHECK ("status" IN ('open', 'investigating', 'resolved', 'dismissed')),
  "reportedAt" timestamptz NOT NULL DEFAULT now(),
  "resolvedAt" timestamptz,
  "handledByAdminId" uuid REFERENCES "adminUsers"("id")
);

ALTER SEQUENCE "misconductReportsCodeSeq" OWNED BY "misconductReports"."code";

-- tripDisputes — A fare/route/damage dispute raised after a trip completes. Fixes a TRIP (money/facts) — see misconductReports for person-facing issues.
CREATE TABLE "tripDisputes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "code" text NOT NULL UNIQUE DEFAULT ('DSP-' || nextval('"tripDisputesCodeSeq"')),
  "tripId" uuid NOT NULL REFERENCES "trips"("id"),
  "bookingId" uuid REFERENCES "bookings"("id"),
  "raisedByUserId" uuid NOT NULL REFERENCES "users"("id"),
  "category" text NOT NULL,
  "amountPesewas" bigint,   -- omitted for non-monetary disputes
  "status" text NOT NULL DEFAULT 'open' CHECK ("status" IN ('open', 'underReview', 'resolved', 'escalated')),
  "openedAt" timestamptz NOT NULL DEFAULT now(),
  "resolvedAt" timestamptz,
  "resolutionNotes" text
);

ALTER SEQUENCE "tripDisputesCodeSeq" OWNED BY "tripDisputes"."code";

-- ============================================================================
-- Group 6: Finance
-- ============================================================================

-- walletAccounts — One row per (user, balance bucket) — models the four distinct rider/car-owner wallet balances.
CREATE TABLE "walletAccounts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "userId" uuid NOT NULL REFERENCES "users"("id"),
  "accountType" text NOT NULL CHECK ("accountType" IN ('riderCash', 'riderCredit', 'ownerAvailable', 'ownerPending')),
  "balancePesewas" bigint NOT NULL DEFAULT 0,   -- cache; authoritative value = SUM(walletTransactions.amountPesewas), reconciled by a job
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now(),
  UNIQUE ("userId", "accountType")
);

-- walletTransactions — Append-only ledger. Every money movement is a row here; nothing edits or deletes one — corrections are reversal entries.
CREATE TABLE "walletTransactions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "accountId" uuid NOT NULL REFERENCES "walletAccounts"("id"),
  "amountPesewas" bigint NOT NULL,   -- signed; negative = money out
  "balanceAfterPesewas" bigint NOT NULL,   -- running balance for statements
  "type" text NOT NULL CHECK ("type" IN ('topup', 'tripPayment', 'tripEarning', 'commission', 'pendingRelease', 'payout', 'payoutFee', 'refund', 'serviceCredit', 'passPurchase', 'adjustment', 'reversal')),
  "referenceType" text,   -- e.g. "booking", "trip", "withdrawalRequest", "refundRequest", "transitPass"
  "referenceId" uuid,   -- polymorphic — may reference: bookings.id, trips.id, withdrawalRequests.id, refundRequests.id, transitPasses.id (no FK constraint)
  "gateway" text,
  "gatewayReference" text,
  "gatewayStatus" text,
  "createdByAdminId" uuid REFERENCES "adminUsers"("id"),   -- set for manual adjustments
  "note" text,
  "idempotencyKey" text UNIQUE,   -- webhook/retry safety
  "createdAt" timestamptz NOT NULL DEFAULT now()
);

-- paymentMethods — A rider's funding sources (cards/MoMo). Only PSP tokens and masked display strings are stored — never raw PANs/full numbers.
CREATE TABLE "paymentMethods" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "userId" uuid NOT NULL REFERENCES "users"("id"),
  "kind" text NOT NULL CHECK ("kind" IN ('card', 'momo')),
  "provider" text NOT NULL,   -- visa / mastercard / mtn / telecel / at
  "maskedDetails" text NOT NULL,   -- e.g. "024•••1148", "•••• 4242"
  "gatewayToken" text NOT NULL,   -- tokenized at the PSP
  "isDefault" boolean NOT NULL DEFAULT FALSE,
  "createdAt" timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX "uq_paymentMethods_userId_partial" ON "paymentMethods" ("userId") WHERE "isDefault" = true; -- at most one default payment method per rider

-- payoutAccounts — A car owner's payout destination (Mobile Money or bank account).
CREATE TABLE "payoutAccounts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "carOwnerUserId" uuid NOT NULL REFERENCES "users"("id"),
  "method" text NOT NULL CHECK ("method" IN ('mobileMoney', 'bankAccount')),
  "provider" text NOT NULL,
  "accountName" text NOT NULL,
  "maskedDetails" text NOT NULL,
  "gatewayToken" text,
  "isDefault" boolean NOT NULL DEFAULT FALSE,
  "createdAt" timestamptz NOT NULL DEFAULT now()
);

-- transitPasses — A prepaid ride bundle ("14 of 20 rides left"). Product details (pricing tiers, expiry policy) are under-documented — see open questions.
CREATE TABLE "transitPasses" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "code" text UNIQUE,   -- display prefix not specified in source docs
  "riderUserId" uuid NOT NULL REFERENCES "users"("id"),
  "ridesTotal" smallint NOT NULL,
  "ridesUsed" smallint NOT NULL DEFAULT 0,
  "routeId" uuid REFERENCES "routes"("id"),   -- scope; NULL = any corridor
  "status" text NOT NULL DEFAULT 'active' CHECK ("status" IN ('active', 'exhausted', 'expired', 'cancelled')),
  "validFrom" timestamptz,
  "validUntil" timestamptz,
  "purchaseTransactionId" uuid REFERENCES "walletTransactions"("id"),
  "createdAt" timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE "bookings" ADD CONSTRAINT "bookings_transitPassId_fkey" FOREIGN KEY ("transitPassId") REFERENCES "transitPasses"("id"); -- deferred: transitPasses is created in a later migration group than bookings

-- withdrawalRequests — A car owner's payout request. Read-only for admins — decisions happen in payoutApprovals (segregation of duties).
CREATE TABLE "withdrawalRequests" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "code" text NOT NULL UNIQUE DEFAULT ('WD-' || nextval('"withdrawalRequestsCodeSeq"')),
  "carOwnerUserId" uuid NOT NULL REFERENCES "users"("id"),
  "payoutAccountId" uuid NOT NULL REFERENCES "payoutAccounts"("id"),
  "amountPesewas" bigint NOT NULL,
  "feePesewas" bigint NOT NULL,
  "netPesewas" bigint NOT NULL,
  "status" text NOT NULL DEFAULT 'awaitingReview' CHECK ("status" IN ('awaitingReview', 'processing', 'paid', 'failed', 'reversed')),
  "risk" text NOT NULL CHECK ("risk" IN ('low', 'medium', 'high')),   -- computed at submission
  "requestedAt" timestamptz NOT NULL DEFAULT now(),
  "processedAt" timestamptz,
  "gatewayReference" text
);

ALTER SEQUENCE "withdrawalRequestsCodeSeq" OWNED BY "withdrawalRequests"."code";

-- payoutApprovals — The actual reviewer-decision record for a payout, hard-linked 1:1 to its withdrawalRequests row (unlike the frontend's unlinked mock fixtures).
CREATE TABLE "payoutApprovals" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "code" text NOT NULL UNIQUE DEFAULT ('APQ-' || nextval('"payoutApprovalsCodeSeq"')),
  "withdrawalRequestId" uuid NOT NULL UNIQUE REFERENCES "withdrawalRequests"("id"),
  "eligibility" text NOT NULL CHECK ("eligibility" IN ('eligible', 'policyReview', 'dutyConflict')),   -- computed on queue entry
  "outcome" text NOT NULL DEFAULT 'awaitingApproval' CHECK ("outcome" IN ('awaitingApproval', 'approved', 'rejected')),
  "enteredQueueAt" timestamptz NOT NULL DEFAULT now(),
  "reviewedByAdminId" uuid REFERENCES "adminUsers"("id"),
  "decidedAt" timestamptz
);

ALTER SEQUENCE "payoutApprovalsCodeSeq" OWNED BY "payoutApprovals"."code";

-- refundRequests — A refund or service-credit request for a rider.
CREATE TABLE "refundRequests" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "code" text NOT NULL UNIQUE DEFAULT ('RFC-' || nextval('"refundRequestsCodeSeq"')),
  "type" text NOT NULL CHECK ("type" IN ('refund', 'serviceCredit')),
  "riderUserId" uuid NOT NULL REFERENCES "users"("id"),
  "sourceType" text NOT NULL CHECK ("sourceType" IN ('trip', 'dispute')),
  "sourceId" uuid NOT NULL,   -- polymorphic — may reference: trips.id, tripDisputes.id (no FK constraint)
  "amountPesewas" bigint NOT NULL,
  "reason" text NOT NULL,
  "requestedByAdminId" uuid NOT NULL REFERENCES "adminUsers"("id"),
  "status" text NOT NULL DEFAULT 'pendingReview' CHECK ("status" IN ('pendingReview', 'completed', 'processed', 'rejected')),
  "decidedByAdminId" uuid REFERENCES "adminUsers"("id"),
  "decidedAt" timestamptz,
  "createdAt" timestamptz NOT NULL DEFAULT now()
);

ALTER SEQUENCE "refundRequestsCodeSeq" OWNED BY "refundRequests"."code";

-- ============================================================================
-- Group 7: Safety & support
-- ============================================================================

-- sosAlerts — Emergency SOS Desk incident. Never deleted — status transitions only.
CREATE TABLE "sosAlerts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "code" text NOT NULL UNIQUE DEFAULT ('SOS-' || nextval('"sosAlertsCodeSeq"')),
  "tripId" uuid NOT NULL REFERENCES "trips"("id"),
  "riderUserId" uuid NOT NULL REFERENCES "users"("id"),   -- the commuter; car-owner/vehicle details join through trip, not duplicated
  "locationText" text NOT NULL,
  "lat" numeric(9,6),
  "lng" numeric(9,6),
  "triggerReason" text NOT NULL,   -- e.g. "Panic button pressed", "Sudden deceleration detected"
  "priority" text NOT NULL CHECK ("priority" IN ('critical', 'medium', 'low')),
  "status" text NOT NULL DEFAULT 'active' CHECK ("status" IN ('active', 'dispatched', 'resolved')),
  "triggeredAt" timestamptz NOT NULL DEFAULT now(),
  "dispatchedAt" timestamptz,
  "resolvedAt" timestamptz,
  "resolvedByAdminId" uuid REFERENCES "adminUsers"("id")
);

ALTER SEQUENCE "sosAlertsCodeSeq" OWNED BY "sosAlerts"."code";

-- sosAlertNotes — Append-only operator call/verification log on an SOS alert.
CREATE TABLE "sosAlertNotes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "alertId" uuid NOT NULL REFERENCES "sosAlerts"("id"),
  "authorAdminId" uuid NOT NULL REFERENCES "adminUsers"("id"),
  "message" text NOT NULL,   -- plain text, not rich HTML
  "createdAt" timestamptz NOT NULL DEFAULT now()
);

-- supportTickets — A support ticket, either logged by an admin (phoned-in) or raised by a user in-app.
CREATE TABLE "supportTickets" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "code" text NOT NULL UNIQUE DEFAULT ('TCK-' || nextval('"supportTicketsCodeSeq"')),
  "userId" uuid REFERENCES "users"("id"),
  "reporterName" text NOT NULL,   -- snapshot — admin console can log a ticket for someone not yet linked to userId
  "reporterRole" text NOT NULL CHECK ("reporterRole" IN ('rider', 'carOwner')),
  "category" text NOT NULL CHECK ("category" IN ('fareAndBilling', 'appCrashGps', 'lostAndFound', 'driverConduct', 'accountAndSecurity', 'routeNavigation')),
  "subject" text NOT NULL,
  "description" text NOT NULL,
  "priority" text NOT NULL CHECK ("priority" IN ('high', 'medium', 'low')),
  "status" text NOT NULL DEFAULT 'open' CHECK ("status" IN ('open', 'inProgress', 'resolved')),
  "region" text NOT NULL,
  "assignedToAdminId" uuid REFERENCES "adminUsers"("id"),
  "resolvedAt" timestamptz,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now(),
  "deletedAt" timestamptz
);

ALTER SEQUENCE "supportTicketsCodeSeq" OWNED BY "supportTickets"."code";

-- ticketReplies — One message in a support ticket's two-sided conversation thread.
CREATE TABLE "ticketReplies" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "ticketId" uuid NOT NULL REFERENCES "supportTickets"("id"),
  "authorType" text NOT NULL CHECK ("authorType" IN ('admin', 'user')),
  "authorAdminId" uuid REFERENCES "adminUsers"("id"),
  "authorUserId" uuid REFERENCES "users"("id"),
  "messageHtml" text NOT NULL,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  CHECK ((("authorType" = 'admin') AND ("authorAdminId" IS NOT NULL) AND ("authorUserId" IS NULL)) OR (("authorType" = 'user') AND ("authorUserId" IS NOT NULL) AND ("authorAdminId" IS NULL)))
);

-- broadcasts — A notice composed and sent (or drafted) to riders/car owners via Broadcast Studio.
CREATE TABLE "broadcasts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "code" text NOT NULL UNIQUE DEFAULT ('BRD-' || nextval('"broadcastsCodeSeq"')),
  "title" text NOT NULL,
  "channel" text NOT NULL CHECK ("channel" IN ('inApp', 'email', 'push', 'sms')),
  "message" text NOT NULL,   -- HTML for inApp/email; plain text for push (150 char) / sms (160 char), length validated server-side
  "audience" text NOT NULL CHECK ("audience" IN ('allRiders', 'allCarOwners', 'everyone')),
  "status" text NOT NULL DEFAULT 'sent' CHECK ("status" IN ('draft', 'scheduled', 'sent')),
  "scheduledFor" timestamptz,
  "sentAt" timestamptz,
  "reach" integer NOT NULL DEFAULT 0,   -- recipient count stamped at send
  "createdByAdminId" uuid NOT NULL REFERENCES "adminUsers"("id"),
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now()
);

ALTER SEQUENCE "broadcastsCodeSeq" OWNED BY "broadcasts"."code";

-- ============================================================================
-- Group 8: Audit & settings
-- ============================================================================

-- auditLogs — One append-only table serving three consumers: Administration Activity Logs, Finance Financial Audit Logs (module='finance'), and the Overview 'recent actions' feed. Written as a side effect of every consequential mutation.
CREATE TABLE "auditLogs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "code" text NOT NULL UNIQUE,   -- prefix depends on consuming view — ACL- (Administration) or FAL- (Finance) — chosen by application logic, not a single DB sequence
  "actorAdminId" uuid REFERENCES "adminUsers"("id"),   -- NULL = system
  "module" text NOT NULL CHECK ("module" IN ('users', 'verification', 'finance', 'tripOperations', 'safety', 'support', 'administration', 'settings')),
  "action" text NOT NULL,   -- e.g. "Approved payout"
  "targetType" text,
  "targetId" uuid,   -- polymorphic — may reference: users.id, verificationApplications.id, withdrawalRequests.id, ... (no FK constraint)
  "targetLabel" text,   -- name snapshot — survives target deletion
  "referenceCode" text,   -- e.g. "APQ-201"
  "result" text NOT NULL CHECK ("result" IN ('success', 'rejected', 'failed')),
  "ipAddress" inet,
  "metadata" jsonb,
  "createdAt" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX "idx_auditLogs_module_createdAt" ON "auditLogs" ("module", "createdAt");
CREATE INDEX "idx_auditLogs_actorAdminId_createdAt" ON "auditLogs" ("actorAdminId", "createdAt");

-- platformSettings — Single-row table of platform-wide default configuration. routes carries its own baseFarePesewas/perKmRatePesewas which override these defaults per route.
CREATE TABLE "platformSettings" (
  "id" smallint PRIMARY KEY DEFAULT 1,
  "baseFarePesewas" bigint NOT NULL,
  "perKmRatePesewas" bigint NOT NULL,
  "perMinRatePesewas" bigint NOT NULL,
  "platformCommissionPct" numeric(5,2) NOT NULL,
  "maxSurgeMultiplier" numeric(4,2) NOT NULL,
  "autoPayoutThresholdPesewas" bigint NOT NULL,
  "momoEnabled" boolean NOT NULL,
  "bankTransferEnabled" boolean NOT NULL,
  "sosTimeoutMinutes" smallint NOT NULL,
  "autoNotifyPolice" boolean NOT NULL,
  "ghanaCardMandatory" boolean NOT NULL,
  "licenceExpiryNoticeDays" smallint NOT NULL,
  "minDriverAge" smallint NOT NULL CHECK ("minDriverAge" >= 18),   -- CHECK >= 18
  "updatedByAdminId" uuid NOT NULL REFERENCES "adminUsers"("id"),
  "updatedAt" timestamptz NOT NULL DEFAULT now(),
  CHECK ("id" = 1)
);

-- settingsChangeLogs — Read-only diff-based trail of platform settings changes, written automatically on every settings update.
CREATE TABLE "settingsChangeLogs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "code" text NOT NULL UNIQUE DEFAULT ('CFG-' || nextval('"settingsChangeLogsCodeSeq"')),
  "adminId" uuid NOT NULL REFERENCES "adminUsers"("id"),
  "summary" text NOT NULL,
  "changes" jsonb NOT NULL,   -- [{ field, old, new }, ...] — diff-based, not one generic string
  "createdAt" timestamptz NOT NULL DEFAULT now()
);

ALTER SEQUENCE "settingsChangeLogsCodeSeq" OWNED BY "settingsChangeLogs"."code";

COMMIT;
