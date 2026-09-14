import { BALANCE } from '../constants/balance';
import { StrategicGoal, GoalType, FactionId, TerritoryId, ResourceType, WarlordSnapshot, Territory } from '../types';

export interface GoalAlignmentResult {
  alignedGoals: StrategicGoal[];
  misalignedGoals: StrategicGoal[];
  scoreContribution: number;
  relevantGoals: {
    goal: StrategicGoal;
    alignment: 'aligned' | 'misaligned' | 'neutral';
  }[];
}

type AlignmentParams = {
  actionType: string;
  targetFaction?: FactionId | null;
  targetTerritory?: TerritoryId | null;
  self: WarlordSnapshot;
  currentTurn: number;
  allTerritories: Map<TerritoryId, Territory>;
};

/**
 * Optional world context for `generateInitialGoals`. When omitted, faction-
 * targeted goals keep `targetFaction: null` (same as before this pass).
 * Callers that already know the faction set (e.g. `SimulationBuilder`)
 * should pass it so `destroy_rival` / `form_alliance` can actually affect
 * scoring. `control_region` uses `Territory.regionId` against
 * `goal.targetRegion` from `homeRegionId`.
 */
export interface InitialGoalContext {
  otherFactionIds?: FactionId[];
  rivalFactionIds?: FactionId[];
  allianceCandidateIds?: FactionId[];
  /** Authoritative region containing the faction home territory. */
  homeRegionId?: string | null;
}

export class GoalSystem {
  private goals: StrategicGoal[] = [];
  private nextId = 0;

  constructor(initialGoals: StrategicGoal[] = []) {
    this.goals = [...initialGoals];
    for (const g of initialGoals) {
      const parsed = parseInt(g.id.replace('goal_', ''));
      if (!isNaN(parsed) && parsed >= this.nextId)
        this.nextId = parsed + 1;
    }
  }

  addGoal(params: {
    type: GoalType;
    priority: number;
    targetFaction?: FactionId | null;
    targetTerritory?: TerritoryId | null;
    targetRegion?: string | null;
    targetResource?: ResourceType | null;
    progress?: number;
    targetProgress?: number;
    deadlineTurn?: number | null;
    createdTurn: number;
  }): StrategicGoal {
    const goal: StrategicGoal = {
      id: `goal_${this.nextId++}`,
      type: params.type,
      priority: params.priority,
      targetFaction: params.targetFaction ?? null,
      targetTerritory: params.targetTerritory ?? null,
      targetRegion: params.targetRegion ?? null,
      targetResource: params.targetResource ?? null,
      progress: params.progress ?? 0,
      targetProgress: params.targetProgress ?? 100,
      deadlineTurn: params.deadlineTurn ?? null,
      createdTurn: params.createdTurn,
    };
    this.goals.push(goal);
    this.trimGoals();
    return goal;
  }

  getActiveGoals(currentTurn: number): StrategicGoal[] {
    return this.goals.filter((g) => {
      if (g.progress >= g.targetProgress)
        return false;
      if (g.deadlineTurn !== null && currentTurn > g.deadlineTurn)
        return false;
      return true;
    }).sort((a, b) => b.priority - a.priority);
  }

  getAllGoals(): StrategicGoal[] {
    return [...this.goals];
  }

  updateProgress(goalId: string, delta: number): boolean {
    const goal = this.goals.find((g) => g.id === goalId);
    if (!goal)
      return false;
    goal.progress = Math.max(0, Math.min(goal.targetProgress, goal.progress + delta));
    return true;
  }

  removeGoal(goalId: string): boolean {
    const idx = this.goals.findIndex((g) => g.id === goalId);
    if (idx < 0)
      return false;
    this.goals.splice(idx, 1);
    return true;
  }

