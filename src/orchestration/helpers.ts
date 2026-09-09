import { Army, FactionId, GameStateSnapshot, Resources, Territory, TerritoryId, WarlordSnapshot } from '../types';
import { GameState } from '../types/GameState';
import { CommandRequest } from './protocol';
import { OrchestrationError, ErrorCode } from './errors';

export function deriveBattleSeed(
  baseSeed: number,
  turn: number,
  attackerId: string,
  defenderId: string,
  territoryId: string,
): number {
  const s = `${turn}_${attackerId}_${defenderId}_${territoryId}`;
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  }
  return (h ^ baseSeed) >>> 0;
}

export function paramString(req: CommandRequest, name: string): string | undefined {
  const v = req.parameters?.[name];
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

export function paramNumber(req: CommandRequest, name: string): number | undefined {
  const v = req.parameters?.[name];
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

export function requireString(req: CommandRequest, name: string): string {
  const v = paramString(req, name);
  if (!v) throw new OrchestrationError(ErrorCode.MISSING_PARAMETER, `Missing required parameter: ${name}`);
  return v;
}

/** Temporarily merge parameters onto `ctx.req` for a nested handler call. */
export function withRequestParameters<T>(
  req: CommandRequest,
  extra: Record<string, unknown>,
  fn: () => T,
): T {
  const prev = req.parameters;
  req.parameters = { ...prev, ...extra };
  try {
    return fn();
  } finally {
    req.parameters = prev;
  }
}

export function resolveActingFactionId(state: GameState, req: CommandRequest): FactionId {
  const explicit = paramString(req, 'factionId');
  if (explicit) {
    if (!state.factions.has(explicit)) {
      throw new OrchestrationError(ErrorCode.INVALID_FACTION, `Unknown faction: ${explicit}`, { factionId: explicit });
    }
    return explicit;
  }
  if (state.playerFactionId && state.factions.has(state.playerFactionId)) {
    return state.playerFactionId;
  }
  throw new OrchestrationError(
    ErrorCode.INVALID_FACTION,
    'No acting faction: set GameState.playerFactionId or pass parameters.factionId',
  );
}

/** Derived presentation label only — does not change domain rules. */
export type InteractionKind = 'player_vs_ai' | 'ai_vs_player' | 'ai_vs_ai';

export function classifyFactionInteraction(
  playerFactionId: string | null,
  actorId: string,
  counterpartyId: string,
): InteractionKind {
  const actorIsPlayer = playerFactionId !== null && actorId === playerFactionId;
  const otherIsPlayer = playerFactionId !== null && counterpartyId === playerFactionId;
  if (actorIsPlayer && !otherIsPlayer) return 'player_vs_ai';
  if (!actorIsPlayer && otherIsPlayer) return 'ai_vs_player';
  return 'ai_vs_ai';
}

export function requireTerritory(state: GameState, territoryId: TerritoryId): Territory {
  const t = state.territories.get(territoryId);
  if (!t) {
    throw new OrchestrationError(ErrorCode.INVALID_TERRITORY, `Unknown territory: ${territoryId}`, { territoryId });
  }
  return t;
}

export function requireArmy(state: GameState, armyId: string): Army {
  const a = state.armies.get(armyId);
  if (!a) {
    throw new OrchestrationError(ErrorCode.INVALID_ARMY, `Unknown army: ${armyId}`, { armyId });
  }
  return a;
}

export function requireFactionSnapshot(state: GameState, factionId: FactionId): WarlordSnapshot {
  const f = state.factions.get(factionId);
  if (!f) {
    throw new OrchestrationError(ErrorCode.INVALID_FACTION, `Unknown faction: ${factionId}`, { factionId });
  }
  return f;
}

/**
 * Narrowed to `GameStateSnapshot` (AI RUNTIME INTEGRATION PASS) so
 * `ActionScorer`/feasibility code — which only ever has the read-only
 * `GameStateSnapshot` shape (`ActionContext.gameState`), not a full
 * `GameState` — can call this exact same helper instead of a second
 * "which armies does this faction have" implementation. `GameState`
 * still structurally satisfies `GameStateSnapshot`, so every existing
 * caller is unaffected.
 */
export function factionArmies(state: GameStateSnapshot, factionId: FactionId): Army[] {
  const f = state.factions.get(factionId);
  if (!f) return [];
  const out: Army[] = [];
  for (const id of f.armies) {
    const a = state.armies.get(id);
    if (a) out.push(a);
  }
  return out;
}

export function armiesInTerritory(state: GameState, territoryId: TerritoryId, owner?: FactionId): Army[] {
  const out: Army[] = [];
  for (const a of state.armies.values()) {
    if (a.location !== territoryId) continue;
    if (owner && a.owner !== owner) continue;
    out.push(a);
  }
  return out;
}

/** Narrowed to `GameStateSnapshot` — see `factionArmies` doc comment. */
export function isAdjacent(state: GameStateSnapshot, fromId: TerritoryId, toId: TerritoryId): boolean {
  const from = state.territories.get(fromId);
  return !!from?.neighboring.includes(toId);
}

export function pushMemory(
  faction: WarlordSnapshot,
  turn: number,
  type: WarlordSnapshot['memory'][0]['type'],
  withFaction: FactionId | null,
  territory: TerritoryId | null,
  magnitude: number,
  details: Record<string, unknown> = {},
): void {
  faction.memory.unshift({
    id: `mem_${faction.id}_${turn}_${faction.memory.length}`,
    turn,
    type,
    withFaction,
    territory,
    magnitude,
    details,
  });
  if (faction.memory.length > 200) faction.memory.length = 200;
}

export function recordResourceChange(
  changes: { factionId: string; resource: string; from: number; to: number }[],
  factionId: FactionId,
  resource: keyof Resources,
  from: number,
  to: number,
): void {
  if (from !== to) changes.push({ factionId, resource, from, to });
}
