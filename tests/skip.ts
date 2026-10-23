/** Explicit skips are not passes. Live tests require an operator-approved test database. */
export class TestSkipped extends Error {}
export function requireLiveSupabase(): void {
  if (process.env.REP_WARS_RUN_LIVE_SUPABASE_TESTS !== 'true') {
    throw new TestSkipped('live Supabase tests require explicit non-production opt-in');
  }
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new TestSkipped('non-production Supabase credentials are not set');
  }
}
