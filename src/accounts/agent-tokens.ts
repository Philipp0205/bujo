import crypto from "node:crypto";
import { hashSecret } from "../app-kit/auth-code.ts";
import type { Db } from "../db.ts";

export const AGENT_TOKEN_PREFIX = "bujo_";
export const AGENT_NAME_MAX = 40;
export const MAX_AGENT_TOKENS = 10;
/** last_used_at is rewritten at most this often per token. */
export const AGENT_TOUCH_MS = 60_000;

export type AgentScope = "read" | "write";

const SHAPE = /^bujo_[A-Za-z0-9_-]{43}$/;

export type AgentToken = {
  id: string;
  userId: string;
  scope: AgentScope;
};

export type AgentTokenInfo = {
  id: string;
  name: string;
  tokenPrefix: string;
  scope: AgentScope;
  createdAt: number;
  lastUsedAt: number | null;
};

export function isAgentTokenShape(token: string): boolean {
  return SHAPE.test(token);
}

/** The live token behind a plain token string, or undefined for unknown, revoked or malformed ones. */
export function findAgentToken(db: Db, token: string, now: number): AgentToken | undefined {
  if (!isAgentTokenShape(token)) return undefined;
  const row = db
    .prepare("SELECT id, user_id, scope, last_used_at FROM agent_tokens WHERE token_hash = ? AND revoked_at IS NULL")
    .get(hashSecret(token)) as { id: string; user_id: string; scope: AgentScope; last_used_at: number | null } | undefined;
  if (!row) return undefined;
  if (row.last_used_at === null || now - row.last_used_at > AGENT_TOUCH_MS) {
    db.prepare("UPDATE agent_tokens SET last_used_at = ? WHERE id = ?").run(now, row.id);
  }
  return { id: row.id, userId: row.user_id, scope: row.scope };
}

export class AgentTokenLimitError extends Error {
  constructor() {
    super(`You already have ${MAX_AGENT_TOKENS} agent tokens. Revoke one first.`);
    this.name = "AgentTokenLimitError";
  }
}

/** The plain token is in the result once. Only its hash and a short display prefix are stored. */
export function issueAgentToken(
  db: Db,
  userId: string,
  input: { name: string; scope: AgentScope },
  now: number,
): AgentTokenInfo & { token: string } {
  const live = db
    .prepare("SELECT COUNT(*) AS n FROM agent_tokens WHERE user_id = ? AND revoked_at IS NULL")
    .get(userId) as { n: number };
  if (Number(live.n) >= MAX_AGENT_TOKENS) throw new AgentTokenLimitError();
  const token = AGENT_TOKEN_PREFIX + crypto.randomBytes(32).toString("base64url");
  const id = crypto.randomUUID();
  const tokenPrefix = token.slice(0, 9);
  db.prepare(
    "INSERT INTO agent_tokens (id, user_id, name, token_hash, token_prefix, scope, created_at, last_used_at, revoked_at) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL)",
  ).run(id, userId, input.name, hashSecret(token), tokenPrefix, input.scope, now);
  return { id, name: input.name, tokenPrefix, scope: input.scope, createdAt: now, lastUsedAt: null, token };
}

/** Live tokens only, newest first. A revoked token is not listed. */
export function listAgentTokens(db: Db, userId: string): AgentTokenInfo[] {
  const rows = db
    .prepare(
      "SELECT id, name, token_prefix, scope, created_at, last_used_at FROM agent_tokens WHERE user_id = ? AND revoked_at IS NULL ORDER BY created_at DESC, id",
    )
    .all(userId) as Array<{
    id: string;
    name: string;
    token_prefix: string;
    scope: AgentScope;
    created_at: number;
    last_used_at: number | null;
  }>;
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    tokenPrefix: row.token_prefix,
    scope: row.scope,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
  }));
}

/**
 * Marks the token revoked. Revoking twice is fine. False only when the id is not this person's token.
 * The row stays (revoked_at is set), so nothing is deleted and a revoked token can never match again.
 */
export function revokeAgentToken(db: Db, userId: string, id: string, now: number): boolean {
  const owned = db.prepare("SELECT id FROM agent_tokens WHERE id = ? AND user_id = ?").get(id, userId);
  if (!owned) return false;
  db.prepare("UPDATE agent_tokens SET revoked_at = ? WHERE id = ? AND user_id = ? AND revoked_at IS NULL").run(now, id, userId);
  return true;
}
