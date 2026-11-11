 
export const SCHOLARSHIP_CODES = {
  '980454': 1000,
  '234426': 2000,
  '543913': 3000,
  '482008': 4000,
  '749836': 5000,
  '767070': 6000,
  '342214': 7000,
  '473616': 8000,
  '494814': 9000,
  '461181': 10000,
  '968258': 11000,
  '689088': 12000,
  '959491': 13000,
  '331709': 14000,
  '409993': 15000,
  '835230': 16000,
  '178799': 17000,
  '144914': 18000,
  '336605': 19000,
  '851759': 20000,
  '857133': 21000,
  '230959': 22000,
  '526430': 23000,
  '380357': 24000,
  '736439': 25000,
  '587766': 26000,
  '835644': 27000,
  '454779': 28000,
  '659998': 29000,
  '125392': 30000,
  '795503': 31000,
  '479921': 32000,
  '103735': 33000,
  '436626': 34000,
  '150940': 35000,
  '466088': 36000,
  '261758': 37000,
  '156938': 38000,
  '406423': 39000,
  '295476': 40000,
  '129958': 41000,
  '258541': 42000,
  '408838': 43000,
  '144069': 44000,
  '830377': 45000,
  '328121': 46000,
  '565814': 47000,
  '286563': 48000,
  '279530': 49000,
  '585311': 50000
};

export const getScholarshipByCode = (rawCode) => {
  if (!rawCode) return null;
  const sanitized = String(rawCode).trim().replace(/\D/g, '');
  if (!sanitized || sanitized.length !== 6) return null;

  const amount = SCHOLARSHIP_CODES[sanitized];
  if (typeof amount !== 'number') return null;

  return {
    code: sanitized,
    amount,
    formattedAmount: `₹${amount.toLocaleString('en-IN')}`,
    description: 'Counselor Scholarship Grant'
  };
};

/**
 * Course-level Scholarship Eligibility & Rules
 * - PGDM: Total Scholarship Cap = ₹50,000
 *         Class 12th (>65%): ₹15,000
 *         UG Degree (>65%): ₹15,000
 *         Balance: Promocode Grant (up to ₹20,000 if both merits applied)
 * - PGP:  Total Scholarship Cap = ₹15,000
 *         Class 12th (>65%): ₹5,000
 *         UG Degree (>65%): ₹5,000
 *         Balance: Promocode Grant (up to ₹5,000 if both merits applied)
 * - EDP:  (EXEC_DIP / Executive Diploma): Not Eligible (Total = ₹0)
 */
export const getCourseScholarshipConfig = (courseCodeOrName) => {
  const str = String(courseCodeOrName || '').toUpperCase();

  // Executive Diploma Programmes (EDP) have NO scholarship eligibility
  if (str.includes('EXEC') || str.includes('EDP') || str.includes('2797') || str.includes('DIPLOMA')) {
    return {
      type: 'EDP',
      name: 'Executive Diploma Programs',
      isEligible: false,
      maxScholarship: 0,
      twelfthMerit: 0,
      ugMerit: 0,
      maxPromoBalance: 0,
      message: 'Executive Diploma Programmes (EDP) are not eligible for counselor/merit scholarships.'
    };
  }

  // PGP Online (Cap: ₹15,000)
  if (str.includes('PGP') || str.includes('2197')) {
    return {
      type: 'PGP',
      name: 'PGP (Online) AI, Healthcare',
      isEligible: true,
      maxScholarship: 15000,
      twelfthMerit: 5000,
      ugMerit: 5000,
      maxPromoBalance: 5000,
      message: 'PGP Online Scholarship Cap: Up to ₹15,000'
    };
  }

  // PGDM Online (Default Cap: ₹50,000)
  return {
    type: 'PGDM',
    name: 'PGDM (Online) AICTE Approved',
    isEligible: true,
    maxScholarship: 50000,
    twelfthMerit: 15000,
    ugMerit: 15000,
    maxPromoBalance: 20000,
    message: 'PGDM Online Scholarship Cap: Up to ₹50,000'
  };
};

/**
 * Calculates scholarship split across 12th Merit, UG Merit, and Promocode Balance
 */
export const calculateScholarshipBreakdown = ({
  courseCodeOrName,
  twelfthPercentage,
  ugPercentage,
  promoCodeAmount
}) => {
  const cfg = getCourseScholarshipConfig(courseCodeOrName);

  if (!cfg.isEligible) {
    return {
      isEligible: false,
      courseType: cfg.type,
      maxScholarship: 0,
      twelfthPercentage: parseFloat(String(twelfthPercentage || '').replace(/[^0-9.]/g, '')) || 0,
      twelfthEligible: false,
      twelfthMeritAmount: 0,
      ugPercentage: parseFloat(String(ugPercentage || '').replace(/[^0-9.]/g, '')) || 0,
      ugEligible: false,
      ugMeritAmount: 0,
      totalMeritAmount: 0,
      rawPromoAmount: Number(promoCodeAmount) || 0,
      appliedPromoAmount: 0,
      totalScholarshipAmount: 0,
      reason: cfg.message
    };
  }

  const twelfthPct = parseFloat(String(twelfthPercentage || '').replace(/[^0-9.]/g, '')) || 0;
  const ugPct = parseFloat(String(ugPercentage || '').replace(/[^0-9.]/g, '')) || 0;

  // Criteria: Class 12th above 65% and UG above 65%
  const twelfthEligible = twelfthPct >= 65;
  const ugEligible = ugPct >= 65;

  const twelfthMeritAmount = twelfthEligible ? cfg.twelfthMerit : 0;
  const ugMeritAmount = ugEligible ? cfg.ugMerit : 0;
  const totalMeritAmount = twelfthMeritAmount + ugMeritAmount;

  // Promocode fills the remaining balance up to maxScholarship cap
  const maxHeadroom = Math.max(0, cfg.maxScholarship - totalMeritAmount);
  const rawPromo = Number(promoCodeAmount) || 0;
  const appliedPromoAmount = Math.min(rawPromo, maxHeadroom);

  const totalScholarshipAmount = Math.min(cfg.maxScholarship, totalMeritAmount + appliedPromoAmount);

  return {
    isEligible: true,
    courseType: cfg.type,
    maxScholarship: cfg.maxScholarship,
    twelfthPercentage: twelfthPct,
    twelfthEligible,
    twelfthMeritAmount,
    ugPercentage: ugPct,
    ugEligible,
    ugMeritAmount,
    totalMeritAmount,
    rawPromoAmount: rawPromo,
    appliedPromoAmount,
    totalScholarshipAmount
  };
};
