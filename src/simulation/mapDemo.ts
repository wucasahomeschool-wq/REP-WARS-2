import { FactionId } from '../types';
import { MapEngine } from '../map/MapEngine';
import { BALANCE } from '../constants/balance';
import { DEFAULT_THEME_LIBRARY } from '../map/Themes';
import { collectNeighborGraphIssues } from '../map/graphInvariants';

const FACTIONS: FactionId[] = ['ashen_horde', 'iron_kingdom', 'merchant_republic', 'celestial_theocracy'];

export interface MapValidationTest {
  name: string;
  pass: boolean;
  detail: string;
}

export function runMapValidationTests(): MapValidationTest[] {
  const tests: MapValidationTest[] = [];
  /* ── TEST 1: No isolated territories ────────────────────────── */
  {
    const engineT = new MapEngine(9001);
    const { world: w1 } = engineT.generateInitialWorld({ worldSeed: 9001, playerFactionIds: [] });
    const val = engineT.validateWorld(w1);
    let isoCount = 0;
    for (const [, t] of w1.territories)
      if (t.neighboring.length === 0)
        isoCount++;
    tests.push({
      name: 'T1. No isolated territories in initial world',
      pass: val.noIsolated && val.allBidirectional && isoCount === 0,
      detail: `${isoCount} isolated, all bidirectional=${val.allBidirectional}`,
    });
  }
  /* ── TEST 2: New territories connect to existing frontier ───── */
  {
    const engineT = new MapEngine(7777);
    const { world: w2 } = engineT.generateInitialWorld({ worldSeed: 7777, playerFactionIds: [] });
    const beforeCount = w2.territories.size;
    const frontierIds = Array.from(w2.graphMeta.frontierTerritories);
    if (frontierIds.length > 0) {
      const pick = frontierIds[0]!;
      const res = engineT.expandFromFrontier({
        worldState: w2,
        fromFrontierTerritoryId: pick,
        newTerritoryCount: 4,
        salt: 1,
      });
      const connectsOk = res.newTerritories.every(nt => nt.neighboring.some(nid => nid === pick || !res.newTerritories.some(x => x.id === nid)));
      const afterCount = w2.territories.size;
      tests.push({
        name: 'T2. New territories connect to existing frontier',
        pass: afterCount > beforeCount && res.validation.noIsolated && connectsOk,
        detail: `created=${afterCount - beforeCount}, connectsOK=${connectsOk}, frontierValid=${res.validation.frontierCount >= 0}`,
      });
    }
    else {
      tests.push({ name: 'T2. (skipped — no frontier)', pass: false, detail: 'no frontier' });
    }
  }
  /* ── TEST 3: Fog of war hides undiscovered territories ──────── */
  {
    const engineT = new MapEngine(5555);
    const factions = ['fa', 'fb'];
    const { world: w3, visibility: vismap } = engineT.generateInitialWorld({
      worldSeed: 5555,
      playerFactionIds: factions,
      initialTerritoryCount: 16,
      initialRegionCount: 4,
    });
    const visA = vismap.get(factions[0]!)!;
    const totalTerr = w3.territories.size;
    const unknownCount = totalTerr - visA.visibility.size;
    const ownedByA = Array.from(w3.territories.values()).filter(t => t.owner === factions[0]).length;
    const controlledByVis = Array.from(visA.visibility.values()).filter(v => v.state === 'controlled').length;
    const ownedShown = Array.from(visA.visibility.keys()).filter(id => w3.territories.get(id)?.owner === factions[0]).length;
    tests.push({
      name: 'T3. Fog of war hides undiscovered, reveals owned+adjacent',
      pass: unknownCount > 0 && controlledByVis >= ownedByA && ownedShown === ownedByA,
      detail: `total=${totalTerr}, unknown=${unknownCount}, owned=${ownedByA}, controlledVis=${controlledByVis}`,
    });
  }
  /* ── TEST 4: Expansion does NOT overwrite existing territories ─ */
  {
    const engineT = new MapEngine(3333);
    const { world: w4 } = engineT.generateInitialWorld({ worldSeed: 3333, playerFactionIds: [] });
    const snapshot = new Map<string, { name: string; terrain: string; owner: string | null }>();
    for (const [id, t] of w4.territories)
      snapshot.set(id, { name: t.id, terrain: t.terrain, owner: t.owner });
    const frontierIds = Array.from(w4.graphMeta.frontierTerritories);
    let expansionAttempts = 0, expansionsOk = 0;
    for (let i = 0; i < Math.min(3, frontierIds.length); i++) {
      const pick = frontierIds[i]!;
      const res = engineT.expandFromFrontier({
        worldState: w4,
        fromFrontierTerritoryId: pick,
        newTerritoryCount: 3,
        salt: i + 10,
      });
      expansionAttempts++;
      const origIntact = Array.from(snapshot.entries()).every(([origId, origSnap]) => {
        const cur = w4.territories.get(origId);
        return !!cur && cur.id === origSnap.name && cur.terrain === origSnap.terrain;
      });
      if (origIntact && res.validation.noOverwrites)
        expansionsOk++;
    }
    tests.push({
      name: 'T4. Expansion never overwrites existing territories',
      pass: expansionAttempts > 0 && expansionsOk === expansionAttempts,
      detail: `attempts=${expansionAttempts}, preserved=${expansionsOk}`,
    });
  }
  /* ── TEST 5: Different seeds → different worlds ─────────────── */
  {
    const engineA = new MapEngine(1001);
    const engineB = new MapEngine(2002);
    engineA.resetNameTracker();
    engineB.resetNameTracker();
    const { world: wa } = engineA.generateInitialWorld({ worldSeed: 1001, playerFactionIds: [] });
    const { world: wb } = engineB.generateInitialWorld({ worldSeed: 2002, playerFactionIds: [] });
    const namesA = new Set(Array.from(wa.territories.values()).map(t => t.id));
    const namesB = new Set(Array.from(wb.territories.values()).map(t => t.id));
    let shared = 0;
    for (const n of namesA)
      if (namesB.has(n))
        shared++;
    const sharedRatio = shared / Math.max(1, namesA.size);
    const sizeDiff = Math.abs(wa.territories.size - wb.territories.size);
    tests.push({
      name: 'T5. Different seeds produce different worlds',
      pass: sharedRatio < 0.5,
      detail: `sharedNames=${shared}/${namesA.size} (ratio=${sharedRatio.toFixed(2)}), sizeDiff=${sizeDiff}`,
    });
  }
  /* ── TEST 6: Same seed → identical world (determinism) ──────── */
  {
    const SEED = 4321;
    const engineX = new MapEngine(SEED + 1);
    const engineY = new MapEngine(SEED + 1);
    engineX.resetNameTracker();
    engineY.resetNameTracker();
    const params6 = { worldSeed: SEED, playerFactionIds: ['a', 'b'] };
    const { world: wx, playerCapitals: capsX } = engineX.generateInitialWorld(params6);
    const { world: wy, playerCapitals: capsY } = engineY.generateInitialWorld(params6);
    let identical = wx.territories.size === wy.territories.size && wx.regions.size === wy.regions.size;
    const idsX = Array.from(wx.territories.keys()).sort();
    const idsY = Array.from(wy.territories.keys()).sort();
    if (identical && idsX.join(',') === idsY.join(',')) {
      for (const id of idsX) {
        const a = wx.territories.get(id)!;
        const b = wy.territories.get(id)!;
        if (a.terrain !== b.terrain || a.baseValue !== b.baseValue
          || a.fortification !== b.fortification
          || a.neighboring.join(',') !== b.neighboring.join(',')) {
          identical = false;
          break;
        }
      }
    }
    else {
      identical = false;
    }
    let capitalsMatch = true;
    for (const fid of ['a', 'b']) {
      const c1 = capsX.get(fid)!;
      const c2 = capsY.get(fid)!;
      if (c1 !== c2)
        capitalsMatch = false;
    }
    tests.push({
      name: 'T6. Same seed produces identical world (determinism)',
      pass: identical && capitalsMatch,
      detail: `terrMatch=${identical ? 'YES' : 'NO'}, capsMatch=${capitalsMatch}, size=${wx.territories.size}==${wy.territories.size}`,
    });
  }
  /* ── TEST 7: Scout revealTerritories works across range ─────── */
  {
    const engineT = new MapEngine(6666);
    const { world: w7, visibility: vismap } = engineT.generateInitialWorld({
      worldSeed: 6666,
      playerFactionIds: ['scout_fa'],
    });
    const vis = vismap.get('scout_fa')!;
    const capitalId = Array.from(w7.territories.values()).find(t => t.owner === 'scout_fa')?.id;
    if (capitalId) {
      const beforeUnknown = Array.from(w7.territories.keys()).filter(id => (vis.visibility.get(id)?.state ?? 'unknown') === 'unknown').length;
      const res = engineT.revealTerritories(w7, capitalId, 3, vis, 'scout');
      const afterUnknown = Array.from(w7.territories.keys()).filter(id => (vis.visibility.get(id)?.state ?? 'unknown') === 'unknown').length;
      tests.push({
        name: 'T7. Scout revealTerritories(range=3) expands visibility',
        pass: afterUnknown < beforeUnknown || res.newlyDiscovered.length > 0,
        detail: `unknowns: ${beforeUnknown}→${afterUnknown}, discovered=${res.newlyDiscovered.length}, scouted=${res.newlyScouted.length}`,
      });
    }
    else {
      tests.push({ name: 'T7. (skipped — no owned origin)', pass: false, detail: 'no owned origin' });
    }
  }
  /* ── TEST 8: GameStateSnapshot bridge produces valid specs ──── */
  {
    const engineT = new MapEngine(1234);
    const { world: w8 } = engineT.generateInitialWorld({ worldSeed: 1234, playerFactionIds: [] });
    const specs = engineT.toTerritorySpecs(w8);
    const countMatches = specs.length === w8.territories.size;
    const hasAll = Array.from(w8.territories.keys()).every(id => specs.some(s => s.id === id));
    const neighborsCorrect = specs.every(s => {
      const t = w8.territories.get(s.id);
      return !!t && s.neighbors.join(',') === t.neighboring.join(',');
    });
    tests.push({
      name: 'T8. toTerritorySpecs bridge works (GameStateSnapshot compatibility)',
      pass: countMatches && hasAll && neighborsCorrect,
      detail: `count=${specs.length}/${w8.territories.size}, allIds=${hasAll}, neighborsOK=${neighborsCorrect}`,
    });
  }
  /* ── T9–T12: Neighbor graph invariants across several seeds,
     including after multiple rounds of frontier expansion ─────── */
  {
    const GRAPH_TEST_SEEDS = [9001, 1, 42, 7777, 123456, 2026, 555, 31415];
    const missing: ReturnType<typeof collectNeighborGraphIssues> = [];
    const selfNeighbors: ReturnType<typeof collectNeighborGraphIssues> = [];
    const nonReciprocal: ReturnType<typeof collectNeighborGraphIssues> = [];
    const duplicates: ReturnType<typeof collectNeighborGraphIssues> = [];
    const seedsChecked: number[] = [];
    for (const s of GRAPH_TEST_SEEDS) {
      const engineT = new MapEngine(s);
      const { world: wg } = engineT.generateInitialWorld({ worldSeed: s, playerFactionIds: [] });
      // Run several rounds of expansion so the invariants are checked
      // after repeated frontier growth, not just on the initial world.
      for (let round = 0; round < 3; round++) {
        const frontierIds = Array.from(wg.graphMeta.frontierTerritories);
        if (frontierIds.length === 0)
          break;
        const pick = frontierIds[round % frontierIds.length]!;
        engineT.expandFromFrontier({
          worldState: wg,
          fromFrontierTerritoryId: pick,
          newTerritoryCount: 4,
          salt: round + 1,
        });
        const roundIssues = collectNeighborGraphIssues(wg.territories);
        for (const i of roundIssues) {
          if (i.kind === 'missing_neighbor')
            missing.push(i);
          else if (i.kind === 'self_neighbor')
            selfNeighbors.push(i);
          else if (i.kind === 'non_reciprocal')
            nonReciprocal.push(i);
          else if (i.kind === 'duplicate_neighbor')
            duplicates.push(i);
        }
      }
      seedsChecked.push(s);
    }
    tests.push({
      name: 'T9. Referenced neighbors exist (multi-seed, post-expansion)',
      pass: missing.length === 0,
      detail: missing.length === 0
        ? `all neighbor ids resolve across seeds [${seedsChecked.join(', ')}]`
        : `${missing.length} missing: ${missing.slice(0, 4).map(i => `${i.territoryId}→${i.neighborId}`).join(', ')}`,
    });
    tests.push({
      name: 'T10. No territory listed as its own neighbor (multi-seed, post-expansion)',
      pass: selfNeighbors.length === 0,
      detail: selfNeighbors.length === 0
        ? 'no self-neighbor edges across all seeds'
        : `${selfNeighbors.length} self-neighbor: ${selfNeighbors.slice(0, 4).map(i => i.territoryId).join(', ')}`,
    });
    tests.push({
      name: 'T11. Neighbor edges are reciprocal (multi-seed, post-expansion)',
      pass: nonReciprocal.length === 0,
      detail: nonReciprocal.length === 0
        ? 'all edges bidirectional across all seeds'
        : `${nonReciprocal.length} non-reciprocal: ${nonReciprocal.slice(0, 4).map(i => `${i.territoryId}→${i.neighborId}`).join(', ')}`,
    });
    tests.push({
      name: 'T12. No duplicate neighbor ids (multi-seed, post-expansion)',
      pass: duplicates.length === 0,
      detail: duplicates.length === 0
        ? 'no duplicate neighbor ids across all seeds'
        : `${duplicates.length} duplicates: ${duplicates.slice(0, 4).map(i => `${i.territoryId}→${i.neighborId}`).join(', ')}`,
    });
  }
  /* ── T13: Deterministic generation — same seed, multiple runs,
     full neighbor-graph structure identical (not just names/terrain) ── */
  {
    const SEEDS = [4321, 9001, 555];
    const mismatches: string[] = [];
    for (const s of SEEDS) {
      const runs: string[] = [];
      for (let run = 0; run < 3; run++) {
        const engineT = new MapEngine(s + 1);
        engineT.resetNameTracker();
        const { world: w } = engineT.generateInitialWorld({ worldSeed: s, playerFactionIds: ['a', 'b'] });
        const ids = Array.from(w.territories.keys()).sort();
        const structure = ids
          .map(id => `${id}:${w.territories.get(id)!.neighboring.slice().sort().join('|')}`)
          .join(';');
        runs.push(structure);
      }
      const allIdentical = runs.every(r => r === runs[0]);
      if (!allIdentical)
        mismatches.push(`seed=${s}`);
    }
    tests.push({
      name: 'T13. Same seed produces identical full neighbor-graph structure across repeated runs',
      pass: mismatches.length === 0,
      detail: mismatches.length === 0
        ? `graph structure identical across 3 runs for seeds [${SEEDS.join(', ')}]`
        : `mismatched seeds: ${mismatches.join(', ')}`,
    });
  }
  return tests;
}

