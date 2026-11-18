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

export const updateTimerSchema = z.object({
  hours: z.coerce.number().int().min(1, 'Duration must be at least 1 hour').max(168, 'Duration cannot exceed 168 hours (7 days)')
});

export const reactivateTimerSchema = z.object({
  minutes: z.coerce.number().int().min(1, 'Duration must be at least 1 minute').max(10080, 'Duration cannot exceed 10080 minutes (7 days)').optional(),
  duration_minutes: z.coerce.number().int().min(1, 'Duration must be at least 1 minute').max(10080, 'Duration cannot exceed 10080 minutes (7 days)').optional(),
  reason: z.string().trim().max(500).optional()
}).refine((data) => data.minutes !== undefined || data.duration_minutes !== undefined, {
  message: 'Duration in minutes is required (between 1 and 10080 minutes).'
});

export const createCourseSchema = z.object({
  code: z.string().trim().min(2, 'Course code is required').max(50),
  name: z.string().trim().min(2, 'Course name is required').max(255),
  description: z.string().trim().optional().default(''),
  course_type: z.string().trim().max(50).optional().default('Online Degree'),
  total_fee: z.coerce.number().min(0, 'Course fee must be a non-negative number'),
  registration_fee: z.coerce.number().min(0, 'Registration fee must be a non-negative number').optional().default(3100),
  scholarship_amount: z.coerce.number().min(0, 'Scholarship amount must be a non-negative number').optional().default(40000),
  is_scholarship_active: z.preprocess((v) => (v === true || v === '1' || v === 1 ? 1 : 0), z.number()).optional().default(1),
  is_active: z.preprocess((v) => (v === false || v === '0' || v === 0 ? 0 : 1), z.number()).optional().default(1)
});

export const updateCourseSchema = z.object({
  code: z.string().trim().min(2, 'Course code must be at least 2 characters').max(50).optional(),
  name: z.string().trim().min(2, 'Course name must be at least 2 characters').max(255).optional(),
  description: z.string().trim().optional(),
  course_type: z.string().trim().max(50).optional(),
  total_fee: z.coerce.number().min(0, 'Course fee must be a non-negative number').optional(),
  registration_fee: z.coerce.number().min(0, 'Registration fee must be a non-negative number').optional(),
  scholarship_amount: z.coerce.number().min(0, 'Scholarship amount must be a non-negative number').optional(),
  is_scholarship_active: z.preprocess((v) => (v === undefined ? undefined : (v === true || v === '1' || v === 1 ? 1 : 0)), z.number().optional()),
  is_active: z.preprocess((v) => (v === undefined ? undefined : (v === false || v === '0' || v === 0 ? 0 : 1)), z.number().optional())
});

export const updateCourseScholarshipSchema = z.object({
  is_scholarship_active: z.preprocess((v) => {
    if (v === undefined) return undefined;
    return (v === true || v === '1' || v === 1) ? 1 : 0;
  }, z.number().optional()),
  isScholarshipActive: z.preprocess((v) => {
    if (v === undefined) return undefined;
    return (v === true || v === '1' || v === 1) ? 1 : 0;
  }, z.number().optional()),
  scholarship_active: z.preprocess((v) => {
    if (v === undefined) return undefined;
    return (v === true || v === '1' || v === 1) ? 1 : 0;
  }, z.number().optional()),
  scholarship_amount: z.coerce.number().min(0, 'Scholarship amount must be a non-negative number').optional(),
  scholarshipAmount: z.coerce.number().min(0, 'Scholarship amount must be a non-negative number').optional()
}).refine((data) => {
  const hasActive = data.is_scholarship_active !== undefined || 
                    data.isScholarshipActive !== undefined || 
                    data.scholarship_active !== undefined;
  const hasAmount = data.scholarship_amount !== undefined || 
                    data.scholarshipAmount !== undefined;
  return hasActive || hasAmount;
}, {
  message: 'At least one scholarship field (is_scholarship_active or scholarship_amount) is required'
}).transform((data) => {
  const active = data.is_scholarship_active !== undefined 
    ? data.is_scholarship_active 
    : (data.isScholarshipActive !== undefined ? data.isScholarshipActive : data.scholarship_active);
  const amount = data.scholarship_amount !== undefined 
    ? data.scholarship_amount 
    : data.scholarshipAmount;
  const result = {};
  if (active !== undefined) result.is_scholarship_active = active;
  if (amount !== undefined) result.scholarship_amount = amount;
  return result;
});

