CREATE TYPE "public"."attempt_outcome" AS ENUM('CLAIMED', 'ACCEPTED', 'TRANSIENT_FAILURE', 'PERMANENT_FAILURE', 'AMBIGUOUS');--> statement-breakpoint
CREATE TYPE "public"."consent_purpose" AS ENUM('INTAKE_ACKNOWLEDGEMENT', 'MARKETING');--> statement-breakpoint
CREATE TYPE "public"."consent_state" AS ENUM('ACCEPTED', 'WITHDRAWN');--> statement-breakpoint
CREATE TYPE "public"."consultation_state" AS ENUM('PROPOSED', 'CONFIRMED', 'COMPLETED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."document_state" AS ENUM('QUARANTINED', 'SCANNING', 'APPROVED', 'REJECTED', 'DELETED');--> statement-breakpoint
CREATE TYPE "public"."document_type" AS ENUM('ENGAGEMENT', 'SIGNED_ENGAGEMENT', 'PRIVACY_EXPORT');--> statement-breakpoint
CREATE TYPE "public"."engagement_state" AS ENUM('DRAFT', 'QUEUED', 'SENT', 'SIGNED');--> statement-breakpoint
CREATE TYPE "public"."fit_decision" AS ENUM('QUALIFIED', 'REJECTED');--> statement-breakpoint
CREATE TYPE "public"."lead_stage" AS ENUM('NEW', 'CONTACTED', 'QUALIFICATION_PENDING', 'QUALIFIED', 'ENGAGEMENT_SENT', 'SIGNED', 'CONVERTED', 'REJECTED');--> statement-breakpoint
CREATE TYPE "public"."message_category" AS ENUM('SECURITY', 'TRANSACTIONAL', 'DISCRETIONARY');--> statement-breakpoint
CREATE TYPE "public"."message_state" AS ENUM('QUEUED', 'PROCESSING', 'PROVIDER_ACCEPTED', 'DELIVERED', 'BOUNCED', 'COMPLAINED', 'RETRY_SCHEDULED', 'FAILED', 'CANCELLED', 'UNKNOWN');--> statement-breakpoint
CREATE TYPE "public"."net_worth_range" AS ENUM('USD_1M_5M', 'USD_5M_20M', 'USD_20M_PLUS');--> statement-breakpoint
CREATE TYPE "public"."payment_status" AS ENUM('EXTERNALLY_CONFIRMED', 'REVERSED');--> statement-breakpoint
CREATE TYPE "public"."privacy_request_type" AS ENUM('ARCHIVE', 'COMMUNICATION_WITHDRAWAL', 'EXPORT', 'ERASURE');--> statement-breakpoint
CREATE TYPE "public"."privacy_state" AS ENUM('REQUESTED', 'IDENTITY_VERIFIED', 'REVIEWED', 'PROCESSING', 'COMPLETED', 'REJECTED');--> statement-breakpoint
CREATE TYPE "public"."qualification_state" AS ENUM('DRAFT', 'SUBMITTED', 'REVIEWED');--> statement-breakpoint
CREATE TYPE "public"."recipient_type" AS ENUM('LEAD', 'STAFF', 'CONFIGURED_TEST');--> statement-breakpoint
CREATE TYPE "public"."staff_role" AS ENUM('OWNER', 'ADVISOR', 'VIEWER');--> statement-breakpoint
CREATE TYPE "public"."tier_interest" AS ENUM('FOUNDATION', 'ACCELERATED', 'EXECUTIVE', 'NOT_SURE');--> statement-breakpoint
CREATE TYPE "public"."webhook_state" AS ENUM('RECEIVED', 'PROCESSED', 'IGNORED', 'FAILED');--> statement-breakpoint
CREATE TABLE "app_meta" (
	"key" text PRIMARY KEY NOT NULL,
	"value" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_id" text,
	"actor_type" text NOT NULL,
	"action" text NOT NULL,
	"target_type" text NOT NULL,
	"target_id" text NOT NULL,
	"request_id" text NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "communications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lead_id" uuid,
	"engagement_id" uuid,
	"document_id" uuid,
	"recipient_type" "recipient_type" NOT NULL,
	"recipient_ref" text NOT NULL,
	"recipient_email" text NOT NULL,
	"template" text NOT NULL,
	"template_version" text NOT NULL,
	"category" "message_category" NOT NULL,
	"state" "message_state" DEFAULT 'QUEUED' NOT NULL,
	"provider_message_id" text,
	"subject_redacted" text,
	"last_error_redacted" text,
	"created_by" text,
	"accepted_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "consent_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"enquiry_id" uuid NOT NULL,
	"lead_id" uuid,
	"purpose" "consent_purpose" NOT NULL,
	"state" "consent_state" NOT NULL,
	"notice_version" text NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "consultations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lead_id" uuid NOT NULL,
	"advisor_id" text NOT NULL,
	"state" "consultation_state" NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"timezone" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "consultation_time_order" CHECK ("consultations"."ends_at" > "consultations"."starts_at")
);
--> statement-breakpoint
CREATE TABLE "deletion_ledger" (
	"subject_hash" text PRIMARY KEY NOT NULL,
	"request_id" uuid NOT NULL,
	"erased_at" timestamp with time zone NOT NULL,
	"key_version" text NOT NULL,
	"evidence" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lead_id" uuid NOT NULL,
	"engagement_id" uuid,
	"type" "document_type" NOT NULL,
	"state" "document_state" DEFAULT 'QUARANTINED' NOT NULL,
	"object_key" text NOT NULL,
	"checksum_sha256" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"version" integer NOT NULL,
	"original_name" text NOT NULL,
	"scan_reference" text,
	"approved_at" timestamp with time zone,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "documents_object_key_unique" UNIQUE("object_key"),
	CONSTRAINT "documents_size_positive" CHECK ("documents"."size_bytes" > 0)
);
--> statement-breakpoint
CREATE TABLE "email_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"outbox_id" uuid NOT NULL,
	"attempt_number" integer NOT NULL,
	"lease_token" uuid NOT NULL,
	"outcome" "attempt_outcome" NOT NULL,
	"provider_message_id" text,
	"error_redacted" text,
	"started_at" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "email_outbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"communication_id" uuid NOT NULL,
	"job_key" text NOT NULL,
	"payload_encrypted" jsonb,
	"priority" integer DEFAULT 0 NOT NULL,
	"state" "message_state" DEFAULT 'QUEUED' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"lease_owner" text,
	"lease_token" uuid,
	"lease_expires_at" timestamp with time zone,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone,
	"provider_message_id" text,
	"last_error_redacted" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "email_outbox_job_key_unique" UNIQUE("job_key"),
	CONSTRAINT "outbox_attempts_nonnegative" CHECK ("email_outbox"."attempts" >= 0)
);
--> statement-breakpoint
CREATE TABLE "email_suppressions" (
	"recipient_hash" text PRIMARY KEY NOT NULL,
	"reason" text NOT NULL,
	"provider_message_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "engagements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lead_id" uuid NOT NULL,
	"package_code" "tier_interest" NOT NULL,
	"quote_minor" bigint NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"payment_required" boolean DEFAULT true NOT NULL,
	"state" "engagement_state" DEFAULT 'DRAFT' NOT NULL,
	"current_document_id" uuid,
	"sent_document_id" uuid,
	"signature_evidence_type" text,
	"signature_evidence_reference" text,
	"signed_document_id" uuid,
	"signed_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "engagement_quote_nonnegative" CHECK ("engagements"."quote_minor" >= 0)
);
--> statement-breakpoint
CREATE TABLE "enquiries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lead_id" uuid,
	"full_name" text NOT NULL,
	"email" text NOT NULL,
	"normalized_email" text NOT NULL,
	"country" text NOT NULL,
	"net_worth_range" "net_worth_range" NOT NULL,
	"tier_interest" "tier_interest" NOT NULL,
	"repeat_contact" boolean DEFAULT false NOT NULL,
	"reconciliation_pending" boolean DEFAULT false NOT NULL,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reconciled_at" timestamp with time zone,
	"reconciled_by" text
);
--> statement-breakpoint
CREATE TABLE "enquiry_candidates" (
	"enquiry_id" uuid NOT NULL,
	"lead_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "enquiry_candidates_enquiry_id_lead_id_pk" PRIMARY KEY("enquiry_id","lead_id")
);
--> statement-breakpoint
CREATE TABLE "idempotency_records" (
	"scope" text NOT NULL,
	"key_hash" text NOT NULL,
	"request_fingerprint" text NOT NULL,
	"response_status" integer,
	"response_body" jsonb,
	"locked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "idempotency_records_scope_key_hash_pk" PRIMARY KEY("scope","key_hash")
);
--> statement-breakpoint
CREATE TABLE "import_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_checksum" text NOT NULL,
	"dry_run" boolean DEFAULT true NOT NULL,
	"report" jsonb NOT NULL,
	"executed_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "import_runs_source_checksum_unique" UNIQUE("source_checksum")
);
--> statement-breakpoint
CREATE TABLE "lead_access_grants" (
	"lead_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lead_access_grants_lead_id_user_id_pk" PRIMARY KEY("lead_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "lead_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lead_id" uuid NOT NULL,
	"actor_id" text NOT NULL,
	"note_encrypted" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "leads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"full_name" text NOT NULL,
	"email" text NOT NULL,
	"normalized_email" text NOT NULL,
	"country" text NOT NULL,
	"net_worth_range" "net_worth_range" NOT NULL,
	"tier_interest" "tier_interest" NOT NULL,
	"assigned_staff_id" text,
	"pipeline_stage" "lead_stage" DEFAULT 'NEW' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"identity_verified_at" timestamp with time zone,
	"archived_at" timestamp with time zone,
	"service_completed_at" timestamp with time zone,
	"legacy_review_required" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "leads_version_positive" CHECK ("leads"."version" > 0)
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"engagement_id" uuid NOT NULL,
	"amount_minor" bigint NOT NULL,
	"currency" text NOT NULL,
	"status" "payment_status" NOT NULL,
	"externally_confirmed_at" timestamp with time zone NOT NULL,
	"external_reference" text NOT NULL,
	"recorded_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payments_amount_positive" CHECK ("payments"."amount_minor" > 0)
);
--> statement-breakpoint
CREATE TABLE "privacy_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lead_id" uuid,
	"type" "privacy_request_type" NOT NULL,
	"state" "privacy_state" DEFAULT 'REQUESTED' NOT NULL,
	"requester_reference" text NOT NULL,
	"identity_verified_at" timestamp with time zone,
	"reviewed_by" text,
	"review_evidence" text,
	"hold_until" timestamp with time zone,
	"execution_report" jsonb,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "qualification_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lead_id" uuid NOT NULL,
	"state" "qualification_state" DEFAULT 'DRAFT' NOT NULL,
	"citizenship_residence" text,
	"approximate_net_worth_range" "net_worth_range",
	"source_of_funds_category" text,
	"requested_service_timing" text,
	"preferred_tier" "tier_interest",
	"received_at" timestamp with time zone,
	"decision" "fit_decision",
	"service_fit_reason" text,
	"restricted_notes_encrypted" jsonb,
	"reviewer_id" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reviewed_at" timestamp with time zone,
	CONSTRAINT "qualification_version_positive" CHECK ("qualification_reviews"."version" > 0)
);
--> statement-breakpoint
CREATE TABLE "rate_limit_buckets" (
	"bucket_key" text PRIMARY KEY NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	"window_started_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "rate_limit_count_nonnegative" CHECK ("rate_limit_buckets"."count" >= 0)
);
--> statement-breakpoint
CREATE TABLE "service_packages" (
	"code" "tier_interest" PRIMARY KEY NOT NULL,
	"display_name" text NOT NULL,
	"price_minor" bigint NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"is_starting_price" boolean DEFAULT false NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "service_packages_price_nonnegative" CHECK ("service_packages"."price_minor" >= 0)
);
--> statement-breakpoint
CREATE TABLE "staff_profiles" (
	"user_id" text PRIMARY KEY NOT NULL,
	"role" "staff_role" NOT NULL,
	"disabled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "status_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lead_id" uuid NOT NULL,
	"from_stage" "lead_stage",
	"to_stage" "lead_stage" NOT NULL,
	"actor_id" text,
	"actor_type" text NOT NULL,
	"reason" text NOT NULL,
	"triggering_event_id" text,
	"from_version" integer,
	"to_version" integer NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhook_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text NOT NULL,
	"provider_event_id" text NOT NULL,
	"event_type" text NOT NULL,
	"provider_message_id" text,
	"payload_hash" text NOT NULL,
	"state" "webhook_state" DEFAULT 'RECEIVED' NOT NULL,
	"occurred_at" timestamp with time zone,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "worker_heartbeats" (
	"worker_id" text PRIMARY KEY NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "account" (
	"id" text PRIMARY KEY NOT NULL,
	"accountId" text NOT NULL,
	"providerId" text NOT NULL,
	"userId" text NOT NULL,
	"accessToken" text,
	"refreshToken" text,
	"idToken" text,
	"accessTokenExpiresAt" timestamp with time zone,
	"refreshTokenExpiresAt" timestamp with time zone,
	"scope" text,
	"password" text,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY NOT NULL,
	"expiresAt" timestamp with time zone NOT NULL,
	"token" text NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	"ipAddress" text,
	"userAgent" text,
	"userId" text NOT NULL,
	"impersonatedBy" text,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "twoFactor" (
	"id" text PRIMARY KEY NOT NULL,
	"secret" text NOT NULL,
	"backupCodes" text NOT NULL,
	"userId" text NOT NULL,
	"verified" boolean DEFAULT true,
	"failedVerificationCount" integer DEFAULT 0,
	"lockedUntil" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"emailVerified" boolean DEFAULT false NOT NULL,
	"image" text,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	"twoFactorEnabled" boolean DEFAULT false,
	"role" text DEFAULT 'user',
	"banned" boolean DEFAULT false,
	"banReason" text,
	"banExpires" timestamp with time zone,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expiresAt" timestamp with time zone NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "communications" ADD CONSTRAINT "communications_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "communications" ADD CONSTRAINT "communications_engagement_id_engagements_id_fk" FOREIGN KEY ("engagement_id") REFERENCES "public"."engagements"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "communications" ADD CONSTRAINT "communications_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "communications" ADD CONSTRAINT "communications_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consent_events" ADD CONSTRAINT "consent_events_enquiry_id_enquiries_id_fk" FOREIGN KEY ("enquiry_id") REFERENCES "public"."enquiries"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consent_events" ADD CONSTRAINT "consent_events_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consultations" ADD CONSTRAINT "consultations_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consultations" ADD CONSTRAINT "consultations_advisor_id_user_id_fk" FOREIGN KEY ("advisor_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deletion_ledger" ADD CONSTRAINT "deletion_ledger_request_id_privacy_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."privacy_requests"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_engagement_id_engagements_id_fk" FOREIGN KEY ("engagement_id") REFERENCES "public"."engagements"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_attempts" ADD CONSTRAINT "email_attempts_outbox_id_email_outbox_id_fk" FOREIGN KEY ("outbox_id") REFERENCES "public"."email_outbox"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_outbox" ADD CONSTRAINT "email_outbox_communication_id_communications_id_fk" FOREIGN KEY ("communication_id") REFERENCES "public"."communications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "engagements" ADD CONSTRAINT "engagements_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "engagements" ADD CONSTRAINT "engagements_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enquiries" ADD CONSTRAINT "enquiries_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enquiries" ADD CONSTRAINT "enquiries_reconciled_by_user_id_fk" FOREIGN KEY ("reconciled_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enquiry_candidates" ADD CONSTRAINT "enquiry_candidates_enquiry_id_enquiries_id_fk" FOREIGN KEY ("enquiry_id") REFERENCES "public"."enquiries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enquiry_candidates" ADD CONSTRAINT "enquiry_candidates_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_access_grants" ADD CONSTRAINT "lead_access_grants_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_access_grants" ADD CONSTRAINT "lead_access_grants_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_notes" ADD CONSTRAINT "lead_notes_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_notes" ADD CONSTRAINT "lead_notes_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_assigned_staff_id_user_id_fk" FOREIGN KEY ("assigned_staff_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_engagement_id_engagements_id_fk" FOREIGN KEY ("engagement_id") REFERENCES "public"."engagements"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_recorded_by_user_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "privacy_requests" ADD CONSTRAINT "privacy_requests_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "privacy_requests" ADD CONSTRAINT "privacy_requests_reviewed_by_user_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qualification_reviews" ADD CONSTRAINT "qualification_reviews_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qualification_reviews" ADD CONSTRAINT "qualification_reviews_reviewer_id_user_id_fk" FOREIGN KEY ("reviewer_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_profiles" ADD CONSTRAINT "staff_profiles_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "status_history" ADD CONSTRAINT "status_history_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "status_history" ADD CONSTRAINT "status_history_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "twoFactor" ADD CONSTRAINT "twoFactor_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_target_idx" ON "audit_events" USING btree ("target_type","target_id","occurred_at");--> statement-breakpoint
CREATE INDEX "audit_actor_idx" ON "audit_events" USING btree ("actor_id","occurred_at");--> statement-breakpoint
CREATE INDEX "communications_lead_idx" ON "communications" USING btree ("lead_id","created_at");--> statement-breakpoint
CREATE INDEX "communications_provider_idx" ON "communications" USING btree ("provider_message_id");--> statement-breakpoint
CREATE INDEX "consent_lead_purpose_idx" ON "consent_events" USING btree ("lead_id","purpose","occurred_at");--> statement-breakpoint
CREATE INDEX "consultations_advisor_time_idx" ON "consultations" USING btree ("advisor_id","starts_at");--> statement-breakpoint
CREATE UNIQUE INDEX "documents_engagement_version_idx" ON "documents" USING btree ("engagement_id","version");--> statement-breakpoint
CREATE INDEX "documents_lead_idx" ON "documents" USING btree ("lead_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "email_attempt_unique_idx" ON "email_attempts" USING btree ("outbox_id","attempt_number");--> statement-breakpoint
CREATE INDEX "outbox_claim_idx" ON "email_outbox" USING btree ("state","next_attempt_at","priority");--> statement-breakpoint
CREATE INDEX "engagements_lead_idx" ON "engagements" USING btree ("lead_id","created_at");--> statement-breakpoint
CREATE INDEX "enquiries_email_idx" ON "enquiries" USING btree ("normalized_email");--> statement-breakpoint
CREATE INDEX "enquiries_pending_idx" ON "enquiries" USING btree ("reconciliation_pending","submitted_at");--> statement-breakpoint
CREATE INDEX "idempotency_expiry_idx" ON "idempotency_records" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "lead_access_user_idx" ON "lead_access_grants" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "lead_notes_lead_idx" ON "lead_notes" USING btree ("lead_id","created_at");--> statement-breakpoint
CREATE INDEX "leads_normalized_email_idx" ON "leads" USING btree ("normalized_email");--> statement-breakpoint
CREATE INDEX "leads_stage_created_idx" ON "leads" USING btree ("pipeline_stage","created_at");--> statement-breakpoint
CREATE INDEX "leads_assigned_staff_idx" ON "leads" USING btree ("assigned_staff_id");--> statement-breakpoint
CREATE INDEX "payments_engagement_idx" ON "payments" USING btree ("engagement_id");--> statement-breakpoint
CREATE INDEX "privacy_lead_idx" ON "privacy_requests" USING btree ("lead_id","created_at");--> statement-breakpoint
CREATE INDEX "qualification_lead_idx" ON "qualification_reviews" USING btree ("lead_id","created_at");--> statement-breakpoint
CREATE INDEX "rate_limit_expiry_idx" ON "rate_limit_buckets" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "status_history_lead_idx" ON "status_history" USING btree ("lead_id","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "webhook_provider_event_idx" ON "webhook_events" USING btree ("provider","provider_event_id");--> statement-breakpoint
CREATE INDEX "webhook_message_idx" ON "webhook_events" USING btree ("provider_message_id");--> statement-breakpoint
CREATE INDEX "account_userId_idx" ON "account" USING btree ("userId");--> statement-breakpoint
CREATE UNIQUE INDEX "account_provider_account_idx" ON "account" USING btree ("providerId","accountId");--> statement-breakpoint
CREATE INDEX "session_userId_idx" ON "session" USING btree ("userId");--> statement-breakpoint
CREATE INDEX "twoFactor_secret_idx" ON "twoFactor" USING btree ("secret");--> statement-breakpoint
CREATE UNIQUE INDEX "twoFactor_userId_idx" ON "twoFactor" USING btree ("userId");--> statement-breakpoint
CREATE UNIQUE INDEX "user_email_idx" ON "user" USING btree ("email");--> statement-breakpoint
CREATE INDEX "verification_identifier_idx" ON "verification" USING btree ("identifier");
--> statement-breakpoint
ALTER TABLE "engagements" ADD CONSTRAINT "engagements_current_document_fk" FOREIGN KEY ("current_document_id") REFERENCES "documents"("id") ON DELETE set null;
--> statement-breakpoint
ALTER TABLE "engagements" ADD CONSTRAINT "engagements_sent_document_fk" FOREIGN KEY ("sent_document_id") REFERENCES "documents"("id") ON DELETE restrict;
--> statement-breakpoint
ALTER TABLE "engagements" ADD CONSTRAINT "engagements_signed_document_fk" FOREIGN KEY ("signed_document_id") REFERENCES "documents"("id") ON DELETE restrict;
--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS btree_gist;
--> statement-breakpoint
ALTER TABLE "consultations" ADD CONSTRAINT "consultations_no_confirmed_overlap"
  EXCLUDE USING gist (
    "advisor_id" WITH =,
    tstzrange("starts_at", "ends_at", '[)') WITH &&
  ) WHERE ("state" = 'CONFIRMED');
--> statement-breakpoint
CREATE OR REPLACE FUNCTION prevent_append_only_changes() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER audit_events_append_only BEFORE UPDATE OR DELETE ON "audit_events"
FOR EACH ROW EXECUTE FUNCTION prevent_append_only_changes();
--> statement-breakpoint
CREATE TRIGGER email_attempts_append_only BEFORE UPDATE OR DELETE ON "email_attempts"
FOR EACH ROW EXECUTE FUNCTION prevent_append_only_changes();
--> statement-breakpoint
CREATE TRIGGER status_history_append_only BEFORE UPDATE OR DELETE ON "status_history"
FOR EACH ROW EXECUTE FUNCTION prevent_append_only_changes();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION preserve_enquiry_snapshot() RETURNS trigger AS $$
BEGIN
  IF ROW(NEW.full_name, NEW.email, NEW.normalized_email, NEW.country, NEW.net_worth_range, NEW.tier_interest, NEW.repeat_contact, NEW.submitted_at)
     IS DISTINCT FROM
     ROW(OLD.full_name, OLD.email, OLD.normalized_email, OLD.country, OLD.net_worth_range, OLD.tier_interest, OLD.repeat_contact, OLD.submitted_at) THEN
    RAISE EXCEPTION 'enquiry submission snapshot is immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER enquiries_preserve_snapshot BEFORE UPDATE ON "enquiries"
FOR EACH ROW EXECUTE FUNCTION preserve_enquiry_snapshot();
--> statement-breakpoint
INSERT INTO "app_meta" ("key", "value") VALUES ('schema_version', '1');
--> statement-breakpoint
INSERT INTO "service_packages" ("code", "display_name", "price_minor", "currency", "is_starting_price") VALUES
  ('FOUNDATION', 'Foundation', 750000, 'USD', false),
  ('ACCELERATED', 'Accelerated', 2500000, 'USD', false),
  ('EXECUTIVE', 'Executive', 4500000, 'USD', true);
