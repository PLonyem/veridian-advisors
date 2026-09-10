import { describe, expect, it } from "vitest";
import { renderTemplate } from "../src/email/templates.js";

describe("email templates", () => {
  it("escapes all caller text", () => {
    const rendered = renderTemplate("FOLLOW_UP", { subject: "Hello\r\nBcc: bad@example.test", message: "<img src=x onerror=alert(1)>" });
    expect(rendered.subject).not.toContain("\n");
    expect(rendered.html).not.toContain("<img");
    expect(rendered.html).toContain("&lt;img");
  });

  it("keeps intake wording accurate", () => {
    const rendered = renderTemplate("ENQUIRY_ACK", { fullName: "Example" });
    expect(rendered.text).toContain("not affiliated with any government");
    expect(rendered.text).not.toContain("24 hours");
    expect(rendered.text).not.toContain("WhatsApp");
  });

  it("rejects links outside configured origins", () => {
    expect(() => renderTemplate("STAFF_NOTIFICATION", { dashboardUrl: "https://attacker.example/admin" })).toThrow("origin");
  });
});