export const verifyManualPaymentSchema = z.object({
  payment_type: z.enum(['registration_fee', 'course_fee']).optional().default('registration_fee'),
  paymentType: z.enum(['registration_fee', 'course_fee']).optional(),
  amount: z.coerce.number().positive('Payment amount must be greater than zero'),
  payment_method: z.string().trim().min(1, 'Payment method is required').max(50),
  paymentMethod: z.string().trim().max(50).optional(),
  transaction_reference: z.string().trim().min(3, 'Transaction reference number is required').max(100),
  transactionReference: z.string().trim().max(100).optional(),
  actual_payment_date: z.string().trim().min(4, 'Actual payment date/time is required'),
  paymentDate: z.string().trim().optional(),
  verification_notes: z.string().trim().max(1000).optional().default(''),
  verificationNotes: z.string().trim().max(1000).optional(),
  payment_proof_path: z.string().trim().max(255).optional().default('')
});

export const createSpecializationSchema = z.object({
  course_id: z.coerce.number().int().positive('A valid course is required'),
  code: z.string().trim().min(2, 'Specialisation code is required').max(50),
  name: z.string().trim().min(2, 'Specialisation name is required').max(255),
  is_active: z.preprocess((v) => (v === false || v === '0' || v === 0 ? 0 : 1), z.number()).optional().default(1)
});

export const updateSpecializationSchema = z.object({
  course_id: z.coerce.number().int().positive('A valid course is required').optional(),
  code: z.string().trim().min(2, 'Specialisation code must be at least 2 characters').max(50).optional(),
  name: z.string().trim().min(2, 'Specialisation name must be at least 2 characters').max(255).optional(),
  is_active: z.preprocess((v) => (v === undefined ? undefined : (v === false || v === '0' || v === 0 ? 0 : 1)), z.number().optional())
});

export const updateCourseStatusSchema = z.object({
  is_active: z.preprocess((v) => {
    if (v === undefined) return undefined;
    return (v === false || v === '0' || v === 0) ? 0 : 1;
  }, z.number().optional()),
  isActive: z.preprocess((v) => {
    if (v === undefined) return undefined;
    return (v === false || v === '0' || v === 0) ? 0 : 1;
  }, z.number().optional())
}).refine((data) => {
  return data.is_active !== undefined || data.isActive !== undefined;
}, {
  message: 'is_active field is required'
}).transform((data) => {
  return {
    is_active: data.is_active !== undefined ? data.is_active : (data.isActive !== undefined ? data.isActive : 1)
  };
});

export const updateSpecializationStatusSchema = z.object({
  is_active: z.preprocess((v) => {
    if (v === undefined) return undefined;
    return (v === false || v === '0' || v === 0) ? 0 : 1;
  }, z.number().optional()),
  isActive: z.preprocess((v) => {
    if (v === undefined) return undefined;
    return (v === false || v === '0' || v === 0) ? 0 : 1;
  }, z.number().optional())
}).refine((data) => {
  return data.is_active !== undefined || data.isActive !== undefined;
}, {
  message: 'is_active field is required'
}).transform((data) => {
  return {
    is_active: data.is_active !== undefined ? data.is_active : (data.isActive !== undefined ? data.isActive : 1)
  };
});

export const listSpecializationsQuerySchema = z.object({
  course_id: z.coerce.number().int().positive().optional(),
  status: z.enum(['all', 'active', 'inactive']).optional().default('all'),
  search: z.string().trim().optional()
});

export const updateCourseDistributionsSchema = z.object({
  distributions: z.array(
    z.object({
      category: z.string().trim().min(1, 'Category is required'),
      amount: z.preprocess((v) => (v === '' || v === null || v === undefined ? 0 : Number(v)), z.number().min(0, 'Amount must be >= 0')),
      is_active: z.preprocess((v) => (v === true || v === '1' || v === 1 ? 1 : 0), z.number().optional().default(1)),
      eligibility_config: z.record(z.any()).optional().default({})
    })
  ).min(1, 'At least one distribution category is required')
});

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

