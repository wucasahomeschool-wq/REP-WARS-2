import { BALANCE } from '../constants/balance';
import { SeededRNG } from '../utils/SeededRNG';
import { MemorySystem } from '../memory/MemorySystem';
import { GoalSystem } from '../goals/GoalSystem';
import { ActionScorer, ScorerInput, ScoringHelpers } from '../scoring/ActionScorer';
import {
  WarlordSnapshot,
  GameStateSnapshot,
  ActionContext,
  Decision,
  FactionId,
  Territory,
  Army,
  ScoredAction,
  AICommitment,
  CommitmentStatus,
  ActionType,
} from '../types';
import { isAttackForbiddenOnSnapshot } from '../gameplay/invasion/eligibility';

function withLiveMilitaryPower(snap: WarlordSnapshot, gameState: GameStateSnapshot): WarlordSnapshot {
  const armies = snap.armies
    .map((id) => gameState.armies.get(id))
    .filter((a): a is Army => !!a);
  const territories = snap.territories
    .map((id) => gameState.territories.get(id))
    .filter((t): t is Territory => !!t);
  const power = ScoringHelpers.computeTotalMilitaryPower(armies, territories);
  if (power === snap.totalMilitaryPower) return snap;
  return { ...snap, totalMilitaryPower: power };
}

function liveFactionPowerMap(gameState: GameStateSnapshot): Map<FactionId, WarlordSnapshot> {
  const out = new Map<FactionId, WarlordSnapshot>();
  for (const [id, snap] of gameState.factions) {
    out.set(id, withLiveMilitaryPower(snap, gameState));
  }
  return out;
}

export class WarlordState {
  snapshot: WarlordSnapshot;
  memory: MemorySystem;
  goals: GoalSystem;
  /** AI-owned; not world state. The future Orchestrator reads this, it does not live on territories/armies. */
  activeCommitment: AICommitment | null = null;
  lastTerminalCommitment: AICommitment | null = null;
  private commitmentSeq = 0;

  constructor(snapshot: WarlordSnapshot, memory?: MemorySystem, goals?: GoalSystem) {
    this.snapshot = snapshot;
    this.memory = memory ?? new MemorySystem();
    this.goals = goals ?? new GoalSystem(this.snapshot.goals);
    this.memory.mergeFrom(this.snapshot.memory);
  }

  nextCommitmentSeq(): number {
    return this.commitmentSeq++;
  }

  static buildContext(self: WarlordSnapshot, gameState: GameStateSnapshot): ActionContext {
    const allTerritories = gameState.territories;
    const allArmies = gameState.armies;
    const allFactions = liveFactionPowerMap(gameState);
    const selfLive = allFactions.get(self.id) ?? withLiveMilitaryPower(self, gameState);
    const myTerritories = selfLive.territories
      .map((id) => allTerritories.get(id))
      .filter((t): t is Territory => !!t);
    const myArmies = selfLive.armies
      .map((id) => allArmies.get(id))
      .filter((a): a is Army => !!a);
    const knownTerritories = self.knownTerritories
      .map((id) => allTerritories.get(id))
      .filter((t): t is Territory => !!t);
    void knownTerritories;
    const myNeighborIds = new Set<string>();
    for (const t of myTerritories) {
      for (const nId of t.neighboring)
        myNeighborIds.add(nId);
    }
    const myNeighboringTerritories = Array.from(myNeighborIds)
      .map((id) => allTerritories.get(id))
      .filter((t): t is Territory => !!t);
    const unownedNeighbors = myNeighboringTerritories.filter((t) => t.owner === null);
    const enemyNeighbors = myNeighboringTerritories.filter((t) => {
      if (!t.owner || t.owner === self.id)
        return false;
      const rel = self.diplomacy.get(t.owner);
      return rel?.state === 'at_war' || rel?.state === 'hostile' || (rel?.opinion ?? 0) < -20;
    });
    const friendlyNeighbors = myNeighboringTerritories.filter((t) => {
      if (!t.owner || t.owner === self.id)
        return false;
      const rel = self.diplomacy.get(t.owner);
      return rel?.state === 'allied' || rel?.state === 'friendly' || (rel?.opinion ?? 0) > 20;
    });
    const knownEnemies: FactionId[] = [];
    const knownAllies: FactionId[] = [];
    const knownNeutrals: FactionId[] = [];
    for (const id of self.knownFactions) {
      if (id === self.id)
        continue;
      const rel = self.diplomacy.get(id);
      if (!rel) {
        knownNeutrals.push(id);
        continue;
      }
      if (rel.state === 'at_war' || rel.state === 'hostile')
        knownEnemies.push(id);
      else if (rel.state === 'allied' || rel.state === 'friendly')
        knownAllies.push(id);
      else
        knownNeutrals.push(id);
    }
    return {
      self: selfLive,
      gameState,
      allTerritories,
      allArmies,
      allFactions,
      myTerritories,
      myArmies,
      myNeighboringTerritories,
      unownedNeighbors,
      enemyNeighbors,
      friendlyNeighbors,
      knownEnemies,
      knownAllies,
      knownNeutrals,
    };
  }
}

