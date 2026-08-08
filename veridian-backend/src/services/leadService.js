const db = require('../config/database');
const logger = require('../utils/logger');

const ALLOWED_STATUSES = [
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
 * Creates a new lead, or updates the existing lead if one with the same email already exists.
 * This is a pure database operation - callers are responsible for any follow-up side effects
 * (e.g. confirmation/notification emails), typically fired off without awaiting them.
 *
 * @param {Object} leadData
 * @param {string} leadData.full_name - Lead's full name.
 * @param {string} leadData.country - Lead's country of residence.
 * @param {string} leadData.net_worth - Declared net worth bracket.
 * @param {string} leadData.tier_interest - Service tier the lead is interested in.
 * @param {string} leadData.email - Lead's email address (unique key for upsert).
 * @param {boolean} leadData.disclaimer_accepted - Whether the legal disclaimer was accepted.
 * @param {string} [leadData.source='Website'] - Origin of the lead submission.
 * @param {string} [leadData.notes] - Free-form internal notes.
 * @returns {Promise<Object>} The created or updated lead row.
 */
async function createLead(leadData) {
  const { full_name, country, net_worth, tier_interest, email, disclaimer_accepted, source, notes } = leadData;
  const normalizedEmail = email.trim().toLowerCase();

  try {
    const existing = await getLeadByEmail(normalizedEmail);

    await db.run(
      `INSERT INTO leads (full_name, country, net_worth, tier_interest, email, disclaimer_accepted, source, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(email) DO UPDATE SET
         full_name = excluded.full_name,
         country = excluded.country,
         net_worth = excluded.net_worth,
         tier_interest = excluded.tier_interest,
         disclaimer_accepted = excluded.disclaimer_accepted,
         source = excluded.source,
         notes = excluded.notes,
         updated_at = CURRENT_TIMESTAMP`,
      [
        full_name.trim(),
        country.trim(),
        net_worth.trim(),
        tier_interest.trim(),
        normalizedEmail,
        disclaimer_accepted ? 1 : 0,
        source || 'Website',
        notes || null,
      ],
    );

    const lead = await getLeadByEmail(normalizedEmail);
    logger.info(
      `[${new Date().toISOString()}] leadService.createLead: ${existing ? 'updated' : 'created'} lead id=${lead.id} email=${lead.email}`,
    );

    return lead;
  } catch (err) {
    logger.error(`leadService.createLead: failed for email=${email}: ${err.message}`);
    throw new Error(`Failed to create lead for email "${email}": ${err.message}`);
  }
}

/**
 * Retrieves a single lead by its email address.
 *
 * @param {string} email - Email address to look up (matched case-insensitively).
 * @returns {Promise<Object|undefined>} The matching lead row, or undefined if none exists.
 */
async function getLeadByEmail(email) {
  const normalizedEmail = email.trim().toLowerCase();

  try {
    const lead = await db.get('SELECT * FROM leads WHERE email = ?', [normalizedEmail]);
    logger.info(`[${new Date().toISOString()}] leadService.getLeadByEmail: email=${normalizedEmail} found=${Boolean(lead)}`);
    return lead;
  } catch (err) {
    logger.error(`leadService.getLeadByEmail: failed for email=${email}: ${err.message}`);
    throw new Error(`Failed to fetch lead by email "${email}": ${err.message}`);
  }
}

/**
 * Retrieves a single lead by its numeric id.
 *
 * @param {number|string} id - Lead id.
 * @returns {Promise<Object|undefined>} The matching lead row, or undefined if none exists.
 */
async function getLeadById(id) {
  try {
    const lead = await db.get('SELECT * FROM leads WHERE id = ?', [id]);
    logger.info(`[${new Date().toISOString()}] leadService.getLeadById: id=${id} found=${Boolean(lead)}`);
    return lead;
  } catch (err) {
    logger.error(`leadService.getLeadById: failed for id=${id}: ${err.message}`);
    throw new Error(`Failed to fetch lead by id ${id}: ${err.message}`);
  }
}

/**
 * Builds a `WHERE` clause and matching params for the status/fromDate/toDate filters
 * shared by getAllLeads() and countLeads().
 *
 * @param {Object} [filters]
 * @param {string} [filters.status]
 * @param {string} [filters.fromDate] - 'YYYY-MM-DD', inclusive lower bound on created_at.
 * @param {string} [filters.toDate] - 'YYYY-MM-DD', inclusive upper bound on created_at.
 * @returns {{ where: string, params: Array }}
 */
function buildLeadFilterClause({ status, fromDate, toDate } = {}) {
  const conditions = [];
  const params = [];

  if (status) {
    conditions.push('status = ?');
    params.push(status);
  }

  if (fromDate) {
    conditions.push('date(created_at) >= date(?)');
    params.push(fromDate);
  }

  if (toDate) {
    conditions.push('date(created_at) <= date(?)');
    params.push(toDate);
  }

  return {
    where: conditions.length ? ` WHERE ${conditions.join(' AND ')}` : '',
    params,
  };
}

/**
 * Retrieves all leads matching the given filters, newest first.
 *
 * @param {Object} [filters]
 * @param {('New'|'Contacted'|'Consultation Scheduled'|'Engagement Sent'|'Signed'|'Rejected'|'Converted'|'Archived')} [filters.status] - Restrict to a single status.
 * @param {string} [filters.fromDate] - 'YYYY-MM-DD', inclusive lower bound on created_at.
 * @param {string} [filters.toDate] - 'YYYY-MM-DD', inclusive upper bound on created_at.
 * @param {number} [filters.limit=100] - Max rows to return.
 * @param {number} [filters.offset=0] - Rows to skip, for pagination.
 * @returns {Promise<Object[]>} Matching lead rows.
 */
async function getAllLeads(filters = {}) {
  const { limit = 100, offset = 0 } = filters;
  const { where, params } = buildLeadFilterClause(filters);

  const sql = `SELECT * FROM leads${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`;
  params.push(limit, offset);

  try {
    const leads = await db.all(sql, params);
    logger.info(`[${new Date().toISOString()}] leadService.getAllLeads: filters=${JSON.stringify(filters)} returned=${leads.length}`);
    return leads;
  } catch (err) {
    logger.error(`leadService.getAllLeads: failed for filters=${JSON.stringify(filters)}: ${err.message}`);
    throw new Error(`Failed to fetch leads: ${err.message}`);
  }
}

/**
 * Counts leads matching the given filters (ignoring pagination), for use alongside
 * getAllLeads() when callers need a total independent of the current page.
 *
 * @param {Object} [filters]
 * @param {string} [filters.status]
 * @param {string} [filters.fromDate]
 * @param {string} [filters.toDate]
 * @returns {Promise<number>} Total matching rows.
 */
async function countLeads(filters = {}) {
  const { where, params } = buildLeadFilterClause(filters);

  try {
    const row = await db.get(`SELECT COUNT(*) as count FROM leads${where}`, params);
    return row.count;
  } catch (err) {
    logger.error(`leadService.countLeads: failed for filters=${JSON.stringify(filters)}: ${err.message}`);
    throw new Error(`Failed to count leads: ${err.message}`);
  }
}

/**
 * Updates a lead's status and refreshes its updated_at timestamp.
 *
 * @param {number|string} id - Lead id.
 * @param {('New'|'Contacted'|'Consultation Scheduled'|'Engagement Sent'|'Signed'|'Rejected'|'Converted'|'Archived')} status - New status; must be one of ALLOWED_STATUSES.
 * @returns {Promise<Object>} The updated lead row.
 */
async function updateLeadStatus(id, status) {
  if (!ALLOWED_STATUSES.includes(status)) {
    throw new Error(`Invalid status "${status}". Must be one of: ${ALLOWED_STATUSES.join(', ')}`);
  }

  try {
    const result = await db.run('UPDATE leads SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [status, id]);

    if (result.changes === 0) {
      throw new Error(`No lead found with id ${id}`);
    }

    const lead = await getLeadById(id);
    logger.info(`[${new Date().toISOString()}] leadService.updateLeadStatus: id=${id} status=${status}`);
    return lead;
  } catch (err) {
    logger.error(`leadService.updateLeadStatus: failed for id=${id}: ${err.message}`);
    throw new Error(`Failed to update status for lead ${id}: ${err.message}`);
  }
}

/**
 * Deletes a lead. By default this is a soft delete (status set to 'Archived').
 *
 * @param {number|string} id - Lead id.
 * @param {boolean} [hard=false] - If true, permanently removes the row instead of archiving it.
 * @returns {Promise<Object>} The archived lead row, or `{ id, deleted: true }` for a hard delete.
 */
async function deleteLead(id, hard = false) {
  try {
    if (hard) {
      const result = await db.run('DELETE FROM leads WHERE id = ?', [id]);

      if (result.changes === 0) {
        throw new Error(`No lead found with id ${id}`);
      }

      logger.info(`[${new Date().toISOString()}] leadService.deleteLead: hard-deleted id=${id}`);
      return { id, deleted: true };
    }

    const result = await db.run(`UPDATE leads SET status = 'Archived', updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [id]);

    if (result.changes === 0) {
      throw new Error(`No lead found with id ${id}`);
    }

    const lead = await getLeadById(id);
    logger.info(`[${new Date().toISOString()}] leadService.deleteLead: archived id=${id}`);
    return lead;
  } catch (err) {
    logger.error(`leadService.deleteLead: failed for id=${id}: ${err.message}`);
    throw new Error(`Failed to delete lead ${id}: ${err.message}`);
  }
}

/**
 * Returns lead counts grouped by status, plus a grand total.
 *
 * @returns {Promise<{ total: number, byStatus: Record<string, number> }>} Counts for every known status (0 for statuses with no leads) and the total across all statuses.
 */
async function getLeadStats() {
  try {
    const rows = await db.all('SELECT status, COUNT(*) as count FROM leads GROUP BY status');

    const byStatus = {};
    ALLOWED_STATUSES.forEach((s) => {
      byStatus[s] = 0;
    });

    let total = 0;
    rows.forEach((row) => {
      byStatus[row.status] = row.count;
      total += row.count;
    });

    logger.info(`[${new Date().toISOString()}] leadService.getLeadStats: total=${total}`);
    return { total, byStatus };
  } catch (err) {
    logger.error(`leadService.getLeadStats: failed: ${err.message}`);
    throw new Error(`Failed to get lead stats: ${err.message}`);
  }
}

const COMMUNICATION_TYPES = ['incoming', 'outgoing'];

/**
 * Records a single communication (an email actually sent or received) against
 * a lead, for the audit trail required by the email-only client communication
 * system - every automated send, manually-triggered send, and manually-logged
 * reply should end up as a row here.
 *
 * @param {number|string} leadId - Lead id this communication belongs to.
 * @param {Object} entry
 * @param {('incoming'|'outgoing')} entry.type - Direction of the communication.
 * @param {string} [entry.channel='email'] - Communication channel.
 * @param {string} [entry.subject] - Email subject line (or a short label for non-email channels).
 * @param {string} [entry.content] - Body text or a summary of what was sent/received.
 * @returns {Promise<Object>} The newly created communications row.
 */
async function logCommunication(leadId, { type, channel = 'email', subject, content } = {}) {
  if (!COMMUNICATION_TYPES.includes(type)) {
    throw new Error(`Invalid communication type "${type}". Must be one of: ${COMMUNICATION_TYPES.join(', ')}`);
  }

  try {
    const result = await db.run(
      `INSERT INTO communications (lead_id, type, channel, subject, content) VALUES (?, ?, ?, ?, ?)`,
      [leadId, type, channel || 'email', subject || null, content || null],
    );

    const entry = await db.get('SELECT * FROM communications WHERE id = ?', [result.lastID]);
    logger.info(`[${new Date().toISOString()}] leadService.logCommunication: id=${entry.id} lead_id=${leadId} type=${type}`);
    return entry;
  } catch (err) {
    logger.error(`leadService.logCommunication: failed for lead_id=${leadId}: ${err.message}`);
    throw new Error(`Failed to log communication for lead ${leadId}: ${err.message}`);
  }
}

/**
 * Retrieves the full communication history for a lead, newest first.
 *
 * @param {number|string} leadId - Lead id.
 * @returns {Promise<Object[]>} Matching communications rows.
 */
async function getCommunicationsForLead(leadId) {
  try {
    const rows = await db.all('SELECT * FROM communications WHERE lead_id = ? ORDER BY sent_at DESC', [leadId]);
    logger.info(`[${new Date().toISOString()}] leadService.getCommunicationsForLead: lead_id=${leadId} returned=${rows.length}`);
    return rows;
  } catch (err) {
    logger.error(`leadService.getCommunicationsForLead: failed for lead_id=${leadId}: ${err.message}`);
    throw new Error(`Failed to fetch communications for lead ${leadId}: ${err.message}`);
  }
}

module.exports = {
  ALLOWED_STATUSES,
  COMMUNICATION_TYPES,
  createLead,
  getLeadByEmail,
  getLeadById,
  getAllLeads,
  countLeads,
  updateLeadStatus,
  deleteLead,
  getLeadStats,
  logCommunication,
  getCommunicationsForLead,
};