export function runMapDemo(opts: {
  seed?: number;
  factions?: FactionId[];
  verbose?: boolean;
  iterations?: number;
}): string {
  const out: string[] = [];
  const seed = opts.seed ?? BALANCE.mapGen.initial.defaultSeed;
  const factions = opts.factions ?? FACTIONS.slice(0, 4);
  const iter = opts.iterations ?? 4;
  const verbose = opts.verbose ?? false;
  out.push('╔══════════════════════════════════════════════════════════════╗');
  out.push('║          REP WARS  ·  MAP GENERATION & EXPANSION ENGINE     ║');
  out.push('║              Third Milestone  ·  Map Test / Demo            ║');
  out.push('╚══════════════════════════════════════════════════════════════╝');
  out.push('');
  out.push(`[DEMO 1] Generate initial world (seed=${seed})`);
  out.push(`       Factions: ${factions.join(', ')}`);
  out.push(`       Themes loaded: ${DEFAULT_THEME_LIBRARY.length} (${DEFAULT_THEME_LIBRARY.map(t => t.id).join(', ')})`);
  const engine = new MapEngine(seed + 1);
  const params = {
    worldSeed: seed,
    playerFactionIds: factions,
    initialTerritoryCount: BALANCE.mapGen.initial.defaultInitialTerritories,
    initialRegionCount: BALANCE.mapGen.initial.defaultInitialRegions,
    startingTerritoriesPerFaction: BALANCE.mapGen.initial.defaultStartingTerritoriesPerFaction,
  };
  const { world, playerCapitals, visibility } = engine.generateInitialWorld(params);
  const report = engine.generateReport(world, playerCapitals);
  out.push('');
  out.push(`       Generated ${report.territoryCount} territories, ${report.regionCount} regions, ${report.frontierCount} frontier slots.`);
  out.push('');
  if (report.perFactionStart) {
    out.push('Per-faction starting positions:');
    for (const [fid, info] of Object.entries(report.perFactionStart)) {
      const cap = world.territories.get(info.capital)!;
      out.push(`  · ${fid.padEnd(22)} capital=${cap.id.padEnd(26)} ${info.territoryCount} territories`);
    }
  }
  out.push('');
  out.push('Terrain distribution:');
  for (const [k, v] of Object.entries(report.terrainDistribution).sort((a, b) => b[1] - a[1])) {
    const pct = (v / report.territoryCount * 100).toFixed(0).padStart(3);
    out.push(`  · ${k.padEnd(10)} ${v.toString().padStart(3)} territories (${pct}%)`);
  }
  out.push('');
  out.push('Theme distribution:');
  for (const [k, v] of Object.entries(report.themeDistribution).sort((a, b) => b[1] - a[1])) {
    const pct = (v / report.territoryCount * 100).toFixed(0).padStart(3);
    out.push(`  · ${k.padEnd(26)} ${v.toString().padStart(3)} territories (${pct}%)`);
  }
  out.push('');
  out.push('─── GRAPH VIEW (legend: #=controlled  !=scouted  o=discovered  ·=unknown; ★=capital) ───');
  out.push(engine.renderWorldText(world));
  out.push('');
  out.push('─── VISIBLE TERRITORY TABLE (for Ashen Horde) ───');
  const ah = visibility.get(factions[0]!);
  out.push(engine.renderTerritoryTable(world, ah));
  if (verbose) {
    out.push('');
    out.push('─── REGION DETAILS ───');
    for (const r of world.regions.values()) {
      const theme = world.themes.get(r.themeId);
      out.push(`REGION ${r.id}  "${r.name}"  [theme=${r.themeId}]  center=${r.centerTerritoryId ?? 'none'}  size=${r.territories.length}${r.isCapitalRegion ? '  ★CAPITAL REGION' : ''}`);
      if (theme)
        out.push(`         env=${theme.environmentalTag ?? 'n/a'}  strategic=${theme.strategicTendency}  rarity=${theme.rarity}`);
      out.push(`         territories: ${r.territories.slice(0, 8).join(', ')}${r.territories.length > 8 ? ` +${r.territories.length - 8} more` : ''}`);
    }
  }
  out.push('');
  out.push('─── STRUCTURAL VALIDATION ───');
  const val = engine.validateWorld(world);
  out.push(val.summary);
  out.push('');
  out.push(`[DEMO 2] Fog of War — visible vs unknown territories per faction`);
  for (const fid of factions) {
    const v = visibility.get(fid)!;
    const unknowns: string[] = [];
    const discovered: string[] = [];
    const scouted: string[] = [];
    const controlled: string[] = [];
    for (const [id, info] of v.visibility.entries()) {
      if (info.state === 'controlled')
        controlled.push(id);
      else if (info.state === 'scouted')
        scouted.push(id);
      else if (info.state === 'discovered')
        discovered.push(id);
      else
        unknowns.push(id);
    }
    const total = world.territories.size;
    const pct = (n: number) => (n / total * 100).toFixed(0).padStart(3);
    out.push(`  · ${fid.padEnd(22)} C=${controlled.length.toString().padStart(2)}(${pct(controlled.length)}%)  S=${scouted.length.toString().padStart(2)}(${pct(scouted.length)}%)  D=${discovered.length.toString().padStart(2)}(${pct(discovered.length)}%)  U=${unknowns.length.toString().padStart(2)}(${pct(unknowns.length)}%)  knownThemes=${v.knownThemes.size}/${world.themes.size}  knownRegions=${v.knownRegions.size}/${world.regions.size}`);
  }
  out.push('');
  out.push(`[DEMO 3] Conquest-driven expansion — ashen_horde conquers frontier → engine generates new lands`);
  out.push(`       Simulating ${iter} rounds of frontier conquest + auto-expansion.`);
  const ashen = factions[0]!;
  const vis = visibility.get(ashen)!;
  let expCount = 0;
  for (let round = 0; round < iter; round++) {
    out.push(``);
    out.push(`   ─ Round ${round + 1} of frontier expansion for ${ashen} ─`);
    const candidates = Array.from(world.territories.values()).filter(t => {
      const v = vis.visibility.get(t.id);
      if (!v)
        return false;
      if (v.state === 'unknown')
        return false;
      if (t.owner === ashen)
        return false;
      return t.neighboring.some(nid => world.territories.get(nid)?.owner === ashen);
    });
    if (candidates.length === 0) {
      out.push('      No adjacent conquerable territories. Triggering scout-based discovery instead.');
      const ctrl = Array.from(world.territories.values()).find(t => t.owner === ashen);
      if (ctrl) {
        const sr = engine.revealTerritories(world, ctrl.id, 3, vis, 'scout');
        out.push(`      Scout found: ${sr.newlyDiscovered.length} new, ${sr.newlyScouted.length} scouted.`);
      }
      break;
    }
    candidates.sort((a, b) => b.baseValue - a.baseValue);
    const target = candidates[0]!;
    target.owner = ashen;
    out.push(`      Conquered: ${target.id} (${target.terrain}, value=${target.baseValue}) — now owned by ${ashen}.`);
    engine.recomputeVisibilityFor(world, ashen, vis);
    const newly = Array.from(vis.visibility.entries()).filter(([, v]) => v.lastUpdatedTurn >= world.turn - 1 && v.revealedBy === 'control').length;
    out.push(`      Control-based reveal showed ${newly} adjacent territories.`);
    const frontier = Array.from(world.graphMeta.frontierTerritories).filter(fid => {
      const t = world.territories.get(fid);
      if (!t)
        return false;
      const v = vis.visibility.get(fid);
      return !!v && v.state !== 'unknown' && t.neighboring.length > 0;
    });
    if (frontier.length > 0) {
      const pick = frontier[Math.floor(frontier.length / 2)]!;
      const req = {
        worldState: world,
        fromFrontierTerritoryId: pick,
        newTerritoryCount: 3,
        ownerFaction: null,
        salt: expCount++,
      };
      const res = engine.expandFromFrontier(req);
      out.push(`      Expansion from ${world.territories.get(pick)?.id ?? pick} → ${res.newTerritories.length} new territories, ${res.newRegions.length} new regions.`);
      for (const nt of res.newTerritories.slice(0, 3)) {
        out.push(`        ⟶ ${nt.id.padEnd(24)} [${nt.terrain.padEnd(8)} val=${nt.baseValue.toString().padStart(3)} pop=${Math.round(nt.population / 1000)}k]`);
      }
      if (res.newRegions.length) {
        for (const nr of res.newRegions.slice(0, 2)) {
          out.push(`        REGION → ${nr.name} [theme=${nr.themeId}, size=${nr.territories.length}]`);
        }
      }
      out.push(`      Validation: connected=${res.validation.allConnected}  noIsolated=${res.validation.noIsolated}  noOverwrite=${res.validation.noOverwrites}  frontierNow=${res.validation.frontierCount}`);
      engine.recomputeVisibilityFor(world, ashen, vis);
    }
    else {
      out.push('      No frontier to expand from.');
    }
  }
  out.push('');
  out.push(`[DEMO 4] Scout-based exploration — revealTerritories(origin, range=4)`);
  const ashenCapital = playerCapitals.get(ashen);
  if (ashenCapital) {
    const beforeUnknown = Array.from(world.territories.keys()).filter(tid => !vis.visibility.has(tid) || vis.visibility.get(tid)!.state === 'unknown').length;
    const scoutRes = engine.revealTerritories(world, ashenCapital, 4, vis, 'scout');
    out.push(`      Origin: ${world.territories.get(ashenCapital)?.id ?? ashenCapital} (${ashen} capital), range=4.`);
    out.push(`      Revealed territories: ${scoutRes.revealedTerritories.length}`);
    out.push(`      newly discovered: ${scoutRes.newlyDiscovered.length}`);
    out.push(`      newly scouted (full info): ${scoutRes.newlyScouted.length}`);
    out.push(`      Unknowns before: ${beforeUnknown} → now: ${Array.from(world.territories.keys()).filter(tid => !vis.visibility.has(tid) || vis.visibility.get(tid)!.state === 'unknown').length}`);
    if (verbose && scoutRes.revealedTerritories.length) {
      out.push('      Sample reveals:');
      for (const r of scoutRes.revealedTerritories.slice(0, 8)) {
        const name = world.territories.get(r.id)?.id ?? r.id;
        out.push(`        distance ${r.distance.toFixed(1)}: ${r.fromState} → ${r.toState}  ${name}`);
      }
    }
  }
  out.push('');
  out.push(`[DEMO 5] Seeded determinism — same seed (${seed}) produces same world?`);
  out.push(`       NOTE: this compares two FRESH generations from the same seed, not the`);
  out.push(`       "${ashen}"-conquered/expanded world from DEMO 3-4 above (that world has been`);
  out.push(`       mutated by conquest and manual expansion, so it is no longer an equivalent`);
  out.push(`       state to compare against a clean generation — doing so previously produced`);
  out.push(`       a misleading FAIL here even though generation itself is fully deterministic).`);
  const engine1Fresh = new MapEngine(seed + 1);
  engine1Fresh.resetNameTracker();
  const { world: world1Fresh, playerCapitals: pc1 } = engine1Fresh.generateInitialWorld(params);
  const engine2 = new MapEngine(seed + 1);
  engine2.resetNameTracker();
  const { world: world2, playerCapitals: pc2 } = engine2.generateInitialWorld(params);
  let sameWorld = world1Fresh.territories.size === world2.territories.size &&
    world1Fresh.regions.size === world2.regions.size;
  const ids1 = Array.from(world1Fresh.territories.keys()).sort();
  const ids2 = Array.from(world2.territories.keys()).sort();
  let sameGraph = ids1.join(',') === ids2.join(',');
  if (sameWorld) {
    for (let i = 0; i < Math.min(ids1.length, ids2.length); i++) {
      const a = world1Fresh.territories.get(ids1[i]!)!;
      const b = world2.territories.get(ids2[i]!)!;
      if (a.id !== b.id || a.terrain !== b.terrain || a.baseValue !== b.baseValue) {
        sameWorld = false;
      }
      if (a.neighboring.slice().sort().join('|') !== b.neighboring.slice().sort().join('|')) {
        sameGraph = false;
      }
    }
  }
  else {
    sameGraph = false;
  }
  let capsSame = true;
  for (const fid of factions) {
    const c1 = pc1.get(fid)!;
    const c2 = pc2.get(fid)!;
    if (world1Fresh.territories.get(c1)?.id !== world2.territories.get(c2)?.id)
      capsSame = false;
  }
  out.push(`      Territories: ${world1Fresh.territories.size}==${world2.territories.size}  Regions: ${world1Fresh.regions.size}==${world2.regions.size}`);
  out.push(`      Territory ids, names, terrain & values identical: ${sameWorld ? 'PASS ✓' : 'FAIL ✗'}`);
  out.push(`      Full neighbor-graph structure identical: ${sameGraph ? 'PASS ✓' : 'FAIL ✗'}`);
  out.push(`      Capital assignments identical: ${capsSame ? 'PASS ✓' : 'FAIL ✗'}`);
  out.push('');
  out.push(`[DEMO 6] Different seeds → different worlds?`);
  const paramsAlt = { ...params, worldSeed: 2026 };
  const engine3 = new MapEngine(2026 + 1);
  engine3.resetNameTracker();
  const { world: world3 } = engine3.generateInitialWorld(paramsAlt);
  const names1 = new Set(Array.from(world.territories.values()).map(t => t.id));
  const names3 = new Set(Array.from(world3.territories.values()).map(t => t.id));
  const commonNames = Array.from(names1).filter(n => names3.has(n)).length;
  const terr1 = JSON.stringify(Object.fromEntries(Object.entries(engine.generateReport(world).terrainDistribution).sort()));
  const terr3 = JSON.stringify(Object.fromEntries(Object.entries(engine3.generateReport(world3).terrainDistribution).sort()));
  out.push(`      Seed ${seed} → ${names1.size} unique names, seed ${paramsAlt.worldSeed} → ${names3.size} unique names.`);
  out.push(`      Shared names between worlds: ${commonNames}/${names1.size} (lower is more diverse)`);
  out.push(`      Terrain distribution differs: ${terr1 !== terr3 ? 'YES ✓' : 'NO (identical) ✗'}`);
  out.push(`      Sizes: ${world.territories.size} vs ${world3.territories.size} territories, ${world.regions.size} vs ${world3.regions.size} regions.`);
  out.push('');
  out.push('─── FINAL STATE ───');
  const finalReport = engine.generateReport(world);
  out.push(`Territories ${finalReport.territoryCount}  |  Regions ${finalReport.regionCount}  |  Frontier slots ${finalReport.frontierCount}`);
  out.push(engine.renderWorldText(world, vis, ashen));
  out.push('');
  out.push(engine.renderTerritoryTable(world, vis));
  out.push('');
  const val2 = engine.validateWorld(world);
  out.push('─── FINAL VALIDATION ───');
  out.push(val2.summary);
  out.push('');
  out.push('╔══════════════════════════════════════════════════════════════╗');
  out.push('║                  FORMAL VALIDATION TEST SUITE                ║');
  out.push('╚══════════════════════════════════════════════════════════════╝');
  const tests = runMapValidationTests();
  out.push('');
  const passed = tests.filter(t => t.pass).length;
  const total = tests.length;
  out.push(`Results: ${passed}/${total} tests passed`);
  out.push('');
  for (const t of tests) {
    const icon = t.pass ? '✓ PASS' : '✗ FAIL';
    out.push(`  ${icon}  ${t.name}`);
    out.push(`         ${t.detail}`);
  }
  out.push('');
  out.push(passed === total
    ? `All ${total} validation tests PASSED ✓`
    : `${total - passed} test(s) FAILED — review above.`);
  out.push('');
  out.push('End of map generation & expansion demo.');
  return out.join('\n');
}
