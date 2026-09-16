# Rep Wars — Economy Specification (v1)

**Status:** Authoritative design lock for the v1 economy.  
**This document is design only.** It does not authorize implementation by itself; implementation is a later, explicit phase.

Related (not design authority):

- `docs/ECONOMY_DESIGN_SURFACE.md` — current code hooks / extension points
- Prior Economy Design-Lock Audit and Design-Resolution reports

**Labels used below**

| Label | Meaning |
|--------|---------|
| **LOCKED** | Build against this rule. Changing it is a product decision, not a tuning pass. |
| **INITIAL / TUNABLE** | Defined enough to implement; expect playtest changes. Not a permanent number. |
| **DEFERRED** | Intentionally unfinished. Must not block economy-core implementation. |

---

## 1. Economy philosophy

**LOCKED**

The v1 economy exists to create **strategic choices**, not an accounting simulator.

1. **Specialization matters.** Authored tile `resourceOutput` is geographic identity. Development **amplifies** what a tile already produces; it does not invent missing resources.
2. **Scarcity is real.** Wood is common, Stone less so, Iron rarer. Gold is labor currency. Food is the only decaying stock. Players should not always have everything.
3. **Fitness is physical input, not a second currency.** Live workouts accelerate construction, power Golden Yield, grant Troops, or provide emergency defense. Gold never buys those effects. Banked Troops never pay for buildings.
4. **Bookkeeping stays small.** One construction project per territory. One empire-health variable (Stability). No population, hunger, prosperity, or size-based Gold upkeep.
5. **Scale is a conversion layer.** The fitness engine sets **relative physical workload**. World level sets **game-unit magnitude**. Troops and costs may grow from tens to tens of thousands without making workouts absurd.
6. **No burnout pressure.** Passive production accrues offline; collection is a player action; construction uses world time; workouts are optional acceleration (except systems that already require them: Golden Yield, emergency defense, troop grants).
7. **Expansion is not taxed in Gold.** Owning more land does not levy a maintenance fee. Food demand scales with owned territories as **sustenance**, not as a punishment tax.
8. **Stability is the only empire-health variable.** Food shortage and events feed it. Low Stability makes negative events (and later rebellion) more dangerous. It is not a production penalty slider.

---

## 2. Resource system

Five keys remain: `gold`, `food`, `iron`, `wood`, `stone`.  
**LOCKED:** Do not add categories in v1.

### Gold

| | |
|--|--|
| **Role** | Currency / paying labor. Required on **every** conventional building. Also spent on REINFORCE. |
| **Source** | Territorial `resourceOutput.gold` (keep unless a later contradiction). Events may grant or take Gold. |
| **Production** | Passive, owned tiles, no City required. |
| **Collection** | Player `COLLECT_RESOURCES` (and later AI auto-collect). |
| **Storage** | `faction.resources.gold` after collect; uncollected on `territoryEconomy`. |
| **Decay** | **None.** |
| **Sinks now** | Construction (all buildings), REINFORCE. |
| **Sinks later** | Trade. **Not** Golden Yield, **not** workout acceleration. |

### Food

| | |
|--|--|
| **Role** | Empire sustenance. Also military supply when spent on REINFORCE. **Not** a construction material. **Not** a hunger/happiness meter. |
| **Source** | Territorial `resourceOutput.food`; Farm multiplies existing Food only. |
| **Production** | Passive, owned tiles. |
| **Collection** | Player collect into banked reserves. |
| **Storage** | Banked: `faction.resources.food`. Uncollected: `territoryEconomy` (not eaten). |
| **Decay** | **Yes — only naturally consumed resource.** 1 Food per owned territory per 60-tick cycle, from banked Food, all factions. |
| **Sinks now** | Passive empire consume; REINFORCE (military supply). |
| **Shortage** | Feeds **Stability** only. No second meter. No production freeze. |

### Wood

| | |
|--|--|
| **Role** | Common / lighter construction material. Relatively easy to acquire (authoring + Lumber). |
| **Source** | Territorial `resourceOutput.wood`; Lumber Operation multiplies existing Wood. |
| **Production / collection / storage** | Same pipeline as other materials. |
| **Decay** | None. |
| **Sinks (v1 classes)** | Farm, Mine, Road, Market. |

### Stone

| | |
|--|--|
| **Role** | Less common than Wood. Heavier construction. |
| **Source** | Territorial `resourceOutput.stone`; Mine multiplies existing Stone (and Iron). |
| **Decay** | None. |
| **Sinks (v1 classes)** | City, Fortification, Lumber Operation, Market. |

