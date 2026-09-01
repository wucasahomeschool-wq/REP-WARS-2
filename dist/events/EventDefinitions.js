"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.EVENT_LIST = exports.EVENT_REGISTRY = void 0;
exports.getEventById = getEventById;
exports.evaluateAllTriggersForTerritory = evaluateAllTriggersForTerritory;
const balance_1 = require("../constants/balance");
const EventModel_1 = require("./EventModel");
const EventTriggers_1 = require("./EventTriggers");
const B = balance_1.BALANCE.events;
const BT = B.trigger;
const BC = B.consequenceMagnitudes;
const BH = B.choices;
const T = B.thresholds;
const BN = B.chain;
function terrName(ctx) {
    if (!ctx.territoryId)
        return 'Unknown';
    return ctx.helper.getTerritory(ctx.territoryId)?.name ?? ctx.territoryId;
}
function scale(sev, base) {
    return Math.round(base * (0, EventModel_1.severityScale)(sev));
}
// ────────────────────────────────────────────
// 1. DROUGHT (environmental)
// ────────────────────────────────────────────
const DROUGHT = {
    id: 'evt_drought',
    typeId: 'drought',
    category: 'environmental',
    categoryLabel: 'Environmental',
    titleTemplate: (sev, loc, world) => {
        const t = loc && world ? world.territories.get(loc)?.name ?? '' : '';
        return 'Drought — ' + (t || 'a territory');
    },
    descriptionTemplate: (sev, ctx) => {
        const loc = terrName(ctx);
        if (sev === 'critical')
            return loc + ' suffers catastrophic drought — reservoirs empty and agriculture collapses.';
        if (sev === 'severe')
            return 'A severe drought parches ' + loc + ', threatening harvests and water supplies.';
        if (sev === 'moderate')
            return 'Rainfall has been unusually low in ' + loc + '. Crops wither, rivers shrink, and the land grows parched.';
        return 'A mild drought has begun in ' + loc + '; the harvest may be reduced.';
    },
    causes: ['Low rainfall', 'Agricultural region', 'Climate patterns'],
    target: 'territory',
    defaultDuration: { min: 3, max: 6 },
    severityTable: (0, EventModel_1.buildDefaultSeverityTable)(),
    canChainFrom: [{ toEventId: 'evt_food_shortage', baseProb: BN.droughtToFoodShortageProb, delayMinTurns: BN.droughtToFoodShortageDelayMin }],
    onTrigger: (ctx, sev) => {
        const loc = ctx.territoryId;
        const scaleVal = (0, EventModel_1.severityScale)(sev);
        const consequences = [{
                territoryId: loc,
                delta: { foodProductionPct: BC.droughtFoodProductionPctPerSeverity * scaleVal },
                message: 'Food production reduced by ' + Math.round(BC.droughtFoodProductionPctPerSeverity * scaleVal * 100) + '%',
            }];
        if (sev === 'severe' || sev === 'critical') {
            consequences.push({
                territoryId: loc,
                delta: { infrastructureDeltaPct: BC.droughtInfrastructurePctPerSeverity * scaleVal },
                message: 'Irrigation infrastructure degraded',
            });
        }
        return { reasons: ['Low rainfall pattern'], consequences };
    },
    perTurn: (_ctx, sev, active) => {
        const scaleVal = (0, EventModel_1.severityScale)(sev);
        return [{
                territoryId: active.territoryId,
                delta: { foodProductionPct: BC.droughtFoodProductionPctPerSeverity * scaleVal * 0.3 },
                message: 'Persistent drought continues to suppress agriculture',
            }];
    },
};
// ────────────────────────────────────────────
// 2. FLOOD (environmental)
// ────────────────────────────────────────────
const FLOOD = {
    id: 'evt_flood',
    typeId: 'flood',
    category: 'environmental',
    categoryLabel: 'Environmental',
    titleTemplate: (sev, loc, world) => {
        const t = loc && world ? world.territories.get(loc)?.name ?? '' : '';
        return 'Flood — ' + (t || 'a territory');
    },
    descriptionTemplate: (sev, ctx) => {
        const loc = terrName(ctx);
        if (sev === 'critical')
            return 'Catastrophic floodwaters have submerged ' + loc + '; entire villages are swept away.';
        if (sev === 'severe')
            return 'Severe floods batter ' + loc + '; rivers burst their banks and damage settlements.';
        if (sev === 'moderate')
            return 'Heavy rains have caused moderate flooding across ' + loc + '.';
        return 'Minor floodwaters rise in ' + loc + '; some fields are submerged but losses are modest.';
    },
    causes: ['Heavy rainfall', 'River proximity', 'Storm runoff'],
    target: 'territory',
    defaultDuration: { min: 1, max: 3 },
    severityTable: (0, EventModel_1.buildDefaultSeverityTable)(),
    onTrigger: (ctx, sev) => {
        const loc = ctx.territoryId;
        const scaleVal = (0, EventModel_1.severityScale)(sev);
        const pop = ctx.helper.getTerritory(loc)?.population ?? 0;
        const consequences = [{
                territoryId: loc,
                delta: { populationDeltaAbs: Math.round(BC.floodPopulationPctPerSeverity * scaleVal * pop) },
                message: 'Population affected by floodwaters',
            }, {
                territoryId: loc,
                delta: { infrastructureDeltaPct: BC.floodInfrastructurePctPerSeverity * scaleVal },
                message: 'Infrastructure damaged by floodwaters',
            }, {
                territoryId: loc,
                delta: { foodProductionPct: BC.floodFoodProductionPctPerSeverity * scaleVal },
                message: 'Flood-silt replenishment restores some arable land fertility',
            }];
        return { reasons: ['Heavy seasonal rainfall'], consequences };
    },
};
// ────────────────────────────────────────────
// 3. STORM (environmental)
// ────────────────────────────────────────────
const STORM = {
    id: 'evt_storm',
    typeId: 'storm',
    category: 'environmental',
    categoryLabel: 'Environmental',
    titleTemplate: (sev, loc, world) => {
        const t = loc && world ? world.territories.get(loc)?.name ?? '' : '';
        return 'Severe Storm — ' + (t || 'a territory');
    },
    descriptionTemplate: (sev, ctx) => {
        const loc = terrName(ctx);
        if (sev === 'critical')
            return 'A hurricane-force storm strikes ' + loc + '; roofs are torn off and coastal flooding is widespread.';
        if (sev === 'severe')
            return 'A severe storm batters ' + loc + '; trade and military readiness decline.';
        if (sev === 'moderate')
            return 'A strong storm sweeps through ' + loc + '.';
        return 'A storm passes over ' + loc + ', causing minor disruption.';
    },
    causes: ['Atmospheric disturbance', 'Coastal weather', 'Seasonal winds'],
    target: 'territory',
    defaultDuration: { min: 1, max: 2 },
    severityTable: (0, EventModel_1.buildDefaultSeverityTable)(),
    isInstant: true,
    onTrigger: (ctx, sev) => {
        const loc = ctx.territoryId;
        const scaleVal = (0, EventModel_1.severityScale)(sev);
        const consequences = [{
                territoryId: loc,
                delta: { foodProductionPct: BC.stormFoodProductionPctPerSeverity * scaleVal },
                message: 'Harvests damaged by storm winds',
            }];
        if (sev !== 'minor') {
            consequences.push({
                territoryId: loc,
                delta: { garrisonDeltaAbs: scale(sev, BC.stormGarrisonDeltaAbsPerSeverity) },
                message: 'Garrison readiness reduced by storm disruption',
            });
        }
        return { reasons: ['Seasonal weather system'], consequences };
    },
};
// ────────────────────────────────────────────
// 4. HARSH WINTER (environmental)
// ────────────────────────────────────────────
const HARSH_WINTER = {
    id: 'evt_harsh_winter',
    typeId: 'harsh_winter',
    category: 'environmental',
    categoryLabel: 'Environmental',
    titleTemplate: (sev, loc, world) => {
        const t = loc && world ? world.territories.get(loc)?.name ?? '' : '';
        return 'Harsh Winter — ' + (t || 'a territory');
    },
    descriptionTemplate: (sev, ctx) => {
        const loc = terrName(ctx);
        if (sev === 'critical')
            return 'The worst winter in a generation freezes ' + loc + ' deep; roads close and populations suffer.';
        if (sev === 'severe')
            return 'A brutal winter descends on ' + loc + '; supplies dwindle and unrest simmers.';
        if (sev === 'moderate')
            return 'A harsh winter sets in across ' + loc + '.';
        return 'An unseasonably cold winter grips ' + loc + '.';
    },
    causes: ['Cold air mass', 'Snowfall', 'Northern latitude'],
    target: 'territory',
    defaultDuration: { min: 2, max: 4 },
    severityTable: (0, EventModel_1.buildDefaultSeverityTable)(),
    onTrigger: (ctx, sev) => {
        const loc = ctx.territoryId;
        const owner = ctx.helper.getTerritory(loc)?.owner ?? null;
        const scaleVal = (0, EventModel_1.severityScale)(sev);
        const consequences = [{
                territoryId: loc,
                factionId: owner,
                delta: { stabilityDelta: Math.round(BC.harshWinterStabilityDeltaPerSeverity * scaleVal) },
                message: 'Stability declines from harsh conditions',
            }, {
                territoryId: loc,
                delta: { foodProductionPct: BC.harshWinterFoodProductionPctPerSeverity * scaleVal },
                message: 'Winter frost suppresses winter crop yields',
            }];
        return { reasons: ['Seasonal cold wave'], consequences };
    },
    perTurn: (ctx, sev, active) => {
        const scaleVal = (0, EventModel_1.severityScale)(sev);
        const owner = ctx.helper.getTerritory(active.territoryId)?.owner ?? null;
        return [{
                territoryId: active.territoryId,
                factionId: owner,
                delta: { stabilityDelta: Math.round(BC.harshWinterStabilityDeltaPerSeverity * scaleVal * 0.3) },
                message: 'Winter cold continues to strain morale',
            }];
    },
};
// ────────────────────────────────────────────
// 5. RESOURCE DISCOVERY (environmental — positive, instant)
// ────────────────────────────────────────────
const RESOURCE_DISCOVERY = {
    id: 'evt_resource_discovery',
    typeId: 'resource_discovery',
    category: 'environmental',
    categoryLabel: 'Environmental (Boons)',
    titleTemplate: (sev, loc, world) => {
        const t = loc && world ? world.territories.get(loc)?.name ?? '' : '';
        return 'Resource Discovery — ' + (t || 'a territory');
    },
    descriptionTemplate: (sev, ctx) => {
        const loc = terrName(ctx);
        if (sev === 'critical')
            return 'An extraordinary new lode of resources is struck in ' + loc + ' — prospectors flock!';
        if (sev === 'severe')
            return 'Prospectors in ' + loc + ' uncover a rich new resource deposit.';
        if (sev === 'moderate')
            return 'A useful new resource vein is found in ' + loc + '.';
        return 'Small but valuable resources are uncovered in ' + loc + '.';
    },
    causes: ['Exploration', 'Geological survey', 'Miners prospecting'],
    target: 'territory',
    defaultDuration: { min: 1, max: 1 },
    severityTable: (0, EventModel_1.buildDefaultSeverityTable)(),
    isInstant: true,
    onTrigger: (ctx, sev) => {
        const loc = ctx.territoryId;
        const owner = ctx.helper.getTerritory(loc)?.owner ?? null;
        const scaleVal = (0, EventModel_1.severityScale)(sev);
        const gold = scale(sev, BC.resourceDiscoveryGoldPerSeverity);
        const consequences = [{
                factionId: owner,
                territoryId: loc,
                delta: { resources: { gold } },
                message: '+' + gold + ' gold seized from initial extraction windfall',
            }, {
                territoryId: loc,
                delta: { resourceOutputPct: { gold: BC.resourceDiscoveryResourceBoostPct * scaleVal, iron: BC.resourceDiscoveryResourceBoostPct * scaleVal * 0.5 } },
                message: 'Local resource output boosted by discovery',
            }];
        return { reasons: ['Successful prospecting expedition'], consequences };
    },
};
// ────────────────────────────────────────────
// 6. FOOD SHORTAGE (economic)
// ────────────────────────────────────────────
const FOOD_SHORTAGE = {
    id: 'evt_food_shortage',
    typeId: 'food_shortage',
    category: 'economic',
    categoryLabel: 'Economic',
    titleTemplate: (sev, loc, world) => {
        const t = loc && world ? world.territories.get(loc)?.name ?? '' : '';
        return 'Food Shortage — ' + (t || 'a territory');
    },
    descriptionTemplate: (sev, ctx) => {
        const loc = terrName(ctx);
        if (sev === 'critical')
            return loc + ' faces imminent famine without immediate intervention.';
        if (sev === 'severe')
            return 'Food supplies in ' + loc + ' are running dangerously short; prices skyrocket.';
        if (sev === 'moderate')
            return loc + ' is experiencing a food shortage.';
        return 'Minor food shortages appear in ' + loc + '.';
    },
    causes: ['Drought aftermath', 'Poor harvest', 'Supply disruption'],
    target: 'territory',
    defaultDuration: { min: 2, max: 5 },
    severityTable: (0, EventModel_1.buildDefaultSeverityTable)(),
    canChainFrom: [{ toEventId: 'evt_famine', baseProb: BN.foodShortageToFamineProb, delayMinTurns: BN.foodShortageToFamineDelayMin, requireSeverityAtLeast: 'moderate' }],
    choices: (_ctx, sev) => {
        const costGold = BH.importFoodCostGoldPerSeverity[sev];
        const costFood = BH.emergencyReservesFoodCostPerSeverity[sev];
        const goldPenalty = BH.reduceTaxesGoldPenaltyPerSeverity[sev];
        return [
            { id: 'import_food', label: 'Import food', description: 'Purchase food from neighboring markets (cost ' + costGold + ' gold)', cost: { gold: costGold } },
            { id: 'release_reserves', label: 'Release emergency reserves', description: 'Distribute stored food (cost ' + costFood + ' food)', cost: { food: costFood } },
            { id: 'reduce_taxes', label: 'Reduce taxes', description: 'Let the people keep their harvests (-' + goldPenalty + ' income this season)', cost: { gold: goldPenalty } },
            { id: 'ignore', label: 'Ignore the problem', description: 'Hope it passes without intervention' },
        ];
    },
    resolveChoice: (choiceId, ctx, sev, active) => {
        const loc = active.territoryId;
        const owner = ctx.helper.getTerritory(loc)?.owner ?? null;
        let choiceTakenMessage = '';
        const consequences = [];
        let suppressChains = false;
        let shortenDurationBy = 0;
        switch (choiceId) {
            case 'import_food':
                choiceTakenMessage = 'Imported grain arrives; shortage abates.';
                consequences.push({ factionId: owner, territoryId: loc, delta: { stabilityDelta: BH.importFoodStabilityRestore }, message: 'Stability restored by decisive action' });
                suppressChains = true;
                shortenDurationBy = 2;
                break;
            case 'release_reserves':
                choiceTakenMessage = 'Reserves distributed to the hungry.';
                consequences.push({ factionId: owner, territoryId: loc, delta: { stabilityDelta: BH.emergencyReservesStabilityRestore }, message: 'Reserves ease the shortage' });
                suppressChains = true;
                shortenDurationBy = 1;
                break;
            case 'reduce_taxes':
                choiceTakenMessage = 'Tax relief calms the populace.';
                consequences.push({ factionId: owner, territoryId: loc, delta: { stabilityDelta: BH.reduceTaxesStabilityRestore }, message: 'Tax relief gains goodwill' });
                suppressChains = false;
                shortenDurationBy = 1;
                break;
            case 'ignore':
            default:
                choiceTakenMessage = 'The court does nothing; the shortage deepens.';
                const stabPenalty = BH.ignoreFamineStabilityPenaltyPerSeverity[sev];
                consequences.push({ factionId: owner, territoryId: loc, delta: { stabilityDelta: stabPenalty }, message: 'Inaction erodes trust' });
                break;
        }
        return { choiceTakenMessage, consequences, suppressChains, shortenDurationBy };
    },
    onTrigger: (ctx, sev) => {
        const loc = ctx.territoryId;
        const owner = ctx.helper.getTerritory(loc)?.owner ?? null;
        const scaleVal = (0, EventModel_1.severityScale)(sev);
        const consequences = [{
                territoryId: loc, factionId: owner,
                delta: { stabilityDelta: Math.round(BC.foodShortageStabilityDeltaPerSeverity * scaleVal) },
                message: 'Stability falls over empty markets',
            }, {
                territoryId: loc,
                delta: { populationDeltaAbs: scale(sev, BC.foodShortagePopulationDeltaAbsPerSeverity) },
                message: 'Migration from hungry households',
            }, {
                factionId: owner,
                delta: { moraleDeltaArmy: BC.foodShortageMoraleDeltaArmy },
                message: 'Army rations stretched thin',
            }];
        return { reasons: ['Food supply shortfall'], consequences };
    },
    perTurn: (_ctx, sev, active) => {
        const scaleVal = (0, EventModel_1.severityScale)(sev);
        const owner = _ctx.helper.getTerritory(active.territoryId)?.owner ?? null;
        return [{
                territoryId: active.territoryId,
                factionId: owner,
                delta: { stabilityDelta: Math.round(BC.foodShortageStabilityDeltaPerSeverity * scaleVal * 0.2) },
                message: 'Shortage continues to anger the populace',
            }];
    },
};
// ────────────────────────────────────────────
// 7. FAMINE (economic)
// ────────────────────────────────────────────
const FAMINE = {
    id: 'evt_famine',
    typeId: 'famine',
    category: 'economic',
    categoryLabel: 'Economic (Crisis)',
    titleTemplate: (sev, loc, world) => {
        const t = loc && world ? world.territories.get(loc)?.name ?? '' : '';
        return 'FAMINE — ' + (t || 'a territory');
    },
    descriptionTemplate: (sev, ctx) => {
        const loc = terrName(ctx);
        if (sev === 'critical')
            return loc + ' is ravaged by catastrophic famine — the dead litter the streets.';
        if (sev === 'severe')
            return 'Famine tightens its grip on ' + loc + '; refugees flee by the thousand.';
        if (sev === 'moderate')
            return 'Famine spreads in ' + loc + '.';
        return 'Widespread hunger in ' + loc + ' develops into early famine.';
    },
    causes: ['Protracted food shortage', 'Drought', 'War disruption'],
    target: 'territory',
    defaultDuration: { min: 3, max: 6 },
    severityTable: (0, EventModel_1.buildDefaultSeverityTable)(),
    canChainFrom: [{ toEventId: 'evt_unrest', baseProb: BN.famineToUnrestProb, delayMinTurns: BN.famineToUnrestDelayMin }],
    choices: (_ctx, sev) => {
        const costGold = BH.importFoodCostGoldPerSeverity[sev];
        const costFood = BH.emergencyReservesFoodCostPerSeverity[sev];
        const goldPenalty = BH.reduceTaxesGoldPenaltyPerSeverity[sev];
        return [
            { id: 'import_food', label: 'Massive food imports', description: 'Import emergency grain (cost ' + costGold + ' gold)', cost: { gold: costGold } },
            { id: 'release_reserves', label: 'Open every granary', description: 'Distribute all reserves (cost ' + costFood + ' food)', cost: { food: costFood } },
            { id: 'reduce_taxes', label: 'Suspend taxation entirely', description: 'Abolish taxes temporarily (' + goldPenalty + ' gold loss)', cost: { gold: goldPenalty } },
            { id: 'ignore', label: 'Fortify the palace', description: 'Secure the capital against unrest' },
        ];
    },
    resolveChoice: (choiceId, ctx, sev, active) => {
        const loc = active.territoryId;
        const owner = ctx.helper.getTerritory(loc)?.owner ?? null;
        let choiceTakenMessage = '';
        const consequences = [];
        let suppressChains = false;
        let shortenDurationBy = 0;
        switch (choiceId) {
            case 'import_food':
                choiceTakenMessage = 'A vast convoy of grain ships arrives.';
                consequences.push({ factionId: owner, territoryId: loc, delta: { stabilityDelta: BH.importFoodStabilityRestore + 2 }, message: 'Imported grain saves lives' });
                suppressChains = true;
                shortenDurationBy = 3;
                break;
            case 'release_reserves':
                choiceTakenMessage = 'Granaries are thrown open.';
                consequences.push({ factionId: owner, territoryId: loc, delta: { stabilityDelta: BH.emergencyReservesStabilityRestore + 2 }, message: 'Reserves blunt the famine' });
                suppressChains = true;
                shortenDurationBy = 2;
                break;
            case 'reduce_taxes':
                choiceTakenMessage = 'Taxes are suspended — people keep what little they have.';
                consequences.push({ factionId: owner, territoryId: loc, delta: { stabilityDelta: BH.reduceTaxesStabilityRestore + 2 }, message: 'Tax suspension wins loyalty' });
                suppressChains = false;
                shortenDurationBy = 1;
                break;
            case 'ignore':
            default:
                choiceTakenMessage = 'The famine is left to run its course.';
                const stabPenalty = BH.ignoreFamineStabilityPenaltyPerSeverity[sev] * 1.5;
                consequences.push({ factionId: owner, territoryId: loc, delta: { stabilityDelta: stabPenalty }, message: 'Inaction devastates legitimacy' });
                break;
        }
        return { choiceTakenMessage, consequences, suppressChains, shortenDurationBy };
    },
    onTrigger: (ctx, sev) => {
        const loc = ctx.territoryId;
        const owner = ctx.helper.getTerritory(loc)?.owner ?? null;
        const scaleVal = (0, EventModel_1.severityScale)(sev);
        return {
            reasons: ['Collapse of food supply'],
            consequences: [
                { territoryId: loc, factionId: owner, delta: { stabilityDelta: Math.round(BC.famineStabilityDeltaPerSeverity * scaleVal) }, message: 'Famine terrorizes the populace' },
                { territoryId: loc, delta: { populationDeltaAbs: scale(sev, BC.faminePopulationDeltaAbsPerSeverity) }, message: 'Starvation empties villages' },
                { factionId: owner, delta: { moraleDeltaArmy: BC.famineMoraleDeltaArmy }, message: 'Army morale collapses over hunger' },
            ],
        };
    },
    perTurn: (_ctx, sev, active) => {
        const scaleVal = (0, EventModel_1.severityScale)(sev);
        const owner = _ctx.helper.getTerritory(active.territoryId)?.owner ?? null;
        return [{
                territoryId: active.territoryId,
                factionId: owner,
                delta: { populationDeltaAbs: Math.round(scale(sev, BC.faminePopulationDeltaAbsPerSeverity) * 0.3) },
                message: 'Famine claims more lives',
            }];
    },
};
// ────────────────────────────────────────────
// 8. PROSPERITY (economic — positive)
// ────────────────────────────────────────────
const PROSPERITY = {
    id: 'evt_prosperity',
    typeId: 'prosperity',
    category: 'economic',
    categoryLabel: 'Economic (Boons)',
    titleTemplate: (sev, loc, world) => {
        const t = loc && world ? world.territories.get(loc)?.name ?? '' : '';
        return 'Era of Prosperity — ' + (t || 'a territory');
    },
    descriptionTemplate: (sev, ctx) => {
        const loc = terrName(ctx);
        if (sev === 'critical')
            return loc + ' enters a golden age — wealth and plenty abound.';
        if (sev === 'severe')
            return 'A prosperous time for ' + loc + '; markets boom and people thrive.';
        if (sev === 'moderate')
            return loc + ' enjoys growing prosperity.';
        return 'Trade picks up in ' + loc + ', bringing modest prosperity.';
    },
    causes: ['Stable rule', 'Trade links', 'Good harvests'],
    target: 'territory',
    defaultDuration: { min: 3, max: 6 },
    severityTable: (0, EventModel_1.buildDefaultSeverityTable)(),
    onTrigger: (ctx, sev) => {
        const loc = ctx.territoryId;
        const owner = ctx.helper.getTerritory(loc)?.owner ?? null;
        const scaleVal = (0, EventModel_1.severityScale)(sev);
        const stab = Math.round(BC.prosperityStabilityDeltaPerSeverity * scaleVal);
        const gainGold = scale(sev, BC.prosperityResourceGainPerSeverity.gold);
        const gainFood = scale(sev, BC.prosperityResourceGainPerSeverity.food);
        return {
            reasons: ['Flourishing commerce'],
            consequences: [
                { territoryId: loc, factionId: owner, delta: { stabilityDelta: stab }, message: '+' + stab + ' stability from prosperity' },
                { factionId: owner, delta: { resources: { gold: gainGold, food: gainFood } }, message: '+' + gainGold + ' gold, +' + gainFood + ' food in taxes' },
                { territoryId: loc, delta: { resourceOutputPct: { gold: 0.08 * scaleVal, food: 0.08 * scaleVal } }, message: 'Local production surges' },
            ],
        };
    },
    perTurn: (_ctx, sev, active) => {
        const scaleVal = (0, EventModel_1.severityScale)(sev);
        const owner = _ctx.helper.getTerritory(active.territoryId)?.owner ?? null;
        return [{
                territoryId: active.territoryId,
                factionId: owner,
                delta: { stabilityDelta: Math.round(BC.prosperityStabilityDeltaPerSeverity * scaleVal * 0.15) },
                message: 'Prosperity continues',
            }];
    },
};
// ────────────────────────────────────────────
// 9. TRADE BOOM (economic — positive)
// ────────────────────────────────────────────
const TRADE_BOOM = {
    id: 'evt_trade_boom',
    typeId: 'trade_boom',
    category: 'economic',
    categoryLabel: 'Economic (Boons)',
    titleTemplate: (sev, loc, world) => {
        const t = loc && world ? world.territories.get(loc)?.name ?? '' : '';
        return 'Trade Boom — ' + (t || 'a territory');
    },
    descriptionTemplate: (sev, ctx) => {
        const loc = terrName(ctx);
        if (sev === 'critical')
            return 'Caravans and ships flood into ' + loc + ' — unprecedented commerce!';
        if (sev === 'severe')
            return 'Traders flood into ' + loc + '; trade surges across all routes.';
        if (sev === 'moderate')
            return 'Trade booms in ' + loc + '.';
        return 'Increased traffic through ' + loc + '.';
    },
    causes: ['New trade route', 'Regional stability', 'Merchant networks'],
    target: 'territory',
    defaultDuration: { min: 2, max: 4 },
    severityTable: (0, EventModel_1.buildDefaultSeverityTable)(),
    onTrigger: (ctx, sev) => {
        const loc = ctx.territoryId;
        const owner = ctx.helper.getTerritory(loc)?.owner ?? null;
        const gold = scale(sev, BC.tradeBoomGoldPerSeverity);
        const food = scale(sev, BC.tradeBoomFoodPerSeverity);
        return {
            reasons: ['Expanded merchant traffic'],
            consequences: [
                { factionId: owner, delta: { resources: { gold, food } }, message: '+' + gold + ' gold, +' + food + ' food from tariffs' },
                { territoryId: loc, delta: { resourceOutputPct: { gold: 0.15 * (0, EventModel_1.severityScale)(sev) } }, message: 'Merchant quarter expands' },
            ],
        };
    },
};
// ────────────────────────────────────────────
// 10. UNREST (political/social)
// ────────────────────────────────────────────
const UNREST = {
    id: 'evt_unrest',
    typeId: 'unrest',
    category: 'political',
    categoryLabel: 'Political / Social',
    titleTemplate: (sev, loc, world) => {
        const t = loc && world ? world.territories.get(loc)?.name ?? '' : '';
        return 'Unrest — ' + (t || 'a territory');
    },
    descriptionTemplate: (sev, ctx) => {
        const loc = terrName(ctx);
        if (sev === 'critical')
            return loc + ' is on the brink of open rebellion!';
        if (sev === 'severe')
            return 'Widespread unrest sweeps ' + loc + '; crowds riot in the streets.';
        if (sev === 'moderate')
            return 'Protests and unrest in ' + loc + '.';
        return 'Grumbles of discontent surface in ' + loc + '.';
    },
    causes: ['Heavy taxation', 'Famine', 'Unjust rule', 'Cultural grievance'],
    target: 'territory',
    defaultDuration: { min: 2, max: 5 },
    severityTable: (0, EventModel_1.buildDefaultSeverityTable)(),
    canChainFrom: [{ toEventId: 'evt_rebellion', baseProb: BN.unrestToRebellionProb, delayMinTurns: BN.unrestToRebellionDelayMin, requireSeverityAtLeast: 'moderate' }],
    choices: (_ctx, sev) => {
        const costGold = Math.round(BH.sendTroopsGarrisonCostPerSeverity * (0, EventModel_1.severityScale)(sev));
        const goldPenalty = BH.reduceTaxesGoldPenaltyPerSeverity[sev];
        return [
            { id: 'send_troops', label: 'Send in the garrison', description: 'Restore order by force (' + costGold + ' gold for supplies)', cost: { gold: costGold } },
            { id: 'reduce_taxes', label: 'Offer concessions', description: 'Tax reform and redistribution (' + goldPenalty + ' gold)', cost: { gold: goldPenalty } },
            { id: 'give_speech', label: 'Address the crowd', description: 'A masterful speech from the Emperor' },
            { id: 'ignore', label: 'Do nothing', description: 'Hope order restores itself' },
        ];
    },
    resolveChoice: (choiceId, ctx, sev, active) => {
        const loc = active.territoryId;
        const owner = ctx.helper.getTerritory(loc)?.owner ?? null;
        let choiceTakenMessage = '';
        const consequences = [];
        let suppressChains = false;
        let shortenDurationBy = 0;
        switch (choiceId) {
            case 'send_troops': {
                choiceTakenMessage = 'The garrison restores order at bayonet-point.';
                const stabRestore = Math.round(BH.sendTroopsStabilityRestorePerSeverity * (0, EventModel_1.severityScale)(sev));
                consequences.push({ factionId: owner, territoryId: loc, delta: { stabilityDelta: stabRestore, moraleDeltaGarrison: -3 }, message: 'Order restored at cost of goodwill' });
                suppressChains = true;
                shortenDurationBy = 2;
                break;
            }
            case 'reduce_taxes':
                choiceTakenMessage = 'Concessions calm the angry crowd.';
                consequences.push({ factionId: owner, territoryId: loc, delta: { stabilityDelta: BH.reduceTaxesStabilityRestore + 2 }, message: 'Reforms reduce unrest' });
                suppressChains = true;
                shortenDurationBy = 2;
                break;
            case 'give_speech': {
                const worked = ctx.rng.chance(0.55);
                if (worked) {
                    choiceTakenMessage = 'A rousing speech wins hearts and minds.';
                    consequences.push({ factionId: owner, territoryId: loc, delta: { stabilityDelta: 10 }, message: 'Inspired loyalty' });
                    suppressChains = true;
                    shortenDurationBy = 3;
                }
                else {
                    choiceTakenMessage = 'The speech falls flat; the crowd jeers.';
                    consequences.push({ factionId: owner, territoryId: loc, delta: { stabilityDelta: -5 }, message: 'Mockery further erodes standing' });
                }
                break;
            }
            case 'ignore':
            default:
                choiceTakenMessage = 'The unrest is left to fester.';
                consequences.push({ factionId: owner, territoryId: loc, delta: { stabilityDelta: BH.ignoreFamineStabilityPenaltyPerSeverity[sev] }, message: 'Discontent deepens' });
                break;
        }
        return { choiceTakenMessage, consequences, suppressChains, shortenDurationBy };
    },
    onTrigger: (ctx, sev) => {
        const loc = ctx.territoryId;
        const owner = ctx.helper.getTerritory(loc)?.owner ?? null;
        const scaleVal = (0, EventModel_1.severityScale)(sev);
        return {
            reasons: ['Popular discontent'],
            consequences: [
                { territoryId: loc, factionId: owner, delta: { stabilityDelta: Math.round(BC.unrestStabilityDeltaPerSeverity * scaleVal) }, message: 'Public order declines' },
                { territoryId: loc, delta: { moraleDeltaGarrison: BC.unrestGarrisonMoraleDelta }, message: 'Garrison watches nervously' },
            ],
        };
    },
    perTurn: (_ctx, sev, active) => {
        const scaleVal = (0, EventModel_1.severityScale)(sev);
        const owner = _ctx.helper.getTerritory(active.territoryId)?.owner ?? null;
        return [{
                territoryId: active.territoryId,
                factionId: owner,
                delta: { stabilityDelta: Math.round(BC.unrestStabilityDeltaPerSeverity * scaleVal * 0.25) },
                message: 'Unrest persists',
            }];
    },
};
// ────────────────────────────────────────────
// 11. REBELLION (political — crisis)
// ────────────────────────────────────────────
const REBELLION = {
    id: 'evt_rebellion',
    typeId: 'rebellion',
    category: 'political',
    categoryLabel: 'Political / Social (Crisis)',
    titleTemplate: (sev, loc, world) => {
        const t = loc && world ? world.territories.get(loc)?.name ?? '' : '';
        return 'REBELLION — ' + (t || 'a territory');
    },
    descriptionTemplate: (sev, ctx) => {
        const loc = terrName(ctx);
        if (sev === 'critical')
            return loc + ' erupts in full-scale rebellion! The garrison is besieged!';
        if (sev === 'severe')
            return 'Open rebellion in ' + loc + '; rebels seize parts of the countryside.';
        if (sev === 'moderate')
            return 'Armed rebellion breaks out in ' + loc + '.';
        return 'A small rebel band rises in ' + loc + '.';
    },
    causes: ['Unchecked unrest', 'Famine', 'Oppression', 'Foreign agents'],
    target: 'territory',
    defaultDuration: { min: 4, max: 8 },
    severityTable: (0, EventModel_1.buildDefaultSeverityTable)(),
    choices: (_ctx, sev) => {
        const costGold = Math.round(BH.sendTroopsGarrisonCostPerSeverity * (0, EventModel_1.severityScale)(sev) * 2);
        const goldPenalty = Math.round(BH.reduceTaxesGoldPenaltyPerSeverity[sev] * 1.5);
        return [
            { id: 'crush', label: 'Crush with overwhelming force', description: 'Send in the army (' + costGold + ' gold)', cost: { gold: costGold } },
            { id: 'negotiate', label: 'Negotiate with rebel leaders', description: 'Offer terms and reforms (' + goldPenalty + ' gold concessions)', cost: { gold: goldPenalty } },
            { id: 'ignore', label: 'Contain and wait', description: 'Garrison holds on, hope rebels run out of supplies' },
        ];
    },
    resolveChoice: (choiceId, ctx, sev, active) => {
        const loc = active.territoryId;
        const owner = ctx.helper.getTerritory(loc)?.owner ?? null;
        let choiceTakenMessage = '';
        const consequences = [];
        let suppressChains = true;
        let shortenDurationBy = 0;
        switch (choiceId) {
            case 'crush': {
                choiceTakenMessage = 'The rebellion is crushed under iron heel.';
                const garrisonLoss = -1 * scale(sev, BC.rebellionGarrisonDeltaPerSeverity);
                consequences.push({ factionId: owner, territoryId: loc, delta: { garrisonDeltaAbs: garrisonLoss, stabilityDelta: -4 }, message: 'Garrison suffers losses pacifying rebels' });
                shortenDurationBy = 5;
                break;
            }
            case 'negotiate':
                choiceTakenMessage = 'Negotiations bear fruit — terms are accepted.';
                consequences.push({ factionId: owner, territoryId: loc, delta: { stabilityDelta: BH.reduceTaxesStabilityRestore - 2 }, message: 'Compromise restores order' });
                shortenDurationBy = 4;
                break;
            case 'ignore':
            default:
                choiceTakenMessage = 'The siege drags on.';
                consequences.push({ factionId: owner, territoryId: loc, delta: { stabilityDelta: BH.ignoreFamineStabilityPenaltyPerSeverity[sev] * 2 }, message: 'Rebellion gathers popular support' });
                suppressChains = false;
                break;
        }
        return { choiceTakenMessage, consequences, suppressChains, shortenDurationBy };
    },
    onTrigger: (ctx, sev) => {
        const loc = ctx.territoryId;
        const owner = ctx.helper.getTerritory(loc)?.owner ?? null;
        const scaleVal = (0, EventModel_1.severityScale)(sev);
        return {
            reasons: ['Long-simmering grievances boil over'],
            consequences: [
                { territoryId: loc, factionId: owner, delta: { stabilityDelta: Math.round(BC.rebellionStabilityDeltaPerSeverity * scaleVal) }, message: 'Authority collapses in region' },
                { territoryId: loc, delta: { garrisonDeltaAbs: -1 * scale(sev, BC.rebellionGarrisonDeltaPerSeverity) }, message: 'Garrison engaged, suffers casualties' },
                { territoryId: loc, delta: { populationDeltaAbs: -3 * scale(sev, BC.rebellionGarrisonDeltaPerSeverity) }, message: 'Civilians swept into rebel ranks or flight' },
            ],
        };
    },
    perTurn: (_ctx, sev, active) => {
        const scaleVal = (0, EventModel_1.severityScale)(sev);
        const owner = _ctx.helper.getTerritory(active.territoryId)?.owner ?? null;
        return [{
                territoryId: active.territoryId,
                factionId: owner,
                delta: { stabilityDelta: Math.round(BC.rebellionStabilityDeltaPerSeverity * scaleVal * 0.3) },
                message: 'Rebellion destabilizes region',
            }];
    },
};
// ────────────────────────────────────────────
// 12. BORDER TENSION (military)
// ────────────────────────────────────────────
const BORDER_TENSION = {
    id: 'evt_border_tension',
    typeId: 'border_tension',
    category: 'military',
    categoryLabel: 'Military',
    titleTemplate: (sev, loc, world) => {
        const t = loc && world ? world.territories.get(loc)?.name ?? '' : '';
        return 'Border Tension — ' + (t || 'a territory');
    },
    descriptionTemplate: (sev, ctx) => {
        const loc = terrName(ctx);
        if (sev === 'critical')
            return 'Hostile forces mass on the borders of ' + loc + ' — invasion imminent!';
        if (sev === 'severe')
            return 'Serious military incidents on the border of ' + loc + '; readiness degrades.';
        if (sev === 'moderate')
            return 'Border incidents increase around ' + loc + '.';
        return 'Minor skirmishes and saber-rattling near ' + loc + '.';
    },
    causes: ['Hostile neighbors', 'Rival mobilization', 'Unresolved claims'],
    target: 'territory',
    defaultDuration: { min: 2, max: 4 },
    severityTable: (0, EventModel_1.buildDefaultSeverityTable)(),
    onTrigger: (ctx, sev) => {
        const loc = ctx.territoryId;
        const owner = ctx.helper.getTerritory(loc)?.owner ?? null;
        return {
            reasons: ['Hostile neighbor activity'],
            consequences: [
                { territoryId: loc, delta: { moraleDeltaGarrison: BC.borderTensionGarrisonMoraleDelta }, message: 'Garrison watches border nervously' },
                { territoryId: loc, factionId: owner, delta: { stabilityDelta: BC.borderTensionStabilityDelta }, message: 'Border worry unsettles populace' },
            ],
        };
    },
};
// ────────────────────────────────────────────
// REGISTRY
// ────────────────────────────────────────────
exports.EVENT_REGISTRY = {
    [DROUGHT.id]: DROUGHT,
    [FLOOD.id]: FLOOD,
    [STORM.id]: STORM,
    [HARSH_WINTER.id]: HARSH_WINTER,
    [RESOURCE_DISCOVERY.id]: RESOURCE_DISCOVERY,
    [FOOD_SHORTAGE.id]: FOOD_SHORTAGE,
    [FAMINE.id]: FAMINE,
    [PROSPERITY.id]: PROSPERITY,
    [TRADE_BOOM.id]: TRADE_BOOM,
    [UNREST.id]: UNREST,
    [REBELLION.id]: REBELLION,
    [BORDER_TENSION.id]: BORDER_TENSION,
};
exports.EVENT_LIST = Object.values(exports.EVENT_REGISTRY);
function getEventById(id) {
    return exports.EVENT_REGISTRY[id];
}
function evaluateAllTriggersForTerritory(ctx) {
    const C = BT;
    const results = [];
    const t = ctx.territoryId ? ctx.helper.getTerritory(ctx.territoryId) : null;
    const terrain = t?.terrain;
    const factionId = t?.owner ?? null;
    const wrapAndPush = (id, fn) => {
        const s = fn();
        if (s.eligible)
            results.push({ eventId: id, weight: s.baseWeight, severityHint: s.severityHint, reasons: s.reasons });
    };
    // DROUGHT
    wrapAndPush(DROUGHT.id, () => (0, EventTriggers_1.buildTriggerFn)({
        baseWeight: C.drought.baseWeight,
        eligibility: (cx) => EventTriggers_1.COMMON_ELIGIBILITY.ownedTerritory(cx) && EventTriggers_1.COMMON_ELIGIBILITY.noActiveDuplicate('drought')(cx),
        modifiers: [
            { when: () => terrain === 'plains' || terrain === 'desert', apply: s => ({ ...s, baseWeight: s.baseWeight * C.drought.plainsBoost }), reason: () => 'Plains/desert agriculture vulnerable' },
            { when: () => terrain === 'desert', apply: s => ({ ...s, baseWeight: s.baseWeight * (C.drought.desertBoost / C.drought.plainsBoost) }), reason: () => 'Desert prone to drought' },
            { when: () => !!(t && (t.resourceOutput?.food ?? 0) > 20), apply: s => ({ ...s, baseWeight: s.baseWeight * 1.4 }), reason: () => 'Agricultural region' },
        ],
    })(ctx));
    // FLOOD
    wrapAndPush(FLOOD.id, () => (0, EventTriggers_1.buildTriggerFn)({
        baseWeight: C.flood.baseWeight,
        eligibility: cx => EventTriggers_1.COMMON_ELIGIBILITY.ownedTerritory(cx) && EventTriggers_1.COMMON_ELIGIBILITY.noActiveDuplicate('flood')(cx),
        modifiers: [
            { when: () => terrain === 'river', apply: s => ({ ...s, baseWeight: s.baseWeight * C.flood.riverBoost }), reason: () => 'River proximity' },
            { when: () => terrain === 'coastal', apply: s => ({ ...s, baseWeight: s.baseWeight * C.flood.coastalBoost }), reason: () => 'Coastal storm surge risk' },
        ],
    })(ctx));
    // STORM
    wrapAndPush(STORM.id, () => (0, EventTriggers_1.buildTriggerFn)({
        baseWeight: C.storm.baseWeight,
        eligibility: cx => EventTriggers_1.COMMON_ELIGIBILITY.ownedTerritory(cx) && EventTriggers_1.COMMON_ELIGIBILITY.noActiveDuplicate('storm')(cx),
        modifiers: [
            { when: () => terrain === 'coastal', apply: s => ({ ...s, baseWeight: s.baseWeight * C.storm.coastalBoost }), reason: () => 'Coastal exposed' },
        ],
    })(ctx));
    // HARSH WINTER
    wrapAndPush(HARSH_WINTER.id, () => (0, EventTriggers_1.buildTriggerFn)({
        baseWeight: C.harshWinter.baseWeight,
        eligibility: cx => EventTriggers_1.COMMON_ELIGIBILITY.ownedTerritory(cx) && EventTriggers_1.COMMON_ELIGIBILITY.noActiveDuplicate('harsh_winter')(cx),
        modifiers: [
            { when: () => terrain === 'mountain', apply: s => ({ ...s, baseWeight: s.baseWeight * C.harshWinter.mountainBoost }), reason: () => 'Mountain elevation' },
            { when: () => terrain === 'hills', apply: s => ({ ...s, baseWeight: s.baseWeight * C.harshWinter.hillsBoost }), reason: () => 'Highlands' },
        ],
    })(ctx));
    // RESOURCE DISCOVERY
    wrapAndPush(RESOURCE_DISCOVERY.id, () => (0, EventTriggers_1.buildTriggerFn)({
        baseWeight: C.resourceDiscovery.baseWeight,
        eligibility: cx => EventTriggers_1.COMMON_ELIGIBILITY.ownedTerritory(cx) && EventTriggers_1.COMMON_ELIGIBILITY.noActiveDuplicate('resource_discovery')(cx),
        modifiers: [
            { when: () => !!(t && Object.keys(t.resourceOutput ?? {}).length < 2), apply: s => ({ ...s, baseWeight: s.baseWeight * C.resourceDiscovery.noResourceTerritoryBoost }), reason: () => 'Undersurveyed lands' },
            { when: () => terrain === 'mountain' || terrain === 'hills', apply: s => ({ ...s, baseWeight: s.baseWeight * 1.5 }), reason: () => 'Mineral-rich geology' },
        ],
    })(ctx));
    // FOOD SHORTAGE
    wrapAndPush(FOOD_SHORTAGE.id, () => (0, EventTriggers_1.buildTriggerFn)({
        baseWeight: C.foodShortage.baseWeight,
        eligibility: cx => EventTriggers_1.COMMON_ELIGIBILITY.ownedTerritory(cx) && EventTriggers_1.COMMON_ELIGIBILITY.noActiveDuplicate('food_shortage')(cx),
        modifiers: [
            { when: () => !!(t && ctx.helper.hasActiveEventOn(t.id, 'drought')), apply: s => ({ ...s, baseWeight: s.baseWeight * C.foodShortage.droughtActiveBoost }), reason: () => 'Active drought' },
            { when: () => { const f = factionId ? ctx.helper.getFaction(factionId) : null; if (!f)
                    return false; return ctx.helper.getFactionResourceRatio(f.id, 'food') < T.lowFoodRatio; }, apply: s => ({ ...s, baseWeight: s.baseWeight * C.foodShortage.lowFoodReserveBoost }), reason: () => 'Low food reserves' },
            { when: () => { const f = factionId ? ctx.helper.getFaction(factionId) : null; if (!f)
                    return false; return ctx.helper.getFactionResourceRatio(f.id, 'food') < T.criticalFoodRatio; }, apply: s => ({ ...s, severityHint: 'severe' }), reason: () => 'Critical food ratio' },
        ],
    })(ctx));
    // FAMINE
    wrapAndPush(FAMINE.id, () => (0, EventTriggers_1.buildTriggerFn)({
        baseWeight: C.famine.baseWeight,
        eligibility: cx => EventTriggers_1.COMMON_ELIGIBILITY.ownedTerritory(cx) && EventTriggers_1.COMMON_ELIGIBILITY.noActiveDuplicate('famine')(cx),
        modifiers: [
            { when: () => !!(t && ctx.helper.hasActiveEventOn(t.id, 'food_shortage')), apply: s => ({ ...s, baseWeight: s.baseWeight * C.famine.foodShortageActiveBoost }), reason: () => 'Food shortage active' },
            { when: () => { const f = factionId ? ctx.helper.getFaction(factionId) : null; if (!f)
                    return false; return ctx.helper.getFactionResourceRatio(f.id, 'food') < T.criticalFoodRatio; }, apply: s => ({ ...s, baseWeight: s.baseWeight * C.famine.criticalFoodBoost }), reason: () => 'Critical food reserves' },
        ],
        severityByConditions: [
            { when: () => { if (!t)
                    return false; const f = factionId ? ctx.helper.getFaction(factionId) : null; return ctx.helper.hasActiveEventOn(t.id, 'food_shortage') && !!f && ctx.helper.getFactionResourceRatio(f.id, 'food') < T.criticalFoodRatio; }, severity: 'severe', reason: () => 'Shortage + critical food' },
        ],
    })(ctx));
    // PROSPERITY
    wrapAndPush(PROSPERITY.id, () => (0, EventTriggers_1.buildTriggerFn)({
        baseWeight: C.prosperity.baseWeight,
        eligibility: cx => EventTriggers_1.COMMON_ELIGIBILITY.ownedTerritory(cx) && EventTriggers_1.COMMON_ELIGIBILITY.noActiveDuplicate('prosperity')(cx),
        modifiers: [
            { when: () => { const f = factionId ? ctx.helper.getFaction(factionId) : null; return !!f && f.stability >= 75; }, apply: s => ({ ...s, baseWeight: s.baseWeight * C.prosperity.stableBoost }), reason: () => 'Stable realm' },
            { when: () => { const f = factionId ? ctx.helper.getFaction(factionId) : null; if (!f)
                    return false; return ctx.helper.getFactionResourceRatio(f.id, 'gold') >= T.goodProsperityRatio; }, apply: s => ({ ...s, baseWeight: s.baseWeight * C.prosperity.goodTradeBoost }), reason: () => 'Treasury surplus' },
        ],
    })(ctx));
    // TRADE BOOM
    wrapAndPush(TRADE_BOOM.id, () => (0, EventTriggers_1.buildTriggerFn)({
        baseWeight: C.tradeBoom.baseWeight,
        eligibility: cx => EventTriggers_1.COMMON_ELIGIBILITY.ownedTerritory(cx) && EventTriggers_1.COMMON_ELIGIBILITY.noActiveDuplicate('trade_boom')(cx),
        modifiers: [
            { when: () => terrain === 'coastal', apply: s => ({ ...s, baseWeight: s.baseWeight * C.tradeBoom.coastalBoost }), reason: () => 'Coastal port access' },
            { when: () => !!(t && t.neighboring.length >= T.strongTradeAccessNeighbors), apply: s => ({ ...s, baseWeight: s.baseWeight * C.tradeBoom.manyNeighborsBoost }), reason: () => 'Many trade neighbors' },
        ],
    })(ctx));
    // UNREST
    wrapAndPush(UNREST.id, () => (0, EventTriggers_1.buildTriggerFn)({
        baseWeight: C.unrest.baseWeight,
        eligibility: cx => EventTriggers_1.COMMON_ELIGIBILITY.ownedTerritory(cx) && EventTriggers_1.COMMON_ELIGIBILITY.noActiveDuplicate('unrest')(cx),
        modifiers: [
            { when: () => { const f = factionId ? ctx.helper.getFaction(factionId) : null; return !!f && f.stability < T.lowFactionStability; }, apply: s => ({ ...s, baseWeight: s.baseWeight * C.unrest.stabilityLowBoost }), reason: () => 'Low faction stability' },
            { when: () => !!(t && ctx.helper.hasActiveEventOn(t.id, 'famine')), apply: s => ({ ...s, baseWeight: s.baseWeight * C.unrest.famineActiveBoost }), reason: () => 'Famine fuels anger' },
            { when: () => !!(t && ctx.helper.hasActiveEventOn(t.id, 'food_shortage')), apply: s => ({ ...s, baseWeight: s.baseWeight * 1.5 }), reason: () => 'Shortage breeds discontent' },
        ],
        severityByConditions: [
            { when: () => { const f = factionId ? ctx.helper.getFaction(factionId) : null; return !!f && f.stability < T.criticalFactionStability; }, severity: 'severe', reason: () => 'Critical stability' },
        ],
    })(ctx));
    // REBELLION
    wrapAndPush(REBELLION.id, () => (0, EventTriggers_1.buildTriggerFn)({
        baseWeight: C.rebellion.baseWeight,
        eligibility: cx => EventTriggers_1.COMMON_ELIGIBILITY.ownedTerritory(cx) && EventTriggers_1.COMMON_ELIGIBILITY.noActiveDuplicate('rebellion')(cx),
        modifiers: [
            { when: () => !!(t && ctx.helper.hasActiveEventOn(t.id, 'unrest')), apply: s => ({ ...s, baseWeight: s.baseWeight * C.rebellion.unrestActiveBoost }), reason: () => 'Active unrest' },
            { when: () => { const f = factionId ? ctx.helper.getFaction(factionId) : null; return !!f && f.stability < T.criticalFactionStability; }, apply: s => ({ ...s, baseWeight: s.baseWeight * C.rebellion.stabilityCriticalBoost }), reason: () => 'Critical faction stability' },
        ],
        severityByConditions: [
            { when: () => { if (!t)
                    return false; const f = factionId ? ctx.helper.getFaction(factionId) : null; return ctx.helper.hasActiveEventOn(t.id, 'unrest') && !!f && f.stability < T.criticalFactionStability; }, severity: 'severe', reason: () => 'Unrest + critical stability' },
        ],
    })(ctx));
    // BORDER TENSION
    wrapAndPush(BORDER_TENSION.id, () => (0, EventTriggers_1.buildTriggerFn)({
        baseWeight: C.borderTension.baseWeight,
        eligibility: cx => EventTriggers_1.COMMON_ELIGIBILITY.ownedTerritory(cx) && EventTriggers_1.COMMON_ELIGIBILITY.noActiveDuplicate('border_tension')(cx),
        modifiers: [
            { when: () => !!(t && ctx.helper.countHostileBorderNeighbors(t.id) >= T.borderHostileNeighbors), apply: s => ({ ...s, baseWeight: s.baseWeight * C.borderTension.hostileNeighborBoost }), reason: () => 'Hostile neighbors nearby' },
        ],
    })(ctx));
    return results.sort((a, b) => b.weight - a.weight);
}
//# sourceMappingURL=EventDefinitions.js.map