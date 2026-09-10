const $ = (selector) => document.querySelector(selector);
const panels = ["#login-panel", "#mfa-panel", "#enroll-panel", "#dashboard"];
let staff = null;
let selectedLead = null;
let selectedRecord = null;
let latestPrivacyRequestId = "";
let deepLinkHandled = false;
const actionKeys = new Map();

function show(selector) {
  for (const panel of panels) $(panel).classList.toggle("hidden", panel !== selector);
  $("#logout").classList.toggle("hidden", selector === "#login-panel");
}

async function api(path, options = {}) {
  const multipart = options.body instanceof FormData;
  const response = await fetch(path, {
    credentials: "include",
    cache: "no-store",
    ...options,
    headers: { ...(options.body && !multipart ? { "Content-Type": "application/json" } : {}), ...(options.headers || {}) }
  });
  const result = response.status === 204 ? {} : await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(result.error?.message || result.message || `Request failed (${response.status})`);
    error.status = response.status;
    error.code = result.error?.code;
    if (response.status === 401 && staff) {
      staff = null;
      clearDashboardData();
      show("#login-panel");
    }
    throw error;
  }
  return result;
}

function idempotency() { return crypto.randomUUID(); }
async function idempotentApi(path, payload) {
  const fingerprint = `${path}:${JSON.stringify(payload)}`;
  const key = actionKeys.get(fingerprint) || idempotency();
  actionKeys.set(fingerprint, key);
  const result = await api(path, { method: "POST", headers: { "Idempotency-Key": key }, body: JSON.stringify(payload) });
  actionKeys.delete(fingerprint);
  return result;
}
function formatDate(value) { return value ? new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)) : "—"; }
function escapeText(value) { const element = document.createElement("span"); element.textContent = value ?? ""; return element.innerHTML; }
function clearDashboardData() {
  selectedLead = null;
  selectedRecord = null;
  actionKeys.clear();
  $("#stats").innerHTML = "";
  $("#lead-rows").innerHTML = "";
  $("#lead-detail").innerHTML = '<p class="muted">Choose a lead to view its details.</p>';
  $("#owner-ops").innerHTML = "";
  $("#owner-ops").classList.add("hidden");
  $("#reconciliation").innerHTML = "";
  $("#reconciliation").classList.add("hidden");
}

async function boot() {
  try {
    const result = await api("/api/v1/admin/session");
    staff = result.user;
    show("#dashboard");
    await loadDashboard();
  } catch (error) {
    if (error.code === "MFA_ENROLLMENT_REQUIRED") show("#enroll-panel");
    else show("#login-panel");
  }
}

$("#login-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  $("#login-error").textContent = "";
  const data = new FormData(event.currentTarget);
  try {
    const result = await api("/api/auth/sign-in/email", { method: "POST", body: JSON.stringify({ email: data.get("email"), password: data.get("password") }) });
    if (result.twoFactorRedirect) show("#mfa-panel");
    else await boot();
  } catch { $("#login-error").textContent = "Unable to sign in. Check your credentials and try again."; }
});

$("#mfa-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  $("#mfa-error").textContent = "";
  const code = new FormData(event.currentTarget).get("code");
  try {
    await api("/api/auth/two-factor/verify-totp", { method: "POST", body: JSON.stringify({ code, trustDevice: false }) });
    await boot();
  } catch {
    try {
      await api("/api/auth/two-factor/verify-backup-code", { method: "POST", body: JSON.stringify({ code, trustDevice: false }) });
      await boot();
    } catch { $("#mfa-error").textContent = "The code was not accepted."; }
  }
});

$("#enroll-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  $("#enroll-error").textContent = "";
  const password = new FormData(event.currentTarget).get("password");
  try {
    const result = await api("/api/auth/two-factor/enable", { method: "POST", body: JSON.stringify({ password, method: "totp", issuer: "Veridian Global Advisors" }) });
    $("#enroll-details").textContent = `Authenticator URI:\n${result.totpURI}\n\nRecovery codes (store securely):\n${result.backupCodes.join("\n")}`;
    $("#enroll-details").classList.remove("hidden");
    $("#enroll-verify-form").classList.remove("hidden");
  } catch (error) { $("#enroll-error").textContent = error.message; }
});

$("#enroll-verify-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    await api("/api/auth/two-factor/verify-totp", { method: "POST", body: JSON.stringify({ code: new FormData(event.currentTarget).get("code") }) });
    await boot();
  } catch (error) { $("#enroll-error").textContent = error.message; }
});

