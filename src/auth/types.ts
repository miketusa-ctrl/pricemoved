import type { Env, PlanId } from "../env";

export interface User {
  id: string;
  email: string;
  google_sub: string | null;
  plan: PlanId;
  polar_customer_id: string | null;
  slack_webhook_url: string | null;
  created_at: string;
}

export interface AuthProvider {
  name: string;
  begin(env: Env, request: Request): Promise<Response>;
  complete(env: Env, request: Request): Promise<Response>;
}
