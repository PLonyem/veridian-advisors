import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid
} from "drizzle-orm/pg-core";
import { user } from "./auth-schema.js";

export const staffRole = pgEnum("staff_role", ["OWNER", "ADVISOR", "VIEWER"]);
export const leadStage = pgEnum("lead_stage", [
  "NEW", "CONTACTED", "QUALIFICATION_PENDING", "QUALIFIED", "ENGAGEMENT_SENT", "SIGNED", "CONVERTED", "REJECTED"
]);
export const netWorthRange = pgEnum("net_worth_range", ["USD_1M_5M", "USD_5M_20M", "USD_20M_PLUS"]);
export const tierInterest = pgEnum("tier_interest", ["FOUNDATION", "ACCELERATED", "EXECUTIVE", "NOT_SURE"]);
export const consentPurpose = pgEnum("consent_purpose", ["INTAKE_ACKNOWLEDGEMENT", "MARKETING"]);
export const consentState = pgEnum("consent_state", ["ACCEPTED", "WITHDRAWN"]);
export const qualificationState = pgEnum("qualification_state", ["DRAFT", "SUBMITTED", "REVIEWED"]);
export const fitDecision = pgEnum("fit_decision", ["QUALIFIED", "REJECTED"]);
export const consultationState = pgEnum("consultation_state", ["PROPOSED", "CONFIRMED", "COMPLETED", "CANCELLED"]);
export const engagementState = pgEnum("engagement_state", ["DRAFT", "QUEUED", "SENT", "SIGNED"]);
export const documentType = pgEnum("document_type", ["ENGAGEMENT", "SIGNED_ENGAGEMENT", "PRIVACY_EXPORT"]);
export const documentState = pgEnum("document_state", ["QUARANTINED", "SCANNING", "APPROVED", "REJECTED", "DELETED"]);
export const paymentStatus = pgEnum("payment_status", ["EXTERNALLY_CONFIRMED", "REVERSED"]);
export const messageState = pgEnum("message_state", [
  "QUEUED", "PROCESSING", "PROVIDER_ACCEPTED", "DELIVERED", "BOUNCED", "COMPLAINED", "RETRY_SCHEDULED", "FAILED", "CANCELLED", "UNKNOWN"
]);
export const messageCategory = pgEnum("message_category", ["SECURITY", "TRANSACTIONAL", "DISCRETIONARY"]);
export const recipientType = pgEnum("recipient_type", ["LEAD", "STAFF", "CONFIGURED_TEST"]);
export const attemptOutcome = pgEnum("attempt_outcome", ["CLAIMED", "ACCEPTED", "TRANSIENT_FAILURE", "PERMANENT_FAILURE", "AMBIGUOUS"]);
export const webhookState = pgEnum("webhook_state", ["RECEIVED", "PROCESSED", "IGNORED", "FAILED"]);
export const privacyRequestType = pgEnum("privacy_request_type", ["ARCHIVE", "COMMUNICATION_WITHDRAWAL", "EXPORT", "ERASURE"]);
export const privacyState = pgEnum("privacy_state", ["REQUESTED", "IDENTITY_VERIFIED", "REVIEWED", "PROCESSING", "COMPLETED", "REJECTED"]);

export const appMeta = pgTable("app_meta", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull()
});

export const servicePackages = pgTable("service_packages", {
  code: tierInterest("code").primaryKey(),
  displayName: text("display_name").notNull(),
  priceMinor: bigint("price_minor", { mode: "number" }).notNull(),
  currency: text("currency").default("USD").notNull(),
  isStartingPrice: boolean("is_starting_price").default(false).notNull(),
  active: boolean("active").default(true).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull()
}, (table) => [check("service_packages_price_nonnegative", sql`${table.priceMinor} >= 0`) ]);