$("#logout").addEventListener("click", async () => {
  await api("/api/auth/sign-out", { method: "POST", body: "{}" }).catch(() => {});
  staff = null;
  latestPrivacyRequestId = "";
  deepLinkHandled = false;
  document.location.hash = "";
  clearDashboardData();
  document.querySelectorAll("input").forEach((input) => { input.value = ""; });
  show("#login-panel");
});

async function loadDashboard(search = "") {
  $("#global-error").textContent = "";
  $("#staff-summary").textContent = `${staff.name} · ${staff.role}`;
  $("#lead-rows").innerHTML = '<tr><td colspan="4" class="muted">Loading leads…</td></tr>';
  try {
    const [stats, leads] = await Promise.all([
      api("/api/v1/admin/leads/stats"),
      api(`/api/v1/admin/leads?pageSize=50&search=${encodeURIComponent(search)}`)
    ]);
    $("#stats").innerHTML = stats.counts.map((item) => `<div class="stat"><strong>${item.count}</strong><span>${escapeText(item.pipeline_stage.replaceAll("_", " "))}</span></div>`).join("");
    $("#lead-rows").innerHTML = leads.data.map((lead) => `<tr data-id="${lead.id}" tabindex="0"><td>${escapeText(lead.full_name)}</td><td>${escapeText(lead.tier_interest)}</td><td><span class="badge">${escapeText(lead.pipeline_stage)}</span></td><td>${formatDate(lead.updated_at)}</td></tr>`).join("");
    $("#empty-leads").classList.toggle("hidden", leads.data.length > 0);
    $("#lead-rows").querySelectorAll("tr").forEach((row) => {
      const open = () => loadLead(row.dataset.id);
      row.addEventListener("click", open);
      row.addEventListener("keydown", (event) => { if (event.key === "Enter") open(); });
    });
    if (staff.role !== "VIEWER") await loadReconciliation();
    if (staff.role === "OWNER") await loadOwnerOps();
    const [targetType, targetId] = document.location.hash.slice(1).split("=");
    if (!deepLinkHandled && targetType === "lead" && /^[0-9a-f-]{36}$/i.test(targetId)) { deepLinkHandled = true; await loadLead(targetId); }
    if (!deepLinkHandled && targetType === "enquiry" && /^[0-9a-f-]{36}$/i.test(targetId)) { deepLinkHandled = true; document.querySelector(`[data-enquiry-id="${targetId}"]`)?.scrollIntoView({ block: "center" }); }
  } catch (error) {
    if (error.status === 401) return show("#login-panel");
    $("#global-error").textContent = error.status === 503 ? "The service is temporarily unavailable." : error.message;
  }
}

