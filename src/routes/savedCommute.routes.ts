import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../middlewares/validate.js';
import { authenticate } from '../middlewares/authenticate.js';
import { requirePermission } from '../middlewares/authorize.js';
import {
	createSavedCommuteSchema,
	updateSavedCommuteSchema,
	savedCommuteIdParamSchema,
} from '../schemas/savedCommute.schema.js';
import {
	listCommutes,
	createCommute,
	getCommuteById,
	updateCommute,
	deleteCommute,
	toggleCommuteStatus,
} from '../controllers/savedCommute.controller.js';

export const savedCommuteRouter = Router();

// List all commutes (drivers see own, admins see all)
savedCommuteRouter.get('/commutes', authenticate, listCommutes);

// Create new commute (drivers for themselves, admins for any driver)
savedCommuteRouter.post(
	'/commutes',
	authenticate,
	validate({ body: createSavedCommuteSchema }),
	createCommute
);

// Get single commute
savedCommuteRouter.get(
	'/commutes/:id',
	authenticate,
	validate({ params: savedCommuteIdParamSchema }),
	getCommuteById
);

// Update commute
savedCommuteRouter.patch(
	'/commutes/:id',
	authenticate,
	validate({ params: savedCommuteIdParamSchema, body: updateSavedCommuteSchema }),
	updateCommute
);

// Delete commute
savedCommuteRouter.delete(
	'/commutes/:id',
	authenticate,
	validate({ params: savedCommuteIdParamSchema }),
	deleteCommute
);

// Toggle commute status (activate/deactivate)
savedCommuteRouter.patch(
	'/commutes/:id/status',
	authenticate,
	validate({
		params: savedCommuteIdParamSchema,
		body: z.object({
			isActive: z.boolean().meta({ description: 'Activate or deactivate the commute', example: true }),
		}),
	}),
	toggleCommuteStatus
);
