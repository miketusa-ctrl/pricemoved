export interface ChangeStats {
  lines_added: number;
  lines_removed: number;
  line_similarity: number;
  char_similarity: number;
  changed_line_pct: number;
}

export function unifiedDiff(oldText: string, newText: string, fromFile = "prev", toFile = "now"): string {
  const a = oldText.split("\n");
  const b = newText.split("\n");
  const n = a.length;
  const m = b.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const lines: string[] = [`--- ${fromFile}`, `+++ ${toFile}`];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      lines.push(` ${a[i]}`);
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      lines.push(`-${a[i++]}`);
    } else {
      lines.push(`+${b[j++]}`);
    }
  }
  while (i < n) lines.push(`-${a[i++]}`);
  while (j < m) lines.push(`+${b[j++]}`);
  return excerpt(lines.join("\n"), 200);
}

export function changeStats(oldText: string, newText: string): ChangeStats {
  const a = oldText.split("\n");
  const b = newText.split("\n");
  const counts = new Map<string, number>();
  for (const line of a) counts.set(line, (counts.get(line) || 0) + 1);
  let common = 0;
  for (const line of b) {
    const c = counts.get(line) || 0;
    if (c > 0) {
      common++;
      counts.set(line, c - 1);
    }
  }
  const removed = a.length - common;
  const added = b.length - common;
  const lineSim = a.length + b.length === 0 ? 1 : (2 * common) / (a.length + b.length);
  const maxLen = Math.max(oldText.length, newText.length, 1);
  let same = 0;
  const minLen = Math.min(oldText.length, newText.length);
  for (let i = 0; i < minLen; i += Math.max(1, Math.floor(minLen / 500))) {
    if (oldText[i] === newText[i]) same++;
  }
  const samples = Math.ceil(minLen / Math.max(1, Math.floor(minLen / 500)));
  const charSim = Math.min(1, same / Math.max(samples, 1));
  return {
    lines_added: added,
    lines_removed: removed,
    line_similarity: Math.round(lineSim * 10000) / 10000,
    char_similarity: Math.round(charSim * 10000) / 10000,
    changed_line_pct: Math.round((1000 * (added + removed)) / Math.max(a.length, 1)) / 10,
  };
}

export function isMeaningful(stats: ChangeStats, minChanged = 1, maxSim = 0.995): boolean {
  if (stats.lines_added + stats.lines_removed < minChanged) return false;
  if (stats.char_similarity >= maxSim && stats.lines_added + stats.lines_removed <= 2) return false;
  return true;
}

export function excerpt(diffText: string, maxLines = 60): string {
  const lines = diffText.split("\n");
  if (lines.length <= maxLines) return diffText;
  return lines.slice(0, maxLines).join("\n") + `\n… truncated (${lines.length - maxLines} more lines)`;
}