function renderLeadActions(lead, engagement, result) {
  const qualification = result.qualifications?.[0];
  const engagementSummary = engagement ? `<p><strong>Current engagement:</strong> ${escapeText(engagement.package_code)} · ${escapeText(engagement.state)} · v${engagement.version}</p>` : "";
  return `<div class="action-stack">
    <details><summary>Notes and outreach</summary>
      <form data-action="note"><label>Add private note<textarea name="note" maxlength="5000" required></textarea></label><button class="button small">Add note</button></form>
      <form data-action="prevet"><p>Send the approved five-question service-fit email.</p><button class="button small">Previewed — queue pre-vetting</button></form>
      <form data-action="followup"><label>Subject<input name="subject" maxlength="140" required></label><label>Message<textarea name="message" maxlength="5000" required></textarea></label><label><input name="previewAccepted" type="checkbox" required> I reviewed the recipient and message.</label><button class="button small">Queue follow-up</button></form>
    </details>
    <details><summary>Qualification</summary>
      <form data-action="qualification"><label>Citizenship / residence<input name="citizenshipResidence" required value="${escapeText(qualification?.citizenship_residence || "")}"></label><label>Approximate net worth<select name="approximateNetWorthRange"><option>USD_1M_5M</option><option>USD_5M_20M</option><option>USD_20M_PLUS</option></select></label><label>Source of funds category<input name="sourceOfFundsCategory" required value="${escapeText(qualification?.source_of_funds_category || "")}"></label><label>Service timing<input name="requestedServiceTiming" required value="${escapeText(qualification?.requested_service_timing || "")}"></label><label>Preferred tier<select name="preferredTier"><option>FOUNDATION</option><option>ACCELERATED</option><option>EXECUTIVE</option><option>NOT_SURE</option></select></label><label>Reply received<input name="receivedAt" type="datetime-local" required></label><label>Restricted notes<textarea name="restrictedNotes" maxlength="5000"></textarea></label><button class="button small">Record summary</button></form>
      <form data-action="qualification-review"><label>Decision<select name="decision"><option>QUALIFIED</option><option>REJECTED</option></select></label><label>Service-fit reason<textarea name="serviceFitReason" maxlength="1000" required></textarea></label><button class="button small">Confirm human decision</button></form>
    </details>
    <details><summary>Engagement and onboarding</summary>${engagementSummary}
      <form data-action="engagement-create"><label>Package<select name="packageCode"><option>FOUNDATION</option><option>ACCELERATED</option><option>EXECUTIVE</option></select></label><label>Quote, minor units<input name="quoteMinor" type="number" min="1" required></label><label>Currency<input name="currency" value="USD" pattern="[A-Z]{3}" required></label><label><input name="paymentRequired" type="checkbox" checked> Payment required before conversion</label><button class="button small">Create draft</button></form>
      ${engagement ? `<form data-action="document" enctype="multipart/form-data"><label>PDF document<input name="document" type="file" accept="application/pdf" required></label><label>Document type<select name="type"><option>ENGAGEMENT</option><option>SIGNED_ENGAGEMENT</option></select></label><button class="button small">Upload and scan</button></form><form data-action="engagement-send"><p>Send the approved current engagement PDF.</p><button class="button small">Previewed — queue engagement</button></form><form data-action="signature"><label>Signed at<input name="signedAt" type="datetime-local" required></label><label>Evidence type<select name="evidenceType"><option>EXTERNAL_RECORD</option><option>SIGNED_PDF</option></select></label><label>Evidence reference<input name="evidenceReference" required></label><label>Signed document ID<input name="signedDocumentId" placeholder="Required for SIGNED_PDF"></label><button class="button small">Record signature</button></form><form data-action="payment"><label>Amount, minor units<input name="amountMinor" type="number" min="1" required></label><label>Currency<input name="currency" value="USD" pattern="[A-Z]{3}" required></label><label>Confirmed at<input name="externallyConfirmedAt" type="datetime-local" required></label><label>External reference<input name="externalReference" required></label><button class="button small">Record external payment</button></form>` : ""}
      <form data-action="convert"><p>Conversion requires a signed engagement and any required payment.</p><button class="button small">Complete onboarding</button></form>
    </details>
    ${staff.role === "OWNER" ? `<details><summary>Privacy request</summary><form data-action="privacy-create"><label>Request type<select name="type"><option>ARCHIVE</option><option>COMMUNICATION_WITHDRAWAL</option><option>EXPORT</option><option>ERASURE</option></select></label><label>Requester reference<input name="requesterReference" minlength="3" required></label><button class="button small">Record request</button></form></details>` : ""}
    <form data-action="archive"><label>Reason<input name="reason" required value="Operational archive"></label><button class="button secondary small">${lead.archived_at ? "Restore" : "Archive"}</button></form>
  </div>`;
}