### Iron

| | |
|--|--|
| **Role** | Rarer than Stone. Strategic / heavy. **Required for Cities.** |
| **Source** | Territorial `resourceOutput.iron`; Mine multiplies existing Iron (and Stone). |
| **Decay** | None. |
| **Sinks (v1 classes)** | City. (No other v1 building class uses Iron.) |

---

## 3. Production, accrual, collection

**LOCKED** flow:

```
Owned territory
  → passive production from Territory.resourceOutput
     (after completed development multipliers)
  → lazy accrual (telescoping tick math)
  → uncollected on GameState.territoryEconomy
  → player COLLECT_RESOURCES
  → faction.resources (banked)
```

- A **City is not required** to produce.
- Accrual is **not** a per-minute simulation loop; catch-up uses `lastAccrualTick`.
- Production cycle: **60 world ticks** (prototype: 1 tick ≈ 1 minute). **INITIAL / TUNABLE** as a clock constant; the **rule** (cycle-aligned Food consume + accrual) is **LOCKED**.
- `faction.resourceIncome` remains a **derived rating** for AI/events. It is **not** authoritative production.

**Where resources exist**

| Stage | Location |
|--------|----------|
| Authored / mutated tile rate | `Territory.resourceOutput` |
| Uncollected yield | `territoryEconomy.uncollected` (+ peek since last stamp) |
| Banked reserves | `WarlordSnapshot.resources` |
| Derived scoring/trigger hint | `WarlordSnapshot.resourceIncome` |

**Golden Yield — LOCKED**

- Live workout purpose `GOLDEN_YIELD`.
- Stores a **pending one-time collection multiplier**.
- Consumed on a successful `COLLECT_RESOURCES` that requests it.
- Does **not** permanently change `resourceOutput`.
- Does **not** cost Gold.
- Does **not** replace territorial specialization or developments.

**Collection — LOCKED:** remains **player-initiated**. Do not auto-deposit for the player. AI collection may later use an internal schedule without changing the player loop.

---

## 4. Food and Stability

**LOCKED**

- **No population system** in v1.
- Demand: **1 Food × number of owned territories**, once per **60-tick** production cycle.
- Applies to **player and AI** factions.
- Pays from **`faction.resources.food` only**.
- Uncollected territory Food is **not** consumed.
- If banked Food **≥** demand: subtract demand. **No** Food-driven Stability change that cycle.
- If banked Food **<** demand: consume all remaining Food, set Food **= 0**, then **−2 Stability** for that **failed** cycle (clamp Stability to 0–100).
- **No** production freeze.
- **No** hunger, prosperity, civilian morale, or other health meters.
- Event `stabilityDelta` remains valid.
- Failed/low Stability may make **existing** negative events more likely; do not add a second Food-event pipeline.
- **No** empire-size Gold (or material) upkeep.

**INITIAL / TUNABLE:** starting Stability **70**; failed-cycle penalty **−2**.

**Do not** invent a dedicated Stability recovery grind. Surplus Food does not automatically raise Stability in v1.

---

## 5. Construction system

**LOCKED** universal model:

```
Gold + required materials
  → ConstructionProject (in_progress)
  → world-time progress (ADVANCE_WORLD / catch-up)
  → completeConstruction → definition.onComplete()
```

**Concurrency — LOCKED:** **one active construction project per territory.**  
A tile cannot build City and Farm at the same time. **Completed** buildings coexist.

**Workout — LOCKED:** `EXTRA_CONSTRUCTION_WORKERS` accelerates the **currently active** project on that construction id. It does **not**:

- pay Gold or materials
- replace the project cost
- use banked Troops

| Concept | Meaning |
|---------|---------|
| **Construction cost** | Gold + materials deducted **when the project starts** |
| **Construction time** | World ticks until complete (`durationTicks` / `remainingTicks`) |
| **Workout acceleration** | Reduces remaining ticks (existing `workerPower` conversion); may finish the project early |

Banked Troops remain **offensive military spending** only.

Canonical player command: `START_CONSTRUCTION`.  
`BUILD` remains a **legacy alias** for timed **FORTIFICATION** only.

---

## 6. Building system

**LOCKED material classes** (amounts are **INITIAL / TUNABLE**, see §16):

