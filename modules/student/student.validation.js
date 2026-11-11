import { z } from 'zod';

export const updateProfileSchema = z.object({
  firstName: z.string().trim().min(2, 'First name must be at least 2 characters').optional(),
  lastName: z.string().trim().optional()
});

export const initiatePaymentSchema = z.object({
  language: z.enum(['EN', 'en']).optional().transform((v) => (v ? v.toUpperCase() : 'EN')),
  request_type: z.string().trim().max(50).optional()
}).default({});