async function loadLead(id) {
  $("#lead-detail").innerHTML = '<p class="muted">Loading lead…</p>';
  try {
    const result = await api(`/api/v1/admin/leads/${id}`);
    selectedLead = result.lead;
    selectedRecord = result;
    const lead = result.lead;
    const engagement = result.engagements?.[0];
    const actions = staff.role === "VIEWER" ? "" : renderLeadActions(lead, engagement, result);
    const documents = result.documents?.length ? `<details><summary>Documents (${result.documents.length})</summary>${result.documents.map((item) => `<div class="record-row"><span>${escapeText(item.type)} · ${escapeText(item.state)} · v${item.version}</span>${item.state === "APPROVED" ? `<button class="link-button" data-download="${item.id}">Download</button>` : ""}</div>`).join("")}</details>` : "";
    const communications = result.communications?.length ? `<details><summary>Communications (${result.communications.length})</summary>${result.communications.map((item) => `<div class="record-row"><span><strong>${escapeText(item.template)}</strong> · ${escapeText(item.state)}</span>${["QUEUED", "RETRY_SCHEDULED"].includes(item.state) ? `<button class="link-button" data-message-action="cancel" data-id="${item.id}">Cancel</button>` : ""}${item.state === "FAILED" ? `<button class="link-button" data-message-action="retry" data-id="${item.id}">Retry</button>` : ""}</div>`).join("")}</details>` : "";
    $("#lead-detail").innerHTML = `<p class="eyebrow">Lead detail</p><h2>${escapeText(lead.full_name)}</h2><dl><dt>Stage</dt><dd>${escapeText(lead.pipeline_stage)}</dd><dt>Email</dt><dd>${escapeText(lead.email || "Restricted")}</dd><dt>Country</dt><dd>${escapeText(lead.country)}</dd><dt>Tier</dt><dd>${escapeText(lead.tier_interest)}</dd><dt>Version</dt><dd>${lead.version}</dd></dl>${result.timeline ? `<h3>Timeline</h3><ol class="timeline">${result.timeline.slice(0, 8).map((item) => `<li><strong>${escapeText(item.to_stage)}</strong><br>${formatDate(item.occurred_at)} · ${escapeText(item.reason)}</li>`).join("")}</ol>` : ""}${documents}${communications}${actions}<div class="error" id="detail-error" role="alert"></div>`;
    $("#lead-detail").querySelectorAll("form").forEach((form) => form.addEventListener("submit", handleLeadAction));
    $("#lead-detail").querySelectorAll("[data-message-action]").forEach((button) => button.addEventListener("click", handleMessageAction));
    $("#lead-detail").querySelectorAll("[data-download]").forEach((button) => button.addEventListener("click", handleDownload));
  } catch (error) { $("#lead-detail").innerHTML = `<div class="error">${escapeText(error.message)}</div>`; }
}

async function handleLeadAction(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const action = form.dataset.action;
  const errorBox = $("#detail-error");
  const data = new FormData(form);
  const submitButton = form.querySelector("button[type=submit], button:not([type])");
  if (submitButton) submitButton.disabled = true;
  errorBox.textContent = "";
  try {
    if (action === "note") await api(`/api/v1/admin/leads/${selectedLead.id}/notes`, { method: "POST", body: JSON.stringify({ note: data.get("note") }) });
    if (action === "prevet") await idempotentApi(`/api/v1/admin/leads/${selectedLead.id}/pre-vetting/send`, { expectedVersion: selectedLead.version, previewAccepted: true });
    if (action === "followup") await idempotentApi(`/api/v1/admin/leads/${selectedLead.id}/follow-ups`, { expectedVersion: selectedLead.version, subject: data.get("subject"), message: data.get("message"), previewAccepted: data.get("previewAccepted") === "on" });
    if (action === "qualification") await api(`/api/v1/admin/leads/${selectedLead.id}/qualification`, { method: "PUT", body: JSON.stringify({ expectedVersion: selectedLead.version, citizenshipResidence: data.get("citizenshipResidence"), approximateNetWorthRange: data.get("approximateNetWorthRange"), sourceOfFundsCategory: data.get("sourceOfFundsCategory"), requestedServiceTiming: data.get("requestedServiceTiming"), preferredTier: data.get("preferredTier"), receivedAt: new Date(data.get("receivedAt")).toISOString(), restrictedNotes: data.get("restrictedNotes") || undefined }) });
    if (action === "qualification-review") await api(`/api/v1/admin/leads/${selectedLead.id}/qualification/review`, { method: "POST", body: JSON.stringify({ expectedVersion: selectedLead.version, decision: data.get("decision"), serviceFitReason: data.get("serviceFitReason") }) });
    if (action === "engagement-create") await api(`/api/v1/admin/leads/${selectedLead.id}/engagements`, { method: "POST", body: JSON.stringify({ expectedVersion: selectedLead.version, packageCode: data.get("packageCode"), quoteMinor: Number(data.get("quoteMinor")), currency: data.get("currency"), paymentRequired: data.get("paymentRequired") === "on" }) });
    const engagement = selectedRecord.engagements?.[0];
    if (action === "document") { data.set("expectedVersion", String(engagement.version)); await api(`/api/v1/admin/engagements/${engagement.id}/document`, { method: "POST", body: data }); }
    if (action === "engagement-send") await idempotentApi(`/api/v1/admin/engagements/${engagement.id}/send`, { expectedVersion: engagement.version, previewAccepted: true });
    if (action === "signature") await api(`/api/v1/admin/engagements/${engagement.id}/record-signature`, { method: "POST", body: JSON.stringify({ expectedVersion: engagement.version, signedAt: new Date(data.get("signedAt")).toISOString(), evidenceType: data.get("evidenceType"), evidenceReference: data.get("evidenceReference"), ...(data.get("signedDocumentId") ? { signedDocumentId: data.get("signedDocumentId") } : {}) }) });
    if (action === "payment") await api(`/api/v1/admin/engagements/${engagement.id}/payments`, { method: "POST", body: JSON.stringify({ expectedVersion: engagement.version, amountMinor: Number(data.get("amountMinor")), currency: data.get("currency"), externallyConfirmedAt: new Date(data.get("externallyConfirmedAt")).toISOString(), externalReference: data.get("externalReference") }) });
    if (action === "convert") await api(`/api/v1/admin/leads/${selectedLead.id}/convert`, { method: "POST", body: JSON.stringify({ expectedVersion: selectedLead.version }) });
    if (action === "privacy-create") {
      const created = await api("/api/v1/admin/privacy-requests", { method: "POST", body: JSON.stringify({ leadId: selectedLead.id, type: data.get("type"), requesterReference: data.get("requesterReference") }) });
      latestPrivacyRequestId = created.privacyRequest.id;
    }
    if (action === "archive") await api(`/api/v1/admin/leads/${selectedLead.id}/${selectedLead.archived_at ? "restore" : "archive"}`, { method: "POST", body: JSON.stringify({ expectedVersion: selectedLead.version, reason: data.get("reason") }) });
    const selectedId = selectedLead.id;
    await loadDashboard();
    await loadLead(selectedId);
  } catch (error) {
    if (error.status === 409) {
      const selectedId = selectedLead.id;
      await loadLead(selectedId);
      restoreFormData(action, data);
      $("#detail-error").textContent = `${error.message} Fresh server data is shown; your entered text values remain for review.`;
    } else errorBox.textContent = error.message;
  } finally {
    if (submitButton?.isConnected) submitButton.disabled = false;
  }
}

