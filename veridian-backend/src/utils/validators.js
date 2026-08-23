const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const NET_WORTH_OPTIONS = ['$1M–$5M', '$5M–$20M', '$20M+'];
const TIER_INTEREST_OPTIONS = ['Foundation', 'Accelerated', 'Executive', 'Not sure'];
const LEAD_STATUS_OPTIONS = [
  'New',
  'Contacted',
  'Consultation Scheduled',
  'Engagement Sent',
  'Signed',
  'Rejected',
  'Converted',
  'Archived',
];

/**
 * Checks whether a value is a syntactically valid email address.
 *
 * @param {string} email
 * @returns {boolean}
 */
function validateEmail(email) {
  if (typeof email !== 'string') {
    return false;
  }
  return EMAIL_REGEX.test(email.trim());
}

/**
 * Checks that every field in `requiredFields` is present on `data` and not empty
 * (empty meaning undefined, null, or a whitespace-only string).
 *
 * @param {Object} data
 * @param {string[]} requiredFields
 * @returns {{ valid: boolean, errors: string[] }}
 */
function validateRequiredFields(data = {}, requiredFields = []) {
  const errors = [];

  requiredFields.forEach((field) => {
    const value = data ? data[field] : undefined;
    const isMissing =
      value === undefined ||
      value === null ||
      (typeof value === 'string' && value.trim().length === 0);

    if (isMissing) {
      errors.push(`${field} is required`);
    }
  });

  return { valid: errors.length === 0, errors };
}

/**
 * Checks whether a value is one of the allowed net worth brackets.
 *
 * @param {string} value
 * @returns {boolean}
 */
function validateNetWorth(value) {
  return typeof value === 'string' && NET_WORTH_OPTIONS.includes(value.trim());
}

/**
 * Checks whether a value is one of the allowed service tier interests.
 *
 * @param {string} value
 * @returns {boolean}
 */
function validateTierInterest(value) {
  return typeof value === 'string' && TIER_INTEREST_OPTIONS.includes(value.trim());
}

/**
 * Checks whether a value is one of the allowed lead statuses.
 *
 * @param {string} value
 * @returns {boolean}
 */
function validateLeadStatus(value) {
  return typeof value === 'string' && LEAD_STATUS_OPTIONS.includes(value.trim());
}

/**
 * Trims whitespace and escapes characters that are special in HTML, as a basic
 * XSS guard for free-text fields that may later be rendered in a browser.
 *
 * @param {*} value
 * @returns {*} The sanitized string, or the original value unchanged if it isn't a string.
 */
function sanitizeInput(value) {
  if (typeof value !== 'string') {
    return value;
  }

  return value
    .trim()
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
    .replace(/\//g, '&#x2F;');
}

/**
 * Comprehensive validation for the POST /api/leads (submit-lead) payload.
 * Combines required-field checks with format/enum checks and returns every
 * failure found, rather than stopping at the first one.
 *
 * @param {Object} payload
 * @param {string} payload.full_name
 * @param {string} payload.country
 * @param {string} payload.net_worth
 * @param {string} payload.tier_interest
 * @param {string} payload.email
 * @param {boolean} payload.disclaimer_accepted
 * @param {string} [payload.notes]
 * @param {string} [payload.source]
 * @returns {{ valid: boolean, errors: string[] }}
 */
function validateLeadPayload(payload = {}) {
  const { full_name, country, net_worth, tier_interest, email, disclaimer_accepted, notes, source } = payload;

  const { errors } = validateRequiredFields(payload, [
    'full_name',
    'country',
    'net_worth',
    'tier_interest',
    'email',
    'disclaimer_accepted',
  ]);

  if (typeof full_name === 'string' && full_name.trim().length > 0 && full_name.trim().length < 2) {
    errors.push('full_name must be at least 2 characters long');
  }

  if (typeof country === 'string' && country.trim().length > 0 && country.trim().length < 2) {
    errors.push('country must be at least 2 characters long');
  }

  if (email !== undefined && email !== null && String(email).trim().length > 0 && !validateEmail(email)) {
    errors.push(`email must be a valid email address (received: "${email}")`);
  }

  if (net_worth !== undefined && net_worth !== null && String(net_worth).trim().length > 0 && !validateNetWorth(net_worth)) {
    errors.push(`net_worth must be one of: ${NET_WORTH_OPTIONS.join(', ')} (received: "${net_worth}")`);
  }

  if (
    tier_interest !== undefined &&
    tier_interest !== null &&
    String(tier_interest).trim().length > 0 &&
    !validateTierInterest(tier_interest)
  ) {
    errors.push(`tier_interest must be one of: ${TIER_INTEREST_OPTIONS.join(', ')} (received: "${tier_interest}")`);
  }

  if (disclaimer_accepted !== true) {
    errors.push('disclaimer_accepted must be explicitly set to true');
  }

  if (notes !== undefined && notes !== null && typeof notes !== 'string') {
    errors.push('notes must be a string');
  }

  if (source !== undefined && source !== null && typeof source !== 'string') {
    errors.push('source must be a string');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

const PRE_VETTING_FIELDS = ['country', 'netWorth', 'sourceOfFunds', 'criminalRecord', 'tierInterest'];

/**
 * Validates answers to the 5-question pre-vetting questionnaire sent by
 * emailService.sendPreVettingEmail (country, net worth, source of funds,
 * criminal record, tier interest). All 5 must be present and not empty;
 * netWorth and tierInterest are additionally checked against the same
 * enums used for the initial intake form, since they should stay consistent
 * with what the lead originally submitted.
 *
 * @param {Object} answers
 * @param {string} answers.country
 * @param {string} answers.netWorth
 * @param {string} answers.sourceOfFunds
 * @param {string} answers.criminalRecord
 * @param {string} answers.tierInterest
 * @returns {{ valid: boolean, errors: string[] }}
 */
function validatePreVettingAnswers(answers = {}) {
  const { netWorth, tierInterest } = answers;

  const { errors } = validateRequiredFields(answers, PRE_VETTING_FIELDS);

  if (netWorth !== undefined && netWorth !== null && String(netWorth).trim().length > 0 && !validateNetWorth(netWorth)) {
    errors.push(`netWorth must be one of: ${NET_WORTH_OPTIONS.join(', ')} (received: "${netWorth}")`);
  }

  if (
    tierInterest !== undefined &&
    tierInterest !== null &&
    String(tierInterest).trim().length > 0 &&
    !validateTierInterest(tierInterest)
  ) {
    errors.push(`tierInterest must be one of: ${TIER_INTEREST_OPTIONS.join(', ')} (received: "${tierInterest}")`);
  }

  return { valid: errors.length === 0, errors };
}

module.exports = {
  NET_WORTH_OPTIONS,
  TIER_INTEREST_OPTIONS,
  LEAD_STATUS_OPTIONS,
  PRE_VETTING_FIELDS,
  validateEmail,
  validateRequiredFields,
  validateNetWorth,
  validateTierInterest,
  validateLeadStatus,
  sanitizeInput,
  validateLeadPayload,
  validatePreVettingAnswers,
};
