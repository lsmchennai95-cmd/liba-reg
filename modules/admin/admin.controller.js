import * as AdminService from './admin.service.js';
import { env } from '../../config/env.js';
import { withSafeHandler } from '../../services/errorLogger.service.js';

const getAdminCookieOptions = () => ({
  httpOnly: true,
  secure: env.isProduction,
  sameSite: env.isProduction ? 'none' : 'lax',
  maxAge: 7 * 24 * 60 * 60 * 1000,
  path: '/'
});

export const loginAdmin = withSafeHandler(
  async (req, res) => {
    const { email, password } = req.body;
    const result = await AdminService.loginAdmin(email, password);

    res.cookie(env.adminCookieName || 'liba_admin_token', result.token, getAdminCookieOptions());

    return res.status(200).json({
      success: true,
      message: 'Admin login successful',
      data: result
    });
  },
  {
    context: 'admin.auth.login',
    fallbackMessage: 'Unable to sign in right now. Please try again.'
  }
);

export const logoutAdmin = (req, res) => {
  const options = getAdminCookieOptions();
  delete options.maxAge;
  res.clearCookie(env.adminCookieName || 'liba_admin_token', options);

  return res.status(200).json({
    success: true,
    message: 'Admin logged out successfully',
    data: {}
  });
};

export const getAdminMe = withSafeHandler(
  async (req, res) => {
    const user = await AdminService.getAdminMe(req.user.userId || req.user.id);
    return res.status(200).json({
      success: true,
      message: 'Admin profile retrieved successfully',
      data: { user }
    });
  },
  {
    context: 'admin.auth.me',
    fallbackMessage: 'Unable to verify administrator session.'
  }
);

export const getDashboardStats = withSafeHandler(
  async (req, res) => {
    const stats = await AdminService.getDashboardStats(req.validatedQuery || req.query);
    return res.status(200).json({
      success: true,
      message: 'Admin dashboard statistics retrieved successfully',
      data: stats
    });
  },
  {
    context: 'admin.dashboard.stats',
    fallbackMessage: 'Unable to load dashboard metrics right now. Please try again.'
  }
);

export const getStudents = withSafeHandler(
  async (req, res) => {
    const data = await AdminService.getStudents(req.validatedQuery || req.query);
    return res.status(200).json({
      success: true,
      message: 'Students retrieved successfully',
      data
    });
  },
  {
    context: 'admin.students.list',
    fallbackMessage: 'Unable to load student records right now. Please try again.'
  }
);

export const getStudentById = withSafeHandler(
  async (req, res) => {
    const student = await AdminService.getStudentById(req.params.id);
    return res.status(200).json({
      success: true,
      message: 'Student details retrieved successfully',
      data: { student }
    });
  },
  {
    context: 'admin.students.detail',
    fallbackMessage: 'Unable to load student details right now. Please try again.'
  }
);

export const getStudentPayments = withSafeHandler(
  async (req, res) => {
    const data = await AdminService.getStudentPayments(req.params.id);
    return res.status(200).json({
      success: true,
      message: 'Student payment history retrieved successfully',
      data
    });
  },
  {
    context: 'admin.students.payments',
    fallbackMessage: 'Unable to load student payment history right now. Please try again.'
  }
);

export const getPayments = withSafeHandler(
  async (req, res) => {
    const data = await AdminService.getPayments(req.validatedQuery || req.query);
    return res.status(200).json({
      success: true,
      message: 'Payment transactions retrieved successfully',
      data
    });
  },
  {
    context: 'admin.payments.list',
    fallbackMessage: 'Unable to load payment transactions right now. Please try again.'
  }
);

export const getScholarshipTimer = withSafeHandler(
  async (req, res) => {
    const data = await AdminService.getScholarshipTimer();
    return res.status(200).json({
      success: true,
      message: 'Scholarship timer setting retrieved successfully',
      data
    });
  },
  {
    context: 'admin.settings.getTimer',
    fallbackMessage: 'Unable to retrieve scholarship timer setting.'
  }
);

