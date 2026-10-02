import { BaseModel } from "./BaseModel.js";
import type {
  CreateEmergencyContactInput,
  UpdateEmergencyContactInput,
} from "../schemas/emergencyContact.schema.js";

export interface EmergencyContact {
  id: string;
  userId: string;
  name: string;
  phoneCountryCode: string;
  phoneNumber: string;
  relationship: string;
  createdAt: Date;
  updatedAt: Date;
}

class EmergencyContactModel extends BaseModel<EmergencyContact> {
  protected readonly tableName = "emergencyContacts";

  createContact(input: CreateEmergencyContactInput, userId: string) {
    return this.insert({ ...input, userId });
  }

  updateContact(id: string, input: UpdateEmergencyContactInput) {
    return this.updateById(id, { ...input, updatedAt: new Date() });
  }

  async listForUser(userId: string) {
    const rows = await this.table.where({ userId }).orderBy("createdAt", "asc");
    return rows.map((row: EmergencyContact) => this.sanitize(row));
  }
}

export const emergencyContactModel = new EmergencyContactModel();
