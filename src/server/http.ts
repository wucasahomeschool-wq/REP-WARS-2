import { IncomingMessage, Server, ServerResponse, createServer } from 'node:http';
import { types } from 'node:util';
import { CommandRequest } from '../orchestration/protocol';
import { BadRequestError, resolvePlayerId, validateIdentityBoundary, IdentityBoundary } from './identity';
import { GameplaySessionReceiptError } from './gameplaySessionLifecycle';
import { CommandNotExposedError, CommandSessionHost, PersistenceFailedError, RequestCapacityError } from './session';
import { ErrorCode, publicOrchestrationError } from '../orchestration/errors';
import { isCommandExposed } from './allowlist';
import { COMMAND_INDEX } from '../orchestration/commandIndex';
import { createDependencyBudget, DependencyLimits } from './dependencyBudget';
import { PERSISTENCE_ERROR_CODES } from '../persistence/errors';

const MAX_BODY_BYTES = 1024 * 1024;
export type InternalErrorReporter = (diagnostic: unknown) => void;

// Trusted: server constants, validated primitive codes and explicitly configured
// reporter callbacks. Thrown values and their properties are untrusted data.
function ownDataValue(value: unknown, key: string): unknown {
  if (!value || typeof value !== 'object' || types.isProxy(value)) return undefined;
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor && 'value' in descriptor ? descriptor.value : undefined;
}

type HttpErrorKind = 'bad_request' | 'receipt' | 'command' | 'persistence' | 'capacity' | 'internal';
function httpErrorKind(value: unknown): HttpErrorKind {
  if (!value || typeof value !== 'object' || types.isProxy(value)) return 'internal';
  // Node's util.types.isProxy is a native, non-trapping detector (also for revoked
  // proxies). Check every link before reflection; never use instanceof on unknown.
  let object: object | null = value;
  for (let depth = 0; object !== null && depth < 8; depth++) {
    if (types.isProxy(object)) return 'internal';
    if (depth > 0) {
      if (object === BadRequestError.prototype) return 'bad_request';
      if (object === GameplaySessionReceiptError.prototype) return 'receipt';
      if (object === CommandNotExposedError.prototype) return 'command';
      if (object === PersistenceFailedError.prototype) return 'persistence';
      if (object === RequestCapacityError.prototype) return 'capacity';
    }
    object = Object.getPrototypeOf(object);
  }
  return 'internal';
}

// Log data, not arbitrary object inspection. Bounds apply to depth, visited
// values, sampled fields and strings. Stack is deliberately never evaluated.
function diagnosticSnapshot(value: unknown, budget = { remaining: 64 }, depth = 0, ancestors = new Set<object>()): unknown {
  if (budget.remaining-- <= 0) return '[truncated]';
  if (typeof value === 'string') return value.length > 1024 ? value.slice(0, 1024) + '[truncated]' : value;
  if (value === null || typeof value === 'boolean' || typeof value === 'number') return value;
  if (typeof value !== 'object') return '[' + typeof value + ']';
  if (types.isProxy(value)) return '[proxy]';
  if (depth >= 4) return '[depth limit]';
  if (ancestors.has(value)) return '[circular]';
  ancestors.add(value);
  try {
    const result: Record<string, unknown> = Object.create(null);
    const array = Array.isArray(value);
    const length = array ? ownDataValue(value, 'length') as number : 0;
    const keys = array ? Array.from({ length: Math.min(length, 12) }, (_, i) => String(i)) : Object.getOwnPropertyNames(value).slice(0, 12);
    for (const key of keys) {
      const outputKey = key.length > 1024 ? key.slice(0, 1024) + '[truncated]' : key;
      if (key === 'stack') { result[outputKey] = '[omitted stack]'; continue; }
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      result[outputKey] = !descriptor ? '[absent]' : 'value' in descriptor
        ? diagnosticSnapshot(descriptor.value, budget, depth + 1, ancestors) : '[accessor]';
    }
    if (array && length > 12) result.truncated = '[truncated]';
    return result;
  } finally {
    ancestors.delete(value);
  }
}

function defaultInternalErrorReporter(diagnostic: unknown): void {
  let snapshot: unknown;
  try { snapshot = diagnosticSnapshot(diagnostic); } catch { snapshot = '[diagnostic unavailable]'; }
  // Only primitive text reaches console formatting: no custom inspection or
  // Error.stack access. Symbol hooks and methods are never copied into snapshots.
  console.error('Internal game request failure', JSON.stringify(snapshot));
}