| Building | Gold | Wood | Stone | Iron |
|----------|------|------|-------|------|
| City | yes | — | yes | yes |
| Fortification | yes | — | yes | — |
| Farm | yes | yes | — | — |
| Lumber Operation | yes | — | yes | — |
| Mine | yes | yes | — | — |
| Road | yes | yes | — | — |
| Market | yes | yes | yes | — |

Food is **never** a building material.

All of the following share: conventional project, world time, workout acceleration, **no operating cost**, destroyed on conquest (see §8), **no banked Troops**.

### City

**LOCKED**

- **Purpose:** defense. **Does not** increase passive production.
- **Binary:** present or absent. **One per territory.**
- Unlocks **Fortification**.
- Makes military conquest **harder**.
- Reduces **live defensive workout burden** when the player defends.
- Fortification **strengthens** City defense (City has no separate level track in v1).

**INITIAL / TUNABLE** combat/workout numbers: see §9 and §16. Not permanently locked.

### Fortification

**LOCKED**

- Strengthens **City** defense only. Not an economic building.
- **Requires** a City. Cannot exist on cityless land.
- **Leveled**; each +1 is its **own** construction project.

**INITIAL / TUNABLE:** max **5** levels; **+3%** defender defense bonus per level (current combat hook). Costs/duration in §16.

### Farm

**LOCKED rules:** conventional building; one Farm per territory; no defense; no opex.

**INITIAL / TUNABLE effect:** **×1.5** `resourceOutput.food` on that tile (multiplicative). If base Food is **0**, Farm does **nothing**.

### Mine

**LOCKED rules:** one Mine per territory; no defense; no opex.

**INITIAL / TUNABLE effect:** **×1.5** `resourceOutput.stone` **and** **×1.5** `resourceOutput.iron` on that tile. Zeros stay zero (a Mine does not create Iron on a 0-Iron tile).

### Lumber Operation

**LOCKED rules:** one per territory; no defense; no opex.

**INITIAL / TUNABLE effect:** **×1.5** `resourceOutput.wood` on that tile.

### Road

**LOCKED purpose only:**

- Improve **movement**
- Improve **resource efficiency**
- Improve **connectivity** between important territories / cities

**DEFERRED:** exact movement formula, connectivity graph, and **any** resource-efficiency formula.

Do **not** treat a Road as a generic production multiplier. Do **not** lock “+10% collectible yield” or any other placeholder bonus.

Roads remain conventional Gold + Wood buildings when the Road **system** is designed. Until then, Road **need not ship** in economy-core.

### Market

**LOCKED**

- **Exactly one** Market per faction / empire.
- Must be built on a territory that **has a City**.
- Effect is **empire-wide** (not one Market per tile).
- Exists to **enable / improve trade**.
- Upgrades **eventually** improve trade rates.

**DEFERRED:** trade protocol, pricing, AI–player execution, player-to-player trade.

Do **not** implement trading in the economy-core phase. Market **need not ship** until trade work starts; the **placement rule** is locked so later work does not guess.

---

## 7. Territory specialization

**LOCKED**

`WorldDefinition.territory.resourceOutput` is the authored **geographic / resource identity** of the tile.

The **Map Assistant** (and world JSON) is responsible for making Wood, Stone, Iron, Food, and Gold **differ by place**. Runtime must not flatten that.

Developments **multiply existing rates** of matching resources:

- Food-rich + Farm → more Food (more valuable heartland).
- Iron-rich + Mine → more Iron (and more Stone if the tile has Stone).
- Wood-rich + Lumber → more Wood.
- **0 Iron + Mine → still 0 Iron.** A Mine does not turn a forest into a mine district.

Optimal play must **not** be “build every development on every tile.” Gold, time, one-project-per-tile, and multiplicative-on-zero enforce that without a one-building-per-tile cap.

**Level 1** authored outputs (including 0 Iron / 0 Stone on tutorial tiles) are **content**, not the global scarcity model. Do not retune Level 1 in the economy-core pass.

---

## 8. Conquest and building destruction

**LOCKED**

When a territory changes owner:

| Asset | Result |
|--------|--------|
| City | Destroyed |
| Fortification | Reset to 0 / destroyed |
| Farm, Mine, Lumber Operation | Destroyed |
| Road | Destroyed |
| Market | Destroyed if it stood on that tile (empire then has **no** Market until rebuilt on a City) |
| Uncollected yield | Forfeited |
| In-progress construction | Cancelled, **no refund** |
| Base `resourceOutput` | **Unchanged** (authored identity remains) |
| Garrison | Reset (current settlement) |

