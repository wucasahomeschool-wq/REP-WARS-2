import { TelemetryEvent } from './types';

export interface GameTelemetrySummary {
  startTick: number | null;
  endTick: number | null;
  durationTicks: number | null;
  eventCount: number;
  criticalCount: number;
  importantCount: number;
  battles: number;
  conquests: number;
  workoutsCompleted: number;
  constructionsCompleted: number;
  pauses: number;
  levelsCompleted: number;
  levelsDefeated: number;
}

export interface PlayerTelemetrySummary {
  playerId: string;
  workoutsStarted: number;
  workoutsCompleted: number;
  workoutsAbandoned: number;
  rewardsApplied: number;
  troopsGranted: number;
  attacksCommitted: number;
  averageTroopCommitment: number | null;
  victories: number;
  defeats: number;
  territoriesGained: number;
  constructionsStarted: number;
  resourcesCollected: number;
}

export interface AiTelemetrySummary {
  decisions: number;
  commitmentsResolved: number;
  attacks: number;
  successes: number;
  failures: number;
  defendPostures: number;
  successRate: number | null;
}

function num(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

export function summarizeGame(events: readonly TelemetryEvent[]): GameTelemetrySummary {
  const ticks = events.map((e) => e.occurredAtWorldTick);
  const startTick = ticks.length ? Math.min(...ticks) : null;
  const endTick = ticks.length ? Math.max(...ticks) : null;
  return {
    startTick,
    endTick,
    durationTicks: startTick !== null && endTick !== null ? endTick - startTick : null,
    eventCount: events.length,
    criticalCount: events.filter((e) => e.importance === 'CRITICAL').length,
    importantCount: events.filter((e) => e.importance === 'IMPORTANT').length,
    battles: events.filter((e) => e.eventType === 'battle.resolved').length,
    conquests: events.filter((e) => e.eventType === 'territory.conquered').length,
    workoutsCompleted: events.filter((e) => e.eventType === 'workout.completed').length,
    constructionsCompleted: events.filter((e) => e.eventType === 'construction.completed').length,
    pauses: events.filter((e) => e.eventType === 'player.pause.started').length,
    levelsCompleted: events.filter((e) => e.eventType === 'level.completed').length,
    levelsDefeated: events.filter((e) => e.eventType === 'level.defeated').length,
  };
}

export function summarizePlayer(events: readonly TelemetryEvent[], playerId: string): PlayerTelemetrySummary {
  const mine = events.filter((e) => e.playerId === playerId);
  const commits = mine.filter((e) => e.eventType === 'attack.committed');
  const troopAmounts = commits.map((e) => num(e.payload.committedTroops)).filter((n): n is number => n !== undefined);
  const rewards = mine.filter((e) => e.eventType === 'workout.reward_applied');
  let troopsGranted = 0;
  for (const event of rewards) {
    const next = num(event.payload.bankedTroops);
    if (next !== undefined) troopsGranted = Math.max(troopsGranted, next);
  }
  const battles = mine.filter((e) => e.eventType === 'battle.resolved');
  const victories = battles.filter((e) => str(e.payload.winner) === 'attacker').length;
  const defeats = battles.filter((e) => str(e.payload.winner) === 'defender').length;
  const collected = mine
    .filter((e) => e.eventType === 'resource.collected')
    .reduce((sum, e) => sum + (num(e.payload.collected) ?? 0), 0);
  return {
    playerId,
    workoutsStarted: mine.filter((e) => e.eventType === 'workout.started').length,
    workoutsCompleted: mine.filter((e) => e.eventType === 'workout.completed').length,
    workoutsAbandoned: mine.filter((e) => e.eventType === 'workout.abandoned').length,
    rewardsApplied: rewards.length,
    troopsGranted,
    attacksCommitted: commits.length,
    averageTroopCommitment: troopAmounts.length
      ? troopAmounts.reduce((a, b) => a + b, 0) / troopAmounts.length
      : null,
    victories,
    defeats,
    territoriesGained: mine.filter((e) => e.eventType === 'territory.conquered').length,
    constructionsStarted: mine.filter((e) => e.eventType === 'construction.started').length,
    resourcesCollected: collected,
  };
}

export function summarizeAi(events: readonly TelemetryEvent[], factionId?: string): AiTelemetrySummary {
  const mine = factionId ? events.filter((e) => e.factionId === factionId) : events;
  const decisions = mine.filter((e) => e.eventType === 'ai.decision_selected');
  const resolved = mine.filter((e) => e.eventType === 'ai.commitment_resolved');
  const attacks = resolved.filter((e) => str(e.payload.action) === 'ATTACK' || str(e.payload.attackOutcome));
  const successes = resolved.filter((e) => e.payload.success === true).length;
  const failures = resolved.filter((e) => e.payload.success === false).length;
  return {
    decisions: decisions.length,
    commitmentsResolved: resolved.length,
    attacks: attacks.length,
    successes,
    failures,
    defendPostures: mine.filter((e) => e.eventType === 'ai.defend_posture').length,
    successRate: successes + failures > 0 ? successes / (successes + failures) : null,
  };
}

export function derivedMetrics(events: readonly TelemetryEvent[]): Record<string, number | null> {
  const workouts = events.filter((e) => e.eventType === 'workout.started').length;
  const completed = events.filter((e) => e.eventType === 'workout.completed').length;
  const abandoned = events.filter((e) => e.eventType === 'workout.abandoned').length;
  const battles = events.filter((e) => e.eventType === 'battle.resolved');
  const wins = battles.filter((e) => str(e.payload.winner) === 'attacker').length;
  const casualties = battles.map((e) => (num(e.payload.attackerCasualties) ?? 0) + (num(e.payload.defenderCasualties) ?? 0));
  const commits = events.filter((e) => e.eventType === 'attack.committed');
  const commitAmounts = commits.map((e) => num(e.payload.committedTroops)).filter((n): n is number => n !== undefined);
  const conquests = events.filter((e) => e.eventType === 'territory.conquered');
  return {
    attacksPerPlayer: commits.length,
    averageTroopCommitment: commitAmounts.length
      ? commitAmounts.reduce((a, b) => a + b, 0) / commitAmounts.length
      : null,
    attackSuccessRate: battles.length ? wins / battles.length : null,
    averageCasualties: casualties.length
      ? casualties.reduce((a, b) => a + b, 0) / casualties.length
      : null,
    workoutCompletionRate: workouts ? completed / workouts : null,
    workoutAbandonRate: workouts ? abandoned / workouts : null,
    territoryExpansion: conquests.length,
    constructionStarts: events.filter((e) => e.eventType === 'construction.started').length,
    aiDecisions: events.filter((e) => e.eventType === 'ai.decision_selected').length,
  };
}
