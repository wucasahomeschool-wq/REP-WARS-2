import {createHash} from 'node:crypto';
import {types as nodeTypes} from 'node:util';
import type {GameState} from '../types/GameState';
import type {GameplayCommandReceipt} from './presenceLeases';

/** Retained form of the existing receipt, in the same GameState CAS payload.
 * Lease lastCommandReceipt remains sequencing metadata; this collection is the
 * logical-ID replay authority. No independent service, lock or store exists. */
export interface MutationReceipt extends GameplayCommandReceipt {
  worldAttempt: number;
  /** Null only for pre-32 identities whose original intent was not persisted. */
  intentHash: string | null;
}

export const MUTATION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
export function validMutationId(value: unknown): value is string {
  return typeof value === 'string' && MUTATION_ID_PATTERN.test(value);
}
export function validWorldAttempt(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

/** All gameplay parameters participate, except `now`, which the host replaces
 * with its trusted receipt clock. Envelope timestamps, clientContext and lease
 * sequencing are transport, not intent. HTTP supplies JSON; direct host callers
 * cannot sneak in coercion, accessors, non-finite numbers or executable hooks. */
export function mutationIntent(commandId: string, parameters: Record<string, unknown> = {}): string {
  function canonical(value: unknown, depth: number, parametersRoot = false): string {
    if (depth > 64) throw new Error('Command intent nesting exceeds limit');
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
    if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
    if (!value || typeof value !== 'object' || nodeTypes.isProxy(value)) throw new Error('Command intent must be JSON');
    const array = Array.isArray(value);
    const prototype = Object.getPrototypeOf(value);
    if (!array && prototype !== Object.prototype && prototype !== null) throw new Error('Command intent must be JSON');
    const descriptors = Object.getOwnPropertyDescriptors(value);
    function data(key: string): unknown {
      const descriptor = descriptors[key];
      if (!descriptor || !('value' in descriptor)) throw new Error('Command intent requires own data');
      return descriptor.value;
    }
    if (array) {
      const items: string[] = [];
      for (let index = 0; index < (value as unknown[]).length; index++) items.push(canonical(data(String(index)), depth + 1));
      return '[' + items.join(',') + ']';
    }
    const fields: string[] = [];
    for (const key of Object.keys(descriptors).sort()) {
      if (!descriptors[key]!.enumerable || (parametersRoot && key === 'now')) continue;
      const item = data(key);
      if (item !== undefined) fields.push(JSON.stringify(key) + ':' + canonical(item, depth + 1));
    }
    return '{' + fields.join(',') + '}';
  }
  const json = '{"commandId":' + JSON.stringify(commandId) + ',"parameters":' + canonical(parameters, 0, true) + '}';
  return createHash('sha256').update(json).digest('hex');
}

export function cloneMutationReceipts(receipts: Map<string, MutationReceipt>): Map<string, MutationReceipt> {
  return new Map([...receipts].map(([id, receipt]) => [id, structuredClone(receipt)]));
}

export function mutationReceiptProblems(state: GameState): string[] {
  if (!validWorldAttempt(state.worldAttempt) || !(state.commandReceipts instanceof Map)) {
    return ['Missing or invalid mutation identity authority'];
  }
  for (const [id, receipt] of state.commandReceipts) {
    if (!receipt || id !== receipt.requestId || typeof id !== 'string' || !id
      || !validWorldAttempt(receipt.worldAttempt) || receipt.worldAttempt > state.worldAttempt
      || !(receipt.intentHash === null || typeof receipt.intentHash === 'string' && /^[a-f0-9]{64}$/.test(receipt.intentHash))
      || (receipt.intentHash !== null && !validMutationId(id))
      || typeof receipt.commandId !== 'string' || !receipt.commandId
      || typeof receipt.success !== 'boolean' || !validWorldAttempt(receipt.sequence)
      || !receipt.payload || typeof receipt.payload !== 'object' || Array.isArray(receipt.payload)
      || !Array.isArray(receipt.errors)
      || receipt.errors.some(error => !error || typeof error.code !== 'string' || typeof error.message !== 'string')) {
      return ['Invalid retained command receipt'];
    }
  }
  return [];
}

/** Restart/transition advances one durable fence while retaining settled IDs.
 * This does not change gameplay clocks, rewards or world-definition identity. */
export function carryMutationIdentity(from: GameState, to: GameState): void {
  if (!validWorldAttempt(from.worldAttempt) || !Number.isSafeInteger(from.worldAttempt + 1)) {
    throw new Error('World attempt identity exhausted');
  }
  to.worldAttempt = from.worldAttempt + 1;
  to.commandReceipts = cloneMutationReceipts(from.commandReceipts);
}
