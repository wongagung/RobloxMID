export async function getRobloxStatus(operationId, key) {
  const r = await fetch(`https://apis.roblox.com/assets/v1/operations/${encodeURIComponent(operationId)}`, {
    headers: { "x-api-key": key }
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d?.message || d?.error || `Roblox API HTTP ${r.status}`);
  return d.error ? "REJECTED" : d.done ? "APPROVED" : "PROCESSING";
}
