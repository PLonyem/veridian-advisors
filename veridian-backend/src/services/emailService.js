const nodemailer = require('nodemailer');
const config = require('../config');
const logger = require('../utils/logger');
const leadService = require('./leadService');

const RATE_LIMIT_MS = 5 * 60 * 1000;
const lastSentAt = new Map();

let transporter = null;

function getTransporter() {
  if (transporter) return transporter;

  transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: config.email.user,
      pass: config.email.pass,
    },
  });

  return transporter;
}

function isRateLimited(key) {
  const last = lastSentAt.get(key);
  return Boolean(last) && Date.now() - last < RATE_LIMIT_MS;
}

function markSent(key) {
  lastSentAt.set(key, Date.now());
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]
  ));
}

function wrapEmailHtml(bodyHtml) {
  return `<!DOCTYPE html>
<html>
  <body style="margin:0;padding:0;background-color:#f4f4f5;font-family:Arial, Helvetica, sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f4f5;padding:24px 0;">
      <tr>
        <td align="center">
          <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="background-color:#ffffff;border-radius:8px;overflow:hidden;">
            <tr>
              <td style="background-color:#0b2545;padding:24px 32px;">
                <span style="color:#ffffff;font-size:20px;font-weight:bold;">Veridian Global Advisors</span>
              </td>
            </tr>
            <tr>
              <td style="padding:32px;color:#1f2937;font-size:15px;line-height:1.6;">
                ${bodyHtml}
              </td>
            </tr>
            <tr>
              <td style="padding:16px 32px;background-color:#f4f4f5;color:#6b7280;font-size:12px;">
                Veridian Global Advisors &middot; This is an automated message.
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

/**
 * Best-effort logging of an outgoing email to the communications table, keyed
 * by looking up the lead by email. Used by the manual-action send functions
 * below, which only receive a leadEmail/leadName pair rather than a full lead
 * record. Logging failures are caught and logged rather than rethrown - the
 * email has already been delivered by this point, so a failure to write the
 * audit-trail row must not make the send itself look like it failed.
 *
 * @param {string} leadEmail
 * @param {string} subject
 * @param {string} content
 * @returns {Promise<void>}
 */
async function logOutgoing(leadEmail, subject, content) {
  try {
    const lead = await leadService.getLeadByEmail(leadEmail);
    if (!lead) {
      logger.warn(`emailService: could not log communication - no lead found for email ${leadEmail}`);
      return;
    }
    await leadService.addCommunication(lead.id, 'outgoing', subject, content);
  } catch (err) {
    logger.error(`emailService: failed to log communication for ${leadEmail}: ${err.message}`);
  }
}

/**
 * Sends the client-facing confirmation email after a lead submits the contact form.
 * Skipped (returns null) if a confirmation was already sent to this address within the last 5 minutes.
 *
 * @param {Object} lead
 * @param {number} lead.id
 * @param {string} lead.full_name
 * @param {string} lead.email
 * @returns {Promise<Object|null>} nodemailer send info, or null if rate-limited
 */
async function sendClientConfirmation(lead) {
  const rateLimitKey = `client:${lead.email}`;
  if (isRateLimited(rateLimitKey)) {
    logger.warn(`emailService.sendClientConfirmation: rate-limited for ${lead.email}, skipping duplicate send`);
    return null;
  }

  const howItWorksUrl = `${config.baseUrl}/how-it-works`;
  const pricingUrl = `${config.baseUrl}/pricing`;
  const subject = 'Thank you for contacting Veridian Global Advisors';

  const html = wrapEmailHtml(`
    <p style="margin:0 0 16px;">Hi ${escapeHtml(lead.full_name)},</p>
    <p style="margin:0 0 16px;">Thank you for reaching out to Veridian Global Advisors. We've received your inquiry and a member of our team will be in touch within <strong>24 hours</strong>.</p>
    <p style="margin:0 0 16px;">In the meantime, feel free to learn more about how we work:</p>
    <p style="margin:0 0 16px;">
      <a href="${howItWorksUrl}" style="color:#0b2545;text-decoration:underline;">How It Works</a>
      &nbsp;&middot;&nbsp;
      <a href="${pricingUrl}" style="color:#0b2545;text-decoration:underline;">Pricing</a>
    </p>
    <p style="margin:0 0 16px;color:#6b7280;font-size:13px;">Your information is handled in accordance with our privacy policy and applicable financial compliance regulations. We will never share your details with third parties without your consent.</p>
    <p style="margin:0;">Best regards,<br />Veridian Global Advisors</p>
  `);

  const mailOptions = { from: config.email.user, to: lead.email, subject, html };

  let info;
  try {
    info = await getTransporter().sendMail(mailOptions);
    markSent(rateLimitKey);
    logger.info(`emailService.sendClientConfirmation: sent to ${lead.email} (${info.messageId})`);
  } catch (err) {
    logger.error(`emailService.sendClientConfirmation: failed for ${lead.email}: ${err.message}`);
    throw new Error(`Failed to send client confirmation to ${lead.email}: ${err.message}`);
  }

  try {
    await leadService.addCommunication(
      lead.id,
      'outgoing',
      subject,
      'Automated confirmation sent: 24-hour response expectation, privacy note, links to How It Works and Pricing.',
    );
  } catch (err) {
    logger.error(`emailService.sendClientConfirmation: failed to log communication for lead ${lead.id}: ${err.message}`);
  }

  return info;
}

/**
 * Sends the internal admin notification email for a newly submitted lead.
 * Skipped (returns null) if a notification for this lead's email was already sent within the last 5 minutes.
 *
 * @param {Object} lead
 * @param {number} lead.id
 * @param {string} lead.full_name
 * @param {string} lead.country
 * @param {string} lead.net_worth
 * @param {string} lead.tier_interest
 * @param {string} lead.email
 * @param {boolean|number} lead.disclaimer_accepted
 * @returns {Promise<Object|null>} nodemailer send info, or null if rate-limited
 */
async function sendAdminNotification(lead) {
  const rateLimitKey = `admin:${lead.email}`;
  if (isRateLimited(rateLimitKey)) {
    logger.warn(`emailService.sendAdminNotification: rate-limited for ${lead.email}, skipping duplicate send`);
    return null;
  }

  const timestamp = new Date().toISOString();
  const leadsUrl = `${config.baseUrl}/api/leads?key=${encodeURIComponent(config.adminKey)}`;
  const subject = `New Lead – ${lead.full_name} – ${lead.tier_interest}`;

  const html = wrapEmailHtml(`
    <p style="margin:0 0 16px;">A new lead was submitted.</p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 16px;border-collapse:collapse;">
      <tr><td style="padding:6px 12px 6px 0;color:#6b7280;width:140px;">Name</td><td style="padding:6px 0;">${escapeHtml(lead.full_name)}</td></tr>
      <tr><td style="padding:6px 12px 6px 0;color:#6b7280;">Email</td><td style="padding:6px 0;">${escapeHtml(lead.email)}</td></tr>
      <tr><td style="padding:6px 12px 6px 0;color:#6b7280;">Country</td><td style="padding:6px 0;">${escapeHtml(lead.country)}</td></tr>
      <tr><td style="padding:6px 12px 6px 0;color:#6b7280;">Net worth</td><td style="padding:6px 0;">${escapeHtml(lead.net_worth)}</td></tr>
      <tr><td style="padding:6px 12px 6px 0;color:#6b7280;">Tier interest</td><td style="padding:6px 0;">${escapeHtml(lead.tier_interest)}</td></tr>
      <tr><td style="padding:6px 12px 6px 0;color:#6b7280;">Disclaimer accepted</td><td style="padding:6px 0;">${lead.disclaimer_accepted ? 'Yes' : 'No'}</td></tr>
      <tr><td style="padding:6px 12px 6px 0;color:#6b7280;">Submitted at</td><td style="padding:6px 0;">${escapeHtml(timestamp)}</td></tr>
    </table>
    <p style="margin:0;">
      <a href="${leadsUrl}" style="color:#0b2545;text-decoration:underline;">View all leads</a>
    </p>
  `);

  const mailOptions = {
    from: config.email.user,
    to: config.email.adminEmail,
    replyTo: lead.email,
    subject,
    html,
  };

  let info;
  try {
    info = await getTransporter().sendMail(mailOptions);
    markSent(rateLimitKey);
    logger.info(`emailService.sendAdminNotification: sent for lead ${lead.email} (${info.messageId})`);
  } catch (err) {
    logger.error(`emailService.sendAdminNotification: failed for lead ${lead.email}: ${err.message}`);
    throw new Error(`Failed to send admin notification for lead ${lead.email}: ${err.message}`);
  }

  try {
    await leadService.addCommunication(
      lead.id,
      'outgoing',
      subject,
      'Automated admin notification sent with full lead details and a link to view all leads.',
    );
  } catch (err) {
    logger.error(`emailService.sendAdminNotification: failed to log communication for lead ${lead.id}: ${err.message}`);
  }

  return info;
}

/**
 * Sends a test email to verify EMAIL_USER/EMAIL_PASS configuration. Not tied
 * to a lead, so nothing is logged to the communications table.
 * Skipped (returns null) if a test email was already sent to this address within the last 5 minutes.
 *
 * @param {string} toEmail - recipient address
 * @returns {Promise<Object|null>} nodemailer send info, or null if rate-limited
 */
async function sendTestEmail(toEmail) {
  const rateLimitKey = `test:${toEmail}`;
  if (isRateLimited(rateLimitKey)) {
    logger.warn(`emailService.sendTestEmail: rate-limited for ${toEmail}, skipping duplicate send`);
    return null;
  }

  const html = wrapEmailHtml(`
    <p style="margin:0 0 16px;">This is a test email from Veridian Global Advisors.</p>
    <p style="margin:0 0 16px;">If you're reading this, the email configuration (EMAIL_USER / EMAIL_PASS) is working correctly.</p>
    <p style="margin:0;color:#6b7280;font-size:13px;">Sent at ${escapeHtml(new Date().toISOString())}</p>
  `);

  const mailOptions = {
    from: config.email.user,
    to: toEmail,
    subject: 'Veridian Global Advisors — Test Email',
    html,
  };

  try {
    const info = await getTransporter().sendMail(mailOptions);
    markSent(rateLimitKey);
    logger.info(`emailService.sendTestEmail: sent to ${toEmail} (${info.messageId})`);
    return info;
  } catch (err) {
    logger.error(`emailService.sendTestEmail: failed for ${toEmail}: ${err.message}`);
    throw new Error(`Failed to send test email to ${toEmail}: ${err.message}`);
  }
}

/**
 * Sends the manual pre-vetting questionnaire, the first step after a senior
 * advisor decides a lead is worth pursuing. Not rate-limited like the
 * automatic emails above - this is a deliberate one-off action taken by a
 * human, not a system response to user input, so accidental rapid resubmission
 * isn't a realistic concern the way a public form is.
 *
 * @param {string} leadEmail - Lead's email address.
 * @param {string} leadName - Lead's full name, for the greeting.
 * @returns {Promise<Object>} nodemailer send info
 */
async function sendPreVettingEmail(leadEmail, leadName) {
  const subject = 'Your inquiry about our document preparation services – next steps';

  const html = wrapEmailHtml(`
    <p style="margin:0 0 16px;">Hi ${escapeHtml(leadName)},</p>
    <p style="margin:0 0 16px;">Thank you for your interest in Veridian Global Advisors. Before we schedule your confidential consultation, we ask every prospective client to answer a few brief questions - this helps us make sure we're a good fit for your situation and lets your senior advisor prepare properly.</p>
    <p style="margin:0 0 16px;">Please reply directly to this email with your answers:</p>
    <ol style="margin:0 0 16px;padding-left:20px;">
      <li style="margin-bottom:10px;">What is your country of citizenship, and your current country of residence?</li>
      <li style="margin-bottom:10px;">Please confirm your approximate net worth bracket.</li>
      <li style="margin-bottom:10px;">What is the primary source of the funds you plan to use for this engagement (e.g., business ownership, investment income, sale of property, inheritance)?</li>
      <li style="margin-bottom:10px;">Do you have any criminal record, or have you ever been convicted of a criminal offense, in any country?</li>
      <li style="margin-bottom:0;">Which service tier are you leaning toward (Foundation, Accelerated, or Executive), and does our estimated timeline for that tier fit your needs?</li>
    </ol>
    <p style="margin:0 0 16px;">Once we've reviewed your answers, we'll follow up to schedule your consultation.</p>
    <p style="margin:0;">Best regards,<br />Veridian Global Advisors</p>
  `);

  const mailOptions = { from: config.email.user, to: leadEmail, subject, html };

  let info;
  try {
    info = await getTransporter().sendMail(mailOptions);
    logger.info(`emailService.sendPreVettingEmail: sent to ${leadEmail} (${info.messageId})`);
  } catch (err) {
    logger.error(`emailService.sendPreVettingEmail: failed for ${leadEmail}: ${err.message}`);
    throw new Error(`Failed to send pre-vetting email to ${leadEmail}: ${err.message}`);
  }

  await logOutgoing(
    leadEmail,
    subject,
    'Pre-vetting questionnaire sent (5 questions: country, net worth, source of funds, criminal record, tier interest).',
  );

  return info;
}

/**
 * Sends the manual consultation-scheduling email: proposed time slots and
 * platform options for the client to choose from. This does NOT lock in a
 * time by itself - per the manual-scheduling workflow, the client replies
 * with their preference and a human confirms it, at which point the lead's
 * status is updated separately (see PATCH /api/leads/:id/status).
 *
 * @param {string} leadEmail - Lead's email address.
 * @param {string} leadName - Lead's full name, for the greeting.
 * @param {Object} [details]
 * @param {string[]} details.slots - Proposed date/time options, e.g. ["Tue Aug 12, 2pm ET", "Wed Aug 13, 10am ET"]. Required, non-empty.
 * @param {string} [details.platform='Video call (Zoom or Google Meet) or phone'] - Platform option(s) offered.
 * @param {number} [details.durationMinutes=30] - Consultation length in minutes.
 * @returns {Promise<Object>} nodemailer send info
 */
async function sendSchedulingEmail(leadEmail, leadName, details = {}) {
  const { slots = [], platform = 'Video call (Zoom or Google Meet) or phone', durationMinutes = 30 } = details;

  if (!Array.isArray(slots) || slots.length === 0) {
    throw new Error('sendSchedulingEmail requires at least one proposed time slot (pass details.slots)');
  }

  const subject = 'Consultation Confirmation – Veridian Global Advisors';
  const slotsHtml = slots.map((slot) => `<li style="margin-bottom:6px;">${escapeHtml(slot)}</li>`).join('');

  const html = wrapEmailHtml(`
    <p style="margin:0 0 16px;">Hi ${escapeHtml(leadName)},</p>
    <p style="margin:0 0 16px;">Thank you for completing our questionnaire. We'd like to schedule your confidential consultation with a senior advisor - it takes about <strong>${escapeHtml(String(durationMinutes))} minutes</strong>.</p>
    <p style="margin:0 0 16px;">Here are a few times that work on our end:</p>
    <ul style="margin:0 0 16px;padding-left:20px;">${slotsHtml}</ul>
    <p style="margin:0 0 16px;">Platform: ${escapeHtml(platform)}.</p>
    <p style="margin:0 0 16px;">Reply to this email with whichever time works best for you (or suggest another), and we'll confirm it in writing.</p>
    <p style="margin:0;">Best regards,<br />Veridian Global Advisors</p>
  `);

  const mailOptions = { from: config.email.user, to: leadEmail, subject, html };

  let info;
  try {
    info = await getTransporter().sendMail(mailOptions);
    logger.info(`emailService.sendSchedulingEmail: sent to ${leadEmail} (${info.messageId})`);
  } catch (err) {
    logger.error(`emailService.sendSchedulingEmail: failed for ${leadEmail}: ${err.message}`);
    throw new Error(`Failed to send scheduling email to ${leadEmail}: ${err.message}`);
  }

  await logOutgoing(
    leadEmail,
    subject,
    `Proposed slots: ${slots.join('; ')}. Platform: ${platform}. Duration: ${durationMinutes} min.`,
  );

  return info;
}

/**
 * Sends the engagement letter as a PDF attachment. The PDF content itself is
 * supplied by the caller (typically read from the firm's fixed template file
 * at src/documents/engagement-letter-template.pdf - see the README in that
 * directory) rather than generated here; this function only handles email
 * delivery and deliberately does not fabricate legal contract text.
 *
 * @param {string} leadEmail - Lead's email address.
 * @param {string} leadName - Lead's full name, for the greeting.
 * @param {Buffer} pdfBuffer - The engagement letter PDF content to attach.
 * @returns {Promise<Object>} nodemailer send info
 */
async function sendEngagementLetter(leadEmail, leadName, pdfBuffer) {
  if (!Buffer.isBuffer(pdfBuffer) || pdfBuffer.length === 0) {
    throw new Error('sendEngagementLetter requires a non-empty PDF buffer');
  }

  const subject = 'Engagement Letter – Veridian Global Advisors';

  const html = wrapEmailHtml(`
    <p style="margin:0 0 16px;">Hi ${escapeHtml(leadName)},</p>
    <p style="margin:0 0 16px;">Thank you for moving forward with Veridian Global Advisors. Please find your engagement letter attached. It sets out the scope of our document preparation services, our fees, and the terms of our engagement.</p>
    <p style="margin:0 0 16px;">Please review it carefully - we're happy to answer any questions - then sign and return it to begin your engagement.</p>
    <p style="margin:0;">Best regards,<br />Veridian Global Advisors</p>
  `);

  const mailOptions = {
    from: config.email.user,
    to: leadEmail,
    subject,
    html,
    attachments: [
      {
        filename: 'Veridian-Engagement-Letter.pdf',
        content: pdfBuffer,
        contentType: 'application/pdf',
      },
    ],
  };

  let info;
  try {
    info = await getTransporter().sendMail(mailOptions);
    logger.info(`emailService.sendEngagementLetter: sent to ${leadEmail} (${info.messageId})`);
  } catch (err) {
    logger.error(`emailService.sendEngagementLetter: failed for ${leadEmail}: ${err.message}`);
    throw new Error(`Failed to send engagement letter to ${leadEmail}: ${err.message}`);
  }

  await logOutgoing(leadEmail, subject, 'Engagement letter PDF sent as attachment.');

  return info;
}

/**
 * Sends a manual follow-up email - a gentle reminder or status update.
 *
 * @param {string} leadEmail - Lead's email address.
 * @param {string} leadName - Lead's full name, for the greeting.
 * @param {string} [message] - Custom message body; falls back to a generic gentle reminder if omitted.
 * @returns {Promise<Object>} nodemailer send info
 */
async function sendFollowUpEmail(leadEmail, leadName, message) {
  const bodyText =
    message ||
    "We wanted to check in and see if you had any questions about moving forward. We're happy to help whenever you're ready.";
  const subject = 'Following up – Veridian Global Advisors';

  const html = wrapEmailHtml(`
    <p style="margin:0 0 16px;">Hi ${escapeHtml(leadName)},</p>
    <p style="margin:0 0 16px;">${escapeHtml(bodyText)}</p>
    <p style="margin:0;">Best regards,<br />Veridian Global Advisors</p>
  `);

  const mailOptions = { from: config.email.user, to: leadEmail, subject, html };

  let info;
  try {
    info = await getTransporter().sendMail(mailOptions);
    logger.info(`emailService.sendFollowUpEmail: sent to ${leadEmail} (${info.messageId})`);
  } catch (err) {
    logger.error(`emailService.sendFollowUpEmail: failed for ${leadEmail}: ${err.message}`);
    throw new Error(`Failed to send follow-up email to ${leadEmail}: ${err.message}`);
  }

  await logOutgoing(leadEmail, subject, bodyText);

  return info;
}

module.exports = {
  sendClientConfirmation,
  sendAdminNotification,
  sendTestEmail,
  sendPreVettingEmail,
  sendSchedulingEmail,
  sendEngagementLetter,
  sendFollowUpEmail,
};
