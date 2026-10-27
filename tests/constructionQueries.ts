import assert from 'node:assert/strict';
import { createGameState } from '../src/state';
import { loadTinyWorldDefinition } from '../src/worldDefinition/catalog';
import { snapshotGameState } from '../src/persistence/snapshot';
import { constructionStartProblem, getConstructionProjectDefinition, listConstructionProjectTypes } from '../src/gameplay/construction/definitions';
import { ensureCity, cityIdFor } from '../src/gameplay/cities/city';
import { ensureTerritoryInfrastructure } from '../src/gameplay/economy/effectiveOutput';
import { GAMEPLAY_CONFIG } from '../src/gameplay/config';
import { tradeDemand } from '../src/gameplay/trade/candidates';
import { deriveSources } from '../src/engine/strategicPressure';
import { ErrorCode, OrchestrationError } from '../src/orchestration/errors';

function fixture() {
  const loaded = loadTinyWorldDefinition(); assert.ok(loaded.ok);
  return createGameState({ world: loaded.definition, seed: 11 });
}
function completeSites(state: ReturnType<typeof fixture>) {
  for (const territory of state.territories.values()) {
    assert.ok(territory.owner);
    ensureCity(state, territory.id, territory.owner);
    territory.fortification = GAMEPLAY_CONFIG.maxFortificationLevel;
    const infrastructure = ensureTerritoryInfrastructure(state, territory.id);
    infrastructure.farmCompletedAtTick = 0;
    infrastructure.mineCompletedAtTick = 0;
    infrastructure.lumberCompletedAtTick = 0;
  }
}
export function registerConstructionQueryTests({ test }: { test: (name: string, fn: () => void) => void }) {
  test('construction query: missing and foreign territory retain exact authoritative errors', () => {
    const state = fixture(), territory = [...state.territories.values()][0];
    for (const type of listConstructionProjectTypes()) {
      for (const [territoryId, factionId, expected] of [
        ['missing', territory.owner!, { code: ErrorCode.INVALID_TERRITORY, message: 'Unknown territory: missing', details: { territoryId: 'missing' } }],
        [territory.id, 'foreign', { code: ErrorCode.ACTION_NOT_ALLOWED, message: 'Can only start construction on owned territory' }],
      ] as const) {
        const context = { state, territoryId, factionId }, before = snapshotGameState(state);
        assert.deepEqual(constructionStartProblem(type, context), expected);
        assert.throws(() => getConstructionProjectDefinition(type).assertCanStart(context), error => {
          assert.ok(error instanceof OrchestrationError);
          assert.deepEqual(JSON.parse(JSON.stringify(error.toBody())), expected);
          return true;
        });
        assert.deepEqual(snapshotGameState(state), before);
      }
    }
  });
  test('construction query: zero-tick completed developments remain unavailable', () => {
    const state = fixture(), territory = [...state.territories.values()][0];
    const context = { state, territoryId: territory.id, factionId: territory.owner! };
    for (const [type, field, label] of [['FARM', 'farmCompletedAtTick', 'farm'], ['MINE', 'mineCompletedAtTick', 'mine'], ['LUMBER', 'lumberCompletedAtTick', 'lumber operation']] as const) {
      state.territoryInfrastructure.delete(territory.id);
      assert.equal(constructionStartProblem(type, context), null);
      getConstructionProjectDefinition(type).assertCanStart(context);
      ensureTerritoryInfrastructure(state, territory.id)[field] = 0;
      assert.equal(constructionStartProblem(type, context)?.message, `Territory already has a ${label}`);
      assert.throws(() => getConstructionProjectDefinition(type).assertCanStart(context));
    }
  });
  test('construction query: native city identity and fortification maximum remain prerequisites', () => {
    const state = fixture(), territory = [...state.territories.values()][0];
    const context = { state, territoryId: territory.id, factionId: territory.owner! };
    state.cities.delete(cityIdFor(territory.id));
    assert.equal(constructionStartProblem('CITY', context), null);
    assert.equal(constructionStartProblem('FORTIFICATION', context)?.message, 'Fortification requires a city on the territory');
    ensureCity(state, territory.id, territory.owner!); territory.fortification = 0;
    assert.equal(constructionStartProblem('CITY', context)?.message, 'Territory already has a city');
    assert.equal(constructionStartProblem('FORTIFICATION', context), null);
    territory.fortification = GAMEPLAY_CONFIG.maxFortificationLevel;
    assert.equal(constructionStartProblem('FORTIFICATION', context)?.message, 'Territory is already at maximum fortification');
    assert.throws(() => getConstructionProjectDefinition('FORTIFICATION').assertCanStart(context));
  });
  test('construction query: prerequisites do not replace resource and slot validation', () => {
    const state = fixture(), territory = [...state.territories.values()][0];
    const context = { state, territoryId: territory.id, factionId: territory.owner! };
    state.territoryInfrastructure.delete(territory.id);
    const resources = state.factions.get(territory.owner!)!.resources;
    for (const key of Object.keys(resources) as (keyof typeof resources)[]) resources[key] = 0;
    const before = snapshotGameState(state);
    assert.equal(constructionStartProblem('FARM', context), null);
    getConstructionProjectDefinition('FARM').assertCanStart(context);
    assert.deepEqual(snapshotGameState(state), before);
    assert.throws(() => getConstructionProjectDefinition('unknown' as never), error => error instanceof OrchestrationError && error.code === ErrorCode.INVALID_PARAMETER);
  });
  test('construction query: Trade demand retains exact native cost maxima without mutating state', () => {
    const state = fixture(); completeSites(state);
    const faction = [...state.factions.values()][0];
    for (const territoryId of faction.territories) state.cities.delete(cityIdFor(territoryId));
    const before = snapshotGameState(state), demand = tradeDemand(state, faction.id);
    const cost = getConstructionProjectDefinition('CITY').cost;
    assert.equal(demand.gold, cost.gold); assert.equal(demand.stone, cost.stone);
    assert.equal(demand.iron, cost.iron); assert.equal(demand.wood, 0);
    assert.deepEqual(snapshotGameState(state), before);
  });
  test('construction query: unavailable Trade and build observations allocate no error stacks', () => {
    const state = fixture(); completeSites(state);
    const errors = require('../src/orchestration/errors'), Original = errors.OrchestrationError;
    let allocations = 0;
    errors.OrchestrationError = class extends Original { constructor(...args: unknown[]) { super(...args); allocations++; } };
    const before = snapshotGameState(state);
    try {
      for (let i = 0; i < 25; i++) for (const faction of state.factions.values()) {
        tradeDemand(state, faction.id);
        deriveSources(state, faction.id, state.aiClock.nowMs);
      }
      assert.equal(allocations, 0);
      assert.deepEqual(snapshotGameState(state), before);
    } finally { errors.OrchestrationError = Original; }
  });
}
