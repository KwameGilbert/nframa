import { errorResponse, registry, successResponse } from './registry.js';
import {
	createSavedCommuteSchema,
	updateSavedCommuteSchema,
	savedCommuteResponseSchema,
	savedCommuteIdParamSchema,
} from '../schemas/savedCommute.schema.js';
import { z } from 'zod';

registry.registerPath({
	method: 'get',
	path: '/commutes',
	tags: ['Driver Commutes'],
	summary: 'List all driver commutes',
	description: 'Drivers see only their own commutes; admins see all commutes.',
	security: [{ bearerAuth: [] }],
	responses: {
		200: successResponse(
			'Commutes retrieved successfully',
			z.array(savedCommuteResponseSchema)
		),
		401: errorResponse('Missing or invalid access token'),
	},
});

registry.registerPath({
	method: 'post',
	path: '/commutes',
	tags: ['Driver Commutes'],
	summary: 'Create a new driver commute/route',
	description:
		'Drivers can create commutes for themselves. Admins with commutes: create permission can create commutes for any driver.',
	security: [{ bearerAuth: [] }],
	request: {
		body: {
			content: { 'application/json': { schema: createSavedCommuteSchema } },
		},
	},
	responses: {
		201: successResponse('Commute created successfully', savedCommuteResponseSchema),
		400: errorResponse('Validation error in request body'),
		401: errorResponse('Missing or invalid access token'),
		403: errorResponse(
			'Not allowed to create commute (drivers can only create for themselves)'
		),
	},
});

registry.registerPath({
	method: 'get',
	path: '/commutes/{id}',
	tags: ['Driver Commutes'],
	summary: 'Get a single commute by ID',
	description:
		'Drivers can view their own commutes. Admins can view any commute.',
	security: [{ bearerAuth: [] }],
	parameters: [
		{
			name: 'id',
			in: 'path',
			required: true,
			schema: { type: 'string', format: 'uuid' },
			description: 'Commute ID',
		},
	],
	responses: {
		200: successResponse('Commute retrieved successfully', savedCommuteResponseSchema),
		401: errorResponse('Missing or invalid access token'),
		403: errorResponse('Not allowed to view this commute'),
		404: errorResponse('Commute not found'),
	},
});

registry.registerPath({
	method: 'patch',
	path: '/commutes/{id}',
	tags: ['Driver Commutes'],
	summary: 'Update a commute',
	description:
		'Drivers can update their own commutes. Admins with commutes: update can update any commute.',
	security: [{ bearerAuth: [] }],
	parameters: [
		{
			name: 'id',
			in: 'path',
			required: true,
			schema: { type: 'string', format: 'uuid' },
			description: 'Commute ID',
		},
	],
	request: {
		body: {
			content: { 'application/json': { schema: updateSavedCommuteSchema } },
		},
	},
	responses: {
		200: successResponse('Commute updated successfully', savedCommuteResponseSchema),
		400: errorResponse('Validation error in request body'),
		401: errorResponse('Missing or invalid access token'),
		403: errorResponse('Not allowed to update this commute'),
		404: errorResponse('Commute not found'),
	},
});

registry.registerPath({
	method: 'delete',
	path: '/commutes/{id}',
	tags: ['Driver Commutes'],
	summary: 'Delete a commute',
	description:
		'Drivers can delete their own commutes. Admins with commutes: delete can delete any commute.',
	security: [{ bearerAuth: [] }],
	parameters: [
		{
			name: 'id',
			in: 'path',
			required: true,
			schema: { type: 'string', format: 'uuid' },
			description: 'Commute ID',
		},
	],
	responses: {
		200: successResponse('Commute deleted successfully'),
		401: errorResponse('Missing or invalid access token'),
		403: errorResponse('Not allowed to delete this commute'),
		404: errorResponse('Commute not found'),
	},
});

registry.registerPath({
	method: 'patch',
	path: '/commutes/{id}/status',
	tags: ['Driver Commutes'],
	summary: 'Activate or deactivate a commute',
	description:
		'Drivers can toggle their own commute status. Admins can toggle any commute status.',
	security: [{ bearerAuth: [] }],
	parameters: [
		{
			name: 'id',
			in: 'path',
			required: true,
			schema: { type: 'string', format: 'uuid' },
			description: 'Commute ID',
		},
	],
	request: {
		body: {
			content: {
				'application/json': {
					schema: z.object({
						isActive: z
							.boolean()
							.meta({
								description: 'Set to true to activate, false to deactivate',
								example: true,
							}),
					}),
				},
			},
		},
	},
	responses: {
		200: successResponse(
			'Commute status updated successfully',
			savedCommuteResponseSchema
		),
		400: errorResponse('Validation error in request body'),
		401: errorResponse('Missing or invalid access token'),
		403: errorResponse('Not allowed to update this commute status'),
		404: errorResponse('Commute not found'),
	},
});
