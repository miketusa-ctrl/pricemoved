export type PlanId = "free" | "starter" | "pro";
export type LaunchMode = "waitlist" | "full";

export interface Env {
  DB: D1Database;
  VERSION: string;
  APP_NAME: string;
  ENVIRONMENT: string; // development | production
  LAUNCH_MODE: string; // waitlist | full — production default: waitlist
  AUTH_MODE: string;
  EMAIL_MODE: string;
  SLACK_MODE: string;
  POLAR_MODE: string;
  DRY_RUN_DIR: string;
  BASE_URL: string;
  // Non-secret operator identity (fill before public deploy)
  OPERATOR_NAME: string;
  CONTACT_EMAIL: string;
  MAILING_ADDRESS?: string; // optional; required before live email
  WEB_ANALYTICS_TOKEN?: string; // optional public Cloudflare Web Analytics site token; empty = no beacon
  // Secrets (.dev.vars / wrangler secret put)
  SESSION_SECRET: string;
  POLAR_WEBHOOK_SECRET?: string;
  POLAR_ACCESS_TOKEN?: string;
  POLAR_STARTER_PRODUCT_ID?: string;
  POLAR_PRO_PRODUCT_ID?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  RESEND_API_KEY?: string;
  POSTMARK_SERVER_TOKEN?: string;
  AI?: Ai;
  // Agent-ready v0.2.0
  VISITOR_SALT?: string; // secret; daily-unique-visitor counting is OFF unless set
  MCP_REGISTRY_AUTH?: string; // PUBLIC registry proof record "v=MCPv1; k=ed25519; p=..."
  MCP_ALLOWED_ORIGINS?: string;
  FLEET_UA_MARKERS?: string;
  CF_VERSION_METADATA?: { id: string; tag?: string; timestamp?: string };
}

export const PLAN_LIMITS: Record<
  PlanId,
  { pages: number; intervals: string[]; slack: boolean; retentionDays: number; maxSnapshots: number }
> = {
  free: { pages: 2, intervals: ["daily"], slack: false, retentionDays: 14, maxSnapshots: 5 },
  starter: { pages: 15, intervals: ["daily", "6h"], slack: false, retentionDays: 60, maxSnapshots: 10 },
  pro: { pages: 50, intervals: ["daily", "6h", "hourly"], slack: true, retentionDays: 90, maxSnapshots: 20 },
};

export function intervalMs(interval: string): number {
  switch (interval) {
    case "hourly":
      return 60 * 60 * 1000;
    case "6h":
      return 6 * 60 * 60 * 1000;
    default:
      return 24 * 60 * 60 * 1000;
  }
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function uid(prefix = ""): string {
  const id = crypto.randomUUID().replace(/-/g, "");
  return prefix ? `${prefix}_${id}` : id;
}

export function isPlanId(v: string): v is PlanId {
  return v === "free" || v === "starter" || v === "pro";
}

export function isDevEnvironment(env: Env): boolean {
  return (env.ENVIRONMENT || "development").toLowerCase() !== "production";
}

export function launchMode(env: Env): LaunchMode {
  return (env.LAUNCH_MODE || "waitlist").toLowerCase() === "full" ? "full" : "waitlist";
}

export function isWaitlistMode(env: Env): boolean {
  return launchMode(env) === "waitlist";
}

export function operatorName(env: Env): string {
  return (env.OPERATOR_NAME || "PriceMoved").trim();
}

export function contactEmail(env: Env): string {
  return (env.CONTACT_EMAIL || "").trim();
}

/** Optional. Empty = not shown on any public page. Required only when email sending starts (full mode). */
export function mailingAddress(env: Env): string {
  return (env.MAILING_ADDRESS || "").trim();
}

/** Email footer path: throws in full mode if the address is missing (CAN-SPAM needs it once we send). */
export function requireMailingAddressForEmail(env: Env): string {
  const a = mailingAddress(env);
  if (!a && launchMode(env) === "full" && env.EMAIL_MODE === "live") {
    throw new Error("MAILING_ADDRESS is required before live email sending");
  }
  return a;
}
