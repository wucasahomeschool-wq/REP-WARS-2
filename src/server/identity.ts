import { IncomingMessage } from 'node:http';

export class BadRequestError extends Error {
  constructor(message: string) { super(message); this.name = 'BadRequestError'; }
}

/** The trusted adapter validates credentials and maps them to a durable game player.
 * It must not resolve identity from request JSON. Honor the optional cancellation
 * signal and enforce bounded I/O; synchronous blocking cannot be preempted. No provider is selected here. */
export type AuthenticatePlayer = (request: IncomingMessage, signal?: AbortSignal) => Promise<string | null> | string | null;
export type IdentityBoundary =
  | { mode: 'authenticated'; authenticate?: AuthenticatePlayer }
  | { mode: 'development' };
export type IdentityResult = { ok: true; playerId: string } | {
  ok: false; status: 401 | 403 | 503;
  error: 'UNAUTHENTICATED' | 'IDENTITY_MISMATCH' | 'AUTHENTICATION_UNAVAILABLE';
};

export function validateIdentityBoundary(boundary: IdentityBoundary): void {
  if (boundary.mode !== 'authenticated' && boundary.mode !== 'development') throw new Error('Invalid identity mode');
  if (boundary.mode === 'development' && process.env.NODE_ENV === 'production') {
    throw new Error('Development identity is forbidden in production');
  }
}

/** Missing provider fails closed. Provider exceptions never become public diagnostics. */
export async function resolvePlayerId(request: IncomingMessage, body: { playerId?: unknown }, boundary: IdentityBoundary): Promise<IdentityResult> {
  if (boundary.mode === 'development') {
    if (process.env.NODE_ENV === 'production') return { ok: false, status: 503, error: 'AUTHENTICATION_UNAVAILABLE' };
    if (typeof body.playerId !== 'string' || !body.playerId.trim()) throw new BadRequestError('playerId must be a non-empty string');
    return { ok: true, playerId: body.playerId };
  }
  if (!boundary.authenticate) return { ok: false, status: 503, error: 'AUTHENTICATION_UNAVAILABLE' };
  let playerId: string | null;
  try { playerId = await boundary.authenticate(request); }
  catch { return { ok: false, status: 503, error: 'AUTHENTICATION_UNAVAILABLE' }; }
  if (typeof playerId !== 'string' || !playerId.trim()) return { ok: false, status: 401, error: 'UNAUTHENTICATED' };
  if (body.playerId !== undefined && body.playerId !== playerId) return { ok: false, status: 403, error: 'IDENTITY_MISMATCH' };
  return { ok: true, playerId };
}
