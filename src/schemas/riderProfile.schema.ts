import { z } from "zod";

export const createRiderProfileSchema = z.object({
  userId: z.uuid().meta({ description: "An existing user with role rider" }),
});

export type CreateRiderProfileInput = z.infer<typeof createRiderProfileSchema>;

export const riderProfileParamsSchema = z.object({
  userId: z.uuid(),
});

export const riderProfileResponseSchema = z.object({
  userId: z.uuid(),
  createdAt: z.iso.datetime(),
});
