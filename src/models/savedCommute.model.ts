import { BaseModel } from './BaseModel.js';

export interface SavedCommute {
	id: string;
	userId: string;
	startAddress: string;
	startLat: string;
	startLng: string;
	endAddress: string;
	endLat: string;
	endLng: string;
	departureTime: string;
	recurrenceDays: number[];
	capacity: number;
	isActive: boolean;
	createdAt: string;
	updatedAt: string;
}

class SavedCommuteModel extends BaseModel<SavedCommute> {
	protected readonly tableName = 'driverCommutes';

	async findAll(): Promise<SavedCommute[]> {
		const rows = await this.table.orderBy('createdAt', 'desc');
		return rows.map((row: SavedCommute) => this.sanitize(row));
	}

	async findByUserId(userId: string): Promise<SavedCommute[]> {
		const rows = await this.table.where('userId', userId).orderBy('createdAt', 'desc');
		return rows.map((row: SavedCommute) => this.sanitize(row));
	}

	async findActiveByUserId(userId: string): Promise<SavedCommute[]> {
		const rows = await this.table.where({ userId, isActive: true }).orderBy('departureTime', 'asc');
		return rows.map((row: SavedCommute) => this.sanitize(row));
	}

	async findById(id: string): Promise<SavedCommute | undefined> {
		const row = await this.table.where('id', id).first();
		return row && this.sanitize(row);
	}

	async create(commute: Partial<Omit<SavedCommute, 'id' | 'createdAt' | 'updatedAt'>> & Pick<SavedCommute, 'userId' | 'startAddress' | 'startLat' | 'startLng' | 'endAddress' | 'endLat' | 'endLng' | 'departureTime' | 'recurrenceDays' | 'capacity'>): Promise<SavedCommute> {
		const now = new Date().toISOString();
		try {
			const [created] = await this.table.insert({
				...commute,
				isActive: commute.isActive ?? true,
				createdAt: now,
				updatedAt: now,
			}).returning('*');
			return this.sanitize(created);
		} catch (err) {
			this.handleDbError(err);
		}
	}

	async updateById(id: string, updates: Partial<Omit<SavedCommute, 'id' | 'createdAt'>>): Promise<SavedCommute | undefined> {
		const now = new Date().toISOString();
		try {
			const [updated] = await this.table
				.where('id', id)
				.update({
					...updates,
					updatedAt: now,
				})
				.returning('*');
			return updated && this.sanitize(updated);
		} catch (err) {
			this.handleDbError(err);
		}
	}

	async deleteById(id: string): Promise<number> {
		return this.table.where('id', id).delete();
	}

	async toggleActive(id: string, isActive: boolean): Promise<SavedCommute | undefined> {
		return this.updateById(id, { isActive });
	}
}

export const savedCommuteModel = new SavedCommuteModel();
