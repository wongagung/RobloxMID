export async function getModerationStatus(operationId, apiKey) {
  const r = await fetch(`https://apis.roblox.com/assets/v1/operations/${encodeURIComponent(operationId)}`, {
    headers: { "x-api-key": apiKey }
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d?.message || d?.error || `Roblox API HTTP ${r.status}`);
  if (d.error) return { status: "REJECTED", reason: d.error.message || "Operation rejected" };
  if (d.done) return { status: "APPROVED", assetId: d.response?.assetId || d.response?.asset?.assetId || d.response?.id || null };
  return { status: "PROCESSING" };
}
