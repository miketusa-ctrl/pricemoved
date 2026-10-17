import type { Env } from "./env";
import { nowIso, uid } from "./env";

export async function saveDryRun(
  env: Env,
  kind: string,
  payload: unknown,
  ref: string | null = null
): Promise<string> {
  const id = uid("dry");
  const body = JSON.stringify(payload, null, 2);
  await env.DB.prepare(
    "INSERT INTO dry_run_artifacts (id, kind, ref, payload, created_at) VALUES (?, ?, ?, ?, ?)"
  )
    .bind(id, kind, ref, body, nowIso())
    .run();
  try {
    // Best-effort host write; Worker local sandbox often blocks node:fs.
    // @ts-expect-error local node fs
    const fs = await import("node:fs/promises");
    const dir = `${env.DRY_RUN_DIR}/${kind}`;
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(`${dir}/${id}.json`, body, "utf8");
    await fs.writeFile(`${dir}/LATEST.json`, body, "utf8");
  } catch {
    /* D1 is source of truth */
  }
  return id;
}

export async function latestDryRun(env: Env, kind: string): Promise<unknown | null> {
  const row = await env.DB.prepare(
    "SELECT payload FROM dry_run_artifacts WHERE kind = ? ORDER BY created_at DESC LIMIT 1"
  )
    .bind(kind)
    .first<{ payload: string }>();
  return row ? JSON.parse(row.payload) : null;
}
