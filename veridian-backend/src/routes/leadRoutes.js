const express = require('express');
const leadService = require('../services/leadService');
const emailService = require('../services/emailService');
const { validateLeadPayload } = require('../utils/validators');
const { authenticateAdmin } = require('../middleware/auth');
const logger = require('../utils/logger');

const router = express.Router();

// Validates that a route's :id param is a positive integer, returning it as a
// Number, or null if it isn't (callers should respond 400 in that case).
function parseLeadId(param) {
  if (!/^\d+$/.test(String(param))) {
    return null;
  }
  return Number(param);
}

// POST /api/submit-lead - public endpoint for submitting a new lead.
// Rate limiting for this route is applied in server.js (scoped to this path).
router.post('/submit-lead', async (req, res) => {
  const { fullName, country, netWorth, tierInterest, email, disclaimerAccepted } = req.body || {};

  // The request body arrives in camelCase (frontend form convention). Normalize
  // it to the snake_case shape used by validators.js and the `leads` table.
  const payload = {
    full_name: fullName,
    country,
    net_worth: netWorth,
    tier_interest: tierInterest,
    email,
    disclaimer_accepted: disclaimerAccepted,
  };

  // The disclaimer is a legal/compliance gate, not just another required field -
  // check it first so a caller that ticked nothing gets this specific message
  // instead of it being buried in the generic validation details array.
  if (disclaimerAccepted !== true) {
    return res.status(400).json({ success: false, error: 'You must accept the disclaimer' });
  }

  const { valid, errors } = validateLeadPayload(payload);
  if (!valid) {
    return res.status(400).json({ success: false, error: 'Validation failed', details: errors });
  }

  // --- Save to database (the critical operation) ---
  // leadService.createLead() upserts on email (ON CONFLICT(email) DO UPDATE), so
  // a duplicate submission from an existing lead updates their row instead of
  // failing or creating a second record.
  let lead;
  try {
    lead = await leadService.createLead(payload);
  } catch (err) {
    logger.error(`leadRoutes.submit-lead: failed to save lead for email=${email}: ${err.message}`);
    return res.status(500).json({ success: false, error: 'Failed to save lead' });
  }

  // --- Fire-and-forget email notifications ---
  // Emails are a side effect of a successful submission, not part of what makes
  // the request successful: the lead is already safely in the database at this
  // point, so a slow or failing SMTP connection must never delay the HTTP
  // response or turn an otherwise-successful submission into an error for the
  // caller. We deliberately do NOT `await` either call below - the request
  // handler returns immediately after kicking them off. Each promise still gets
  // its own `.catch()` so a rejection is logged instead of becoming an
  // unhandled promise rejection (which could crash the process).
  emailService
    .sendClientConfirmation(lead)
    .then((info) => {
      // info is null if this was skipped as a duplicate send (see emailService's
      // 5-minute rate limit) - nothing was actually sent, so nothing to log.
      if (!info) return null;
      return leadService.logCommunication(lead.id, {
        type: 'outgoing',
        subject: 'Thank you for contacting Veridian Global Advisors',
        content: 'Automated confirmation sent: 24-hour response expectation, privacy note, links to How It Works and Pricing.',
      });
    })
    .catch((err) => {
      logger.error(`leadRoutes.submit-lead: sendClientConfirmation failed for lead ${lead.id}: ${err.message}`);
    });

  emailService
    .sendAdminNotification(lead)
    .then((info) => {
      if (!info) return null;
      return leadService.logCommunication(lead.id, {
        type: 'outgoing',
        subject: `New Lead – ${lead.full_name} – ${lead.tier_interest}`,
        content: 'Automated admin notification sent with full lead details and a link to view all leads.',
      });
    })
    .catch((err) => {
      logger.error(`leadRoutes.submit-lead: sendAdminNotification failed for lead ${lead.id}: ${err.message}`);
    });

  return res.status(201).json({
    success: true,
    leadId: lead.id,
    message: 'Thank you for your submission. Our team will be in touch within 24 hours.',
  });
});

// GET /api/leads - protected, lists leads for internal/admin use
router.get('/leads', authenticateAdmin, async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
  const offset = parseInt(req.query.offset, 10) || 0;
  const { status, fromDate, toDate } = req.query;

  if (status && !leadService.ALLOWED_STATUSES.includes(status)) {
    return res.status(400).json({ error: `status must be one of: ${leadService.ALLOWED_STATUSES.join(', ')}` });
  }

  try {
    const filters = { status, fromDate, toDate };
    // getAllLeads() is paginated (limit/offset); countLeads() applies the same
    // filters without pagination so callers know the total beyond this page.
    const [leads, total] = await Promise.all([
      leadService.getAllLeads({ ...filters, limit, offset }),
      leadService.countLeads(filters),
    ]);
    return res.status(200).json({ success: true, data: leads, total });
  } catch (err) {
    logger.error(`Failed to fetch leads: ${err.message}`);
    return res.status(500).json({ error: 'Failed to fetch leads' });
  }
});