const TERRITORY_ACTIONS = new Set<ActionType>([
  'ATTACK', 'BUILD', 'DEFEND', 'REINFORCE', 'MOVE', 'RETREAT',
]);
const FACTION_ACTIONS = new Set<ActionType>([
  'NEGOTIATE', 'TRADE', 'DECLARE_WAR', 'OFFER_PEACE',
]);

export function isActiveCommitmentStatus(status: CommitmentStatus): boolean {
  return status === 'pending' || status === 'committed' || status === 'executing';
}

/**
 * AI RUNTIME INTEGRATION PASS — faction elimination.
 *
 * A faction with zero territories AND zero armies has no meaningful
 * remaining presence: it cannot ATTACK/DEFEND/REINFORCE/BUILD (all
 * require an owned territory or army), and letting it keep running
 * `AI_DECIDE` only lets it fall back to faction-level actions
 * (NEGOTIATE/TRADE/DECLARE_WAR/OFFER_PEACE) or WAIT forever — a "ghost
 * empire" still transacting diplomacy with nothing behind it. No new
 * `GameState` field is introduced: elimination is fully derived from
 * `WarlordSnapshot.territories`/`armies`, which are already canonical, so
 * there is no second source of truth to keep in sync (and no exile/
 * comeback mechanic is implied — a faction that somehow regains a
 * territory or army is no longer "eliminated" by this same check).
 */
export function isFactionEliminated(snapshot: WarlordSnapshot): boolean {
  return snapshot.territories.length === 0 && snapshot.armies.length === 0;
}

export function cloneCommitment(c: AICommitment): AICommitment {
  return {
    ...c,
    reason: [...c.reason],
    factorBreakdown: c.factorBreakdown.map((f) => ({ ...f })),
  };
}

/**
 * Invalid targets fail the commitment (not interrupt): the intended action
 * can no longer be carried out against the recorded entity. The Decision
 * Engine then reassesses. A slightly better competing score is NOT a
 * reason to abandon a still-valid commitment.
 */
export function validateCommitmentTarget(
  commitment: AICommitment,
  gameState: GameStateSnapshot,
): { valid: boolean; reason: string } {
  const { action, targetId, warlordId } = commitment;
  if (action === 'WAIT')
    return { valid: true, reason: '' };

  if (TERRITORY_ACTIONS.has(action)) {
    if (!targetId) {
      // RETREAT/MOVE may score with no viable destination; that is a
      // valid (if weak) hold, not a missing entity.
      if (action === 'RETREAT' || action === 'MOVE')
        return { valid: true, reason: '' };
      return { valid: false, reason: 'missing territory target' };
    }
    const t = gameState.territories.get(targetId);
    if (!t)
      return { valid: false, reason: `territory ${targetId} no longer exists` };
    if (action === 'ATTACK') {
      if (!t.owner || t.owner === warlordId)
        return { valid: false, reason: 'attack target is no longer a foreign-owned territory' };
      if (isAttackForbiddenOnSnapshot(gameState, warlordId, t.owner)) {
        return { valid: false, reason: 'attack target is protected, paused, or the attacker is on cooldown' };
      }
    }
    if (action === 'DEFEND' || action === 'REINFORCE' || action === 'BUILD') {
      if (t.owner !== warlordId)
        return { valid: false, reason: 'territory is no longer owned by this faction' };
    }
    return { valid: true, reason: '' };
  }

  if (FACTION_ACTIONS.has(action)) {
    if (!targetId)
      return { valid: false, reason: 'missing faction target' };
    if (targetId === warlordId)
      return { valid: false, reason: 'cannot target self' };
    if (!gameState.factions.has(targetId))
      return { valid: false, reason: `faction ${targetId} no longer exists` };
    return { valid: true, reason: '' };
  }

  return { valid: true, reason: '' };
}

