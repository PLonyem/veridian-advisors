import { config } from "../config.js";

export type TemplateName = "ENQUIRY_ACK" | "STAFF_NOTIFICATION" | "PRE_VETTING" | "QUALIFICATION_OUTCOME" | "ENGAGEMENT_DELIVERY" | "FOLLOW_UP" | "CONFIG_TEST" | "PASSWORD_RESET" | "CONSULTATION_INVITATION" | "CONSULTATION_CONFIRMATION" | "CONSULTATION_CANCELLATION";
export type TemplateVariables = Record<string, string | number | boolean | null | undefined>;

function escapeHtml(value: unknown): string {
  return String(value ?? "").replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]!);
}

function safeLine(value: unknown, maximum = 140): string {
  return String(value ?? "").replace(/[\r\n]+/g, " ").trim().slice(0, maximum);
}

function trustedUrl(value: unknown): string {
  const url = new URL(String(value));
  const allowed = [config.PUBLIC_SITE_URL, config.ADMIN_APP_URL, config.API_BASE_URL].map((item) => new URL(item).origin);
  if (!allowed.includes(url.origin)) throw new Error("Template URL origin is not configured");
  return url.toString();
}

function shell(title: string, content: string): string {
  return `<!doctype html><html><body style="margin:0;background:#f4f2ec;color:#16261f;font-family:Arial,sans-serif"><table role="presentation" width="100%"><tr><td align="center" style="padding:32px"><table role="presentation" width="600" style="max-width:100%;background:#fff;border:1px solid #d9d5c8"><tr><td style="padding:28px"><div style="font-size:12px;letter-spacing:2px;color:#567164">VERIDIAN GLOBAL ADVISORS</div><h1 style="font:28px Georgia,serif">${escapeHtml(title)}</h1>${content}<hr style="border:0;border-top:1px solid #e6e2d8;margin:28px 0"><p style="font-size:12px;color:#65736d">Veridian is a private, independent document preparation consultancy. We are not affiliated with any government, do not provide legal advice, and cannot guarantee approvals.</p></td></tr></table></td></tr></table></body></html>`;
}

export function renderTemplate(name: TemplateName, variables: TemplateVariables): { subject: string; html: string; text: string } {
  const fullName = safeLine(variables.fullName, 120) || "there";
  if (name === "ENQUIRY_ACK") {
    const subject = "We received your Veridian enquiry";
    const text = `Hello ${fullName},\n\nThank you for contacting Veridian. Your enquiry has been received for staff review. Please reply to this email if you need to add context.\n\nVeridian is a private, independent document preparation consultancy. We are not affiliated with any government, do not provide legal advice, and cannot guarantee approvals.`;
    return { subject, text, html: shell("Enquiry received", `<p>Hello ${escapeHtml(fullName)},</p><p>Thank you for contacting Veridian. Your enquiry has been received for staff review. Please reply to this email if you need to add context.</p>`) };
  }
  if (name === "STAFF_NOTIFICATION") {
    const dashboardUrl = trustedUrl(variables.dashboardUrl);
    return { subject: "New Veridian enquiry", text: `A new enquiry is ready for review: ${dashboardUrl}`, html: shell("New enquiry", `<p>A new enquiry is ready for review.</p><p><a href="${escapeHtml(dashboardUrl)}">Open the protected dashboard</a></p>`) };
  }
  if (name === "PRE_VETTING") {
    const questions = "1. Citizenship and current residence\n2. Approximate net-worth range\n3. Broad source-of-funds category\n4. Requested document-preparation service and timing\n5. Preferred service tier";
    return { subject: "Veridian service-fit questions", text: `Hello ${fullName},\n\nPlease reply with brief answers to these service-fit questions:\n${questions}\n\nDo not send passports, financial statements, exact balances, or criminal-history narratives. Replies are reviewed manually and are not imported automatically.`, html: shell("Service-fit questions", `<p>Hello ${escapeHtml(fullName)},</p><p>Please reply with brief answers to these five service-fit questions:</p><ol><li>Citizenship and current residence</li><li>Approximate net-worth range</li><li>Broad source-of-funds category</li><li>Requested document-preparation service and timing</li><li>Preferred service tier</li></ol><p><strong>Do not send</strong> passports, financial statements, exact balances, or criminal-history narratives. Replies are reviewed manually and are not imported automatically.</p>`) };
  }
  if (name === "QUALIFICATION_OUTCOME") {
    const outcome = safeLine(variables.outcome, 30);
    const reason = safeLine(variables.reason, 1000);
    return { subject: "Update on your Veridian enquiry", text: `Hello ${fullName},\n\nService-fit review outcome: ${outcome}.\n${reason}`, html: shell("Service-fit review", `<p>Hello ${escapeHtml(fullName)},</p><p>Service-fit review outcome: <strong>${escapeHtml(outcome)}</strong>.</p><p>${escapeHtml(reason)}</p>`) };
  }
  if (name === "ENGAGEMENT_DELIVERY") {
    return { subject: "Your Veridian engagement document", text: `Hello ${fullName},\n\nThe staff-approved engagement document is attached. Please review it and reply with any questions.`, html: shell("Engagement document", `<p>Hello ${escapeHtml(fullName)},</p><p>The staff-approved engagement document is attached. Please review it and reply with any questions.</p>`) };
  }
  if (name === "FOLLOW_UP") {
    const subject = safeLine(variables.subject);
    const message = safeLine(variables.message, 5000);
    return { subject, text: message, html: shell(subject, `<p>${escapeHtml(message).replace(/\n/g, "<br>")}</p>`) };
  }
  if (name === "PASSWORD_RESET") {
    const resetUrl = trustedUrl(variables.resetUrl);
    return { subject: "Reset your Veridian staff password", text: `Use this single-use link within 30 minutes: ${resetUrl}`, html: shell("Password reset", `<p>Use this single-use link within 30 minutes:</p><p><a href="${escapeHtml(resetUrl)}">Reset password</a></p>`) };
  }
  if (name === "CONFIG_TEST") return { subject: "Veridian email configuration test", text: "The configured email provider accepted this restricted test message.", html: shell("Configuration test", "<p>The configured email provider accepted this restricted test message.</p>") };
  if (!config.CONSULTATIONS_ENABLED) throw new Error("Consultation templates are disabled");
  const consultationText = safeLine(variables.message, 1000);
  return { subject: `Veridian consultation ${name.split("_")[1]!.toLowerCase()}`, text: consultationText, html: shell("Consultation update", `<p>${escapeHtml(consultationText)}</p>`) };
}

export { escapeHtml, trustedUrl };