  /**
   * Mark goals whose required target faction/territory no longer exists as
   * complete so they drop out of `getActiveGoals`. Replaces the goal object
   * (does not mutate the original `StrategicGoal` instance, which may be
   * shared with a `WarlordSnapshot`). Does not invent replacements.
   * `control_region` with a null `targetRegion` is incomplete, not invalid.
   */
  invalidateMissingTargets(
    factionIds: Iterable<FactionId>,
    territoryIds: Iterable<TerritoryId>,
  ): string[] {
    const factions = new Set(factionIds);
    const territories = new Set(territoryIds);
    const completed: string[] = [];
    for (let i = 0; i < this.goals.length; i++) {
      const g = this.goals[i]!;
      if (g.progress >= g.targetProgress)
        continue;
      let invalid = false;
      if (g.targetFaction && !factions.has(g.targetFaction))
        invalid = true;
      if (g.targetTerritory && !territories.has(g.targetTerritory))
        invalid = true;
      if (invalid) {
        this.goals[i] = { ...g, progress: g.targetProgress };
        completed.push(g.id);
      }
    }
    return completed;
  }

  evaluateActionAlignment(params: AlignmentParams): GoalAlignmentResult {
    const active = this.getActiveGoals(params.currentTurn);
    const alignedGoals: StrategicGoal[] = [];
    const misalignedGoals: StrategicGoal[] = [];
    const relevant: GoalAlignmentResult['relevantGoals'] = [];
    let scoreBonus = 0;
    let scorePenalty = 0;
    for (const goal of active) {
      const alignment = this.checkAlignment(goal, params);
      if (alignment === 'aligned') {
        alignedGoals.push(goal);
        const priorityFactor = goal.priority / 100;
        const progressBonus = (goal.progress / goal.targetProgress) * BALANCE.goals.progressBonusFactor;
        scoreBonus += BALANCE.goals.goalAlignmentBonus * priorityFactor * (1 + progressBonus);
        relevant.push({ goal, alignment: 'aligned' });
      }
      else if (alignment === 'misaligned') {
        misalignedGoals.push(goal);
        const priorityFactor = goal.priority / 100;
        scorePenalty += BALANCE.goals.goalMisalignmentPenalty * priorityFactor;
        relevant.push({ goal, alignment: 'misaligned' });
      }
      else {
        relevant.push({ goal, alignment: 'neutral' });
      }
    }
    return {
      alignedGoals,
      misalignedGoals,
      scoreContribution: scoreBonus - scorePenalty,
      relevantGoals: relevant,
    };
  }