export class DecisionEngine {
  private scorer: ActionScorer;
  private rng: SeededRNG;

  constructor(seed?: number) {
    this.scorer = new ActionScorer();
    this.rng = new SeededRNG(seed ?? BALANCE.simulate.defaultSeed);
  }

  resetSeed(seed: number): void {
    this.rng = new SeededRNG(seed);
  }

  getRNG(): SeededRNG {
    return this.rng;
  }

  decide(warlord: WarlordState, gameState: GameStateSnapshot, turn: number): Decision {
    const existing = warlord.activeCommitment;
    if (existing && isActiveCommitmentStatus(existing.status)) {
      const validity = validateCommitmentTarget(existing, gameState);
      if (validity.valid)
        return this.decisionFromCommitment(warlord, existing, turn, gameState, false);
      this.failCommitment(warlord, validity.reason);
      // fall through: reassess after invalidation
    }

    warlord.goals.invalidateMissingTargets(gameState.factions.keys(), gameState.territories.keys());

    const self = warlord.snapshot;
    const ctx = WarlordState.buildContext(self, gameState);
    const factionRNG = this.rng.fork(hashFactionId(self.id) ^ turn);
    const scorerInput: ScorerInput = {
      ctx,
      turn,
      rng: factionRNG,
      memory: warlord.memory,
      goals: warlord.goals,
    };
    const allScored = this.scorer.scoreAllActions(scorerInput);
    if (allScored.length === 0) {
      const commitment = this.createCommitment(warlord, {
        action: 'WAIT',
        targetId: null,
        targetName: null,
        turn,
        reasoning: ['No available actions'],
        score: 0,
        confidence: 0,
        personalityBias: 0,
        ambitionInfluence: 0,
        factorBreakdown: [],
        originatingGoalId: null,
      });
      warlord.activeCommitment = commitment;
      recordLastAction(warlord.snapshot, turn, commitment.action, commitment.targetId);
      return this.decisionFromCommitment(warlord, commitment, turn, gameState, true);
    }
    const { selected, alternatives, confidence } = this.selectWithRandomness(allScored, factionRNG);
    const finalReasoning = [...selected.reasoning];
    if (finalReasoning.length === 0) {
      finalReasoning.push('default strategy');
    }
    const personalityBias = factorSum(selected.factorBreakdown, 'Personality bias');
    const ambitionInfluence =
      factorSum(selected.factorBreakdown, 'Ambition (goal persistence)')
      + factorSum(selected.factorBreakdown, 'Ambition (strategic push)');
    const originatingGoalId = this.originatingGoalId(warlord, selected, gameState, turn);
    const commitment = this.createCommitment(warlord, {
      action: selected.action,
      targetId: selected.targetId,
      targetName: selected.targetName,
      turn,
      reasoning: finalReasoning,
      score: selected.score,
      confidence,
      personalityBias,
      ambitionInfluence,
      factorBreakdown: selected.factorBreakdown.map((f) => ({ ...f })),
      originatingGoalId,
    });
    warlord.activeCommitment = commitment;
    recordLastAction(warlord.snapshot, turn, commitment.action, commitment.targetId);
    const decision = this.decisionFromCommitment(warlord, commitment, turn, gameState, true);
    decision.topAlternatives = alternatives.slice(0, 5);
    return decision;
  }

