import { BaseModel } from "./BaseModel.js";
import type {
  CreateDriverCommuteInput,
  UpdateDriverCommuteInput,
} from "../schemas/driverCommute.schema.js";

export interface DriverCommute {
  id: string;
  userId: string;
  startAddress: string;
  startLat: number;
  startLng: number;
  endAddress: string;
  endLat: number;
  endLng: number;
  departureTime: string;
  recurrenceDays: number[];
  capacity: number;
  isActive: boolean;
  distanceMeters: number | null;
  durationSeconds: number | null;
  createdAt: Date;
  updatedAt: Date;
}

// The driving distance and time between a commute's start and end, saved when it is created or moved.
export type CommuteRoute = Pick<DriverCommute, "distanceMeters" | "durationSeconds">;

class DriverCommuteModel extends BaseModel<DriverCommute> {
  protected readonly tableName = "driverCommutes";

  // pg returns numeric columns as strings; clients get the numbers they sent.
  protected sanitize(row: DriverCommute): DriverCommute {
    return {
      ...row,
      startLat: Number(row.startLat),
      startLng: Number(row.startLng),
      endLat: Number(row.endLat),
      endLng: Number(row.endLng),
    };
  }

  createCommute(input: CreateDriverCommuteInput, userId: string, route: CommuteRoute) {
    return this.insert({ ...input, ...route, userId } as unknown as Partial<DriverCommute>);
  }

  // route is only passed when the start or end moved.
  updateCommute(id: string, input: UpdateDriverCommuteInput, route: Partial<CommuteRoute> = {}) {
    return this.updateById(id, {
      ...input,
      ...route,
      updatedAt: new Date(),
    } as unknown as Partial<DriverCommute>);
  }

  // No userId lists every driver's commutes.
  async list(criteria: { userId?: string } = {}) {
    const rows = await this.table.where(criteria).orderBy("createdAt", "desc");
    return rows.map((row: DriverCommute) => this.sanitize(row));
  }
}

export const driverCommuteModel = new DriverCommuteModel();
