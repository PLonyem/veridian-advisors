import { describe, expect, it } from "vitest";
import { enquirySchema } from "../src/domain/schemas.js";

const valid = {
  fullName: "Ọlámidé Adeyẹmi",
  email: "Person@Example.com",
  country: "Nigeria",
  netWorthRange: "$1M–$5M",
  tierInterest: "Not sure",
  disclaimerAccepted: true,
  noticeVersion: "2026-09-01",
  marketingConsent: false
};

describe("public enquiry validation", () => {
  it("preserves Unicode and maps display enums", () => {
    const parsed = enquirySchema.parse(valid);
    expect(parsed.fullName).toBe("Ọlámidé Adeyẹmi");
    expect(parsed.email).toBe("person@example.com");
    expect(parsed.netWorthRange).toBe("USD_1M_5M");
    expect(parsed.tierInterest).toBe("NOT_SURE");
  });

  it("requires a literal boolean consent", () => {
    expect(() => enquirySchema.parse({ ...valid, disclaimerAccepted: "true" })).toThrow();
    expect(() => enquirySchema.parse({ ...valid, disclaimerAccepted: false })).toThrow();
  });

  it("rejects unknown and object fields", () => {
    expect(() => enquirySchema.parse({ ...valid, fullName: { trim: true } })).toThrow();
    expect(() => enquirySchema.parse({ ...valid, exactAssets: 10_000_000 })).toThrow();
  });
});