  beginExecution(warlord: WarlordState, reason = 'execution started'): AICommitment | null {
    return this.setCommitmentStatus(warlord, 'executing', reason, true);
  }

  completeCommitment(warlord: WarlordState, reason = 'completed'): AICommitment | null {
    return this.setCommitmentStatus(warlord, 'completed', reason, false);
  }

  interruptCommitment(warlord: WarlordState, reason = 'interrupted'): AICommitment | null {
    return this.setCommitmentStatus(warlord, 'interrupted', reason, false);
  }

  failCommitment(warlord: WarlordState, reason = 'failed'): AICommitment | null {
    return this.setCommitmentStatus(warlord, 'failed', reason, false);
  }

  private setCommitmentStatus(
    warlord: WarlordState,
    status: CommitmentStatus,
    reason: string,
    requireActive: boolean,
  ): AICommitment | null {
    const current = warlord.activeCommitment;
    if (!current)
      return null;
    if (requireActive && !isActiveCommitmentStatus(current.status))
      return cloneCommitment(current);
    const updated: AICommitment = {
      ...cloneCommitment(current),
      status,
      statusReason: reason,
      reason: current.reason.includes(reason) ? [...current.reason] : [...current.reason, reason],
    };
    warlord.activeCommitment = updated;
    if (!isActiveCommitmentStatus(status))
      warlord.lastTerminalCommitment = cloneCommitment(updated);
    return cloneCommitment(updated);
  }

  private createCommitment(warlord: WarlordState, params: {
    action: ActionType;
    targetId: string | null;
    targetName: string | null;
    turn: number;
    reasoning: string[];
    score: number;
    confidence: number;
    personalityBias: number;
    ambitionInfluence: number;
    factorBreakdown: AICommitment['factorBreakdown'];
    originatingGoalId: string | null;
  }): AICommitment {
    const seq = warlord.nextCommitmentSeq();
    const id = makeCommitmentId(
      this.rng.getSeed(),
      warlord.snapshot.id,
      params.turn,
      seq,
      params.action,
      params.targetId,
    );
    return {
      id,
      warlordId: warlord.snapshot.id,
      action: params.action,
      targetId: params.targetId,
      targetName: params.targetName,
      status: 'committed',
      createdTurn: params.turn,
      originatingGoalId: params.originatingGoalId,
      reason: [...params.reasoning],
      priority: params.score,
      score: params.score,
      confidence: params.confidence,
      personalityBias: params.personalityBias,
      ambitionInfluence: params.ambitionInfluence,
      factorBreakdown: params.factorBreakdown.map((f) => ({ ...f })),
      statusReason: null,
    };
  }

  private originatingGoalId(
    warlord: WarlordState,
    selected: ScoredAction,
    gameState: GameStateSnapshot,
    turn: number,
  ): string | null {
    const { targetFaction, targetTerritory } = inferTargets(selected.action, selected.targetId, gameState);
    const align = warlord.goals.evaluateActionAlignment({
      actionType: selected.action,
      targetFaction,
      targetTerritory,
      self: warlord.snapshot,
      currentTurn: turn,
      allTerritories: gameState.territories,
    });
    const top = [...align.alignedGoals].sort((a, b) => b.priority - a.priority)[0];
    return top?.id ?? null;
  }

  private decisionFromCommitment(
    warlord: WarlordState,
    commitment: AICommitment,
    turn: number,
    gameState: GameStateSnapshot,
    isNew: boolean,
  ): Decision {
    const cloned = cloneCommitment(commitment);
    let targetName = cloned.targetName;
    if (cloned.targetId) {
      const terr = gameState.territories.get(cloned.targetId);
      const fac = gameState.factions.get(cloned.targetId);
      if (terr)
        targetName = terr.id;
      else if (fac)
        targetName = fac.name;
    }
    return {
      warlordId: warlord.snapshot.id,
      warlordName: warlord.snapshot.name,
      turn,
      action: cloned.action,
      targetId: cloned.targetId,
      targetName,
      reasoning: [...cloned.reason],
      score: cloned.score,
      topAlternatives: [],
      confidence: cloned.confidence,
      commitment: cloned,
      isNewCommitment: isNew,
      originatingGoalId: cloned.originatingGoalId,
      ambitionInfluence: cloned.ambitionInfluence,
      personalityBias: cloned.personalityBias,
    };
  }

