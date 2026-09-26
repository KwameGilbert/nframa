import { BaseModel } from "./BaseModel.js";
import type { DocumentType } from "../schemas/verification.schema.js";

export type DocumentTypeRow = DocumentType;

export class DocumentTypeModel extends BaseModel<DocumentTypeRow> {
  protected readonly tableName = "documentTypes";
  protected readonly primaryKey = "id";

  async getByCode(code: string): Promise<DocumentTypeRow | undefined> {
    return this.table.where({ code }).first();
  }

  async getAllTypes(): Promise<DocumentTypeRow[]> {
    return this.table.orderBy("id", "asc");
  }
}

export const documentTypeModel = new DocumentTypeModel();