export const staffProfiles = pgTable("staff_profiles", {
  userId: text("user_id").primaryKey().references(() => user.id, { onDelete: "cascade" }),
  role: staffRole("role").notNull(),
  disabledAt: timestamp("disabled_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull()
});

export const leads = pgTable("leads", {
  id: uuid("id").defaultRandom().primaryKey(),
  fullName: text("full_name").notNull(),
  email: text("email").notNull(),
  normalizedEmail: text("normalized_email").notNull(),
  country: text("country").notNull(),
  netWorthRange: netWorthRange("net_worth_range"),
  tierInterest: tierInterest("tier_interest").notNull(),
  assignedStaffId: text("assigned_staff_id").references(() => user.id, { onDelete: "set null" }),
  pipelineStage: leadStage("pipeline_stage").default("NEW").notNull(),
  version: integer("version").default(1).notNull(),
  identityVerifiedAt: timestamp("identity_verified_at", { withTimezone: true }),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
  serviceCompletedAt: timestamp("service_completed_at", { withTimezone: true }),
  legacyReviewRequired: boolean("legacy_review_required").default(false).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull()
}, (table) => [
  index("leads_normalized_email_idx").on(table.normalizedEmail),
  index("leads_stage_created_idx").on(table.pipelineStage, table.createdAt),
  index("leads_assigned_staff_idx").on(table.assignedStaffId),
  check("leads_version_positive", sql`${table.version} > 0`)
]);

export const leadAccessGrants = pgTable("lead_access_grants", {
  leadId: uuid("lead_id").notNull().references(() => leads.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull()
}, (table) => [primaryKey({ columns: [table.leadId, table.userId] }), index("lead_access_user_idx").on(table.userId)]);

export const enquiries = pgTable("enquiries", {
  id: uuid("id").defaultRandom().primaryKey(),
  leadId: uuid("lead_id").references(() => leads.id, { onDelete: "set null" }),
  fullName: text("full_name").notNull(),
  email: text("email").notNull(),
  normalizedEmail: text("normalized_email").notNull(),
  country: text("country").notNull(),
  netWorthRange: netWorthRange("net_worth_range").notNull(),
  tierInterest: tierInterest("tier_interest").notNull(),
  repeatContact: boolean("repeat_contact").default(false).notNull(),
  reconciliationPending: boolean("reconciliation_pending").default(false).notNull(),
  submittedAt: timestamp("submitted_at", { withTimezone: true }).defaultNow().notNull(),
  reconciledAt: timestamp("reconciled_at", { withTimezone: true }),
  reconciledBy: text("reconciled_by").references(() => user.id, { onDelete: "set null" })
}, (table) => [index("enquiries_email_idx").on(table.normalizedEmail), index("enquiries_pending_idx").on(table.reconciliationPending, table.submittedAt)]);

export const enquiryCandidates = pgTable("enquiry_candidates", {
  enquiryId: uuid("enquiry_id").notNull().references(() => enquiries.id, { onDelete: "cascade" }),
  leadId: uuid("lead_id").notNull().references(() => leads.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull()
}, (table) => [primaryKey({ columns: [table.enquiryId, table.leadId] })]);

export const consentEvents = pgTable("consent_events", {
  id: uuid("id").defaultRandom().primaryKey(),
  enquiryId: uuid("enquiry_id").notNull().references(() => enquiries.id, { onDelete: "restrict" }),
  leadId: uuid("lead_id").references(() => leads.id, { onDelete: "set null" }),
  purpose: consentPurpose("purpose").notNull(),
  state: consentState("state").notNull(),
  noticeVersion: text("notice_version").notNull(),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).defaultNow().notNull()
}, (table) => [index("consent_lead_purpose_idx").on(table.leadId, table.purpose, table.occurredAt)]);

export const qualificationReviews = pgTable("qualification_reviews", {
  id: uuid("id").defaultRandom().primaryKey(),
  leadId: uuid("lead_id").notNull().references(() => leads.id, { onDelete: "cascade" }),
  state: qualificationState("state").default("DRAFT").notNull(),
  citizenshipResidence: text("citizenship_residence"),
  approximateNetWorthRange: netWorthRange("approximate_net_worth_range"),
  sourceOfFundsCategory: text("source_of_funds_category"),
  requestedServiceTiming: text("requested_service_timing"),
  preferredTier: tierInterest("preferred_tier"),
  receivedAt: timestamp("received_at", { withTimezone: true }),
  decision: fitDecision("decision"),
  serviceFitReason: text("service_fit_reason"),
  restrictedNotesEncrypted: jsonb("restricted_notes_encrypted"),
  reviewerId: text("reviewer_id").references(() => user.id, { onDelete: "set null" }),
  version: integer("version").default(1).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true })
}, (table) => [index("qualification_lead_idx").on(table.leadId, table.createdAt), check("qualification_version_positive", sql`${table.version} > 0`)]);

