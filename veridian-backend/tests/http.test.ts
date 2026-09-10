import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";

describe("HTTP safety", () => {
  const app = createApp();

  it("exposes minimal liveness", async () => {
    const response = await request(app).get("/health/live").expect(200);
    expect(response.body).toEqual({ status: "live" });
    expect(response.headers["x-powered-by"]).toBeUndefined();
  });

  it("rejects false consent before persistence", async () => {
    const response = await request(app).post("/api/v1/enquiries").set("Content-Type", "application/json").set("Idempotency-Key", "test-key-123456789").send({
      fullName: "Synthetic User", email: "synthetic@example.test", country: "NG", netWorthRange: "$1M-$5M", tierInterest: "Not sure", disclaimerAccepted: false, noticeVersion: "2026-09-01"
    }).expect(400);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("rejects untrusted cookie mutation origins", async () => {
    const response = await request(app).post("/api/auth/sign-in/email").set("Origin", "https://attacker.example").send({ email: "nobody@example.test", password: "not-a-real-password" }).expect(403);
    expect(response.body.error.code).toBe("UNTRUSTED_ORIGIN");
  });
});