function reportInternalError(report: InternalErrorReporter, diagnostic: unknown): void {
  // An explicit reporter is a trusted server integration; preserve its existing
  // raw-diagnostic contract. The default reporter uses the bounded snapshot above.
  try { report(diagnostic); } catch { /* Reporter failure cannot replace the response. */ }
}
function sendInternalError(res: ServerResponse, report: InternalErrorReporter, diagnostic: unknown): void {
  reportInternalError(report, diagnostic);
  // Last-resort body is a prototype-free tree of trusted primitive constants.
  sendJson(res, 500, Object.assign(Object.create(null), { error: 'INTERNAL', message: 'Internal server error. Please retry.' }));
}
function sendPersistenceError(res: ServerResponse, report: InternalErrorReporter, err: unknown): void {
  reportInternalError(report, err);
  const candidate = ownDataValue(err, 'code');
  const code = typeof candidate === 'string' && PERSISTENCE_ERROR_CODES.some(c => c === candidate)
    ? candidate : 'persistence.save_failed';
  sendPublicJson(res, 500, { error: 'PERSISTENCE_FAILED', message: 'Unable to save game state. Please retry.', code }, report);
}
function sendCapacityError(res: ServerResponse, report: InternalErrorReporter): void {
  // Expected backpressure. Serialize only constants, never exception properties
  // or queue/player details; do not turn overload into a diagnostic log flood.
  sendPublicJson(res, 503, { error: 'SERVER_BUSY', message: 'Server is busy. Please retry this request.', retryable: true }, report);
}
function sendBadRequest(res: ServerResponse, report: InternalErrorReporter, err: unknown): void {
  const message = ownDataValue(err, 'message');
  if (httpErrorKind(err) !== 'bad_request' || typeof message !== 'string') {
    sendInternalError(res, report, err); return;
  }
  // This explicit public validation contract authorizes its own primitive message.
  sendPublicJson(res, 400, { error: 'BAD_REQUEST', message }, report);
}
/** Inspect inherited data without executing accessors or proxy traps. */
function responseDescriptor(value: object, key: string): PropertyDescriptor | undefined {
  for (let object: object | null = value; object !== null; object = Object.getPrototypeOf(object)) {
    if (types.isProxy(object)) throw new TypeError('Executable HTTP response prototype');
    const descriptor = Object.getOwnPropertyDescriptor(object, key);
    if (descriptor) return descriptor;
  }
  return undefined;
}

/** Normalize outward JSON data before stringify. Never pass the original object
 * through: stringify can invoke toJSON/getters after a raw-object privacy check.
 * DTOs contain data, not executable serialization hooks. Reject those hooks and
 * cycles safely; class/null-prototype own data follows the same recursive path. */
function publicErrorProjection(value: unknown, diagnostics: unknown[], ancestors = new Set<object>()): unknown {
  if (value === null || typeof value !== 'object') {
    if (typeof value === 'bigint') throw new TypeError('Non-JSON HTTP response data');
    if (typeof value === 'function') {
      if (types.isProxy(value)) throw new TypeError('Executable HTTP response representation');
      const hook = responseDescriptor(value, 'toJSON');
      if (hook && (!('value' in hook) || typeof hook.value === 'function')) {
        throw new TypeError('Executable HTTP serialization hook');
      }
      return undefined; // Ordinary function-valued properties are omitted by JSON.
    }
    return typeof value === 'symbol' ? undefined : value;
  }
  // Descriptor reflection must not invoke proxy traps or accessors.
  if (types.isProxy(value)) throw new TypeError('Executable HTTP response representation');
  // Boxed primitives also transform at stringify; DTOs use primitive values.
  if (types.isBoxedPrimitive(value)) throw new TypeError('Non-data HTTP response representation');
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const codeDescriptor = responseDescriptor(value, 'code');
  if (codeDescriptor && !('value' in codeDescriptor)) throw new TypeError('Executable HTTP error code');
  const code: unknown = codeDescriptor?.value;
  const internal = code === ErrorCode.INVALID_GAME_STATE || code === ErrorCode.ENGINE_ERROR;
  const domainError = typeof code === 'string' && Object.values(ErrorCode).some(c => c === code) && !internal;
  if (internal || (types.isNativeError(value) && !domainError)) {
    diagnostics.push(value);
    return Object.assign(Object.create(null), publicOrchestrationError({ code: internal ? code : ErrorCode.ENGINE_ERROR, message: '' }));
  }
  // Inspect serialization hooks, never execute them. A data-only own field may
  // shadow an inherited hook exactly as it would for ordinary JSON lookup.
  const hook = responseDescriptor(value, 'toJSON');
  if (hook && (!('value' in hook) || typeof hook.value === 'function')) {
    throw new TypeError('Executable HTTP serialization hook');
  }
  if (ancestors.has(value)) throw new TypeError('Cyclic HTTP response data');
  ancestors.add(value);
  try {
    const project = (descriptor: PropertyDescriptor): unknown => {
      if (!('value' in descriptor)) throw new TypeError('Executable HTTP response property');
      return publicErrorProjection(descriptor.value, diagnostics, ancestors);
    };
    if (Array.isArray(value)) {
      // A fresh array with no prototype prevents any later inherited JSON hook.
      const array: unknown[] = [];
      Object.setPrototypeOf(array, null);
      const length = descriptors.length.value as number;
      for (let i = 0; i < length; i++) array[i] = descriptors[i] ? project(descriptors[i]) : null;
      return array;
    }
    const result: Record<string, unknown> = Object.create(null);
    if (types.isNativeError(value) && domainError) {
      // Expected Error instances have non-enumerable messages. Keep their useful
      // public fields, never their stack or arbitrary exception implementation.
      result.code = code;
      for (const key of ['message', 'details']) if (descriptors[key]) result[key] = project(descriptors[key]);
    } else {
      for (const [key, descriptor] of Object.entries(descriptors)) {
        if (descriptor.enumerable) result[key] = project(descriptor);
      }
    }
    return result;
  } finally {
    ancestors.delete(value);
  }
}

