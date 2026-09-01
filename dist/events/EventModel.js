"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SEVERITY_ORDER = void 0;
exports.buildDefaultSeverityTable = buildDefaultSeverityTable;
exports.pickSeverityFromTable = pickSeverityFromTable;
exports.severityScale = severityScale;
exports.severityAtLeast = severityAtLeast;
const balance_1 = require("../constants/balance");
exports.SEVERITY_ORDER = {
    minor: 1, moderate: 2, severe: 3, critical: 4,
};
function buildDefaultSeverityTable(rng) {
    const w = balance_1.BALANCE.events.severityWeights;
    const table = [
        { weight: w.minor, severity: 'minor' },
        { weight: w.moderate, severity: 'moderate' },
        { weight: w.severe, severity: 'severe' },
        { weight: w.critical, severity: 'critical' },
    ];
    return table;
}
function pickSeverityFromTable(table, rng, hint) {
    if (hint)
        return hint;
    const items = table.map(t => ({ value: t.severity, weight: t.weight }));
    return rng.weightedPick(items);
}
function severityScale(sev) {
    return balance_1.BALANCE.events.severityConsequenceScales[sev];
}
function severityAtLeast(sev, threshold) {
    return exports.SEVERITY_ORDER[sev] >= exports.SEVERITY_ORDER[threshold];
}
//# sourceMappingURL=EventModel.js.map