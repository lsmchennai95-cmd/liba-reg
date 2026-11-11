import { z } from 'zod';

export const adminLoginSchema = z.object({
  email: z.string().trim().toLowerCase().email('Please provide a valid email address'),
  password: z.string().min(1, 'Password is required')
});

const dateRegex = /^\d{4}-\d{2}-\d{2}$/;

export const dashboardStatsQuerySchema = z
  .object({
    range: z.enum(['all', 'today', 'week', 'month', 'custom']).optional().default('all'),
    startDate: z.string().regex(dateRegex, 'startDate must be in YYYY-MM-DD format').optional(),
    endDate: z.string().regex(dateRegex, 'endDate must be in YYYY-MM-DD format').optional()
  })
  .refine(
    (data) => {
      if (data.range === 'custom') {
        return Boolean(data.startDate && data.endDate);
      }
      return true;
    },
    { message: 'Both startDate and endDate are required for custom date range' }
  )
  .refine(
    (data) => {
      if (data.startDate && data.endDate) {
        return data.startDate <= data.endDate;
      }
      return true;
    },
    { message: 'startDate cannot be later than endDate' }
  );

export const listStudentsQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).optional().default(1),
    limit: z.coerce.number().int().min(1).max(100).optional().default(10),
    search: z.string().trim().max(120).optional().default(''),
    paymentStatus: z
      .enum(['all', 'paid', 'pending', 'failed', 'cancelled'])
      .optional()
      .default('all'),
    emailVerified: z
      .enum(['all', 'verified', 'unverified', 'true', 'false'])
      .optional()
      .default('all'),
    courseId: z.preprocess(
      (v) => (v === '' || v === undefined || v === null || v === 'all' ? undefined : v),
      z.coerce.number().int().positive().optional()
    ),
    startDate: z.preprocess(
      (v) => (v === '' ? undefined : v),
      z.string().regex(dateRegex, 'startDate must be in YYYY-MM-DD format').optional()
    ),
    endDate: z.preprocess(
      (v) => (v === '' ? undefined : v),
      z.string().regex(dateRegex, 'endDate must be in YYYY-MM-DD format').optional()
    ),
    sortOrder: z.enum(['asc', 'desc']).optional().default('desc')
  })
  .refine(
    (data) => {
      if (data.startDate && data.endDate) {
        return data.startDate <= data.endDate;
      }
      return true;
    },
    { message: 'startDate cannot be later than endDate' }
  );

export const listPaymentsQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).optional().default(1),
    limit: z.coerce.number().int().min(1).max(100).optional().default(10),
    search: z.string().trim().max(120).optional().default(''),
    paymentType: z.enum(['all', 'registration_fee', 'course_fee']).optional().default('all'),
    status: z
      .enum(['all', 'paid', 'pending', 'failed', 'cancelled', 'refunded'])
      .optional()
      .default('all'),
    startDate: z.preprocess(
      (v) => (v === '' ? undefined : v),
      z.string().regex(dateRegex, 'startDate must be in YYYY-MM-DD format').optional()
    ),
    endDate: z.preprocess(
      (v) => (v === '' ? undefined : v),
      z.string().regex(dateRegex, 'endDate must be in YYYY-MM-DD format').optional()
    )
  })
  .refine(
    (data) => {
      if (data.startDate && data.endDate) {
        return data.startDate <= data.endDate;
      }
      return true;
    },
    { message: 'startDate cannot be later than endDate' }
  );

export const validateQuery = (schema) => {
  return async (req, res, next) => {
    try {
      const parsed = await schema.parseAsync(req.query);
      req.validatedQuery = parsed;
      next();
    } catch (error) {
      if (error.errors && error.errors.length > 0) {
        const firstError = error.errors[0];
        return res.status(400).json({
          success: false,
          message: firstError.message || 'Invalid query parameters',
          errors: error.errors.map((err) => ({
            field: err.path.join('.'),
            message: err.message
          }))
        });
      }
      return res.status(400).json({
        success: false,
        message: 'Invalid query parameters',
        errors: []
      });
    }
  };
};