function sendPublicJson(res: ServerResponse, status: number, body: unknown, report: InternalErrorReporter, correlation?: { commandId: string; requestId?: string }): void {
  const diagnostics: unknown[] = [];
  let publicBody: unknown;
  try {
    publicBody = publicErrorProjection(body, diagnostics);
  } finally {
    // Preserve encountered error diagnostics even if another malformed value
    // subsequently prevents serialization. Reporter failure stays isolated.
    if (diagnostics.length) reportInternalError(report, { ...correlation, errors: diagnostics });
  }
  sendJson(res, status, publicBody);
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  if (typeof payload !== 'string') throw new TypeError('Non-JSON HTTP response body');
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(payload);
}

function pathname(req: IncomingMessage): string {
  const raw = req.url ?? '/';
  try {
    return new URL(raw, 'http://127.0.0.1').pathname;
  } catch {
    return raw;
  }
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const declared = req.headers['content-length'];
    if (declared !== undefined && Number(declared) > MAX_BODY_BYTES) {
      reject(new BadRequestError('Request body exceeds 1 MiB'));
      req.resume();
      return;
    }
    const chunks: Buffer[] = [];
    let size = 0;
    let settled = false;
    const fail = (err: Error): void => {
      if (settled) return;
      settled = true;
      reject(err);
    };
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        fail(new BadRequestError('Request body exceeds 1 MiB'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (settled) return;
      settled = true;
      resolve(Buffer.concat(chunks).toString('utf8'));
    });
    req.on('error', (err) => fail(err));
  });
}

function isJsonContentType(req: IncomingMessage): boolean {
  const header = req.headers['content-type'];
  if (typeof header !== 'string') return false;
  return header.split(';', 1)[0].trim().toLowerCase() === 'application/json';
}

function optionalObject(value: unknown, field: string): Record<string, unknown> | undefined {
  if (value === undefined) return undefined;
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new BadRequestError(`${field} must be an object`);
  }
  return value as Record<string, unknown>;
}

function commandFromBody(playerId: string, parsed: unknown): CommandRequest {
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new BadRequestError('Request body must be a JSON object');
  }
  const body = parsed as Record<string, unknown>;
  if (typeof body.commandId !== 'string' || body.commandId.trim() === '') {
    throw new BadRequestError('commandId must be a non-empty string');
  }
  if (body.timestamp !== undefined && typeof body.timestamp !== 'number') {
    throw new BadRequestError('timestamp must be a number');
  }
  if (body.requestId !== undefined && typeof body.requestId !== 'string') {
    throw new BadRequestError('requestId must be a string');
  }
  if (body.gameplaySessionId !== undefined && typeof body.gameplaySessionId !== 'string') {
    throw new BadRequestError('gameplaySessionId must be a string');
  }
  if (body.renewalSequence !== undefined && typeof body.renewalSequence !== 'number') {
    throw new BadRequestError('renewalSequence must be a positive safe integer');
  }
  if (body.commandSequence !== undefined && typeof body.commandSequence !== 'number') {
    throw new BadRequestError('commandSequence must be a positive safe integer');
  }
  return {
    commandId: body.commandId,
    playerId,
    timestamp: body.timestamp as number | undefined,
    parameters: optionalObject(body.parameters, 'parameters'),
    clientContext: optionalObject(body.clientContext, 'clientContext'),
    requestId: body.requestId as string | undefined,
    gameplaySessionId: body.gameplaySessionId as string | undefined,
    renewalSequence: body.renewalSequence as number | undefined,
    commandSequence: body.commandSequence as number | undefined,
  };
}

