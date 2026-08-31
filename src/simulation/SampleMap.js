"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SimulationBuilder = exports.WARLORD_SPECS = exports.SAMPLE_MAP = void 0;
const SeededRNG_1 = require("../utils/SeededRNG");
const PersonalitySystem_1 = require("../personality/PersonalitySystem");
const GoalSystem_1 = require("../goals/GoalSystem");
const MemorySystem_1 = require("../memory/MemorySystem");
const DecisionEngine_1 = require("../engine/DecisionEngine");
const balance_1 = require("../constants/balance");
exports.SAMPLE_MAP = [
    { id: 'north_valley', name: 'Northern Valley', terrain: 'plains', neighbors: ['north_pass', 'east_marches', 'central_plains'], population: 25000, baseValue: 30, resourceOutput: { food: 25, gold: 10 }, fortification: 1, garrison: 150, isCapital: false, owner: 'ashen_horde' },
    { id: 'north_pass', name: 'Mountain Pass', terrain: 'mountain', neighbors: ['north_valley', 'frozen_peaks'], population: 8000, baseValue: 25, resourceOutput: { iron: 20, stone: 25 }, fortification: 2, garrison: 250, isCapital: false, owner: 'ashen_horde' },
    { id: 'frozen_peaks', name: 'Frozen Peaks', terrain: 'mountain', neighbors: ['north_pass', 'icehold'], population: 5000, baseValue: 40, resourceOutput: { iron: 35, stone: 30 }, fortification: 3, garrison: 400, isCapital: true, owner: 'ashen_horde' },
    { id: 'icehold', name: 'Icehold', terrain: 'fortress', neighbors: ['frozen_peaks'], population: 12000, baseValue: 50, resourceOutput: { gold: 20, iron: 10 }, fortification: 5, garrison: 600, isCapital: false, owner: 'ashen_horde' },
    { id: 'east_marches', name: 'Eastern Marches', terrain: 'plains', neighbors: ['north_valley', 'central_plains', 'eastern_hills', 'emerald_forest'], population: 20000, baseValue: 28, resourceOutput: { food: 20, wood: 15 }, fortification: 1, garrison: 180, isCapital: false, owner: null },
    { id: 'emerald_forest', name: 'Emerald Forest', terrain: 'forest', neighbors: ['east_marches', 'eastern_hills', 'river_crossing', 'iron_kingdom_east'], population: 18000, baseValue: 35, resourceOutput: { wood: 40, food: 10 }, fortification: 1, garrison: 100, isCapital: false, owner: null },
    { id: 'eastern_hills', name: 'Eastern Hills', terrain: 'forest', neighbors: ['east_marches', 'emerald_forest', 'iron_kingdom_east', 'golden_hills'], population: 15000, baseValue: 30, resourceOutput: { wood: 25, iron: 15 }, fortification: 1, garrison: 120, isCapital: false, owner: null },
    { id: 'central_plains', name: 'Central Plains', terrain: 'plains', neighbors: ['north_valley', 'east_marches', 'river_crossing', 'western_reach', 'south_steppes'], population: 40000, baseValue: 45, resourceOutput: { food: 50, gold: 20 }, fortification: 2, garrison: 300, isCapital: false, owner: null },
    { id: 'river_crossing', name: 'River Crossing', terrain: 'river', neighbors: ['emerald_forest', 'central_plains', 'western_reach', 'iron_spire', 'greenfields'], population: 22000, baseValue: 38, resourceOutput: { food: 30, wood: 10, gold: 15 }, fortification: 2, garrison: 200, isCapital: false, owner: null },
    { id: 'greenfields', name: 'Greenfields', terrain: 'plains', neighbors: ['river_crossing', 'iron_spire', 'south_coast', 'western_reach'], population: 30000, baseValue: 38, resourceOutput: { food: 40, gold: 18 }, fortification: 1, garrison: 160, isCapital: false, owner: null },
    { id: 'iron_spire', name: 'Iron Spire', terrain: 'fortress', neighbors: ['river_crossing', 'greenfields', 'iron_kingdom_east', 'deep_iron_mines', 'south_coast'], population: 35000, baseValue: 60, resourceOutput: { iron: 45, gold: 30, stone: 20 }, fortification: 5, garrison: 800, isCapital: true, owner: 'iron_kingdom' },
    { id: 'iron_kingdom_east', name: 'Eastern Ironhold', terrain: 'mountain', neighbors: ['eastern_hills', 'emerald_forest', 'iron_spire', 'deep_iron_mines'], population: 18000, baseValue: 35, resourceOutput: { iron: 40, stone: 25 }, fortification: 2, garrison: 300, isCapital: false, owner: 'iron_kingdom' },
    { id: 'deep_iron_mines', name: 'Deep Iron Mines', terrain: 'mountain', neighbors: ['iron_spire', 'iron_kingdom_east', 'south_coast'], population: 12000, baseValue: 45, resourceOutput: { iron: 60, stone: 35 }, fortification: 3, garrison: 400, isCapital: false, owner: 'iron_kingdom' },
    { id: 'western_reach', name: 'Western Reach', terrain: 'plains', neighbors: ['central_plains', 'river_crossing', 'greenfields', 'south_steppes', 'crescent_harbor'], population: 28000, baseValue: 32, resourceOutput: { food: 30, wood: 10, gold: 15 }, fortification: 1, garrison: 180, isCapital: false, owner: 'merchant_republic' },
    { id: 'crescent_harbor', name: 'Crescent Harbor', terrain: 'coastal', neighbors: ['western_reach', 'south_steppes', 'salt_marches'], population: 32000, baseValue: 55, resourceOutput: { gold: 60, food: 20 }, fortification: 3, garrison: 350, isCapital: true, owner: 'merchant_republic' },
    { id: 'salt_marches', name: 'Salt Marshes', terrain: 'coastal', neighbors: ['crescent_harbor', 'south_coast', 'merchant_south'], population: 15000, baseValue: 25, resourceOutput: { gold: 25, food: 15 }, fortification: 1, garrison: 150, isCapital: false, owner: 'merchant_republic' },
    { id: 'south_steppes', name: 'Southern Steppes', terrain: 'desert', neighbors: ['central_plains', 'western_reach', 'crescent_harbor', 'south_coast', 'burning_desert'], population: 20000, baseValue: 22, resourceOutput: { gold: 15, food: 10, iron: 5 }, fortification: 1, garrison: 100, isCapital: false, owner: null },
    { id: 'south_coast', name: 'Southern Coast', terrain: 'coastal', neighbors: ['greenfields', 'iron_spire', 'deep_iron_mines', 'salt_marches', 'south_steppes', 'burning_desert', 'merchant_south'], population: 25000, baseValue: 33, resourceOutput: { food: 25, gold: 25, wood: 5 }, fortification: 1, garrison: 180, isCapital: false, owner: null },
    { id: 'merchant_south', name: 'Southern Tradespire', terrain: 'coastal', neighbors: ['salt_marches', 'south_coast'], population: 20000, baseValue: 40, resourceOutput: { gold: 45, food: 10 }, fortification: 2, garrison: 220, isCapital: false, owner: 'merchant_republic' },
    { id: 'burning_desert', name: 'Burning Desert', terrain: 'desert', neighbors: ['south_steppes', 'south_coast'], population: 6000, baseValue: 20, resourceOutput: { gold: 30, iron: 10 }, fortification: 0, garrison: 50, isCapital: false, owner: null },
    { id: 'golden_hills', name: 'Golden Hills', terrain: 'plains', neighbors: ['eastern_hills'], population: 10000, baseValue: 35, resourceOutput: { gold: 40, food: 12 }, fortification: 0, garrison: 80, isCapital: false, owner: null },
];
exports.WARLORD_SPECS = [
    {
        id: 'ashen_horde',
        name: 'Ashen Horde',
        personality: 'aggressive',
        personalityVariant: 0.1,
        startingTerritories: ['north_valley', 'north_pass', 'frozen_peaks', 'icehold'],
        startingArmy: { soldiers: 2500, knights: 400, siege: 15 },
        startingResources: { gold: 1500, food: 2500, iron: 600, wood: 500, stone: 300 },
        startingIncome: { gold: 120, food: 200, iron: 80, wood: 60, stone: 40 },
        relationships: [
            { target: 'iron_kingdom', state: 'tense', opinion: -35 },
            { target: 'merchant_republic', state: 'neutral', opinion: 0 },
            { target: 'celestial_theocracy', state: 'hostile', opinion: -50 },
        ],
    },
    {
        id: 'iron_kingdom',
        name: 'Iron Kingdom',
        personality: 'defensive',
        personalityVariant: 0.08,
        startingTerritories: ['iron_spire', 'iron_kingdom_east', 'deep_iron_mines'],
        startingArmy: { soldiers: 2200, knights: 350, siege: 25 },
        startingResources: { gold: 2500, food: 2000, iron: 1500, wood: 600, stone: 800 },
        startingIncome: { gold: 180, food: 160, iron: 220, wood: 80, stone: 120 },
        relationships: [
            { target: 'ashen_horde', state: 'tense', opinion: -30 },
            { target: 'merchant_republic', state: 'friendly', opinion: 35 },
            { target: 'celestial_theocracy', state: 'neutral', opinion: 10 },
        ],
    },
    {
        id: 'merchant_republic',
        name: 'Merchant Republic',
        personality: 'economic',
        personalityVariant: 0.12,
        startingTerritories: ['western_reach', 'crescent_harbor', 'salt_marches', 'merchant_south'],
        startingArmy: { soldiers: 1800, knights: 200, siege: 10 },
        startingResources: { gold: 4500, food: 2200, iron: 400, wood: 700, stone: 350 },
        startingIncome: { gold: 280, food: 180, iron: 50, wood: 100, stone: 50 },
        relationships: [
            { target: 'iron_kingdom', state: 'friendly', opinion: 40 },
            { target: 'ashen_horde', state: 'neutral', opinion: 5 },
            { target: 'celestial_theocracy', state: 'tense', opinion: -20 },
        ],
    },
    {
        id: 'celestial_theocracy',
        name: 'Celestial Theocracy',
        personality: 'diplomatic',
        personalityVariant: 0.05,
        startingTerritories: [],
        startingArmy: { soldiers: 0, knights: 0, siege: 0 },
        startingResources: { gold: 3500, food: 3000, iron: 300, wood: 400, stone: 400 },
        startingIncome: { gold: 100, food: 100, iron: 20, wood: 40, stone: 30 },
        relationships: [
            { target: 'ashen_horde', state: 'hostile', opinion: -45 },
            { target: 'iron_kingdom', state: 'neutral', opinion: 15 },
            { target: 'merchant_republic', state: 'tense', opinion: -15 },
        ],
    },
];
class SimulationBuilder {
    static buildFromSpecs(mapSpecs, warlordSpecs, seed = balance_1.BALANCE.simulate.defaultSeed) {
        const rng = new SeededRNG_1.SeededRNG(seed);
        const territories = new Map();
        const armies = new Map();
        const factions = new Map();
        const warlordStates = new Map();
        let armyIdCounter = 0;
        for (const spec of mapSpecs) {
            territories.set(spec.id, {
                id: spec.id,
                name: spec.name,
                terrain: spec.terrain,
                neighboring: spec.neighbors,
                population: spec.population,
                baseValue: spec.baseValue,
                resourceOutput: { ...spec.resourceOutput },
                fortification: spec.fortification,
                garrison: spec.garrison,
                isCapital: spec.isCapital,
                owner: spec.owner,
                isKnown: true,
                scoutedTurnsAgo: 0,
            });
        }
        const factionIds = warlordSpecs.map((s) => s.id);
        for (const spec of warlordSpecs) {
            const personality = PersonalitySystem_1.PersonalitySystem.randomizePreset(spec.personality, spec.personalityVariant, rng);
            const diplomacy = new Map();
            for (const rel of spec.relationships) {
                diplomacy.set(rel.target, {
                    target: rel.target,
                    state: rel.state,
                    opinion: rel.opinion,
                    treaties: [],
                    yearsAtPeace: rel.state === 'at_war' ? 0 : 10,
                    yearsAtWar: rel.state === 'at_war' ? 2 : 0,
                });
            }
            for (const fid of factionIds) {
                if (fid !== spec.id && !diplomacy.has(fid)) {
                    diplomacy.set(fid, {
                        target: fid,
                        state: 'neutral',
                        opinion: 0,
                        treaties: [],
                        yearsAtPeace: 5,
                        yearsAtWar: 0,
                    });
                }
            }
            const myArmyIds = [];
            if (spec.startingArmy.soldiers + spec.startingArmy.knights > 0 && spec.startingTerritories.length > 0) {
                const mainArmyId = `army_${armyIdCounter++}`;
                const capitalT = spec.startingTerritories.find((tid) => territories.get(tid)?.isCapital) ?? spec.startingTerritories[0];
                armies.set(mainArmyId, {
                    id: mainArmyId,
                    owner: spec.id,
                    location: capitalT,
                    soldiers: spec.startingArmy.soldiers,
                    knights: spec.startingArmy.knights,
                    siegeEngines: spec.startingArmy.siege,
                    morale: 80 + Math.floor(rng.next() * 20),
                    supply: 70 + Math.floor(rng.next() * 30),
                });
                myArmyIds.push(mainArmyId);
            }
            const goals = GoalSystem_1.GoalSystem.generateInitialGoals(spec.personality, spec.id, 0, rng);
            const knownTerritories = new Set();
            for (const tid of spec.startingTerritories) {
                knownTerritories.add(tid);
                const t = territories.get(tid);
                if (t)
                    for (const n of t.neighboring)
                        knownTerritories.add(n);
            }
            const knownFactions = new Set([spec.id]);
            for (const tid of knownTerritories) {
                const t = territories.get(tid);
                if (t?.owner)
                    knownFactions.add(t.owner);
            }
            for (const rel of spec.relationships)
                knownFactions.add(rel.target);
            const snapshot = {
                id: spec.id,
                name: spec.name,
                personality,
                territories: [...spec.startingTerritories],
                armies: myArmyIds,
                totalMilitaryPower: 0,
                resources: { ...spec.startingResources },
                resourceIncome: { ...spec.startingIncome },
                diplomacy,
                memory: [],
                goals,
                currentThreats: [],
                knownFactions: Array.from(knownFactions).filter((f) => factionIds.includes(f)),
                knownTerritories: Array.from(knownTerritories),
                lastActions: [],
                reputation: 50 + Math.floor(rng.next() * 30 - 15),
                stability: 70 + Math.floor(rng.next() * 30),
            };
            const ws = new DecisionEngine_1.WarlordState(snapshot, new MemorySystem_1.MemorySystem(), new GoalSystem_1.GoalSystem(snapshot.goals));
            warlordStates.set(spec.id, ws);
            factions.set(spec.id, snapshot);
        }
        for (const [id, snap] of factions) {
            const ws = warlordStates.get(id);
            const ctx = DecisionEngine_1.WarlordState.buildContext(snap, {
                turn: 0,
                factions,
                territories,
                armies,
                allFactionIds: factionIds,
            });
            let totalPower = 0;
            for (const aid of snap.armies) {
                const a = armies.get(aid);
                if (a) {
                    totalPower += a.soldiers * balance_1.BALANCE.military.soldierValue
                        + a.knights * balance_1.BALANCE.military.knightValue
                        + a.siegeEngines * balance_1.BALANCE.military.siegeValue;
                }
            }
            for (const t of ctx.myTerritories)
                totalPower += t.garrison * balance_1.BALANCE.military.soldierValue;
            snap.totalMilitaryPower = totalPower;
        }
        const gameState = {
            turn: 0,
            factions,
            territories,
            armies,
            allFactionIds: factionIds,
        };
        return { gameState, warlordStates };
    }
}
exports.SimulationBuilder = SimulationBuilder;
//# sourceMappingURL=SampleMap.js.map