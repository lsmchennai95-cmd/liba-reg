import { z } from 'zod';

export const updateProfileSchema = z.object({
  firstName: z.string().trim().min(2, 'First name must be at least 2 characters').optional(),
  lastName: z.string().trim().optional()
});

export const initiatePaymentSchema = z.object({
  paymentType: z.enum(['registration_fee', 'course_fee']).optional().default('registration_fee'),
  amount: z.coerce.number().positive('Payment amount must be greater than zero').optional(),
  language: z.enum(['EN', 'en']).optional().transform((v) => (v ? v.toUpperCase() : 'EN')),
  request_type: z.string().trim().max(50).optional()
}).default({});