export const updateScholarshipTimer = withSafeHandler(
  async (req, res) => {
    const hours = req.body.hours ?? req.body.scholarship_timer_hours;
    const data = await AdminService.updateScholarshipTimer(hours, req.user);
    return res.status(200).json({
      success: true,
      message: 'Scholarship timer setting updated successfully',
      data
    });
  },
  {
    context: 'admin.settings.updateTimer',
    fallbackMessage: 'Unable to update scholarship timer setting.'
  }
);

export const reactivateStudentTimer = withSafeHandler(
  async (req, res) => {
    const minutes = req.body?.minutes ?? req.body?.duration_minutes ?? 10;
    const data = await AdminService.reactivateStudentTimer(req.params.id, minutes, req.user);
    return res.status(200).json({
      success: true,
      message: 'Scholarship timer reactivated successfully',
      data
    });
  },
  {
    context: 'admin.students.reactivateTimer',
    fallbackMessage: 'Unable to reactivate scholarship timer.'
  }
);

/* =====================================================================
   COURSE MANAGEMENT CONTROLLERS
===================================================================== */
export const getCourses = withSafeHandler(
  async (req, res) => {
    const courses = await AdminService.getCourses();
    return res.status(200).json({
      success: true,
      message: 'Courses retrieved successfully',
      data: {
        courses,
        total: courses.length
      }
    });
  },
  {
    context: 'admin.courses.list',
    fallbackMessage: 'Unable to load courses right now. Please try again.'
  }
);

export const getCourseById = withSafeHandler(
  async (req, res) => {
    const data = await AdminService.getCourseById(req.params.id);
    return res.status(200).json({
      success: true,
      message: 'Course details retrieved successfully',
      data
    });
  },
  {
    context: 'admin.courses.getById',
    fallbackMessage: 'Unable to load course details.'
  }
);

export const createCourse = withSafeHandler(
  async (req, res) => {
    const data = await AdminService.createCourse(req.body, req.user);
    return res.status(201).json({
      success: true,
      message: 'Course created successfully',
      data
    });
  },
  {
    context: 'admin.courses.create',
    fallbackMessage: 'Unable to create course.'
  }
);

export const updateCourse = withSafeHandler(
  async (req, res) => {
    const data = await AdminService.updateCourse(req.params.id, req.body, req.user);
    return res.status(200).json({
      success: true,
      message: 'Course updated successfully',
      data
    });
  },
  {
    context: 'admin.courses.update',
    fallbackMessage: 'Unable to update course.'
  }
);

export const updateCourseScholarship = withSafeHandler(
  async (req, res) => {
    const data = await AdminService.updateCourseScholarship(req.params.id, req.body, req.user);
    return res.status(200).json({
      success: true,
      message: 'Course scholarship status updated successfully',
      data
    });
  },
  {
    context: 'admin.courses.updateScholarship',
    fallbackMessage: 'Unable to update course scholarship status.'
  }
);

export const getCourseScholarshipDistributions = withSafeHandler(
  async (req, res) => {
    const data = await AdminService.getCourseScholarshipDistributions(req.params.id);
    return res.status(200).json({
      success: true,
      message: 'Course scholarship distributions retrieved successfully',
      data
    });
  },
  {
    context: 'admin.courses.getDistributions',
    fallbackMessage: 'Unable to retrieve course scholarship distributions.'
  }
);

export const getAllCourseScholarshipDistributions = withSafeHandler(
  async (req, res) => {
    const data = await AdminService.getAllCourseScholarshipDistributions();
    return res.status(200).json({
      success: true,
      message: 'All course scholarship distributions retrieved successfully',
      data
    });
  },
  {
    context: 'admin.courses.getAllDistributions',
    fallbackMessage: 'Unable to retrieve all course scholarship distributions.'
  }
);

export const saveCourseScholarshipDistributions = withSafeHandler(
  async (req, res) => {
    const data = await AdminService.saveCourseScholarshipDistributions(req.params.id, req.body, req.user);
    return res.status(200).json({
      success: true,
      message: 'Course scholarship distributions saved successfully',
      data
    });
  },
  {
    context: 'admin.courses.saveDistributions',
    fallbackMessage: 'Unable to save course scholarship distributions.'
  }
);