export const statusHistory = pgTable("status_history", {
  id: uuid("id").defaultRandom().primaryKey(),
  leadId: uuid("lead_id").notNull().references(() => leads.id, { onDelete: "cascade" }),
  fromStage: leadStage("from_stage"),
  toStage: leadStage("to_stage").notNull(),
  actorId: text("actor_id").references(() => user.id, { onDelete: "set null" }),
  actorType: text("actor_type").notNull(),
  reason: text("reason").notNull(),
  triggeringEventId: text("triggering_event_id"),
  fromVersion: integer("from_version"),
  toVersion: integer("to_version").notNull(),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).defaultNow().notNull()
}, (table) => [index("status_history_lead_idx").on(table.leadId, table.occurredAt)]);

export const leadNotes = pgTable("lead_notes", {
  id: uuid("id").defaultRandom().primaryKey(),
  leadId: uuid("lead_id").notNull().references(() => leads.id, { onDelete: "cascade" }),
  actorId: text("actor_id").notNull().references(() => user.id, { onDelete: "restrict" }),
  noteEncrypted: jsonb("note_encrypted").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull()
}, (table) => [index("lead_notes_lead_idx").on(table.leadId, table.createdAt)]);

export const consultations = pgTable("consultations", {
  id: uuid("id").defaultRandom().primaryKey(),
  leadId: uuid("lead_id").notNull().references(() => leads.id, { onDelete: "cascade" }),
  advisorId: text("advisor_id").notNull().references(() => user.id, { onDelete: "restrict" }),
  state: consultationState("state").notNull(),
  startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
  endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
  timezone: text("timezone").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull()
}, (table) => [index("consultations_advisor_time_idx").on(table.advisorId, table.startsAt), check("consultation_time_order", sql`${table.endsAt} > ${table.startsAt}`)]);