// GET /api/leads/stats - protected, lead counts by status. Must be registered
// before GET /leads/:id, otherwise "stats" would be captured as an :id value.
router.get('/leads/stats', authenticateAdmin, async (req, res) => {
  try {
    const stats = await leadService.getLeadStats();
    return res.status(200).json({ success: true, data: stats });
  } catch (err) {
    logger.error(`Failed to fetch lead stats: ${err.message}`);
    return res.status(500).json({ error: 'Failed to fetch lead stats' });
  }
});

// GET /api/leads/:id - protected, fetch a single lead
router.get('/leads/:id', authenticateAdmin, async (req, res) => {
  try {
    const lead = await leadService.getLeadById(req.params.id);
    if (!lead) {
      return res.status(404).json({ error: 'Lead not found' });
    }
    return res.json({ data: lead });
  } catch (err) {
    logger.error(`Failed to fetch lead ${req.params.id}: ${err.message}`);
    return res.status(500).json({ error: 'Failed to fetch lead' });
  }
});

// PATCH /api/leads/:id/status - protected, update a lead's status
router.patch('/leads/:id/status', authenticateAdmin, async (req, res) => {
  const id = parseLeadId(req.params.id);
  if (id === null) {
    return res.status(400).json({ error: 'id must be a positive integer' });
  }

  const { status } = req.body || {};
  if (!status || !leadService.ALLOWED_STATUSES.includes(status)) {
    return res.status(400).json({ error: `status must be one of: ${leadService.ALLOWED_STATUSES.join(', ')}` });
  }

  try {
    const existing = await leadService.getLeadById(id);
    if (!existing) {
      return res.status(404).json({ error: 'Lead not found' });
    }
    const lead = await leadService.updateLeadStatus(id, status);
    return res.status(200).json({ success: true, data: lead });
  } catch (err) {
    logger.error(`Failed to update lead ${id}: ${err.message}`);
    return res.status(500).json({ error: 'Failed to update lead' });
  }
});

// DELETE /api/leads/:id - protected, soft-deletes a lead (sets status to 'Archived')
router.delete('/leads/:id', authenticateAdmin, async (req, res) => {
  const id = parseLeadId(req.params.id);
  if (id === null) {
    return res.status(400).json({ error: 'id must be a positive integer' });
  }

  try {
    const existing = await leadService.getLeadById(id);
    if (!existing) {
      return res.status(404).json({ error: 'Lead not found' });
    }
    await leadService.deleteLead(id);
    return res.status(200).json({ success: true });
  } catch (err) {
    logger.error(`Failed to delete lead ${id}: ${err.message}`);
    return res.status(500).json({ error: 'Failed to delete lead' });
  }
});

// --- Manual client-communication actions -----------------------------------
// These are triggered deliberately by an admin (via this API - see the
// Postman collection), not automatically. Each one sends an email, logs it to
// the communications table, and - where the lead-status table maps sending
// that email to a specific stage - advances the lead's status accordingly.

// POST /api/leads/:id/pre-vetting-email - protected. Sends the 5-question
// pre-vetting questionnaire and advances status to 'Contacted'.
router.post('/leads/:id/pre-vetting-email', authenticateAdmin, async (req, res) => {
  const id = parseLeadId(req.params.id);
  if (id === null) {
    return res.status(400).json({ error: 'id must be a positive integer' });
  }

  try {
    const lead = await leadService.getLeadById(id);
    if (!lead) {
      return res.status(404).json({ error: 'Lead not found' });
    }

    await emailService.sendPreVettingEmail(lead);
    await leadService.logCommunication(id, {
      type: 'outgoing',
      subject: 'Your inquiry about our document preparation services – next steps',
      content: 'Pre-vetting questionnaire sent (5 questions).',
    });
    const updated = await leadService.updateLeadStatus(id, 'Contacted');

    return res.status(200).json({ success: true, data: updated });
  } catch (err) {
    logger.error(`Failed to send pre-vetting email for lead ${id}: ${err.message}`);
    return res.status(500).json({ error: 'Failed to send pre-vetting email' });
  }
});

// POST /api/leads/:id/scheduling-email - protected. Body: { slots: string[],
// platform?: string, durationMinutes?: number }. Proposes consultation times;
// does NOT change status - that happens via PATCH /status once the client has
// replied and a time is actually confirmed (see requirement 3: manual scheduling).
router.post('/leads/:id/scheduling-email', authenticateAdmin, async (req, res) => {
  const id = parseLeadId(req.params.id);
  if (id === null) {
    return res.status(400).json({ error: 'id must be a positive integer' });
  }

  const { slots, platform, durationMinutes } = req.body || {};
  if (!Array.isArray(slots) || slots.length === 0) {
    return res.status(400).json({ error: 'slots must be a non-empty array of proposed time strings' });
  }

  try {
    const lead = await leadService.getLeadById(id);
    if (!lead) {
      return res.status(404).json({ error: 'Lead not found' });
    }

    await emailService.sendConsultationSchedulingEmail(lead, { slots, platform, durationMinutes });
    const entry = await leadService.logCommunication(id, {
      type: 'outgoing',
      subject: 'Consultation Confirmation – Veridian Global Advisors',
      content: `Proposed slots: ${slots.join('; ')}.${platform ? ` Platform: ${platform}.` : ''}`,
    });

    return res.status(200).json({ success: true, data: entry });
  } catch (err) {
    logger.error(`Failed to send scheduling email for lead ${id}: ${err.message}`);
    return res.status(500).json({ error: 'Failed to send scheduling email' });
  }
});

