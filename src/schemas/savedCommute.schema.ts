import { z } from 'zod';

export const commuteRecurrenceDaysSchema = z
	.array(z.number().int().min(1).max(7))
	.min(1, 'At least one day must be selected')
	.refine((days) => new Set(days).size === days.length, 'Duplicate days not allowed')
	.meta({
		description: 'ISO 8601 weekday numbers (1=Monday, 7=Sunday). Example: [1,3,5] for Mon/Wed/Fri',
		example: [1, 3, 5],
	});

export const latitudeSchema = z
	.string()
	.refine(
		(val) => {
			const num = parseFloat(val);
			return !isNaN(num) && num >= -90 && num <= 90;
		},
		'Latitude must be between -90 and 90'
	)
	.meta({ description: 'Latitude coordinate (e.g., "5.603720")', example: '5.603720' });

export const longitudeSchema = z
	.string()
	.refine(
		(val) => {
			const num = parseFloat(val);
			return !isNaN(num) && num >= -180 && num <= 180;
		},
		'Longitude must be between -180 and 180'
	)
	.meta({ description: 'Longitude coordinate (e.g., "-0.178370")', example: '-0.178370' });

export const departureTimeSchema = z
	.string()
	.regex(/^([0-1]\d|2[0-3]):[0-5]\d$/, 'Departure time must be in HH:MM format (24-hour)')
	.meta({ description: 'Departure time in 24-hour HH:MM format', example: '07:30' });

export const createSavedCommuteSchema = z
	.object({
		startAddress: z
			.string()
			.min(3, 'Start address must be at least 3 characters')
			.max(255, 'Start address must not exceed 255 characters')
			.meta({ description: 'Starting location address', example: 'Accra Mall, Accra' }),
		startLat: latitudeSchema,
		startLng: longitudeSchema,
		endAddress: z
			.string()
			.min(3, 'End address must be at least 3 characters')
			.max(255, 'End address must not exceed 255 characters')
			.meta({ description: 'Destination address', example: 'Osu, Accra' }),
		endLat: latitudeSchema,
		endLng: longitudeSchema,
		departureTime: departureTimeSchema,
		recurrenceDays: commuteRecurrenceDaysSchema,
		capacity: z
			.number()
			.int()
			.min(1, 'Capacity must be at least 1')
			.max(8, 'Capacity cannot exceed 8')
			.meta({ description: 'Number of available seats', example: 4 }),
	})
	.meta({
		description: 'Create a new driver commute/route',
		example: {
			startAddress: 'Accra Mall, Accra',
			startLat: '5.603720',
			startLng: '-0.178370',
			endAddress: 'Osu, Accra',
			endLat: '5.551820',
			endLng: '-0.181370',
			departureTime: '07:30',
			recurrenceDays: [1, 3, 5],
			capacity: 4,
		},
	});

export const updateSavedCommuteSchema = createSavedCommuteSchema.partial().meta({
	description: 'Update an existing driver commute/route',
});

export const savedCommuteResponseSchema = createSavedCommuteSchema.extend({
	id: z.string().uuid().meta({ description: 'Unique commute ID', example: '550e8400-e29b-41d4-a716-446655440000' }),
	userId: z.string().uuid().meta({ description: 'Driver user ID' }),
	isActive: z.boolean().default(true).meta({ description: 'Whether the commute is currently active' }),
	createdAt: z.string().datetime().meta({ description: 'Creation timestamp' }),
	updatedAt: z.string().datetime().meta({ description: 'Last update timestamp' }),
}).meta({
	description: 'Driver commute/route response',
	example: {
		id: '550e8400-e29b-41d4-a716-446655440000',
		userId: '660e8400-e29b-41d4-a716-446655440001',
		startAddress: 'Accra Mall, Accra',
		startLat: '5.603720',
		startLng: '-0.178370',
		endAddress: 'Osu, Accra',
		endLat: '5.551820',
		endLng: '-0.181370',
		departureTime: '07:30',
		recurrenceDays: [1, 3, 5],
		capacity: 4,
		isActive: true,
		createdAt: '2026-09-30T08:00:00Z',
		updatedAt: '2026-09-30T08:00:00Z',
	},
});

export const savedCommuteIdParamSchema = z
	.object({
		id: z.string().uuid('Invalid commute ID format'),
	})
	.meta({ description: 'Commute ID parameter' });

export type CreateSavedCommuteInput = z.infer<typeof createSavedCommuteSchema>;
export type UpdateSavedCommuteInput = z.infer<typeof updateSavedCommuteSchema>;
export type SavedCommuteResponse = z.infer<typeof savedCommuteResponseSchema>;