async function readJsonObject(req: IncomingMessage): Promise<Record<string, unknown>> {
  if (!isJsonContentType(req)) {
    throw new BadRequestError('Content-Type must be application/json');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readBody(req));
  } catch (err) {
    if (httpErrorKind(err) === 'bad_request') throw err;
    throw new BadRequestError('Malformed JSON');
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new BadRequestError('Request body must be a JSON object');
  }
  return parsed as Record<string, unknown>;
}

function requireRequestId(body: Record<string, unknown>): string {
  if (typeof body.requestId !== 'string') throw new BadRequestError('requestId must be a non-empty string');
  return body.requestId;
}

function requireRenewalSequence(body: Record<string, unknown>): number {
  if (typeof body.renewalSequence !== 'number' || !Number.isSafeInteger(body.renewalSequence) || body.renewalSequence < 1) {
    throw new BadRequestError('renewalSequence must be a positive safe integer');
  }
  return body.renewalSequence;
}

function requireGameplaySessionId(body: Record<string, unknown>): string {
  if (typeof body.gameplaySessionId !== 'string') {
    throw new BadRequestError('gameplaySessionId must be a non-empty string');
  }
  return body.gameplaySessionId;
}

async function handleSession(
  req: IncomingMessage,
  res: ServerResponse,
  host: CommandSessionHost,
  kind: 'open' | 'heartbeat' | 'end',
  report:InternalErrorReporter,
  identity: IdentityBoundary,
): Promise<void> {
  let body: Record<string, unknown>;
  try {
    body = await readJsonObject(req);
  } catch (err) {
    sendBadRequest(res, report, err);
    return;
  }
  try {
    const playerId = await authenticatedPlayer(req, res, body, identity, report);
    if (playerId === null) return;
    const requestId = requireRequestId(body);
    const view = kind === 'open'
      ? await host.openGameplaySession(playerId, requestId)
      : kind === 'heartbeat'
        ? await host.heartbeatGameplaySession(
          playerId,
          requestId,
          requireGameplaySessionId(body),
          requireRenewalSequence(body),
        )
        : await host.endGameplaySession(playerId, requestId, requireGameplaySessionId(body));
    sendPublicJson(res, 200, view, report);
  } catch (err) {
    const kind = httpErrorKind(err);
    if (kind === 'capacity') {
      sendCapacityError(res, report);
      return;
    }
    if (kind === 'bad_request') {
      sendBadRequest(res, report, err);
      return;
    }
    if (kind === 'receipt') {
      sendPublicJson(res, 409, { error: 'STALE_RECEIPT', message: 'Gameplay session receipt is behind authoritative state' }, report);
      return;
    }
    if (kind === 'persistence') {
      sendPersistenceError(res,report,err);
      return;
    }
    sendInternalError(res,report,err);
  }
}

async function handleCommand(req: IncomingMessage, res: ServerResponse, host: CommandSessionHost,report:InternalErrorReporter, identity: IdentityBoundary): Promise<void> {
  let parsed: Record<string, unknown>;
  try {
    parsed = await readJsonObject(req);
  } catch (err) {
    sendBadRequest(res, report, err);
    return;
  }
  let request: CommandRequest;
  try {
    const playerId = await authenticatedPlayer(req, res, parsed, identity, report);
    if (playerId === null) return;
    request = commandFromBody(playerId, parsed);
  } catch (err) {
    sendBadRequest(res, report, err);
    return;
  }
  try {
    const response = await host.execute(request);
    if (request.commandId === 'GET_COMMAND_INDEX' && response.success) {
      const commands = COMMAND_INDEX.filter(c => c.status === 'implemented' && isCommandExposed(c.commandId));
      response.payload = { ...response.payload, summary: { total: commands.length, implemented: commands.length, unsupported: 0 }, commands };
    }
    sendPublicJson(res, 200, response, report, { commandId: request.commandId, requestId: request.requestId });
  } catch (err) {
    const kind = httpErrorKind(err);
    if (kind === 'capacity') {
      sendCapacityError(res, report);
      return;
    }
    if (kind === 'command') {
      sendPublicJson(res, 403, { error: 'COMMAND_NOT_EXPOSED', message: `Command is not exposed over HTTP: ${request.commandId}` }, report);
      return;
    }
    if (kind === 'persistence') {
      sendPersistenceError(res,report,err);
      return;
    }
    sendInternalError(res,report,err);
  }
}

