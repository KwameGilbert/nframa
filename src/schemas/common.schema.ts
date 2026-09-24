import { z } from "zod";

export const idParamsSchema = z.object({
  id: z.uuid(),
});

export type IdParams = z.infer<typeof idParamsSchema>;

// Lowercased so "Admin@Nframa.com" and "admin@nframa.com" are the same account — every email the API accepts,
// stores, or looks up goes through this.
export const emailSchema = z.email().toLowerCase().meta({ example: "admin@nframa.com" });

// bcrypt ignores everything past 72 bytes, so reject longer passwords rather than silently truncating them.
export const passwordSchema = z
  .string()
  .min(8)
  .refine((password) => Buffer.byteLength(password, "utf8") <= 72, {
    message: "Password must be at most 72 bytes",
  })
  .meta({ description: "At least 8 characters, at most 72 bytes", example: "ChangeMe123!" });

export const phoneCountryCodeSchema = z
  .string()
  .min(1)
  .meta({ description: "Country calling code, including the +", example: "+233" });

// Every error response (validation, auth, not found, conflict, rate limit) has this shape; successful ones
// are { success: true, message, data }.
export const errorResponseSchema = z
  .object({
    success: z.literal(false),
    error: z.string().meta({ example: "email: Invalid email address" }),
  })
  .meta({ id: "Error" });
