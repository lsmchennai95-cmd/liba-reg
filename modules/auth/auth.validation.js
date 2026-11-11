import { z } from 'zod';

export const registerSchema = z.object({
  firstName: z.string().trim().min(2, 'First name must be at least 2 characters'),
  lastName: z.string().trim().optional(),
  email: z.string().trim().toLowerCase().email('Please provide a valid email address'),
  password: z.string().min(6, 'Password must be at least 6 characters'),
  mobileNumber: z.string().trim().regex(/^\d{7,15}$/, 'Mobile number must be between 7 and 15 digits'),
  countryCode: z.string().trim().default('+91'),
  courseId: z.coerce.number().int().positive('Please select a valid course'),
  specializationId: z.coerce.number().int().positive('Please select a valid specialization'),
  terms: z.coerce.boolean().refine((val) => val === true, 'You must accept the terms and conditions')
});

export const verifyOtpSchema = z.object({
  verificationToken: z.string().min(1, 'Verification token is required'),
  otp: z.string().trim().regex(/^\d{4}$/, 'OTP must be exactly 4 digits')
});

export const resendOtpSchema = z.object({
  verificationToken: z.string().min(1, 'Verification token is required')
});

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email('Please provide a valid email address'),
  password: z.string().min(1, 'Password is required')
});

export const forgotPasswordSchema = z.object({
  email: z.string().trim().toLowerCase().email('Please provide a valid email address')
});

export const resetPasswordSchema = z.object({
  resetToken: z.string().min(1, 'Reset token is required'),
  newPassword: z.string().min(6, 'Password must be at least 6 characters'),
  confirmPassword: z.string().min(1, 'Confirm password is required')
}).refine((data) => data.newPassword === data.confirmPassword, {
  message: 'Passwords do not match',
  path: ['confirmPassword']
});
