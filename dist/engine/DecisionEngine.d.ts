import { WarlordSnapshot, GameStateSnapshot, ActionContext, Decision, FactionId } from '../types';
import { SeededRNG } from '../utils/SeededRNG';
import { MemorySystem } from '../memory/MemorySystem';
import { GoalSystem } from '../goals/GoalSystem';
export declare class WarlordState {
    snapshot: WarlordSnapshot;
    memory: MemorySystem;
    goals: GoalSystem;
    constructor(snapshot: WarlordSnapshot, memory?: MemorySystem, goals?: GoalSystem);
    static buildContext(self: WarlordSnapshot, gameState: GameStateSnapshot): ActionContext;
}
export declare class DecisionEngine {
    private scorer;
    private rng;
    constructor(seed?: number);
    resetSeed(seed: number): void;
    getRNG(): SeededRNG;
    decide(warlord: WarlordState, gameState: GameStateSnapshot, turn: number): Decision;
    private selectWithRandomness;
    decideAll(warlords: Map<FactionId, WarlordState>, gameState: GameStateSnapshot, turn: number, factionOrder?: FactionId[]): Decision[];
    formatDecision(decision: Decision, verbose?: boolean): string;
    formatTurnReport(turn: number, decisions: Decision[], verbose?: boolean): string;
}