export const engagements = pgTable("engagements", {
  id: uuid("id").defaultRandom().primaryKey(),
  leadId: uuid("lead_id").notNull().references(() => leads.id, { onDelete: "cascade" }),
  packageCode: tierInterest("package_code").notNull(),
  quoteMinor: bigint("quote_minor", { mode: "number" }).notNull(),
  currency: text("currency").default("USD").notNull(),
  paymentRequired: boolean("payment_required").default(true).notNull(),
  state: engagementState("state").default("DRAFT").notNull(),
  currentDocumentId: uuid("current_document_id"),
  sentDocumentId: uuid("sent_document_id"),
  signatureEvidenceType: text("signature_evidence_type"),
  signatureEvidenceReference: text("signature_evidence_reference"),
  signedDocumentId: uuid("signed_document_id"),
  signedAt: timestamp("signed_at", { withTimezone: true }),
  version: integer("version").default(1).notNull(),
  createdBy: text("created_by").notNull().references(() => user.id, { onDelete: "restrict" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull()
}, (table) => [
  index("engagements_lead_idx").on(table.leadId, table.createdAt),
  check("engagement_quote_nonnegative", sql`${table.quoteMinor} >= 0`),
  check("engagement_package_selected", sql`${table.packageCode} <> 'NOT_SURE'`)
]);

export const documents = pgTable("documents", {
  id: uuid("id").defaultRandom().primaryKey(),
  leadId: uuid("lead_id").notNull().references(() => leads.id, { onDelete: "cascade" }),
  engagementId: uuid("engagement_id").references(() => engagements.id, { onDelete: "cascade" }),
  type: documentType("type").notNull(),
  state: documentState("state").default("QUARANTINED").notNull(),
  objectKey: text("object_key").notNull().unique(),
  checksumSha256: text("checksum_sha256").notNull(),
  mimeType: text("mime_type").notNull(),
  sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
  version: integer("version").notNull(),
  originalName: text("original_name").notNull(),
  scanReference: text("scan_reference"),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  createdBy: text("created_by").notNull().references(() => user.id, { onDelete: "restrict" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  deletedAt: timestamp("deleted_at", { withTimezone: true })
}, (table) => [
  uniqueIndex("documents_engagement_version_idx").on(table.engagementId, table.version),
  index("documents_lead_idx").on(table.leadId, table.createdAt),
  check("documents_size_positive", sql`${table.sizeBytes} > 0`)
]);

export const payments = pgTable("payments", {
  id: uuid("id").defaultRandom().primaryKey(),
  engagementId: uuid("engagement_id").notNull().references(() => engagements.id, { onDelete: "cascade" }),
  amountMinor: bigint("amount_minor", { mode: "number" }).notNull(),
  currency: text("currency").notNull(),
  status: paymentStatus("status").notNull(),
  externallyConfirmedAt: timestamp("externally_confirmed_at", { withTimezone: true }).notNull(),
  externalReference: text("external_reference").notNull(),
  recordedBy: text("recorded_by").notNull().references(() => user.id, { onDelete: "restrict" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull()
}, (table) => [index("payments_engagement_idx").on(table.engagementId), check("payments_amount_positive", sql`${table.amountMinor} > 0`)]);

export const communications = pgTable("communications", {
  id: uuid("id").defaultRandom().primaryKey(),
  leadId: uuid("lead_id").references(() => leads.id, { onDelete: "set null" }),
  engagementId: uuid("engagement_id").references(() => engagements.id, { onDelete: "set null" }),
  documentId: uuid("document_id").references(() => documents.id, { onDelete: "set null" }),
  recipientType: recipientType("recipient_type").notNull(),
  recipientRef: text("recipient_ref").notNull(),
  recipientEmail: text("recipient_email").notNull(),
  template: text("template").notNull(),
  templateVersion: text("template_version").notNull(),
  category: messageCategory("category").notNull(),
  state: messageState("state").default("QUEUED").notNull(),
  providerMessageId: text("provider_message_id"),
  subjectRedacted: text("subject_redacted"),
  lastErrorRedacted: text("last_error_redacted"),
  createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
  acceptedAt: timestamp("accepted_at", { withTimezone: true }),
  deliveredAt: timestamp("delivered_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull()
}, (table) => [index("communications_lead_idx").on(table.leadId, table.createdAt), index("communications_provider_idx").on(table.providerMessageId)]);

export const emailOutbox = pgTable("email_outbox", {
  id: uuid("id").defaultRandom().primaryKey(),
  communicationId: uuid("communication_id").notNull().references(() => communications.id, { onDelete: "cascade" }),
  jobKey: text("job_key").notNull().unique(),
  payloadEncrypted: jsonb("payload_encrypted"),
  priority: integer("priority").default(0).notNull(),
  state: messageState("state").default("QUEUED").notNull(),
  attempts: integer("attempts").default(0).notNull(),
  leaseOwner: text("lease_owner"),
  leaseToken: uuid("lease_token"),
  leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
  nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).defaultNow().notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  providerMessageId: text("provider_message_id"),
  lastErrorRedacted: text("last_error_redacted"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull()
}, (table) => [index("outbox_claim_idx").on(table.state, table.nextAttemptAt, table.priority), check("outbox_attempts_nonnegative", sql`${table.attempts} >= 0`)]);

export const emailAttempts = pgTable("email_attempts", {
  id: uuid("id").defaultRandom().primaryKey(),
  outboxId: uuid("outbox_id").notNull().references(() => emailOutbox.id, { onDelete: "cascade" }),
  attemptNumber: integer("attempt_number").notNull(),
  leaseToken: uuid("lease_token").notNull(),
  outcome: attemptOutcome("outcome").notNull(),
  providerMessageId: text("provider_message_id"),
  errorRedacted: text("error_redacted"),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
  finishedAt: timestamp("finished_at", { withTimezone: true }).defaultNow().notNull()
}, (table) => [uniqueIndex("email_attempt_unique_idx").on(table.outboxId, table.attemptNumber)]);

export const webhookEvents = pgTable("webhook_events", {
  id: uuid("id").defaultRandom().primaryKey(),
  provider: text("provider").notNull(),
  providerEventId: text("provider_event_id").notNull(),
  eventType: text("event_type").notNull(),
  providerMessageId: text("provider_message_id"),
  payloadHash: text("payload_hash").notNull(),
  state: webhookState("state").default("RECEIVED").notNull(),
  occurredAt: timestamp("occurred_at", { withTimezone: true }),
  receivedAt: timestamp("received_at", { withTimezone: true }).defaultNow().notNull(),
  processedAt: timestamp("processed_at", { withTimezone: true })
}, (table) => [uniqueIndex("webhook_provider_event_idx").on(table.provider, table.providerEventId), index("webhook_message_idx").on(table.providerMessageId)]);

export const emailSuppressions = pgTable("email_suppressions", {
  recipientHash: text("recipient_hash").primaryKey(),
  reason: text("reason").notNull(),
  providerMessageId: text("provider_message_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull()
});

export const auditEvents = pgTable("audit_events", {
  id: uuid("id").defaultRandom().primaryKey(),
  actorId: text("actor_id"),
  actorType: text("actor_type").notNull(),
  action: text("action").notNull(),
  targetType: text("target_type").notNull(),
  targetId: text("target_id").notNull(),
  requestId: text("request_id").notNull(),
  metadata: jsonb("metadata").default({}).notNull(),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).defaultNow().notNull()
}, (table) => [index("audit_target_idx").on(table.targetType, table.targetId, table.occurredAt), index("audit_actor_idx").on(table.actorId, table.occurredAt)]);

export const privacyRequests = pgTable("privacy_requests", {
  id: uuid("id").defaultRandom().primaryKey(),
  leadId: uuid("lead_id").references(() => leads.id, { onDelete: "set null" }),
  type: privacyRequestType("type").notNull(),
  state: privacyState("state").default("REQUESTED").notNull(),
  requesterReference: text("requester_reference").notNull(),
  identityVerifiedAt: timestamp("identity_verified_at", { withTimezone: true }),
  reviewedBy: text("reviewed_by").references(() => user.id, { onDelete: "set null" }),
  reviewEvidence: text("review_evidence"),
  holdUntil: timestamp("hold_until", { withTimezone: true }),
  executionReport: jsonb("execution_report"),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull()
}, (table) => [index("privacy_lead_idx").on(table.leadId, table.createdAt)]);

export const privacyExports = pgTable("privacy_exports", {
  id: uuid("id").defaultRandom().primaryKey(),
  requestId: uuid("request_id").notNull().references(() => privacyRequests.id, { onDelete: "cascade" }),
  payloadEncrypted: jsonb("payload_encrypted"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  downloadedAt: timestamp("downloaded_at", { withTimezone: true })
}, (table) => [index("privacy_exports_expiry_idx").on(table.expiresAt)]);

export const deletionLedger = pgTable("deletion_ledger", {
  subjectHash: text("subject_hash").primaryKey(),
  requestId: uuid("request_id").notNull().references(() => privacyRequests.id, { onDelete: "restrict" }),
  erasedAt: timestamp("erased_at", { withTimezone: true }).notNull(),
  keyVersion: text("key_version").notNull(),
  evidence: jsonb("evidence").notNull()
});

export const idempotencyRecords = pgTable("idempotency_records", {
  scope: text("scope").notNull(),
  keyHash: text("key_hash").notNull(),
  requestFingerprint: text("request_fingerprint").notNull(),
  responseStatus: integer("response_status"),
  responseBody: jsonb("response_body"),
  lockedAt: timestamp("locked_at", { withTimezone: true }).defaultNow().notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull()
}, (table) => [primaryKey({ columns: [table.scope, table.keyHash] }), index("idempotency_expiry_idx").on(table.expiresAt)]);

export const rateLimitBuckets = pgTable("rate_limit_buckets", {
  bucketKey: text("bucket_key").primaryKey(),
  count: integer("count").default(0).notNull(),
  windowStartedAt: timestamp("window_started_at", { withTimezone: true }).notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull()
}, (table) => [index("rate_limit_expiry_idx").on(table.expiresAt), check("rate_limit_count_nonnegative", sql`${table.count} >= 0`)]);

export const workerHeartbeats = pgTable("worker_heartbeats", {
  workerId: text("worker_id").primaryKey(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).defaultNow().notNull(),
  metadata: jsonb("metadata").default({}).notNull()
});

export const importRuns = pgTable("import_runs", {
  id: uuid("id").defaultRandom().primaryKey(),
  sourceChecksum: text("source_checksum").notNull().unique(),
  dryRun: boolean("dry_run").default(true).notNull(),
  report: jsonb("report").notNull(),
  executedBy: text("executed_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull()
});
