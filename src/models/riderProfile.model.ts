import { BaseModel } from "./BaseModel.js";
import type { CreateRiderProfileInput } from "../schemas/riderProfile.schema.js";

export interface RiderProfile {
  userId: string;
  createdAt: Date;
}

class RiderProfileModel extends BaseModel<RiderProfile> {
  protected readonly tableName = "riderProfiles";
  protected readonly primaryKey = "userId";

  createProfile(input: CreateRiderProfileInput) {
    return this.insert(input);
  }
}

export const riderProfileModel = new RiderProfileModel();
