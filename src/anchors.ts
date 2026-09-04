export function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function findTextOffset(content: string, needle: string): number {
  if (!needle) return -1;
  const exact = content.indexOf(needle);
  if (exact >= 0) return exact;

  const escaped = escapeRegExp(needle.trim()).replace(/\s+/g, "\\s+");
  const re = new RegExp(escaped, "i");
  const m = re.exec(content);
  return m ? m.index : -1;
}