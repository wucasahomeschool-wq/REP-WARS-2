import { IncomingMessage } from 'node:http';

export class BadRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BadRequestError';
  }
}

/**
 * Identity gate for HTTP commands.
 * Today this returns the caller-supplied playerId after a non-empty check.
 * Authentication must resolve the durable Rep Wars playerId here and overwrite
 * CommandRequest.playerId before ensure/execute. Do not mint a second id from
 * an auth user id, and do not let the client choose another player's row.
 */
export function resolvePlayerId(_httpRequest: IncomingMessage, body: { playerId?: unknown }): string {
  const playerId = body.playerId;
  if (typeof playerId !== 'string' || playerId.trim() === '') {
    throw new BadRequestError('playerId must be a non-empty string');
  }
  return playerId;
}
