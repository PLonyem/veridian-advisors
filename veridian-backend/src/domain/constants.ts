export const LEAD_STAGES = ["NEW", "CONTACTED", "QUALIFICATION_PENDING", "QUALIFIED", "ENGAGEMENT_SENT", "SIGNED", "CONVERTED", "REJECTED"] as const;
export type LeadStage = typeof LEAD_STAGES[number];

export const STAFF_ROLES = ["OWNER", "ADVISOR", "VIEWER"] as const;
export type StaffRole = typeof STAFF_ROLES[number];

export const stageRank: Record<Exclude<LeadStage, "REJECTED">, number> = {
  NEW: 0,
  CONTACTED: 1,
  QUALIFICATION_PENDING: 2,
  QUALIFIED: 3,
  ENGAGEMENT_SENT: 4,
  SIGNED: 5,
  CONVERTED: 6
};

export const allowedManualTransitions: Record<LeadStage, readonly LeadStage[]> = {
  NEW: ["CONTACTED", "REJECTED"],
  CONTACTED: ["QUALIFICATION_PENDING", "REJECTED"],
  QUALIFICATION_PENDING: ["QUALIFIED", "REJECTED"],
  QUALIFIED: ["REJECTED"],
  ENGAGEMENT_SENT: ["REJECTED"],
  SIGNED: [],
  CONVERTED: [],
  REJECTED: []
};