  private selectWithRandomness(scored: ScoredAction[], rng: SeededRNG): {
    selected: ScoredAction;
    alternatives: ScoredAction[];
    confidence: number;
  } {
    // AI DECISION CORRECTNESS PASS — bug fix (not a redesign).
    // The weighting/selection MATH below is unchanged: actions within
    // `tiebreakerRandomness * spread` of the top score ("candidates") are
    // weighted by normalized^2.5 score and picked via seeded RNG; a lone
    // leader is picked deterministically. That is intentional, meaningful
    // controlled variation and is left alone (see
    // docs/AI_DECISION_CORRECTNESS.md, "Action selection / randomness").
    //
    // The bug: candidates were built by mapping `sorted` into brand-new
    // `{ ...s, weight }` object copies, then `selected` was drawn from
    // those copies. `alternatives = sorted.filter((s) => s !== selected)`
    // compared by object reference — but `selected` was never
    // reference-equal to anything in `sorted` (it was always a copy), so
    // the filter never removed anything. `Decision.topAlternatives` (and
    // the verbose CLI "Alternatives:" list) therefore always included the
    // very action that had just been selected, listed as if it were a
    // distinct alternative. Fixed by tracking the chosen INDEX into
    // `sorted` instead of relying on copied-object identity.
    const sorted = [...scored].sort((a, b) => b.score - a.score);
    const maxScore = sorted[0]!.score;
    const minScore = sorted[sorted.length - 1]!.score;
    const spread = Math.max(1, maxScore - minScore);
    const weights = sorted.map((s) => {
      const norm = 0.1 + ((s.score - minScore) / spread) * 0.9;
      return Math.pow(norm, 2.5);
    });
    const tieThreshold = BALANCE.scoring.tiebreakerRandomness * spread;
    const candidateIndices = sorted
      .map((_, i) => i)
      .filter((i) => sorted[i]!.score >= maxScore - tieThreshold);
    let selectedIndex: number;
    let confidence: number;
    if (candidateIndices.length === 1) {
      selectedIndex = candidateIndices[0]!;
      confidence = Math.min(0.95, 0.5 + (maxScore - (sorted[1]?.score ?? maxScore - 10)) / spread);
    }
    else {
      const totalWeight = candidateIndices.reduce((s, i) => s + weights[i]!, 0);
      let r = rng.next() * totalWeight;
      selectedIndex = candidateIndices[0]!;
      for (const i of candidateIndices) {
        r -= weights[i]!;
        if (r <= 0) {
          selectedIndex = i;
          break;
        }
      }
      confidence = totalWeight > 0 ? weights[selectedIndex]! / totalWeight : 0;
    }
    const selected = sorted[selectedIndex]!;
    const alternatives = sorted.filter((_, i) => i !== selectedIndex);
    return { selected, alternatives, confidence };
  }

  decideAll(
    warlords: Map<FactionId, WarlordState>,
    gameState: GameStateSnapshot,
    turn: number,
    factionOrder?: FactionId[],
  ): Decision[] {
    const order = factionOrder ?? Array.from(warlords.keys()).sort();
    const results: Decision[] = [];
    for (const id of order) {
      const ws = warlords.get(id);
      if (!ws)
        continue;
      results.push(this.decide(ws, gameState, turn));
    }
    return results;
  }

