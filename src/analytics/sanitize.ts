import { TelemetryPayload } from './types';

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function num(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function bool(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

/** Gameplay-relevant PhysicalResult fields. No per-rep health dump. */
export function sanitizeFitnessResult(payload: Record<string, unknown>): TelemetryPayload {
  return {
    sessionId: str(payload.sessionId) ?? null,
    workoutId: str(payload.workoutId) ?? null,
    purpose: str(payload.purpose) ?? null,
    intendedDifficulty: str(payload.intendedDifficulty) ?? null,
    physicalOutput: num(payload.physicalOutput) ?? num(payload.totalPhysicalOutput) ?? null,
    alreadyProcessed: bool(payload.alreadyProcessed) ?? null,
  };
}

export function sanitizeGameReward(payload: Record<string, unknown>): TelemetryPayload {
  const amountOrEffect = payload.amountOrEffect;
  return {
    kind: str(payload.kind) ?? null,
    purpose: str(payload.purpose) ?? null,
    sessionId: str(payload.sessionId) ?? str(payload.sourceSessionId) ?? null,
    applicationId: str(payload.applicationId) ?? null,
    sourcePhysicalOutput: num(payload.sourcePhysicalOutput) ?? num(payload.physicalOutput) ?? null,
    amountOrEffect: amountOrEffect && typeof amountOrEffect === 'object'
      ? (amountOrEffect as TelemetryPayload)
      : null,
    bankedTroops: num(payload.bankedTroops) ?? null,
  };
}

export function sanitizeBattle(result: unknown, extra: Record<string, unknown> = {}): TelemetryPayload {
  const battle = result && typeof result === 'object' ? result as Record<string, unknown> : {};
  const attacker = battle.attacker && typeof battle.attacker === 'object'
    ? battle.attacker as Record<string, unknown>
    : {};
  const defender = battle.defender && typeof battle.defender === 'object'
    ? battle.defender as Record<string, unknown>
    : {};
  const attackerCas = attacker.casualties && typeof attacker.casualties === 'object'
    ? attacker.casualties as Record<string, unknown>
    : {};
  const defenderCas = defender.casualties && typeof defender.casualties === 'object'
    ? defender.casualties as Record<string, unknown>
    : {};
  return {
    battleId: str(battle.battleId) ?? null,
    territoryId: str(battle.territoryId) ?? str(extra.territoryId) ?? null,
    winner: str(battle.winner) ?? str(extra.winner) ?? null,
    loser: str(battle.loser) ?? null,
    outcomeType: str(battle.outcomeType) ?? null,
    territoryOutcome: str(battle.territoryOutcome) ?? str(extra.territoryOutcome) ?? null,
    attackerCasualties: num(attackerCas.total) ?? null,
    defenderCasualties: num(defenderCas.total) ?? null,
    attackerRemaining: num(attacker.remainingTroops) ?? null,
    defenderRemaining: num(defender.remainingTroops) ?? null,
    committedTroops: num(extra.committedTroops) ?? null,
    invasionId: str(extra.invasionId) ?? null,
    invasionOutcome: str(extra.invasionOutcome) ?? null,
    resolveReason: str(extra.resolveReason) ?? null,
  };
}

export function workoutContextFromParameters(parameters: Record<string, unknown>): TelemetryPayload {
  return {
    purpose: str(parameters.purpose) ?? null,
    workoutId: str(parameters.workoutId) ?? null,
    intendedDifficulty: str(parameters.intendedDifficulty) ?? null,
    invasionId: str(parameters.invasionId) ?? null,
    constructionId: str(parameters.constructionId) ?? null,
    collectionTerritoryId: str(parameters.collectionTerritoryId) ?? null,
  };
}

export function omitUndefined<T extends Record<string, unknown>>(value: T): TelemetryPayload {
  const out: TelemetryPayload = {};
  for (const [key, entry] of Object.entries(value)) {
    if (entry === undefined) continue;
    if (entry === null || typeof entry === 'string' || typeof entry === 'number' || typeof entry === 'boolean') {
      out[key] = entry;
    } else if (Array.isArray(entry) || typeof entry === 'object') {
      try {
        out[key] = JSON.parse(JSON.stringify(entry)) as TelemetryPayload[string];
      } catch {
        continue;
      }
    }
  }
  return out;
}