  private checkAlignment(goal: StrategicGoal, params: AlignmentParams): 'aligned' | 'misaligned' | 'neutral' {
    const { actionType, targetFaction, targetTerritory } = params;
    switch (goal.type) {
      // AI COMMITMENT & AMBITION PASS — `destroy_rival` / `form_alliance`
      // alignment still requires a real `targetFaction`.
      // `generateInitialGoals` now accepts optional `InitialGoalContext`
      // so callers that already know the faction set (SimulationBuilder)
      // can attach a real rival/ally. Without that context the target
      // stays null and this case remains a no-op — never fabricate an id.
      case 'destroy_rival':
        if (goal.targetFaction) {
          if (targetFaction === goal.targetFaction) {
            if (actionType === 'ATTACK' || actionType === 'DECLARE_WAR')
              return 'aligned';
            if (actionType === 'OFFER_PEACE' || actionType === 'NEGOTIATE')
              return 'misaligned';
          }
          if (actionType === 'TRADE' && targetFaction === goal.targetFaction)
            return 'misaligned';
        }
        break;
      // `control_region` uses authored `Territory.regionId` against
      // `goal.targetRegion` (from world membership / homeRegionId).
      case 'control_region': {
        const regionId = goal.targetRegion;
        if (!regionId) break;
        const targetTerr = params.allTerritories.get(targetTerritory ?? '');
        const inRegion = targetTerr?.regionId === regionId;
        if (actionType === 'ATTACK' && inRegion && targetTerr && targetTerr.owner !== params.self.id) {
          return 'aligned';
        }
        if ((actionType === 'BUILD' || actionType === 'DEFEND' || actionType === 'REINFORCE') && inRegion) {
          return 'aligned';
        }
        break;
      }
      // `protect_territory` and `break_siege` (further below) are fully
      // functional (their logic doesn't depend on any of the buggy
      // null-target patterns above) but are currently NEVER generated by
      // `GoalSystem.generateInitialGoals` for any personality — so no
      // faction ever actually holds one of these goals today. Not a bug;
      // documented so a future pass wiring up dynamic goal creation
      // (sieges, capital defense, etc.) knows the alignment logic already
      // works and only goal creation is missing.
      case 'protect_territory':
        if (goal.targetTerritory === targetTerritory) {
          if (actionType === 'DEFEND' || actionType === 'REINFORCE' || actionType === 'BUILD')
            return 'aligned';
          if (actionType === 'RETREAT')
            return 'misaligned';
        }
        if (actionType === 'ATTACK' && goal.targetTerritory) {
          const goalTerr = params.allTerritories.get(goal.targetTerritory);
          const targetTerr = params.allTerritories.get(targetTerritory ?? '');
          if (goalTerr && targetTerr && goalTerr.neighboring.includes(targetTerr.id)) {
            return 'aligned';
          }
        }
        break;
      case 'expand_to_resources':
        if (actionType === 'ATTACK') {
          if (targetTerritory) {
            const terr = params.allTerritories.get(targetTerritory);
            if (terr && goal.targetResource) {
              if (terr.resourceOutput[goal.targetResource]) {
                return 'aligned';
              }
            }
            else if (terr && terr.resourceOutput) {
              const hasResources = Object.values(terr.resourceOutput).some((v) => v && v > 0);
              if (hasResources)
                return 'aligned';
            }
          }
        }
        break;
      case 'dominant_faction':
        if (actionType === 'ATTACK' || actionType === 'DECLARE_WAR')
          return 'aligned';
        if (actionType === 'WAIT' || actionType === 'OFFER_PEACE')
          return 'misaligned';
        break;
      case 'prepare_for_invasion':
        if (actionType === 'BUILD' || actionType === 'REINFORCE' || actionType === 'DEFEND')
          return 'aligned';
        if (actionType === 'ATTACK')
          return 'aligned';
        if (actionType === 'WAIT')
          return 'misaligned';
        break;
      case 'economic_growth':
        if (actionType === 'BUILD' || actionType === 'TRADE')
          return 'aligned';
        if (actionType === 'DECLARE_WAR' || actionType === 'ATTACK')
          return 'misaligned';
        break;
      // Same `targetFaction` gate as `destroy_rival`. With
      // `InitialGoalContext.allianceCandidateIds` this now fires for
      // generated goals; without context it stays a no-op.
      case 'form_alliance':
        if (goal.targetFaction) {
          if (targetFaction === goal.targetFaction) {
            if (actionType === 'NEGOTIATE' || actionType === 'TRADE')
              return 'aligned';
            if (actionType === 'DECLARE_WAR' || actionType === 'ATTACK')
              return 'misaligned';
          }
        }
        break;
      case 'break_siege':
        if (actionType === 'ATTACK' || actionType === 'REINFORCE' || actionType === 'MOVE')
          return 'aligned';
        if (actionType === 'RETREAT')
          return 'misaligned';
        break;
    }
    return 'neutral';
  }

