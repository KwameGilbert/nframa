import type { Request, Response } from 'express';
import { savedCommuteModel } from '../models/savedCommute.model.js';
import { logActivity } from '../services/activityLog.service.js';
import { AppError } from '../utils/AppError.js';
import { sendCreated, sendSuccess } from '../utils/response.js';
import type { CreateSavedCommuteInput, UpdateSavedCommuteInput } from '../schemas/savedCommute.schema.js';

const COMMUTE_ACTIVITY = { module: 'commutes', targetType: 'commute' } as const;

export async function listCommutes(req: Request, res: Response) {
	// Drivers see only their own commutes; admins see all
	let commutes;
	if (req.auth?.role === 'drivers') {
		commutes = await savedCommuteModel.findByUserId(req.auth.id);
	} else {
		// Admins can see all commutes
		commutes = await savedCommuteModel.findAll();
	}

	sendSuccess(res, 'Commutes retrieved successfully', commutes);
}

export async function createCommute(req: Request, res: Response) {
	const input = req.validated.body as CreateSavedCommuteInput;
	const { userId } = req.validated.params as { userId?: string };

	// Determine which user this commute is for
	const targetUserId = userId || req.auth?.id;
	if (!targetUserId) {
		throw AppError.badRequest('User ID is required');
	}

	// Drivers can only create commutes for themselves
	if (req.auth?.role === 'drivers' && req.auth.id !== targetUserId) {
		throw AppError.forbidden('You can only create commutes for yourself');
	}

	const commute = await savedCommuteModel.create({
		userId: targetUserId,
		...input,
		recurrenceDays: input.recurrenceDays,
	});

	sendCreated(res, 'Commute created successfully', commute);

	logActivity(req, {
		...COMMUTE_ACTIVITY,
		action: 'commute.create',
		description: `Created a commute from ${input.startAddress} to ${input.endAddress}`,
		targetId: commute.id,
		after: commute,
	});
}

export async function getCommuteById(req: Request, res: Response) {
	const { id } = req.validated.params as { id: string };

	const commute = await savedCommuteModel.findById(id);
	if (!commute) {
		throw AppError.notFound('Commute not found');
	}

	// Drivers can only view their own commutes
	if (req.auth?.role === 'drivers' && req.auth.id !== commute.userId) {
		throw AppError.forbidden('You can only view your own commutes');
	}

	sendSuccess(res, 'Commute retrieved successfully', commute);
}

export async function updateCommute(req: Request, res: Response) {
	const { id } = req.validated.params as { id: string };
	const input = req.validated.body as UpdateSavedCommuteInput;

	const commute = await savedCommuteModel.findById(id);
	if (!commute) {
		throw AppError.notFound('Commute not found');
	}

	// Drivers can only update their own commutes
	if (req.auth?.role === 'drivers' && req.auth.id !== commute.userId) {
		throw AppError.forbidden('You can only update your own commutes');
	}

	const updated = await savedCommuteModel.updateById(id, input);

	sendSuccess(res, 'Commute updated successfully', updated);

	logActivity(req, {
		...COMMUTE_ACTIVITY,
		action: 'commute.update',
		description: `Updated commute from ${commute.startAddress} to ${commute.endAddress}`,
		targetId: id,
		before: commute,
		after: updated,
	});
}

export async function deleteCommute(req: Request, res: Response) {
	const { id } = req.validated.params as { id: string };

	const commute = await savedCommuteModel.findById(id);
	if (!commute) {
		throw AppError.notFound('Commute not found');
	}

	// Drivers can only delete their own commutes
	if (req.auth?.role === 'drivers' && req.auth.id !== commute.userId) {
		throw AppError.forbidden('You can only delete your own commutes');
	}

	await savedCommuteModel.deleteById(id);

	sendSuccess(res, 'Commute deleted successfully');

	logActivity(req, {
		...COMMUTE_ACTIVITY,
		action: 'commute.delete',
		description: `Deleted commute from ${commute.startAddress} to ${commute.endAddress}`,
		targetId: id,
		before: commute,
	});
}

export async function toggleCommuteStatus(req: Request, res: Response) {
	const { id } = req.validated.params as { id: string };
	const { isActive } = req.validated.body as { isActive: boolean };

	const commute = await savedCommuteModel.findById(id);
	if (!commute) {
		throw AppError.notFound('Commute not found');
	}

	// Drivers can only toggle their own commutes
	if (req.auth?.role === 'drivers' && req.auth.id !== commute.userId) {
		throw AppError.forbidden('You can only toggle your own commutes');
	}

	const updated = await savedCommuteModel.toggleActive(id, isActive);

	sendSuccess(res, `Commute ${isActive ? 'activated' : 'deactivated'} successfully`, updated);

	logActivity(req, {
		...COMMUTE_ACTIVITY,
		action: `commute.${isActive ? 'activate' : 'deactivate'}`,
		description: `${isActive ? 'Activated' : 'Deactivated'} commute from ${commute.startAddress} to ${commute.endAddress}`,
		targetId: id,
		before: commute,
		after: updated,
	});
}
