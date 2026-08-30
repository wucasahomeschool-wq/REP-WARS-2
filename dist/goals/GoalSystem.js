"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GoalSystem = void 0;
const balance_1 = require("../constants/balance");
class GoalSystem {
    constructor(initialGoals = []) {
        this.goals = [];
        this.nextId = 0;
        this.goals = [...initialGoals];
        for (const g of initialGoals) {
            const parsed = parseInt(g.id.replace('goal_', ''));
            if (!isNaN(parsed) && parsed >= this.nextId)
                this.nextId = parsed + 1;
        }
    }
    addGoal(params) {
        const goal = {
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
    getActiveGoals(currentTurn) {
        return this.goals.filter((g) => {
            if (g.progress >= g.targetProgress)
                return false;
            if (g.deadlineTurn !== null && currentTurn > g.deadlineTurn)
                return false;
            return true;
        }).sort((a, b) => b.priority - a.priority);
    }
    getAllGoals() {
        return [...this.goals];
    }
    updateProgress(goalId, delta) {
        const goal = this.goals.find((g) => g.id === goalId);
        if (!goal)
            return false;
        goal.progress = Math.max(0, Math.min(goal.targetProgress, goal.progress + delta));
        return true;
    }
    removeGoal(goalId) {
        const idx = this.goals.findIndex((g) => g.id === goalId);
        if (idx < 0)
            return false;
        this.goals.splice(idx, 1);
        return true;
    }
    evaluateActionAlignment(params) {
        const active = this.getActiveGoals(params.currentTurn);
        const alignedGoals = [];
        const misalignedGoals = [];
        const relevant = [];
        let scoreBonus = 0;
        let scorePenalty = 0;
        for (const goal of active) {
            const alignment = this.checkAlignment(goal, params);
            if (alignment === 'aligned') {
                alignedGoals.push(goal);
                const priorityFactor = goal.priority / 100;
                const progressBonus = (goal.progress / goal.targetProgress) * balance_1.BALANCE.goals.progressBonusFactor;
                scoreBonus += balance_1.BALANCE.goals.goalAlignmentBonus * priorityFactor * (1 + progressBonus);
                relevant.push({ goal, alignment: 'aligned' });
            }
            else if (alignment === 'misaligned') {
                misalignedGoals.push(goal);
                const priorityFactor = goal.priority / 100;
                scorePenalty += balance_1.BALANCE.goals.goalMisalignmentPenalty * priorityFactor;
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
    checkAlignment(goal, params) {
        const { actionType, targetFaction, targetTerritory } = params;
        switch (goal.type) {
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
            case 'control_region':
                if (targetTerritory && goal.targetRegion) {
                    const terr = params.allTerritories.get(targetTerritory);
                    const terrRegion = terr?.id.split('_')[0];
                    if (actionType === 'ATTACK' && terrRegion === goal.targetRegion)
                        return 'aligned';
                    if (actionType === 'EXPAND' && terrRegion === goal.targetRegion)
                        return 'aligned';
                }
                if (actionType === 'BUILD' && targetTerritory)
                    return 'aligned';
                break;
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
                if (actionType === 'EXPAND' || actionType === 'ATTACK') {
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
                if (actionType === 'ATTACK' || actionType === 'EXPAND' || actionType === 'DECLARE_WAR')
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
                if (actionType === 'BUILD' || actionType === 'TRADE' || actionType === 'SCOUT')
                    return 'aligned';
                if (actionType === 'DECLARE_WAR' || actionType === 'ATTACK')
                    return 'misaligned';
                break;
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
    static generateInitialGoals(personalityType, factionId, currentTurn, rng) {
        const goals = [];
        const idCounter = { value: 0 };
        const makeGoal = (type, priority, extras = {}) => ({
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
                goals.push(makeGoal('control_region', 75, { targetProgress: 100 }));
                goals.push(makeGoal('dominant_faction', 60));
                break;
            case 'opportunistic':
                goals.push(makeGoal('expand_to_resources', 70));
                goals.push(makeGoal('control_region', 50, { targetProgress: 100 }));
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
        return goals;
    }
    trimGoals() {
        if (this.goals.length > balance_1.BALANCE.goals.maxActiveGoals * 3) {
            this.goals.sort((a, b) => b.priority - a.priority);
            this.goals = this.goals.slice(0, balance_1.BALANCE.goals.maxActiveGoals * 3);
        }
    }
}
exports.GoalSystem = GoalSystem;
//# sourceMappingURL=GoalSystem.js.map