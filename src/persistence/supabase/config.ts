import { PersistenceError } from '../errors';

export interface SupabaseServerConfig {
  url: string;
  serviceRoleKey: string;
}

/**
 * Backend-only credentials. The service-role key is never returned to Unity
 * and must not be logged.
 */
export function readSupabaseServerConfig(
  env: NodeJS.ProcessEnv = process.env,
): SupabaseServerConfig {
  const url = env.SUPABASE_URL?.trim() ?? '';
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY?.trim() ?? '';
  if (!url || !serviceRoleKey) {
    throw new PersistenceError(
      'persistence.not_configured',
      'Supabase persistence requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY',
    );
  }
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new PersistenceError('persistence.not_configured', 'SUPABASE_URL is not a valid URL');
  }
  if (parsed.protocol !== 'https:') {
    throw new PersistenceError('persistence.not_configured', 'SUPABASE_URL must use https');
  }
  return { url: url.replace(/\/$/, ''), serviceRoleKey };
}