function restoreFormData(action, data) {
  const form = $("#lead-detail").querySelector(`[data-action="${action}"]`);
  if (!form) return;
  for (const [name, value] of data.entries()) {
    const field = form.elements.namedItem(name);
    if (!field || field.type === "file") continue;
    if (field.type === "checkbox") field.checked = value === "on";
    else field.value = value;
  }
}

async function loadReconciliation() {
  const panel = $("#reconciliation");
  const enquiries = await api("/api/v1/admin/enquiries");
  panel.classList.toggle("hidden", enquiries.data.length === 0);
  panel.innerHTML = enquiries.data.length ? `<p class="eyebrow">Reconciliation queue</p><h2>Repeat enquiries</h2><p class="muted">Choose an existing candidate record; enquiry snapshots never overwrite lead data.</p>${enquiries.data.map((item) => `<div class="record-row" data-enquiry-id="${item.id}"><span>${escapeText(item.full_name)} · ${formatDate(item.submitted_at)}</span><form data-reconcile="${item.id}"><label>Candidate lead<select name="leadId">${item.candidate_lead_ids.map((id) => `<option>${id}</option>`).join("")}</select></label><button class="button small">Reconcile</button></form></div>`).join("")}<div id="reconcile-error" class="error" role="alert"></div>` : "";
  panel.querySelectorAll("[data-reconcile]").forEach((form) => form.addEventListener("submit", handleReconciliation));
}

async function handleReconciliation(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const leadId = new FormData(form).get("leadId");
  const button = form.querySelector("button");
  button.disabled = true;
  try {
    const lead = await api(`/api/v1/admin/leads/${leadId}`);
    await api(`/api/v1/admin/enquiries/${form.dataset.reconcile}/reconcile`, { method: "POST", body: JSON.stringify({ leadId, expectedVersion: lead.lead.version }) });
    await loadReconciliation();
  } catch (error) { $("#reconcile-error").textContent = error.message; }
  finally { if (button.isConnected) button.disabled = false; }
}

async function handleMessageAction(event) {
  try {
    const button = event.currentTarget;
    await api(`/api/v1/admin/communications/${button.dataset.id}/${button.dataset.messageAction}`, { method: "POST", body: "{}" });
    await loadLead(selectedLead.id);
  } catch (error) { $("#detail-error").textContent = error.message; }
}

