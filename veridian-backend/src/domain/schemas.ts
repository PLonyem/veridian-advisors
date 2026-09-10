import { z } from "zod";
import { LEAD_STAGES, STAFF_ROLES } from "./constants.js";

const boundedString = (minimum: number, maximum: number) => z.string().trim().min(minimum).max(maximum);
export const uuid = z.uuid();
export const expectedVersion = z.number().int().positive();

const netWorthMapping: Record<string, "USD_1M_5M" | "USD_5M_20M" | "USD_20M_PLUS"> = {
  "$1M–$5M": "USD_1M_5M",
  "$1M-$5M": "USD_1M_5M",
  "USD_1M_5M": "USD_1M_5M",
  "$5M–$20M": "USD_5M_20M",
  "$5M-$20M": "USD_5M_20M",
  "USD_5M_20M": "USD_5M_20M",
  "$20M+": "USD_20M_PLUS",
  "USD_20M_PLUS": "USD_20M_PLUS"
};

const tierMapping: Record<string, "FOUNDATION" | "ACCELERATED" | "EXECUTIVE" | "NOT_SURE"> = {
  Foundation: "FOUNDATION",
  FOUNDATION: "FOUNDATION",
  Accelerated: "ACCELERATED",
  ACCELERATED: "ACCELERATED",
  Executive: "EXECUTIVE",
  EXECUTIVE: "EXECUTIVE",
  "Not sure": "NOT_SURE",
  "Not Sure": "NOT_SURE",
  NOT_SURE: "NOT_SURE"
};

export const enquirySchema = z.strictObject({
  fullName: boundedString(2, 120),
  email: z.email().max(254).transform((value) => value.toLowerCase()),
  country: boundedString(2, 100),
  netWorthRange: z.string().refine((value) => value in netWorthMapping, "Select a supported approximate net-worth range").transform((value) => netWorthMapping[value]!),
  tierInterest: z.string().refine((value) => value in tierMapping, "Select a supported service tier").transform((value) => tierMapping[value]!),
  disclaimerAccepted: z.literal(true, { error: "The intake acknowledgement must be accepted" }),
  noticeVersion: boundedString(1, 40),
  marketingConsent: z.boolean().default(false),
  website: z.string().max(0).optional()
});

export const listLeadsQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  search: z.string().trim().max(120).optional(),
  stage: z.enum(LEAD_STAGES).optional(),
  assignedStaffId: z.string().max(128).optional(),
  sort: z.enum(["createdAt", "updatedAt", "fullName", "pipelineStage"]).default("createdAt"),
  direction: z.enum(["asc", "desc"]).default("desc"),
  from: z.iso.datetime({ offset: true }).optional(),
  to: z.iso.datetime({ offset: true }).optional(),
  includeArchived: z.stringbool().default(false)
});

export const patchLeadSchema = z.strictObject({
  expectedVersion,
  fullName: boundedString(2, 120).optional(),
  email: z.email().max(254).transform((value) => value.toLowerCase()).optional(),
  country: boundedString(2, 100).optional(),
  assignedStaffId: z.string().max(128).nullable().optional(),
  tierInterest: z.enum(["FOUNDATION", "ACCELERATED", "EXECUTIVE", "NOT_SURE"]).optional()
});

export const transitionSchema = z.strictObject({ expectedVersion, toStage: z.enum(LEAD_STAGES), reason: boundedString(3, 500) });
export const noteSchema = z.strictObject({ note: boundedString(1, 5000) });
export const reconcileSchema = z.strictObject({ leadId: uuid, expectedVersion });
export const qualificationSchema = z.strictObject({
  expectedVersion,
  citizenshipResidence: boundedString(2, 300),
  approximateNetWorthRange: z.enum(["USD_1M_5M", "USD_5M_20M", "USD_20M_PLUS"]),
  sourceOfFundsCategory: boundedString(2, 200),
  requestedServiceTiming: boundedString(2, 500),
  preferredTier: z.enum(["FOUNDATION", "ACCELERATED", "EXECUTIVE", "NOT_SURE"]),
  receivedAt: z.iso.datetime({ offset: true }),
  restrictedNotes: z.string().max(5000).optional()
});
export const qualificationReviewSchema = z.strictObject({
  expectedVersion,
  decision: z.enum(["QUALIFIED", "REJECTED"]),
  serviceFitReason: boundedString(3, 1000)
});
export const sendSchema = z.strictObject({ expectedVersion, previewAccepted: z.literal(true) });
export const followUpSchema = z.strictObject({ expectedVersion, subject: boundedString(1, 140), message: boundedString(1, 5000), previewAccepted: z.literal(true) });
export const engagementSchema = z.strictObject({
  expectedVersion,
  packageCode: z.enum(["FOUNDATION", "ACCELERATED", "EXECUTIVE"]),
  quoteMinor: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  currency: z.string().regex(/^[A-Z]{3}$/),
  paymentRequired: z.boolean()
});
export const evidenceSchema = z.strictObject({ expectedVersion, signedAt: z.iso.datetime({ offset: true }), evidenceType: z.enum(["EXTERNAL_RECORD", "SIGNED_PDF"]), evidenceReference: boundedString(3, 500), signedDocumentId: uuid.optional() });
export const paymentSchema = z.strictObject({ expectedVersion, amountMinor: z.number().int().positive(), currency: z.string().regex(/^[A-Z]{3}$/), externallyConfirmedAt: z.iso.datetime({ offset: true }), externalReference: boundedString(2, 300) });
export const privacyCreateSchema = z.strictObject({ leadId: uuid.optional(), type: z.enum(["ARCHIVE", "COMMUNICATION_WITHDRAWAL", "EXPORT", "ERASURE"]), requesterReference: boundedString(3, 300) });
export const privacyReviewSchema = z.strictObject({ identityVerified: z.literal(true), reviewEvidence: boundedString(3, 1000), holdUntil: z.iso.datetime({ offset: true }).optional() });
export const staffCreateSchema = z.strictObject({ email: z.email(), name: boundedString(2, 120), password: z.string().min(12).max(128), role: z.enum(STAFF_ROLES) });
