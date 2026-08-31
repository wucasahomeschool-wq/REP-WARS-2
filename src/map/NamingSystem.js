"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.NamingSystem = void 0;
const SeededRNG_1 = require("../utils/SeededRNG");
const balance_1 = require("../constants/balance");
class NamingSystem {
    constructor(seed) {
        this.usedNames = new Set();
        this.rng = new SeededRNG_1.SeededRNG(seed);
    }
    reset() {
        this.usedNames.clear();
    }
    pick(arr) {
        return arr[Math.floor(this.rng.next() * arr.length)];
    }
    weightedFormat(theme) {
        const w = theme.naming.formatWeights;
        const total = w.prefixRoot + w.rootSuffix + w.prefixRootSuffix + w.standaloneRoot + w.compound;
        const roll = this.rng.next() * total;
        if (roll < w.prefixRoot)
            return 'prefixRoot';
        if (roll < w.prefixRoot + w.rootSuffix)
            return 'rootSuffix';
        if (roll < w.prefixRoot + w.rootSuffix + w.prefixRootSuffix)
            return 'prefixRootSuffix';
        if (roll < total - w.compound)
            return 'standaloneRoot';
        return 'compound';
    }
    generateTerritoryName(theme, opts = {}) {
        const { isCapital = false, disambiguationAttempt = 0 } = opts;
        const cfg = theme.naming;
        const maxTries = balance_1.BALANCE.mapGen.naming.nameRetriesUntilUnique;
        for (let i = 0; i < maxTries; i++) {
            let name = '';
            const fmt = this.weightedFormat(theme);
            switch (fmt) {
                case 'prefixRoot':
                    name = `${this.pick(cfg.prefixes)} ${this.pick(cfg.roots)}`;
                    break;
                case 'rootSuffix':
                    name = `${this.pick(cfg.roots)} ${this.pick(cfg.suffixes)}`;
                    break;
                case 'prefixRootSuffix':
                    name = `${this.pick(cfg.prefixes)} ${this.pick(cfg.roots)} ${this.pick(cfg.suffixes)}`;
                    break;
                case 'standaloneRoot':
                    name = `${this.pick(cfg.roots)}`;
                    break;
                case 'compound':
                    name = `${this.pick(cfg.roots)} of ${this.pick(cfg.prefixes)} ${this.pick(cfg.suffixes)}`;
                    break;
            }
            if (name.endsWith('-'))
                name = name.slice(0, -1);
            if (isCapital && this.rng.next() < cfg.capitalNameChance * balance_1.BALANCE.mapGen.naming.capitalSuffixBias) {
                const capCandidates = [' Citadel', ' Capital', ' Prime', ' Hold', ' Crown', ' Bastion', ''];
                name = `${name}${this.pick(capCandidates)}`;
            }
            if (!this.usedNames.has(name)) {
                this.usedNames.add(name);
                return name.trim();
            }
        }
        const salted = `${this.pick(cfg.prefixes)} ${this.pick(cfg.roots)} ${balance_1.BALANCE.mapGen.naming.disambiguationSalt + disambiguationAttempt + this.rng.nextInt(0, 9999)}`;
        this.usedNames.add(salted);
        return salted;
    }
    generateRegionName(theme, additionalRoots, seedSalt) {
        if (seedSalt !== undefined) {
            this.rng.reseed(seedSalt);
        }
        const cfg = theme.naming;
        const roots = additionalRoots && additionalRoots.length ? additionalRoots : cfg.roots;
        const sfx = cfg.suffixes.slice().concat(['Region', 'Lands', 'March', 'Province', 'Reach', 'Dominion', 'Territory']);
        const roll = this.rng.next();
        let name;
        if (roll < 0.5)
            name = `${this.pick(cfg.prefixes)} ${this.pick(roots)}`;
        else if (roll < 0.85)
            name = `${this.pick(cfg.prefixes)} ${this.pick(sfx)}`;
        else
            name = `${this.pick(cfg.roots)} ${this.pick(sfx)}`;
        return name.trim();
    }
    generateCapitalName(theme) {
        for (let i = 0; i < 5; i++) {
            const n = this.generateTerritoryName(theme, { isCapital: true, disambiguationAttempt: i });
            return n;
        }
        return this.generateTerritoryName(theme, { disambiguationAttempt: 42 });
    }
}
exports.NamingSystem = NamingSystem;
//# sourceMappingURL=NamingSystem.js.map