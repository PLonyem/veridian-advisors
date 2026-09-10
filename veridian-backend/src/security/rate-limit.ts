import type { PoolClient } from "pg";
import { pool } from "../db/client.js";
import { AppError } from "../http/errors.js";

export async function consumeRateLimit(bucketKey: string, maximum: number, windowSeconds: number, client?: PoolClient): Promise<void> {
  const runner = client ?? pool;
  try {
    const result = await runner.query<{ count: number; expires_at: Date }>(
      `insert into rate_limit_buckets (bucket_key,count,window_started_at,expires_at)
       values ($1,1,now(),now()+($2::text || ' seconds')::interval)
       on conflict (bucket_key) do update set
         count=case when rate_limit_buckets.expires_at<=now() then 1 else rate_limit_buckets.count+1 end,
         window_started_at=case when rate_limit_buckets.expires_at<=now() then now() else rate_limit_buckets.window_started_at end,
         expires_at=case when rate_limit_buckets.expires_at<=now() then now()+($2::text || ' seconds')::interval else rate_limit_buckets.expires_at end
       returning count,expires_at`,
      [bucketKey, windowSeconds]
    );
    if ((result.rows[0]?.count ?? maximum + 1) > maximum) throw new AppError(429, "RATE_LIMITED", "Too many requests; try again later");
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(503, "ABUSE_PROTECTION_UNAVAILABLE", "Request protection is temporarily unavailable");
  }
}