async function authenticatedPlayer(req: IncomingMessage, res: ServerResponse, body: Record<string, unknown>, identity: IdentityBoundary, report: InternalErrorReporter): Promise<string | null> {
  const result = await resolvePlayerId(req, body, identity);
  if (result.ok) return result.playerId;
  sendPublicJson(res, result.status, { error: result.error, message: 'Authenticated player identity required' }, report);
  return null;
}

export interface CommandHttpOptions {
  onInternalError?: InternalErrorReporter;
  /** Omission is authenticated mode without a provider: every player request fails closed. */
  identity?: IdentityBoundary;
  /** Trusted deployment bounds; never taken from HTTP input. */
  authenticationLimits?: DependencyLimits;
  readinessLimits?: DependencyLimits;
  /** Trusted, read-only deployment probe. Honor cancellation and enforce bounded
   * I/O; the response deadline cannot stop synchronous or non-cooperative code. */
  readiness?: (signal?: AbortSignal) => boolean | Promise<boolean>;
}
export function createCommandHttpServer(host: CommandSessionHost, options: CommandHttpOptions = {}): Server {
  const identity: IdentityBoundary = { ...(options.identity ?? { mode: 'authenticated' }) };
  validateIdentityBoundary(identity);
  const authenticateWithinBudget = createDependencyBudget(options.authenticationLimits ?? {}, { maxPending: 64, timeoutMs: 5000 });
  const readinessWithinBudget = createDependencyBudget(options.readinessLimits ?? {}, { maxPending: 1, timeoutMs: 2000 });
  if (identity.mode === 'authenticated' && typeof identity.authenticate === 'function') {
    const provider = identity.authenticate;
    identity.authenticate = async request => {
      const result = await authenticateWithinBudget(signal => provider(request, signal));
      if (!result.ok) throw new Error('Authentication unavailable');
      return result.value;
    };
  }
  if (process.env.NODE_ENV === 'production' && host.persistenceName !== 'supabase') {
    throw new Error('Production cannot use ephemeral in-memory persistence');
  }
  const report = options.onInternalError ?? defaultInternalErrorReporter;
  const readiness = options.readiness;
  return createServer((req, res) => {
    const path = pathname(req);
    if (req.method === 'GET' && path === '/ready') {
      const authenticationConfigured = identity.mode === 'authenticated' && typeof identity.authenticate === 'function';
      void (async () => {
        let ready = false;
        if (authenticationConfigured && readiness) {
          const result = await readinessWithinBudget(signal => readiness(signal));
          ready = result.ok && result.value === true;
        }
        sendPublicJson(res, ready ? 200 : 503, { ready, authenticationConfigured }, report);
      })().catch((err: unknown) => { if (!res.headersSent) sendInternalError(res, report, err); });
      return;
    }
    if (req.method === 'GET' && path === '/health') {
      try {
        sendPublicJson(res, 200, { ok: true, service: 'rep-wars', persistence: host.persistenceName }, report);
      } catch (err) { sendInternalError(res, report, err); }
      return;
    }
    if (req.method === 'POST' && (path === '/session/open' || path === '/session/heartbeat' || path === '/session/end')) {
      const kind = path === '/session/open' ? 'open' : path === '/session/heartbeat' ? 'heartbeat' : 'end';
      void handleSession(req, res, host, kind,report, identity).catch((err: unknown) => {
        if (res.headersSent) return;
        sendInternalError(res,report,err);
      });
      return;
    }
    if (req.method === 'POST' && path === '/commands') {
      void handleCommand(req, res, host,report, identity).catch((err: unknown) => {
        if (res.headersSent) return;
        sendInternalError(res,report,err);
      });
      return;
    }
    try {
      sendPublicJson(res, 404, { error: 'NOT_FOUND', message: 'Not found' }, report);
    } catch (err) { sendInternalError(res, report, err); }
  });
}