// POST /api/leads/:id/engagement-letter-email - protected. Sends the engagement
// letter PDF (see src/documents/README.md) and advances status to 'Engagement Sent'.
router.post('/leads/:id/engagement-letter-email', authenticateAdmin, async (req, res) => {
  const id = parseLeadId(req.params.id);
  if (id === null) {
    return res.status(400).json({ error: 'id must be a positive integer' });
  }

  try {
    const lead = await leadService.getLeadById(id);
    if (!lead) {
      return res.status(404).json({ error: 'Lead not found' });
    }

    await emailService.sendEngagementLetterEmail(lead);
    await leadService.logCommunication(id, {
      type: 'outgoing',
      subject: 'Engagement Letter – Veridian Global Advisors',
      content: 'Engagement letter PDF sent as attachment.',
    });
    const updated = await leadService.updateLeadStatus(id, 'Engagement Sent');

    return res.status(200).json({ success: true, data: updated });
  } catch (err) {
    logger.error(`Failed to send engagement letter for lead ${id}: ${err.message}`);
    // Surface the "template not found" message specifically - it tells the
    // admin exactly what to fix (place a PDF at src/documents/...), rather
    // than a generic 500 that hides the actual, easily-fixable cause.
    const message = /template not found/.test(err.message) ? err.message : 'Failed to send engagement letter';
    return res.status(500).json({ error: message });
  }
});

// POST /api/leads/:id/follow-up-email - protected. Body: { message?: string }.
// Sends a gentle reminder/update; does not change status.
router.post('/leads/:id/follow-up-email', authenticateAdmin, async (req, res) => {
  const id = parseLeadId(req.params.id);
  if (id === null) {
    return res.status(400).json({ error: 'id must be a positive integer' });
  }

  const { message } = req.body || {};

  try {
    const lead = await leadService.getLeadById(id);
    if (!lead) {
      return res.status(404).json({ error: 'Lead not found' });
    }

    await emailService.sendFollowUpEmail(lead, message);
    const entry = await leadService.logCommunication(id, {
      type: 'outgoing',
      subject: 'Following up – Veridian Global Advisors',
      content: message || 'Gentle reminder sent (default message).',
    });

    return res.status(200).json({ success: true, data: entry });
  } catch (err) {
    logger.error(`Failed to send follow-up email for lead ${id}: ${err.message}`);
    return res.status(500).json({ error: 'Failed to send follow-up email' });
  }
});

// GET /api/leads/:id/communications - protected. Full communication history for a lead.
router.get('/leads/:id/communications', authenticateAdmin, async (req, res) => {
  const id = parseLeadId(req.params.id);
  if (id === null) {
    return res.status(400).json({ error: 'id must be a positive integer' });
  }

  try {
    const lead = await leadService.getLeadById(id);
    if (!lead) {
      return res.status(404).json({ error: 'Lead not found' });
    }

    const communications = await leadService.getCommunicationsForLead(id);
    return res.status(200).json({ success: true, data: communications });
  } catch (err) {
    logger.error(`Failed to fetch communications for lead ${id}: ${err.message}`);
    return res.status(500).json({ error: 'Failed to fetch communications' });
  }
});

// POST /api/leads/:id/communications - protected. Body: { type: 'incoming'|'outgoing',
// channel?: string, subject?: string, content?: string }. Manually logs a communication
// that happened outside the app - e.g. a client reply that landed in your own inbox,
// which the app has no way to see on its own.
router.post('/leads/:id/communications', authenticateAdmin, async (req, res) => {
  const id = parseLeadId(req.params.id);
  if (id === null) {
    return res.status(400).json({ error: 'id must be a positive integer' });
  }

  const { type, channel, subject, content } = req.body || {};
  if (!leadService.COMMUNICATION_TYPES.includes(type)) {
    return res.status(400).json({ error: `type must be one of: ${leadService.COMMUNICATION_TYPES.join(', ')}` });
  }

  try {
    const lead = await leadService.getLeadById(id);
    if (!lead) {
      return res.status(404).json({ error: 'Lead not found' });
    }

    const entry = await leadService.logCommunication(id, { type, channel, subject, content });
    return res.status(201).json({ success: true, data: entry });
  } catch (err) {
    logger.error(`Failed to log communication for lead ${id}: ${err.message}`);
    return res.status(500).json({ error: 'Failed to log communication' });
  }
});

module.exports = router;