The conqueror receives **undeveloped / bare land**: productive at **base** rates, no City, no developments.

---

## 9. Warfare and economy interaction

**LOCKED relationships** (formulas **INITIAL / TUNABLE**):

### City

- Harder to conquer with **military force**.
- Easier to hold with a **live DEFENSE workout** (same physical effort is worth more game defense, or equivalently the burden is lower).

### Fortification

- Further increases **military** defense of that City tile.
- Further reduces **live defense burden**.
- Illegal without a City.

### Cityless territory

- Still **economically productive**.
- **Cannot** have Fortification.
- **Easier** military target.
- Requires **greater** physical defensive effort if the player defends it.

### Garrison

- **Separate** from City.
- Created/changed by **REINFORCE** (Gold + Food) and by **events**.
- City does not auto-spawn garrison.

**INITIAL / TUNABLE implementation proposals (not locked numbers):**

- City present: extra defender power factor **1.25** (cityless **1.0**).
- DEFENSE workout `defensePower` conversion factor: cityless **1.0**; City **1.5**; **+0.1 per Fortification level**, cap **2.0**.
- Fortification: existing **+0.03** defense bonus per level in combat.

Playtesting may replace these without changing §9 **rules**.

**Level 1:** do not apply new City combat / workout multipliers until scripted combat assumptions are updated (see §13).

---

## 10. Stability

**LOCKED**

- Range **0–100**.
- **INITIAL / TUNABLE** spawn **70**.
- **Food:** failed consume cycle **−2** (see §4).
- **Events:** may apply `stabilityDelta`.
- **Not** a general production tax.
- **Not** an expansion Gold tax.
- **Not** a second health meter.
- Low Stability increases **danger** (negative event likelihood/severity via the existing event system).
- **Future rebellion** (not in v1 implementation) must use Stability as a primary input and spawn a **real hostile AI faction** on a player tile. **Do not implement rebellion** in economy-core.

---

## 11. AI economy

**LOCKED intent — do not rewrite AI in the first economy implementation** unless a hook is required for Food consume (all factions).

When AI economy is extended:

- AI uses **normal** `START_CONSTRUCTION` projects (Gold + materials + time).
- AI **does not** perform workouts; it **waits** out timers.
- AI **collects** on an internal schedule (player collect stays manual).
- AI **consumes Food** and must care about **Stability**.
- AI founds **Cities** when defense/threat requires it.
- AI **fortifies** important or threatened Cities.
- AI builds Farm / Mine / Lumber **only where matching base output is already > 0**.
- AI should **eventually** understand Roads and Markets.
- AI must **not** receive a fake workout currency.

`TRADE` remains unsupported until Market trade is designed.

---

## 12. Level scaling

**LOCKED architecture**

> **Fitness engine** = relative physical workload (what the player actually does).  
> **Game scaling** = how much game-world value that workload represents.

Therefore:

- Exercise prescriptions must **not** grow 1:1 with troop/resource inflation.
- Troops, resources, armies, and construction costs **may** grow from small to enormous.
- Reward conversion (Troops, workerPower, defensePower, Golden Yield bounds) is a **balance layer**, selectable by **`WorldDefinition.level` / `GameState.worldLevel`**.
- Authored `resourceOutput` remains **specialization shape**; magnitude may use per-world JSON and/or a **single** per-level scale table.

**Avoid** stacking independent exponentials (steep JSON growth × steep level table × steep reward curve).

**INITIAL:** Level 1 scale factor **1**; current `GAME_REWARD_CONFIG` conversions and caps **unchanged** until a scaling pass.

---

## 13. Level 1 safety

**LOCKED for the economy-core phase**

Level 1 is a **scripted tutorial**, not the full economy teacher. The sequence **workout → troop reward → attack → scripted invasion → defensive workout → conquest / completion** must remain intact.

| System | Level 1 |
|--------|---------|
| Starting resources / tile `resourceOutput` | **Unchanged** |
| Troop / GY / defense / worker conversion | **Unchanged** |
| Player collect / Golden Yield | **Keep** |
| `START_CONSTRUCTION` City / Fort | May exist; **must not** be required to finish the tutorial |
| Food consumption / Stability drain | **Disabled / gated** (e.g. world level ≥ 2 or explicit flag) |
| Farm / Mine / Lumber / Road / Market | **Not required**; may be absent |
| City combat / defense-workout multipliers | **Do not enable** until combat tests/scripts are updated |
| Rebellion (faction) | **Off** |
| Level 1 map retune | **Separate content pass later** |

