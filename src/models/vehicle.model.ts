import { BaseModel } from "./BaseModel.js";
import type { CreateVehicleInput, UpdateVehicleInput } from "../schemas/vehicle.schema.js";

export interface Vehicle {
  id: string;
  carOwnerUserId: string;
  make: string;
  model: string;
  year: number | null;
  color: string;
  plate: string;
  seats: number;
  status: string;
  isVerified: boolean;
  verificationDate: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

class VehicleModel extends BaseModel<Vehicle> {
  protected readonly tableName = "vehicles";

  createVehicle(input: CreateVehicleInput) {
    return this.insert(input as unknown as Partial<Vehicle>);
  }

  updateVehicle(id: string, input: UpdateVehicleInput) {
    return this.updateById(id, { ...input, updatedAt: new Date() } as unknown as Partial<Vehicle>);
  }
}

export const vehicleModel = new VehicleModel();
