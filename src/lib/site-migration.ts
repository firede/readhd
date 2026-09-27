// One-time migration on update: the old `disabledHosts` list (disable-these
// sites) becomes `siteMode: 'blocklist'` + `blockRules`. Runs only when
// `siteMode` was never set, so it is safe to call on every update.

interface SyncArea {
  get(keys: string[]): Promise<Record<string, unknown>>;
  set(values: Record<string, unknown>): Promise<void>;
  remove(keys: string | string[]): Promise<void>;
}

export async function migrateSiteRules(
  sync: SyncArea,
  reason: string,
): Promise<'migrated' | 'skipped' | 'noop'> {
  if (reason !== 'update') return 'noop';
  const raw = await sync.get(['siteMode', 'disabledHosts']);
  if (raw.siteMode != null) return 'skipped';
  const hosts = Array.isArray(raw.disabledHosts)
    ? raw.disabledHosts.filter((h): h is string => typeof h === 'string')
    : [];
  await sync.set({ siteMode: 'blocklist', blockRules: hosts });
  await sync.remove('disabledHosts');
  return 'migrated';
}
