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
  createdAt: Date;
  updatedAt: Date;
}

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

  createCommute(input: CreateDriverCommuteInput, userId: string) {
    return this.insert({ ...input, userId } as unknown as Partial<DriverCommute>);
  }

  updateCommute(id: string, input: UpdateDriverCommuteInput) {
    return this.updateById(id, {
      ...input,
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