---

## 14. Analytics

**LOCKED principle:** no per-tick telemetry for ordinary passive accrual.

**Canonical events (emit when the system exists):**

| Event | When |
|--------|------|
| `resource.collected` | Successful collect (all changed keys) |
| `resource.spent` | Construction start, REINFORCE, etc. |
| `resource.consumed` | Food empire consume (paid or failed) |
| `resource.golden_yield_used` | GY consumed on collect |
| `construction.started` | Project start (`START_CONSTRUCTION` / BUILD alias) |
| `construction.completed` | Timer or acceleration finish |
| `construction.accelerated` | Worker effect applied |
| `city.founded` | CITY complete |
| `development.completed` | Farm / Mine / Lumber complete |
| `building.destroyed` | Conquest settlement |
| `stability.changed` | Food fail and/or event deltas (avoid noise) |
| `market.trade` | **DEFERRED** |
| `rebellion.*` | **DEFERRED** |

Existing `resource.collected` / `spent` / construction / GY telemetry should stay **complete for all resource keys**.

---

## 15. Persistence

Must round-trip when those systems exist:

- `faction.resources`
- `territoryEconomy` (`lastAccrualTick`, `uncollected`)
- `Territory.resourceOutput` (including event mutations)
- Development / building occupancy (Farm, Mine, Lumber, Road, Market)
- `cities`, `Territory.fortification`
- `constructions` + `remainingTicks` / `lastProgressTick`
- Market identity (which tile, level when upgrades exist)
- `stability`
- Food consumption **last-consumed tick** (or equivalent stamp)
- `playerRewards` (Golden Yield pending, construction workers, applied ledger)
- derived `resourceIncome` (recomputable; persist if already on snapshot)
- Future rebellion records

**Catch-up — LOCKED:** Food consume and construction progress must use **world-tick stamps**, collapsing offline time in one pass (same pattern as current accrual / construction). Do **not** simulate each minute individually.

---

## 16. Balance parameters

All numbers below are **INITIAL / TUNABLE** unless noted as a **LOCKED rule** (e.g. “1 Food per territory per cycle”).

### Currently existing (in code today)

| Parameter | Current value | Notes |
|-----------|----------------|--------|
| Production / Food cycle | 60 ticks | Align consume with this clock (**LOCKED rule**, value tunable) |
| City Gold | 80 | Keep as initial; **add Iron** (new row) |
| City Stone | 40 | |
| City duration | 30 ticks | |
| Fortification Gold | 40 | |
| Fortification Stone | 20 | |
| Fortification duration | 20 ticks | |
| Fortification max level | 5 | |
| Fortification per-level combat bonus | 0.03 | |
| REINFORCE | 250 Gold, 150 Food, +100 garrison | Food as **military supply** is **LOCKED** |
| Stability spawn | 70 | |
| Golden Yield | 1.25–4.0, half-sat 40, zero-output 1.0 | |
| Troops conversion | ×10 physical, cap 10_000 | Level 1: **do not change** |
| Worker conversion | ×0.25, cap 500 | |
| Defense conversion | ×1, cap 5_000 | |
| Worker ticks per power | 1 | |
| Level 1 start | 400/400/80/80/80 Gold/Food/Iron/Wood/Stone | **Do not change** in economy-core |
| Level 1 tile output | gold 1, food 2, wood 2, iron 0, stone 0 | Content; **do not change** now |

### Newly proposed (not in code)

| Parameter | Initial value | Notes |
|-----------|----------------|--------|
| City Iron | **40** | Matches Stone; Level 1 start 80 Iron still founds **one** City |
| Food demand | **1 × owned territories** per cycle | **LOCKED rule**; the **1** is tunable |
| Failed Food cycle | **−2 Stability** | Tunable |
| Farm / Mine / Lumber multiplier | **×1.5** matching outputs | Multiplicative; 0 stays 0 |
| Farm cost | **30 Gold, 20 Wood**, **20 ticks** | Cheaper than City |
| Lumber cost | **30 Gold, 20 Stone**, **20 ticks** | Does not spend Wood |
| Mine cost | **40 Gold, 25 Wood**, **20 ticks** | |
| Road cost / duration | **25 Gold, 20 Wood**, **15 ticks** | **Building class locked**; **effects DEFERRED** — do not ship Road gameplay until Road design |
| Market cost / duration | **50 Gold, 20 Wood, 20 Stone**, **25 ticks** | Placement locked; **trade DEFERRED** |
| City military factor | **1.25** vs cityless **1.0** | Combat proposal only |
| Defense workout factor | **1.0** cityless; **1.5** City; **+0.1 / fort level**, cap **2.0** | Conversion proposal only |
| World-level scale factor | **1** at Level 1 | Architecture locked; curve **DEFERRED** |