async function handleDownload(event) {
  try {
    const result = await api(`/api/v1/admin/documents/${event.currentTarget.dataset.download}/download`);
    document.location.assign(result.url);
  } catch (error) { $("#detail-error").textContent = error.message; }
}

async function loadOwnerOps() {
  const panel = $("#owner-ops");
  panel.classList.remove("hidden");
  const [health, staffList] = await Promise.all([api("/api/v1/admin/email/health"), api("/api/v1/admin/staff")]);
  panel.innerHTML = `<p class="eyebrow">Owner operations</p><div class="owner-grid"><div><h2>Email delivery</h2><p>Provider: ${escapeText(health.provider)} · ${health.configured ? "configured" : "not configured"}</p><ul class="compact-list">${health.queues.map((item) => `<li>${escapeText(item.state)}: ${item.count}</li>`).join("") || "<li>Queue empty</li>"}</ul><form data-owner-action="email-test"><button class="button small">Queue configuration test</button></form></div><div><h2>Staff access</h2><ul class="compact-list">${staffList.data.map((item) => `<li>${escapeText(item.name)} · ${escapeText(item.role)}${item.disabled_at ? " · disabled" : ""}${!item.disabled_at && item.id !== staff.id ? ` <button class="link-button" data-disable-staff="${escapeText(item.id)}">Disable</button>` : ""}</li>`).join("")}</ul><form data-owner-action="staff-create"><label>Name<input name="name" required></label><label>Email<input name="email" type="email" required></label><label>Temporary password<input name="password" type="password" minlength="12" required></label><label>Role<select name="role"><option>ADVISOR</option><option>VIEWER</option><option>OWNER</option></select></label><button class="button small">Provision staff</button></form></div></div><details><summary>Privacy review and execution</summary><form data-owner-action="privacy-review"><label>Request ID<input id="privacy-request-id" name="requestId" value="${escapeText(latestPrivacyRequestId)}" required></label><label>Identity evidence<textarea name="reviewEvidence" minlength="3" maxlength="1000" required></textarea></label><label>Optional hold until<input name="holdUntil" type="datetime-local"></label><label><input name="identityVerified" type="checkbox" required> Identity verification is complete.</label><button class="button small">Approve review</button></form><form data-owner-action="privacy-execute"><label>Reviewed request ID<input name="requestId" value="${escapeText(latestPrivacyRequestId)}" required></label><label><input name="confirm" type="checkbox" required> Execute this reviewed privacy request.</label><button class="button secondary small">Execute request</button></form></details><div id="owner-error" class="error" role="alert"></div>`;
  panel.querySelectorAll("form").forEach((form) => form.addEventListener("submit", handleOwnerAction));
  panel.querySelectorAll("[data-disable-staff]").forEach((button) => button.addEventListener("click", async () => {
    try { await api(`/api/v1/admin/staff/${button.dataset.disableStaff}/disable`, { method: "POST", body: "{}" }); await loadOwnerOps(); }
    catch (error) { $("#owner-error").textContent = error.message; }
  }));
}

async function handleOwnerAction(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const data = new FormData(form);
  const action = form.dataset.ownerAction;
  $("#owner-error").textContent = "";
  try {
    if (action === "email-test") await idempotentApi("/api/v1/admin/email/test", {});
    if (action === "staff-create") await api("/api/v1/admin/staff", { method: "POST", body: JSON.stringify({ name: data.get("name"), email: data.get("email"), password: data.get("password"), role: data.get("role") }) });
    if (action === "privacy-review") await api(`/api/v1/admin/privacy-requests/${data.get("requestId")}/review`, { method: "POST", body: JSON.stringify({ identityVerified: data.get("identityVerified") === "on", reviewEvidence: data.get("reviewEvidence"), ...(data.get("holdUntil") ? { holdUntil: new Date(data.get("holdUntil")).toISOString() } : {}) }) });
    if (action === "privacy-execute") {
      const result = await api(`/api/v1/admin/privacy-requests/${data.get("requestId")}/execute`, { method: "POST", body: "{}" });
      if (result.export?.downloadPath) document.location.assign(result.export.downloadPath);
    }
    form.reset();
    await loadOwnerOps();
  } catch (error) { $("#owner-error").textContent = error.message; }
}

$("#search-form").addEventListener("submit", (event) => { event.preventDefault(); loadDashboard(new FormData(event.currentTarget).get("search")); });
$("#refresh").addEventListener("click", () => loadDashboard());
boot();
