import { z } from 'zod';

const normalizeBoolean = (val) => {
  if (typeof val === 'boolean') return val;
  if (val === 1 || val === '1' || String(val).toLowerCase() === 'true') return true;
  if (val === 0 || val === '0' || String(val).toLowerCase() === 'false') return false;
  return val;
};

const normalizeRecipientPayload = (body) => {
  if (!body || typeof body !== 'object') return body;
  return {
    ...body,
    recipientName: body.recipientName ?? body.recipient_name,
    isActive: body.isActive ?? body.is_active
  };
};

export const createRecipientSchema = z.preprocess(
  normalizeRecipientPayload,
  z.object({
    recipientName: z
      .string({ required_error: 'Recipient name is required' })
      .trim()
      .min(2, 'Recipient name must be at least 2 characters')
      .max(150, 'Recipient name must not exceed 150 characters'),
    email: z
      .string({ required_error: 'Email address is required' })
      .trim()
      .toLowerCase()
      .email('Please provide a valid email address')
      .max(255, 'Email address must not exceed 255 characters'),
    isActive: z.preprocess(normalizeBoolean, z.boolean()).optional().default(true)
  })
);

export const updateRecipientSchema = z.preprocess(
  normalizeRecipientPayload,
  z
    .object({
      recipientName: z
        .string()
        .trim()
        .min(2, 'Recipient name must be at least 2 characters')
        .max(150, 'Recipient name must not exceed 150 characters')
        .optional(),
      email: z
        .string()
        .trim()
        .toLowerCase()
        .email('Please provide a valid email address')
        .max(255, 'Email address must not exceed 255 characters')
        .optional()
    })
    .refine((data) => data.recipientName !== undefined || data.email !== undefined, {
      message: 'Please provide recipientName or email to update'
    })
);

export const updateRecipientStatusSchema = z.preprocess(
  normalizeRecipientPayload,
  z.object({
    isActive: z.preprocess(
      normalizeBoolean,
      z.boolean({
        required_error: 'isActive status (true/false) is required',
        invalid_type_error: 'isActive must be a boolean'
      })
    )
  })
);