### Deliberately unchosen (do not invent in core)

| Item | Status |
|------|--------|
| Road movement ticks, connectivity graph, resource-efficiency formula | **DEFERRED** |
| Market trade rates, upgrade count, AI/P2P protocol | **DEFERRED** |
| Per-level exponential cost/reward curves beyond “scale table exists” | **DEFERRED** |
| Rebellion trigger, army size, aftermath | **DEFERRED** |
| Population | **DEFERRED** |
| City levels (beyond binary + Fort levels) | **DEFERRED** |
| Farm/Mine/Lumber additional levels | **DEFERRED** (v1 is one-and-done per type per tile) |

---

## 17. Deferred systems

This specification **intentionally does not finalize**:

- Advanced **population**
- Detailed **Road** network model and **resource-efficiency** formula
- Final **Market** trade formula and execution
- **AI–player** trade implementation
- **Player-to-player** trade
- Final **rebellion** mechanics (faction spawn, severity, aftermath)
- Advanced economic **event** redesign
- Advanced high-level **scaling curves**
- Future resource or building **types** beyond the v1 list
- Parallel construction (one active project per tile is **LOCKED** for v1)

These must **not** block: production/collect, Food consume + Stability, construction Gold+materials (including City Iron), City/Fort rules, Farm/Mine/Lumber multipliers, conquest destruction, Level 1 gating.

---

## 18. Final design status

### LOCKED

- Five resources and their roles (Gold currency, Food sustenance, Wood/Stone/Iron materials).
- Passive tile production without a City; lazy accrual; **player** collect; Golden Yield on collect.
- Food consume: banked only, all factions, **1 × owned territories / 60-tick cycle**; fail → Food 0 and **−2** Stability; no freeze; no second meter.
- No population; no Gold empire-size upkeep; Stability only health variable.
- Construction: Gold + materials, world time, one active project per territory, completed buildings coexist.
- Workout accelerates time (`EXTRA_CONSTRUCTION_WORKERS`); never pays cost; Troops never pay buildings; Gold never pays GY/acceleration.
- Material **classes** (table in §6); City = Gold+Stone+Iron; Fort = Gold+Stone; Food never a build material.
- City = binary defense, no production, unlocks Fort; Fort requires City and is leveled.
- Farm / Mine / Lumber = conventional buildings; multiplicative on existing matching output; one per type per tile; no opex; no defense; destroyed on conquest.
- One Market per empire, **on a City tile**, empire-wide; trade **not** implemented yet.
- Roads: purpose movement / efficiency / connectivity only — **no** placeholder production formula.
- Conquest → bare land, forfeit uncollected, no refund.
- Garrison separate (REINFORCE + events).
- Fitness vs game-unit scaling split; world level selects game magnitude.
- Level 1 tutorial gated (no Food drain, no rebellion, no required new buildings, no untested City combat multipliers).
- REINFORCE may spend Food as military supply.

### INITIAL / TUNABLE

- All §16 numeric costs, durations, ×1.5 development bonuses, City Iron 40, City/Fort combat and workout **proposal** factors, Stability 70 / −2, reward conversion (leave Level 1 unchanged), REINFORCE amounts, fort max 5 / +3% per level.

### DEFERRED

- Population; Road formulas; Market trade; P2P trade; rebellion; advanced events; multi-level developments/Cities; parallel construction; high-level scale curves.

---

### Remaining Category C?

**No.**

The four product-owner decisions (Food per territory, one project per tile, material classes, Market on City) close the last implementation-blocking forks.

What remains is **INITIAL / TUNABLE** numbers (safe to ship as constants) or **DEFERRED** systems (must not be guessed as if they were v1 rules).

If implementation discovers a **genuine repository contradiction** (e.g. a command that cannot express Gold+Iron without inventing a new player-facing rule), stop and ask — do not invent a fifth resource, a second health meter, auto-collect for the player, or a Road yield hack.

---

*End of v1 Economy Specification.*
