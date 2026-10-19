/** Client-owned line ids. The server only requires unique non-empty strings. */
export function newLineId(): string {
  return `ln_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
}
