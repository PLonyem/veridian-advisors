import type { PoolClient } from "pg";

export async function audit(client: PoolClient, input: {
  actorId?: string;
  actorType: "STAFF" | "PUBLIC" | "SYSTEM";
  action: string;
  targetType: string;
  targetId: string;
  requestId: string;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  await client.query(
    `insert into audit_events (actor_id,actor_type,action,target_type,target_id,request_id,metadata)
     values ($1,$2,$3,$4,$5,$6,$7)`,
    [input.actorId ?? null, input.actorType, input.action, input.targetType, input.targetId, input.requestId, JSON.stringify(input.metadata ?? {})]
  );
}
