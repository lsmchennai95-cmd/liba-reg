 CREATE DATABASE IF NOT EXISTS `liba_online`
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE `liba_online`;

SET FOREIGN_KEY_CHECKS = 0;

-- 1. USERS TABLE
DROP TABLE IF EXISTS `users`;
CREATE TABLE `users` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `email` VARCHAR(255) NOT NULL,
  `password_hash` VARCHAR(255) NOT NULL,
  `role` ENUM('student', 'admin') NOT NULL DEFAULT 'student',
  `is_active` TINYINT(1) NOT NULL DEFAULT 0,
  `is_verified` TINYINT(1) NOT NULL DEFAULT 0,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_users_email` (`email`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 2. STUDENT PROFILES TABLE
DROP TABLE IF EXISTS `student_profiles`;
CREATE TABLE `student_profiles` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id` BIGINT UNSIGNED NOT NULL,
  `student_id` VARCHAR(50) NOT NULL,
  `application_no` VARCHAR(50) NOT NULL,
  `first_name` VARCHAR(100) NOT NULL,
  `last_name` VARCHAR(100) NULL DEFAULT NULL,
  `country_code` VARCHAR(10) NOT NULL DEFAULT '+91',
  `mobile_number` VARCHAR(20) NOT NULL,
  `terms_accepted` TINYINT(1) NOT NULL DEFAULT 1,
  `application_status` ENUM('pending_verification', 'email_verified', 'awaiting_payment', 'payment_pending', 'payment_failed', 'submitted', 'scholarship_submitted', 'pending_review', 'under_scrutiny', 'approved', 'rejected') NOT NULL DEFAULT 'pending_verification',
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_student_profiles_user_id` (`user_id`),
  UNIQUE KEY `uq_student_profiles_student_id` (`student_id`),
  UNIQUE KEY `uq_student_profiles_application_no` (`application_no`),
  UNIQUE KEY `uq_student_profiles_mobile` (`mobile_number`),
  CONSTRAINT `fk_student_profiles_user` FOREIGN KEY (`user_id`)
    REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 3. COURSES TABLE
DROP TABLE IF EXISTS `courses`;
CREATE TABLE `courses` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `code` VARCHAR(50) NOT NULL,
  `name` VARCHAR(255) NOT NULL,
  `description` TEXT NULL DEFAULT NULL,
  `is_active` TINYINT(1) NOT NULL DEFAULT 1,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_courses_code` (`code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 4. SPECIALIZATIONS TABLE
DROP TABLE IF EXISTS `specializations`;
CREATE TABLE `specializations` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `course_id` BIGINT UNSIGNED NOT NULL,
  `code` VARCHAR(50) NOT NULL,
  `name` VARCHAR(255) NOT NULL,
  `is_active` TINYINT(1) NOT NULL DEFAULT 1,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_spec_course` (`course_id`),
  CONSTRAINT `fk_spec_course` FOREIGN KEY (`course_id`)
    REFERENCES `courses` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 5. COURSE FEES TABLE
DROP TABLE IF EXISTS `course_fees`;
CREATE TABLE `course_fees` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `course_id` BIGINT UNSIGNED NOT NULL,
  `total_fee` DECIMAL(12, 2) NOT NULL,
  `registration_fee` DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
  `admission_fee` DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
  `tuition_fee` DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_course_fees_course` (`course_id`),
  CONSTRAINT `fk_course_fees_course` FOREIGN KEY (`course_id`)
    REFERENCES `courses` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 6. ENROLLMENTS TABLE
DROP TABLE IF EXISTS `enrollments`;
CREATE TABLE `enrollments` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id` BIGINT UNSIGNED NOT NULL,
  `student_profile_id` BIGINT UNSIGNED NOT NULL,
  `course_id` BIGINT UNSIGNED NOT NULL,
  `specialization_id` BIGINT UNSIGNED NOT NULL,
  `enrollment_status` ENUM('pending', 'admitted', 'enrolled', 'completed') NOT NULL DEFAULT 'pending',
  `total_fee` DECIMAL(12, 2) NOT NULL,
  `amount_paid` DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
  `outstanding_balance` DECIMAL(12, 2) NOT NULL,
  `enrolled_at` DATETIME NULL DEFAULT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_enrollments_user` (`user_id`),
  KEY `idx_enrollments_profile` (`student_profile_id`),
  CONSTRAINT `fk_enrollments_user` FOREIGN KEY (`user_id`)
    REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_enrollments_profile` FOREIGN KEY (`student_profile_id`)
    REFERENCES `student_profiles` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_enrollments_course` FOREIGN KEY (`course_id`)
    REFERENCES `courses` (`id`) ON UPDATE CASCADE,
  CONSTRAINT `fk_enrollments_specialization` FOREIGN KEY (`specialization_id`)
    REFERENCES `specializations` (`id`) ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 7. PAYMENTS TABLE
DROP TABLE IF EXISTS `payments`;
CREATE TABLE `payments` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `enrollment_id` BIGINT UNSIGNED NOT NULL,
  `user_id` BIGINT UNSIGNED NOT NULL,
  `transaction_id` VARCHAR(100) NOT NULL,
  `order_id` VARCHAR(100) NULL DEFAULT NULL,
  `tid` VARCHAR(100) NULL DEFAULT NULL,
  `tracking_id` VARCHAR(100) NULL DEFAULT NULL,
  `bank_ref_no` VARCHAR(100) NULL DEFAULT NULL,
  `payment_mode` VARCHAR(100) NULL DEFAULT NULL,
  `amount` DECIMAL(12, 2) NOT NULL,
  `currency` VARCHAR(10) NOT NULL DEFAULT 'INR',
  `payment_method` VARCHAR(50) NULL DEFAULT NULL,
  `payment_gateway` VARCHAR(50) NOT NULL DEFAULT 'ccavenue',
  `payment_status` ENUM('pending', 'successful', 'failed', 'cancelled', 'refunded') NOT NULL DEFAULT 'pending',
  `receipt_url` VARCHAR(255) NULL DEFAULT NULL,
  `raw_response` TEXT NULL,
  `gateway_response` TEXT NULL,
  `paid_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_payments_transaction_id` (`transaction_id`),
  UNIQUE KEY `uq_payments_order_id` (`order_id`),
  UNIQUE KEY `uq_payments_tid` (`tid`),
  KEY `idx_payments_tracking` (`tracking_id`),
  KEY `idx_payments_enrollment` (`enrollment_id`),
  KEY `idx_payments_user` (`user_id`),
  CONSTRAINT `fk_payments_enrollment` FOREIGN KEY (`enrollment_id`)
    REFERENCES `enrollments` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_payments_user` FOREIGN KEY (`user_id`)
    REFERENCES `users` (`id`) ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 7A. REGISTRATION PAYMENTS TABLE (CCAvenue & Preserved Historical Razorpay Records)
DROP TABLE IF EXISTS `registration_payments`;
CREATE TABLE `registration_payments` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id` BIGINT UNSIGNED NOT NULL,
  `student_profile_id` BIGINT UNSIGNED NULL DEFAULT NULL,
  `student_id` VARCHAR(50) NULL DEFAULT NULL,
  `course_id` BIGINT UNSIGNED NOT NULL,
  `original_reg_fee` DECIMAL(12, 2) NOT NULL,
  `scholarship_code` VARCHAR(50) NULL DEFAULT NULL,
  `scholarship_discount` DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
  `final_reg_fee` DECIMAL(12, 2) NOT NULL,
  `amount` DECIMAL(12, 2) NULL DEFAULT NULL,
  `order_id` VARCHAR(100) NOT NULL,
  `transaction_id` VARCHAR(100) NULL DEFAULT NULL,
  `tracking_id` VARCHAR(100) NULL DEFAULT NULL,
  `bank_ref_no` VARCHAR(100) NULL DEFAULT NULL,
  `payment_mode` VARCHAR(100) NULL DEFAULT NULL,
  `payment_gateway` VARCHAR(50) NOT NULL DEFAULT 'ccavenue',
  `payment_type` VARCHAR(50) NOT NULL DEFAULT 'registration_fee',
  `request_type` VARCHAR(50) NULL DEFAULT 'payment_initiation',
  `tid` VARCHAR(100) NULL DEFAULT NULL,
  `merchant_id` VARCHAR(100) NULL DEFAULT NULL,
  `currency` VARCHAR(10) NOT NULL DEFAULT 'INR',
  `redirect_url` VARCHAR(500) NULL DEFAULT NULL,
  `cancel_url` VARCHAR(500) NULL DEFAULT NULL,
  `language` VARCHAR(10) NOT NULL DEFAULT 'EN',
  `billing_name` VARCHAR(255) NULL DEFAULT NULL,
  `billing_email` VARCHAR(255) NULL DEFAULT NULL,
  `courses` VARCHAR(255) NULL DEFAULT NULL,
  `payment_status` ENUM('pending', 'successful', 'failed', 'cancelled') NOT NULL DEFAULT 'pending',
  `paid_at` DATETIME NULL DEFAULT NULL,
  `raw_response` TEXT NULL DEFAULT NULL,
  `gateway_response` TEXT NULL DEFAULT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_reg_payments_order` (`order_id`),
  UNIQUE KEY `uq_reg_payments_transaction` (`transaction_id`),
  UNIQUE KEY `uq_reg_payments_tid` (`tid`),
  KEY `idx_reg_payments_user` (`user_id`),
  KEY `idx_reg_payments_tracking` (`tracking_id`),
  KEY `idx_reg_payments_gateway` (`payment_gateway`),
  KEY `idx_reg_payments_student_id` (`student_id`),
  CONSTRAINT `fk_reg_payments_user` FOREIGN KEY (`user_id`)
    REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 8. SCHOLARSHIP CODES TABLE
DROP TABLE IF EXISTS `scholarship_codes`;
CREATE TABLE `scholarship_codes` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `code` VARCHAR(20) NOT NULL UNIQUE,
  `amount` DECIMAL(12, 2) NOT NULL,
  `description` VARCHAR(255) NOT NULL DEFAULT 'Counselor Scholarship Grant',
  `is_active` TINYINT(1) NOT NULL DEFAULT 1,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_scholarship_code` (`code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 9. STUDENT ACADEMICS TABLE
DROP TABLE IF EXISTS `student_academics`;
CREATE TABLE `student_academics` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id` BIGINT UNSIGNED NOT NULL,
  `student_profile_id` BIGINT UNSIGNED NULL,
  `twelfth_school` VARCHAR(255) NULL,
  `twelfth_board` VARCHAR(100) NULL,
  `twelfth_stream` VARCHAR(100) NULL,
  `twelfth_year` VARCHAR(10) NULL,
  `twelfth_percentage` VARCHAR(20) NULL,
  `ug_degree` VARCHAR(100) NULL,
  `ug_college` VARCHAR(255) NULL,
  `ug_specialization` VARCHAR(150) NULL,
  `ug_year` VARCHAR(10) NULL,
  `ug_percentage` VARCHAR(20) NULL,
  `certifications` JSON NULL,
  `promo_code` VARCHAR(20) NULL,
  `scholarship_amount` DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
  `scholarship_status` ENUM('not_applied', 'applied', 'approved', 'rejected') NOT NULL DEFAULT 'not_applied',
  `applied_at` DATETIME NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_student_academics_user` (`user_id`),
  KEY `idx_student_academics_profile` (`student_profile_id`),
  CONSTRAINT `fk_student_academics_user` FOREIGN KEY (`user_id`)
    REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 10. REGISTRATION NOTIFICATION RECIPIENTS TABLE
DROP TABLE IF EXISTS `registration_notification_recipients`;
CREATE TABLE `registration_notification_recipients` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `recipient_name` VARCHAR(150) NOT NULL,
  `email` VARCHAR(255) NOT NULL,
  `is_active` TINYINT(1) NOT NULL DEFAULT 1,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_reg_notif_recipient_email` (`email`),
  KEY `idx_reg_notif_recipient_active` (`is_active`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 11. REGISTRATION NOTIFICATION OUTBOX TABLE
DROP TABLE IF EXISTS `registration_notification_outbox`;
CREATE TABLE `registration_notification_outbox` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id` BIGINT UNSIGNED NOT NULL,
  `student_id` VARCHAR(50) NULL DEFAULT NULL,
  `application_no` VARCHAR(50) NULL DEFAULT NULL,
  `payload` JSON NOT NULL,
  `recipients_snapshot` JSON NULL DEFAULT NULL,
  `status` ENUM('pending', 'processing', 'sent', 'failed', 'skipped') NOT NULL DEFAULT 'pending',
  `attempts` INT UNSIGNED NOT NULL DEFAULT 0,
  `max_attempts` INT UNSIGNED NOT NULL DEFAULT 3,
  `last_error` TEXT NULL DEFAULT NULL,
  `next_retry_at` DATETIME NULL DEFAULT NULL,
  `sent_at` DATETIME NULL DEFAULT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_reg_notif_outbox_user` (`user_id`),
  KEY `idx_reg_notif_outbox_status_retry` (`status`, `next_retry_at`),
  CONSTRAINT `fk_reg_notif_outbox_user` FOREIGN KEY (`user_id`)
    REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET FOREIGN_KEY_CHECKS = 1;

-- =====================================================================
-- INITIAL SEED DATA
-- =====================================================================

INSERT INTO `courses` (`id`, `code`, `name`, `description`, `is_active`) VALUES
(1, 'PGDM', 'PGDM (Online) AICTE Approved', 'Post Graduate Diploma in Management - 2-year premier online programme approved by AICTE.', 1),
(2, 'PGP', 'PGP (Online) AI, Healthcare', 'Post Graduate Programme in Artificial Intelligence and Healthcare domains.', 1),
(10, 'EXEC_DIP', 'Executive Diploma Programs', 'Executive Diploma Programmes for working professionals.', 1)
ON DUPLICATE KEY UPDATE `name` = VALUES(`name`);

INSERT INTO `specializations` (`id`, `course_id`, `code`, `name`, `is_active`) VALUES
(1, 1, 'MKT', 'Marketing Management', 1),
(2, 1, 'FIN', 'Financial Management', 1),
(3, 1, 'HRM', 'Human Resource Management', 1),
(4, 1, 'BA', 'Business Analytics', 1),
(5, 1, 'HCM', 'Healthcare Management', 1),
(6, 1, 'SCM', 'Logistics and Supply Chain Management', 1),
(7, 2, 'AI_DS', 'AI & Data Science', 1),
(8, 2, 'HCM', 'Healthcare Management', 1),
(9, 10, 'AI_FIN', 'AI-Enabled Investment Analysis and Portfolio Management', 1),
(10, 10, 'GEN_AI', 'Generative Artificial Intelligence', 1)
ON DUPLICATE KEY UPDATE `name` = VALUES(`name`);

INSERT INTO `course_fees` (`id`, `course_id`, `total_fee`, `registration_fee`, `admission_fee`, `tuition_fee`) VALUES
(1, 1, 350000.00, 25000.00, 50000.00, 275000.00),
(2, 2, 200000.00, 15000.00, 35000.00, 150000.00),
(3, 10, 150000.00, 10000.00, 20000.00, 120000.00)
ON DUPLICATE KEY UPDATE `total_fee` = VALUES(`total_fee`);

