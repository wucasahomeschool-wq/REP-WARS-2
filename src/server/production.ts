import { Server } from 'node:http';
import { DependencyLimits } from './dependencyBudget';
import { AuthenticatePlayer } from './identity';
import { createCommandHttpServer, InternalErrorReporter } from './http';
import { createSupabasePersistence } from './persistencePort';
import { createSessionHost } from './session';
import { aiInvasionFixtureMode } from './aiInvasionFixture';
import { readSupabaseServerConfig } from '../persistence/supabase/config';

/** Deployment composition point. The approved identity provider must verify its
 * own credentials; this module never selects one or falls back to body identity
 * or memory persistence. Construction does not listen or deploy anything. */
export function createProductionHttpServer(options: {
  authenticate: AuthenticatePlayer;
  readiness: (signal?: AbortSignal) => boolean | Promise<boolean>;
  authenticationLimits?: DependencyLimits;
  readinessLimits?: DependencyLimits;
  onInternalError?: InternalErrorReporter;
  maxCachedPlayers?: number;
  maxPendingRequests?: number;
  maxPendingRequestsPerPlayer?: number;
  maxCatchUpChunks?: number;
}): Server {
  if (typeof options.authenticate !== 'function' || typeof options.readiness !== 'function') {
    throw new Error('Production requires trusted identity and dependency-readiness adapters');
  }
  if (aiInvasionFixtureMode()) throw new Error('AI invasion fixtures are forbidden in production');
  // The adapters defer configuration until I/O; production must reject a broken
  // configuration before returning a server that could claim readiness.
  readSupabaseServerConfig();
  const persistence = createSupabasePersistence();
  return createCommandHttpServer(createSessionHost(persistence, {
    maxCachedPlayers: options.maxCachedPlayers,
    maxPendingRequests: options.maxPendingRequests,
    maxPendingRequestsPerPlayer: options.maxPendingRequestsPerPlayer,
    maxCatchUpChunks: options.maxCatchUpChunks,
  }), {
    identity: { mode: 'authenticated', authenticate: options.authenticate },
    readiness: options.readiness, onInternalError: options.onInternalError,
    authenticationLimits: options.authenticationLimits, readinessLimits: options.readinessLimits,
  });
}
