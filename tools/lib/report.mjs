const MAX_SNIPPET = 120;

export function clip(text) {
  const t = text.trim().replace(/\s+/g, ' ');
  return t.length > MAX_SNIPPET ? `${t.slice(0, MAX_SNIPPET - 3)}...` : t;
}

export function formatFinding(gate, f) {
  let loc = f.file;
  if (f.line) loc += `:${f.line}`;
  if (f.line && f.col) loc += `:${f.col}`;
  return `${loc}  ${gate}/${f.rule}  ${f.message}`;
}

export function sortFindings(findings) {
  return [...findings].sort(
    (a, b) =>
      a.file.localeCompare(b.file) ||
      (a.line ?? 0) - (b.line ?? 0) ||
      (a.col ?? 0) - (b.col ?? 0) ||
      a.rule.localeCompare(b.rule),
  );
}

/** Prints findings and notes for one gate; returns true when the gate passed. */
export function printResult(gate, result, out = process.stdout) {
  for (const f of sortFindings(result.findings)) out.write(`${formatFinding(gate, f)}\n`);
  for (const note of result.notes ?? []) out.write(`${gate}: note: ${note}\n`);
  const ok = result.findings.length === 0;
  const count = result.findings.length;
  out.write(
    ok
      ? `${gate}: pass (${result.scanned} files scanned)\n`
      : `${gate}: FAIL, ${count} finding${count === 1 ? '' : 's'} (${result.scanned} files scanned)\n`,
  );
  return ok;
}