export const updateCourseStatus = withSafeHandler(
  async (req, res) => {
    const data = await AdminService.updateCourseStatus(req.params.id, req.body.is_active, req.user);
    return res.status(200).json({
      success: true,
      message: `Course status updated to ${data.is_active ? 'active' : 'inactive'}`,
      data
    });
  },
  {
    context: 'admin.courses.updateStatus',
    fallbackMessage: 'Unable to update course status.'
  }
);

export const deleteCourse = withSafeHandler(
  async (req, res) => {
    const data = await AdminService.deleteCourse(req.params.id, req.user);
    return res.status(200).json({
      success: true,
      message: data.message,
      data
    });
  },
  {
    context: 'admin.courses.delete',
    fallbackMessage: 'Unable to delete course.'
  }
);

/* =====================================================================
   SPECIALISATION MANAGEMENT CONTROLLERS
===================================================================== */
export const getSpecializations = withSafeHandler(
  async (req, res) => {
    const data = await AdminService.getSpecializations(req.validatedQuery || req.query);
    return res.status(200).json({
      success: true,
      message: 'Specialisations retrieved successfully',
      data: {
        specializations: data,
        total: data.length
      }
    });
  },
  {
    context: 'admin.specializations.list',
    fallbackMessage: 'Unable to load specialisations.'
  }
);

export const getSpecializationById = withSafeHandler(
  async (req, res) => {
    const data = await AdminService.getSpecializationById(req.params.id);
    return res.status(200).json({
      success: true,
      message: 'Specialisation details retrieved successfully',
      data
    });
  },
  {
    context: 'admin.specializations.getById',
    fallbackMessage: 'Unable to load specialisation details.'
  }
);

export const createSpecialization = withSafeHandler(
  async (req, res) => {
    const data = await AdminService.createSpecialization(req.body, req.user);
    return res.status(201).json({
      success: true,
      message: 'Specialisation created successfully',
      data
    });
  },
  {
    context: 'admin.specializations.create',
    fallbackMessage: 'Unable to create specialisation.'
  }
);

export const updateSpecialization = withSafeHandler(
  async (req, res) => {
    const data = await AdminService.updateSpecialization(req.params.id, req.body, req.user);
    return res.status(200).json({
      success: true,
      message: 'Specialisation updated successfully',
      data
    });
  },
  {
    context: 'admin.specializations.update',
    fallbackMessage: 'Unable to update specialisation.'
  }
);

export const deleteSpecialization = withSafeHandler(
  async (req, res) => {
    const data = await AdminService.deleteSpecialization(req.params.id, req.user);
    return res.status(200).json({
      success: true,
      message: data.message,
      data
    });
  },
  {
    context: 'admin.specializations.delete',
    fallbackMessage: 'Unable to delete specialisation.'
  }
);

export const updateSpecializationStatus = withSafeHandler(
  async (req, res) => {
    const data = await AdminService.updateSpecializationStatus(req.params.id, req.body.is_active, req.user);
    return res.status(200).json({
      success: true,
      message: `Specialisation status updated to ${data.is_active ? 'active' : 'inactive'}`,
      data
    });
  },
  {
    context: 'admin.specializations.status',
    fallbackMessage: 'Unable to update specialisation status.'
  }
);

/* =====================================================================
   STUDENT SCHOLARSHIP DETAILS & MANUAL PAYMENT VERIFICATION
===================================================================== */
export const getStudentScholarshipDetails = withSafeHandler(
  async (req, res) => {
    const data = await AdminService.getStudentScholarshipDetails(req.params.id);
    return res.status(200).json({
      success: true,
      message: 'Student scholarship details retrieved successfully',
      data
    });
  },
  {
    context: 'admin.students.scholarship',
    fallbackMessage: 'Unable to retrieve student scholarship details.'
  }
);

export const verifyRegistrationPayment = withSafeHandler(
  async (req, res) => {
    const data = await AdminService.verifyRegistrationPayment(req.params.id, req.body, req.user);
    const isCourseFee = req.body?.payment_type === 'course_fee' || req.body?.paymentType === 'course_fee';
    return res.status(200).json({
      success: true,
      message: isCourseFee
        ? 'Course fee payment verified and recorded successfully'
        : 'Registration fee payment verified successfully',
      data
    });
  },
  {
    context: 'admin.students.verifyPayment',
    fallbackMessage: 'Unable to verify payment.'
  }
);