  static generateInitialGoals(
    personalityType: string,
    factionId: FactionId,
    currentTurn: number,
    rng: {
      nextInt: (min: number, max: number) => number;
      next: () => number;
    },
    context?: InitialGoalContext,
  ): StrategicGoal[] {
    void rng;
    const goals: StrategicGoal[] = [];
    const idCounter = { value: 0 };
    const makeGoal = (type: GoalType, priority: number, extras: Partial<StrategicGoal> = {}): StrategicGoal => ({
      id: `goal_${idCounter.value++}`,
      type,
      priority,
      targetFaction: null,
      targetTerritory: null,
      targetRegion: null,
      targetResource: null,
      progress: 0,
      targetProgress: 100,
      deadlineTurn: null,
      createdTurn: currentTurn,
      ...extras,
    });
    const homeRegion = context?.homeRegionId ?? null;
    const regionGoal = (priority: number): StrategicGoal => makeGoal('control_region', priority, {
      targetProgress: 100,
      targetRegion: homeRegion,
    });
    switch (personalityType) {
      case 'aggressive':
        goals.push(makeGoal('dominant_faction', 90, { targetProgress: 100 }));
        goals.push(makeGoal('destroy_rival', 80, { targetProgress: 100 }));
        goals.push(makeGoal('expand_to_resources', 50));
        break;
      case 'defensive':
        goals.push(makeGoal('prepare_for_invasion', 85, { targetProgress: 100 }));
        goals.push(makeGoal('economic_growth', 70));
        goals.push(makeGoal('form_alliance', 55));
        break;
      case 'expansionist':
        goals.push(makeGoal('expand_to_resources', 90));
        goals.push(regionGoal(75));
        goals.push(makeGoal('dominant_faction', 60));
        break;
      case 'opportunistic':
        goals.push(makeGoal('expand_to_resources', 70));
        goals.push(regionGoal(50));
        goals.push(makeGoal('economic_growth', 60));
        break;
      case 'diplomatic':
        goals.push(makeGoal('form_alliance', 85));
        goals.push(makeGoal('economic_growth', 75));
        goals.push(makeGoal('prepare_for_invasion', 50));
        break;
      case 'economic':
        goals.push(makeGoal('economic_growth', 90));
        goals.push(makeGoal('expand_to_resources', 70));
        goals.push(makeGoal('form_alliance', 55));
        break;
      default:
        goals.push(makeGoal('expand_to_resources', 60));
        goals.push(makeGoal('economic_growth', 60));
        goals.push(makeGoal('prepare_for_invasion', 50));
    }
    assignGoalTargets(goals, factionId, context);
    return goals;
  }

  private trimGoals(): void {
    if (this.goals.length > BALANCE.goals.maxActiveGoals * 3) {
      this.goals.sort((a, b) => b.priority - a.priority);
      this.goals = this.goals.slice(0, BALANCE.goals.maxActiveGoals * 3);
    }
  }
}

/**
 * Attach real faction targets when the caller already has a faction set.
 * Picks deterministically from the provided pools (sorted + salt hash) and
 * never invents an id that wasn't supplied. Does not consume the simulation
 * RNG, so SampleMap reputation/stability rolls stay unchanged.
 */
function assignGoalTargets(
  goals: StrategicGoal[],
  factionId: FactionId,
  context?: InitialGoalContext,
): void {
  if (!context)
    return;
  for (const g of goals) {
    if (g.type === 'destroy_rival' && !g.targetFaction) {
      const pool = (context.rivalFactionIds && context.rivalFactionIds.length > 0)
        ? context.rivalFactionIds
        : (context.otherFactionIds ?? []);
      const picked = pickDeterministicId(pool, `${factionId}:destroy_rival`);
      if (picked)
        g.targetFaction = picked;
    }
    if (g.type === 'form_alliance' && !g.targetFaction) {
      const pool = (context.allianceCandidateIds && context.allianceCandidateIds.length > 0)
        ? context.allianceCandidateIds
        : (context.otherFactionIds ?? []);
      const picked = pickDeterministicId(pool, `${factionId}:form_alliance`);
      if (picked)
        g.targetFaction = picked;
    }
  }
}

function pickDeterministicId(ids: FactionId[], salt: string): FactionId | null {
  if (ids.length === 0)
    return null;
  const sorted = [...ids].sort();
  let h = 0;
  for (let i = 0; i < salt.length; i++) {
    h = ((h << 5) - h) + salt.charCodeAt(i);
    h |= 0;
  }
  const idx = Math.abs(h) % sorted.length;
  return sorted[idx] ?? null;
}