  formatDecision(decision: Decision, verbose = false): string {
    const target = decision.targetName ? ` ${decision.targetName}` : '';
    const reason = decision.reasoning.length > 0
      ? decision.reasoning.slice(0, 5).join(', ')
      : 'no specific reason';
    let output = `${decision.warlordName.toUpperCase()}:\n  Decision: ${decision.action}${target}\n  Reason: ${reason}.`;
    if (decision.commitment) {
      const hold = decision.isNewCommitment ? 'new' : 'holding';
      output += `\n  Commitment: ${decision.commitment.id} [${decision.commitment.status}/${hold}]`;
      if (decision.originatingGoalId)
        output += `\n  Goal: ${decision.originatingGoalId}`;
    }
    if (verbose) {
      output += `\n  Score: ${decision.score.toFixed(1)} | Confidence: ${(decision.confidence * 100).toFixed(0)}%`;
      if (decision.personalityBias !== undefined || decision.ambitionInfluence !== undefined) {
        output += `\n  Personality bias: ${(decision.personalityBias ?? 0).toFixed(1)} | Ambition: ${(decision.ambitionInfluence ?? 0).toFixed(1)}`;
      }
      if (decision.topAlternatives.length > 0) {
        output += '\n  Alternatives:';
        for (const alt of decision.topAlternatives.slice(0, 3)) {
          const tn = alt.targetName ? ` ${alt.targetName}` : '';
          output += `\n    - ${alt.action}${tn} (${alt.score.toFixed(1)})`;
        }
      }
    }
    return output;
  }

  formatTurnReport(turn: number, decisions: Decision[], verbose = false): string {
    const lines: string[] = [];
    lines.push('');
    lines.push('='.repeat(50));
    lines.push(`TURN ${turn}`);
    lines.push('='.repeat(50));
    for (const d of decisions) {
      lines.push(this.formatDecision(d, verbose));
      lines.push('');
    }
    return lines.join('\n');
  }
}

/**
 * AI RUNTIME INTEGRATION PASS — bug fix, not a new mechanism.
 * `ScoringHelpers`/`ActionScorer.scoreWait` already reads
 * `ctx.self.lastActions` to penalize consecutive WAITs, and
 * `src/simulation/cli.ts`'s legacy demo loop already pushes onto it — but
 * nothing on the CANONICAL `Orchestrator` → `AI_DECIDE` path
 * (`handleAiDecide` → `DecisionEngine.decide`) ever did, so in the actual
 * continuous-world runtime `lastActions` was always empty and that
 * anti-repetition logic never fired. Fixed here, at the single place a
 * new commitment is created, so every caller of `decide()` benefits
 * (CLI demo, tests, Orchestrator) without duplicating the bookkeeping.
 * Same cap (20) the CLI already used.
 */
function recordLastAction(
  snapshot: WarlordSnapshot,
  turn: number,
  action: ActionType,
  targetId: string | null,
): void {
  snapshot.lastActions.unshift({ turn, action, target: targetId });
  if (snapshot.lastActions.length > 20) {
    snapshot.lastActions.length = 20;
  }
}

function factorSum(factors: { factor: string; contribution: number }[], name: string): number {
  return factors.filter((f) => f.factor === name).reduce((s, f) => s + f.contribution, 0);
}

function inferTargets(
  action: ActionType,
  targetId: string | null,
  gameState: GameStateSnapshot,
): { targetFaction: FactionId | null; targetTerritory: string | null } {
  if (!targetId)
    return { targetFaction: null, targetTerritory: null };
  if (FACTION_ACTIONS.has(action))
    return { targetFaction: targetId, targetTerritory: null };
  const terr = gameState.territories.get(targetId);
  if (terr)
    return { targetFaction: terr.owner, targetTerritory: terr.id };
  if (gameState.factions.has(targetId))
    return { targetFaction: targetId, targetTerritory: null };
  return { targetFaction: null, targetTerritory: null };
}

function makeCommitmentId(
  seed: number,
  warlordId: string,
  turn: number,
  seq: number,
  action: string,
  targetId: string | null,
): string {
  const seedPart = (seed >>> 0).toString(36);
  const facPart = hashFactionId(warlordId).toString(36);
  const seqPart = seq.toString(36);
  const tgt = (targetId ?? 'none').replace(/[^a-zA-Z0-9_-]/g, '_');
  return `cmt_${seedPart}_${facPart}_${turn}_${seqPart}_${action}_${tgt}`;
}

function hashFactionId(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) {
    h = ((h << 5) - h) + id.charCodeAt(i);
    h |= 0;
  }
  return h >>> 0;
}
