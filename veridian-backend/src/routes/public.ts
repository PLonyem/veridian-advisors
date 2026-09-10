import { Router } from "express";
import { enquirySchema } from "../domain/schemas.js";
import { config } from "../config.js";
import { pool } from "../db/client.js";
import { asyncHandler } from "../http/errors.js";
import { requireJson } from "../http/middleware.js";
import { submitEnquiry } from "../services/intake.js";

export const publicRouter = Router();

publicRouter.get("/v1/public-config", asyncHandler(async (_request, response) => {
  const packages = await pool.query<{ code: string; display_name: string; price_minor: string; currency: string; is_starting_price: boolean }>(
    "select code,display_name,price_minor,currency,is_starting_price from service_packages where active=true order by price_minor"
  );
  response.set("Cache-Control", "no-store").json({
    noticeVersion: config.CURRENT_NOTICE_VERSION,
    communicationPolicy: config.COMMUNICATION_POLICY,
    packages: packages.rows.map((item) => ({
      code: item.code,
      displayName: item.display_name,
      priceMinor: Number(item.price_minor),
      currency: item.currency,
      isStartingPrice: item.is_starting_price
    }))
  });
}));

const handleEnquiry = asyncHandler(async (request, response) => {
  const input = enquirySchema.parse(request.body);
  const result = await submitEnquiry(input, request);
  response.status(202).json(result);
});

publicRouter.post("/v1/enquiries", requireJson, handleEnquiry);
publicRouter.post("/submit-lead", requireJson, handleEnquiry);
