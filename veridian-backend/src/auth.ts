import { betterAuth } from "better-auth";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { admin, twoFactor } from "better-auth/plugins";
import { config } from "./config.js";
import { db } from "./db/client.js";
import * as authSchema from "./db/auth-schema.js";

export const auth = betterAuth({
  appName: "Veridian Global Advisors",
  baseURL: config.API_BASE_URL,
  basePath: "/api/auth",
  secret: config.BETTER_AUTH_SECRET,
  database: drizzleAdapter(db, { provider: "pg", schema: authSchema }),
  trustedOrigins: config.trustedOrigins,
  emailAndPassword: {
    enabled: true,
    disableSignUp: true,
    minPasswordLength: 12,
    maxPasswordLength: 128,
    resetPasswordTokenExpiresIn: 30 * 60,
    revokeSessionsOnPasswordReset: true,
    sendResetPassword: async ({ user, url }) => {
      const { queueAuthEmail } = await import("./email/auth-email.js");
      await queueAuthEmail({ recipientEmail: user.email, userId: user.id, resetUrl: url });
    }
  },
  session: {
    expiresIn: 60 * 60 * 8,
    updateAge: 60 * 30,
    cookieCache: { enabled: false }
  },
  advanced: {
    cookiePrefix: "veridian",
    useSecureCookies: config.NODE_ENV === "production"
  },
  plugins: [
    twoFactor({
      issuer: "Veridian Global Advisors",
      skipVerificationOnEnable: false,
      accountLockout: { enabled: true, maxFailedAttempts: 5, durationSeconds: 15 * 60 }
    }),
    admin({
      defaultRole: "user",
      adminRoles: ["admin"],
      bannedUserMessage: "Unable to sign in. Contact the account owner."
    })
  ]
});

export async function closeAuthDatabase(): Promise<void> {
  return Promise.resolve();
}
