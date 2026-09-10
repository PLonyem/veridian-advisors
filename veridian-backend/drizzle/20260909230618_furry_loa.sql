CREATE TABLE "privacy_exports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" uuid NOT NULL,
	"payload_encrypted" jsonb,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"downloaded_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "privacy_exports" ADD CONSTRAINT "privacy_exports_request_id_privacy_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."privacy_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "privacy_exports_expiry_idx" ON "privacy_exports" USING btree ("expires_at");