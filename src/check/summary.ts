import type { Env } from "../env";
import type { ChangeStats } from "./diff";

export async function summarizeChange(
  env: Env,
  url: string,
  diffText: string,
  stats: ChangeStats
): Promise<{ summary: string; provider: string }> {
  try {
    if (env.AI) {
      const prompt = `In 2-4 sentences, summarize this webpage content change for a SaaS founder watching competitor pricing. URL: ${url}\nStats: ${JSON.stringify(stats)}\nDiff:\n${diffText.slice(0, 3000)}`;
      const result = (await env.AI.run("@cf/meta/llama-3.1-8b-instruct", {
        messages: [{ role: "user", content: prompt }],
      })) as { response?: string };
      if (result?.response) return { summary: result.response.trim(), provider: "workers_ai" };
    }
  } catch {
    /* stub */
  }
  return { summary: stubSummary(url, diffText, stats), provider: "stub" };
}

function stubSummary(url: string, diffText: string, stats: ChangeStats): string {
  const adds: string[] = [];
  const removes: string[] = [];
  for (const line of diffText.split("\n")) {
    if (line.startsWith("+++") || line.startsWith("---") || line.startsWith("@@")) continue;
    if (line.startsWith("+") && adds.length < 4) adds.push(line.slice(1).trim().slice(0, 120));
    else if (line.startsWith("-") && removes.length < 4) removes.push(line.slice(1).trim().slice(0, 120));
  }
  const parts = [
    `We detected a meaningful content change on ${url}.`,
    `About ${stats.lines_added} line(s) added and ${stats.lines_removed} removed (~${stats.changed_line_pct}% of prior lines touched).`,
  ];
  if (removes.length)
    parts.push(`Removed / previous text includes: ${removes.slice(0, 2).map((r) => `“${r}”`).join("; ")}.`);
  if (adds.length) parts.push(`New text includes: ${adds.slice(0, 2).map((a) => `“${a}”`).join("; ")}.`);
  parts.push("Review the diff and decide whether this affects your positioning or pricing response.");
  return parts.join(" ");
}
