import { randomUUID } from "node:crypto";
import { pool, closeDatabase } from "../db/client.js";

const leadId = randomUUID();
await pool.query(
  `insert into leads (id, full_name, email, normalized_email, country, net_worth_range, tier_interest)
   values ($1, 'Synthetic Example', 'synthetic@example.test', 'synthetic@example.test', 'NG', 'USD_1M_5M', 'NOT_SURE')
   on conflict do nothing`,
  [leadId]
);
process.stdout.write("Synthetic development fixture inserted.\n");
await closeDatabase();
