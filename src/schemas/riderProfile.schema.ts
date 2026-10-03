import { z } from "zod";

export const createRiderProfileSchema = z.object({
  userId: z.uuid().meta({
    description:
      "The rider's user id. Must be the caller's own id unless the caller has users: create, and an existing user who has no rider profile yet",
  }),
});

export type CreateRiderProfileInput = z.infer<typeof createRiderProfileSchema>;

export const riderProfileParamsSchema = z.object({
  userId: z.uuid().meta({ description: "The rider's user id" }),
});

export const riderProfileResponseSchema = z.object({
  userId: z.uuid(),
  createdAt: z.iso.datetime(),
});
