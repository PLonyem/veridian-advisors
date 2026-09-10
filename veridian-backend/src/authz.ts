import type { RequestHandler, Response } from "express";
import { fromNodeHeaders } from "better-auth/node";
import { auth } from "./auth.js";
import { config } from "./config.js";
import { pool } from "./db/client.js";
import type { StaffRole } from "./domain/constants.js";
import { AppError, asyncHandler } from "./http/errors.js";

export type StaffContext = { userId: string; email: string; name: string; role: StaffRole; twoFactorEnabled: boolean };

export function getStaff(response: Response): StaffContext {
  const staff = response.locals.staff as StaffContext | undefined;
  if (!staff) throw new AppError(401, "AUTHENTICATION_REQUIRED", "Sign in is required");
  return staff;
}

export const requireStaff: RequestHandler = asyncHandler(async (request, response, next) => {
  const session = await auth.api.getSession({ headers: fromNodeHeaders(request.headers) });
  if (!session?.user) throw new AppError(401, "AUTHENTICATION_REQUIRED", "Sign in is required");
  const result = await pool.query<{ role: StaffRole; disabled_at: Date | null; banned: boolean; two_factor_enabled: boolean }>(
    `select staff.role, staff.disabled_at, coalesce(account.banned,false) as banned,
            coalesce(account."twoFactorEnabled",false) as two_factor_enabled
     from staff_profiles staff join "user" account on account.id=staff.user_id where staff.user_id=$1`,
    [session.user.id]
  );
  const profile = result.rows[0];
  if (!profile || profile.disabled_at || profile.banned) throw new AppError(401, "SESSION_REVOKED", "Session is no longer authorized");
  if (config.NODE_ENV === "production" && !profile.two_factor_enabled) throw new AppError(403, "MFA_ENROLLMENT_REQUIRED", "Complete MFA enrollment before accessing staff data");
  response.locals.staff = { userId: session.user.id, email: session.user.email, name: session.user.name, role: profile.role, twoFactorEnabled: profile.two_factor_enabled } satisfies StaffContext;
  next();
});

export function requireRole(...roles: StaffRole[]): RequestHandler {
  return (_request, response, next) => {
    if (!roles.includes(getStaff(response).role)) return next(new AppError(403, "FORBIDDEN", "This action is not permitted"));
    next();
  };
}

export async function assertLeadAccess(leadId: string, staff: StaffContext, mutate = false): Promise<void> {
  if (mutate && staff.role === "VIEWER") throw new AppError(403, "FORBIDDEN", "Viewer accounts cannot modify leads");
  if (staff.role === "OWNER") {
    const exists = await pool.query("select 1 from leads where id=$1", [leadId]);
    if (exists.rowCount !== 1) throw new AppError(404, "NOT_FOUND", "Lead not found");
    return;
  }
  const result = await pool.query(
    `select 1 from leads lead where lead.id=$1 and (
       ($3='ADVISOR' and lead.assigned_staff_id=$2)
       or exists (select 1 from lead_access_grants grant_row where grant_row.lead_id=lead.id and grant_row.user_id=$2)
     )`,
    [leadId, staff.userId, staff.role]
  );
  if (result.rowCount !== 1) throw new AppError(404, "NOT_FOUND", "Lead not found");
}

export function scopeSql(staff: StaffContext, alias = "lead"): { clause: string; values: unknown[] } {
  if (staff.role === "OWNER") return { clause: "true", values: [] };
  if (staff.role === "ADVISOR") return { clause: `${alias}.assigned_staff_id=$1`, values: [staff.userId] };
  return { clause: `exists (select 1 from lead_access_grants grant_row where grant_row.lead_id=${alias}.id and grant_row.user_id=$1)`, values: [staff.userId] };
}
