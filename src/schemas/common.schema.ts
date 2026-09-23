import { z } from "zod";

export const idParamsSchema = z.object({
  id: z.uuid(),
});

export type IdParams = z.infer<typeof idParamsSchema>;

// bcrypt ignores everything past 72 bytes, so reject longer passwords rather than silently truncating them.
export const passwordSchema = z
  .string()
  .min(8)
  .refine((password) => Buffer.byteLength(password, "utf8") <= 72, {
    message: "Password must be at most 72 bytes",
  });
