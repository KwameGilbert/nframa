import db from "../database/knex.js";
import { BaseModel } from "./BaseModel.js";
import type {
  CreateVehicleInput,
  UpdateVehicleInput,
  VehiclePhotoSide,
} from "../schemas/vehicle.schema.js";

export type VehiclePhotos = Partial<Record<VehiclePhotoSide, string>>;

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
  photos: VehiclePhotos;
  isVerified: boolean;
  verificationDate: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

class VehicleModel extends BaseModel<Vehicle> {
  protected readonly tableName = "vehicles";
  // Storage keys stay on the server: every read, insert and update here strips them.
  protected readonly excludedColumns = ["photoKeys"];

  createVehicle(
    input: CreateVehicleInput & { id: string; photos: VehiclePhotos; photoKeys: VehiclePhotos },
  ) {
    return this.insert(input as unknown as Partial<Vehicle>);
  }

  updateVehicle(id: string, input: UpdateVehicleInput) {
    return this.updateById(id, { ...input, updatedAt: new Date() } as unknown as Partial<Vehicle>);
  }

  async findByUserId(userId: string) {
    const rows: Vehicle[] = await this.table
      .where({ carOwnerUserId: userId })
      .orderBy("createdAt", "desc");
    return rows.map((row) => this.sanitize(row));
  }

  // Swaps one side's photo under a row lock, so two replacements of the same side each hand back the key they
  // replaced (and every old file is deleted exactly once). Returns the vehicle and the replaced key, if any.
  async replacePhoto(
    id: string,
    side: VehiclePhotoSide,
    photo: { fileUrl: string; storageKey: string },
  ) {
    return db.transaction(async (trx) => {
      const current = await trx(this.tableName)
        .where({ id })
        .forUpdate()
        .first<{ photoKeys: VehiclePhotos }>("photoKeys");
      if (!current) return undefined;

      const [row] = await trx(this.tableName)
        .where({ id })
        .update({
          photos: trx.raw(`jsonb_set("photos", ?, to_jsonb(?::text))`, [
            `{${side}}`,
            photo.fileUrl,
          ]),
          photoKeys: trx.raw(`jsonb_set("photoKeys", ?, to_jsonb(?::text))`, [
            `{${side}}`,
            photo.storageKey,
          ]),
          updatedAt: trx.fn.now(),
        })
        .returning("*");
      return { vehicle: this.sanitize(row), replacedKey: current.photoKeys[side] };
    });
  }
}

export const vehicleModel = new VehicleModel();
