using System;
using System.Collections.Generic;
using System.Text;
using UnityEngine;

namespace RepWars.Characters
{
    /// <summary>Every definition a variant id resolves to. Built once per lookup from the catalog's indexes.</summary>
    public sealed class ResolvedCharacterVariant
    {
        public CharacterVariantDefinition Variant;
        public CharacterBaseDefinition Base;
        public AppearanceDefinition Appearance;
        public RigProfileDefinition Rig;
        public AnimationProfileDefinition Animation;
    }

    /// <summary>Everything validation found. Broken definitions are reported, never repaired or hidden.</summary>
    public sealed class CharacterCatalogReport
    {
        public readonly List<string> Errors = new List<string>();
        public readonly List<string> Warnings = new List<string>();

        public bool IsValid { get { return Errors.Count == 0; } }

        public string ToText()
        {
            var text = new StringBuilder();
            text.Append("Character catalog: ").Append(Errors.Count).Append(" error(s), ").Append(Warnings.Count).Append(" warning(s)");
            foreach (var error in Errors) text.Append("\n  ERROR   ").Append(error);
            foreach (var warning in Warnings) text.Append("\n  WARNING ").Append(warning);
            return text.ToString();
        }
    }

    /// <summary>
    /// Resolves variant ids to definitions and lists the Emperor and Infantry catalogs.
    /// Built from a RepWarsCharacterRegistry. Owns the id indexes and the validation report.
    /// </summary>
    public sealed class RepWarsCharacterCatalog
    {
        const string LogPrefix = "[RepWarsCharacters] ";

        static RepWarsCharacterCatalog defaultCatalog;

        readonly Dictionary<string, CharacterBaseDefinition> bases = new Dictionary<string, CharacterBaseDefinition>();
        readonly Dictionary<string, AppearanceDefinition> appearances = new Dictionary<string, AppearanceDefinition>();
        readonly Dictionary<string, CharacterVariantDefinition> variants = new Dictionary<string, CharacterVariantDefinition>();
        readonly Dictionary<string, RigProfileDefinition> rigs = new Dictionary<string, RigProfileDefinition>();
        readonly Dictionary<string, AnimationProfileDefinition> animations = new Dictionary<string, AnimationProfileDefinition>();
        readonly List<CharacterCatalogEntry> emperorEntries = new List<CharacterCatalogEntry>();
        readonly List<CharacterCatalogEntry> infantryEntries = new List<CharacterCatalogEntry>();

        RepWarsCharacterCatalog(RepWarsCharacterRegistry registry)
        {
            Registry = registry;
            Report = new CharacterCatalogReport();
        }

        public RepWarsCharacterRegistry Registry { get; private set; }
        public CharacterCatalogReport Report { get; private set; }
        public string DefaultInfantryVariantId { get; private set; }

        /// <summary>The catalog built from Resources/RepWarsCharacterRegistry. Cached until ReloadDefault.</summary>
        public static RepWarsCharacterCatalog Default
        {
            get
            {
                if (defaultCatalog == null)
                {
                    var registry = Resources.Load<RepWarsCharacterRegistry>(RepWarsCharacterRegistry.ResourcePath);
                    defaultCatalog = Build(registry);
                    if (!defaultCatalog.Report.IsValid) Debug.LogError(LogPrefix + defaultCatalog.Report.ToText());
                }
                return defaultCatalog;
            }
        }

        public static void ReloadDefault()
        {
            defaultCatalog = null;
        }

        // Domain reload is off in this project. Drop the cached catalog when Play Mode starts so edited assets are seen.
        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
        static void ResetStatics()
        {
            defaultCatalog = null;
        }

        public static RepWarsCharacterCatalog Build(RepWarsCharacterRegistry registry)
        {
            var catalog = new RepWarsCharacterCatalog(registry);
            if (registry == null)
            {
                catalog.Report.Errors.Add("Character registry asset not found at Resources/" + RepWarsCharacterRegistry.ResourcePath);
                return catalog;
            }
            catalog.Index(registry);
            catalog.Validate(registry);
            return catalog;
        }

        public IReadOnlyList<CharacterCatalogEntry> ListEmperor() { return emperorEntries; }
        public IReadOnlyList<CharacterCatalogEntry> ListInfantry() { return infantryEntries; }

        public IEnumerable<string> VariantIds { get { return variants.Keys; } }
        public IEnumerable<string> AppearanceIds { get { return appearances.Keys; } }

        public bool TryFindBase(string id, out CharacterBaseDefinition found) { return TryGet(bases, id, out found); }
        public bool TryFindAppearance(string id, out AppearanceDefinition found) { return TryGet(appearances, id, out found); }
        public bool TryFindVariant(string id, out CharacterVariantDefinition found) { return TryGet(variants, id, out found); }
        public bool TryFindRig(string id, out RigProfileDefinition found) { return TryGet(rigs, id, out found); }
        public bool TryFindAnimationProfile(string id, out AnimationProfileDefinition found) { return TryGet(animations, id, out found); }

        /// <summary>Resolve a variant and everything it depends on. On failure, error names the missing piece.</summary>
        public bool TryResolveVariant(string variantId, out ResolvedCharacterVariant resolved, out string error)
        {
            resolved = null;
            if (string.IsNullOrEmpty(variantId))
            {
                error = "Variant id is empty";
                return false;
            }
            if (!variants.TryGetValue(variantId, out var variant))
            {
                error = "Unknown variant '" + variantId + "'";
                return false;
            }
            if (!bases.TryGetValue(variant.baseId ?? "", out var characterBase))
            {
                error = "Variant '" + variantId + "' references missing base '" + variant.baseId + "'";
                return false;
            }
            if (!appearances.TryGetValue(variant.appearanceId ?? "", out var appearance))
            {
                error = "Variant '" + variantId + "' references missing appearance '" + variant.appearanceId + "'";
                return false;
            }
            if (!rigs.TryGetValue(characterBase.rigProfileId ?? "", out var rig))
            {
                error = "Base '" + characterBase.baseId + "' references missing rig profile '" + characterBase.rigProfileId + "'";
                return false;
            }
            if (!animations.TryGetValue(characterBase.animationProfileId ?? "", out var animation))
            {
                error = "Base '" + characterBase.baseId + "' references missing animation profile '" + characterBase.animationProfileId + "'";
                return false;
            }
            var missing = MissingSockets(appearance, rig);
            if (missing.Length > 0)
            {
                error = "Appearance '" + appearance.appearanceId + "' needs socket(s) " + missing + " that rig '" + rig.rigProfileId + "' does not provide";
                return false;
            }
            resolved = new ResolvedCharacterVariant
            {
                Variant = variant,
                Base = characterBase,
                Appearance = appearance,
                Rig = rig,
                Animation = animation,
            };
            error = null;
            return true;
        }

        /// <summary>Resolve a variant or log the problem and return null. Use TryResolveVariant when the caller handles failure.</summary>
        public ResolvedCharacterVariant ResolveVariant(string variantId)
        {
            if (TryResolveVariant(variantId, out var resolved, out var error)) return resolved;
            Debug.LogError(LogPrefix + error);
            return null;
        }

        /// <summary>Check that an appearance can be worn by a base. Used when swapping appearances on a live character.</summary>
        public bool TryResolveAppearanceFor(string appearanceId, RigProfileDefinition rig, out AppearanceDefinition appearance, out string error)
        {
            appearance = null;
            if (string.IsNullOrEmpty(appearanceId))
            {
                error = "Appearance id is empty";
                return false;
            }
            if (!appearances.TryGetValue(appearanceId, out var found))
            {
                error = "Unknown appearance '" + appearanceId + "'";
                return false;
            }
            if (rig != null)
            {
                var missing = MissingSockets(found, rig);
                if (missing.Length > 0)
                {
                    error = "Appearance '" + appearanceId + "' needs socket(s) " + missing + " that rig '" + rig.rigProfileId + "' does not provide";
                    return false;
                }
            }
            appearance = found;
            error = null;
            return true;
        }

        /// <summary>Comma-separated socket names an appearance needs that the rig lacks. Empty when it fits.</summary>
        public static string MissingSockets(AppearanceDefinition appearance, RigProfileDefinition rig)
        {
            if (appearance == null || rig == null) return "";
            var missing = new List<string>();
            foreach (var socket in appearance.RequiredSocketNames())
            {
                if (!rig.HasSocket(socket)) missing.Add("'" + socket + "'");
            }
            return string.Join(", ", missing);
        }

        static bool TryGet<T>(Dictionary<string, T> map, string id, out T found) where T : class
        {
            found = null;
            if (string.IsNullOrEmpty(id)) return false;
            return map.TryGetValue(id, out found);
        }

        void Index(RepWarsCharacterRegistry registry)
        {
            IndexById(registry.bases, bases, b => b.baseId, "base");
            IndexById(registry.appearances, appearances, a => a.appearanceId, "appearance");
            IndexById(registry.variants, variants, v => v.variantId, "variant");
            IndexById(registry.rigs, rigs, r => r.rigProfileId, "rig profile");
            IndexById(registry.animationProfiles, animations, a => a.animationProfileId, "animation profile");
            IndexEntries(registry.emperorCatalog, emperorEntries, "emperor catalog");
            IndexEntries(registry.infantryCatalog, infantryEntries, "infantry catalog");
            DefaultInfantryVariantId = registry.infantryCatalog != null ? registry.infantryCatalog.defaultInfantryVariantId : null;
        }

        void IndexById<T>(T[] source, Dictionary<string, T> target, Func<T, string> idOf, string label) where T : UnityEngine.Object
        {
            if (source == null) return;
            for (var i = 0; i < source.Length; i++)
            {
                var item = source[i];
                if (item == null)
                {
                    Report.Errors.Add("Registry " + label + " list has an empty slot at index " + i);
                    continue;
                }
                var id = idOf(item);
                if (string.IsNullOrEmpty(id))
                {
                    Report.Errors.Add("Registry " + label + " '" + item.name + "' has an empty id");
                    continue;
                }
                if (target.ContainsKey(id))
                {
                    Report.Errors.Add("Duplicate " + label + " id '" + id + "' (asset '" + item.name + "')");
                    continue;
                }
                target.Add(id, item);
            }
        }

        void IndexEntries(CharacterCatalogAsset asset, List<CharacterCatalogEntry> target, string label)
        {
            if (asset == null)
            {
                Report.Errors.Add("Registry has no " + label);
                return;
            }
            var seen = new HashSet<string>();
            if (asset.entries != null)
            {
                for (var i = 0; i < asset.entries.Length; i++)
                {
                    var entry = asset.entries[i];
                    if (entry == null)
                    {
                        Report.Errors.Add(Capitalize(label) + " has an empty entry at index " + i);
                        continue;
                    }
                    if (string.IsNullOrEmpty(entry.catalogEntryId))
                    {
                        Report.Errors.Add(Capitalize(label) + " entry " + i + " has an empty catalogEntryId");
                        continue;
                    }
                    if (!seen.Add(entry.catalogEntryId))
                    {
                        Report.Errors.Add("Duplicate catalogEntryId '" + entry.catalogEntryId + "' in " + label);
                        continue;
                    }
                    target.Add(entry);
                }
            }
            target.Sort((a, b) =>
            {
                var order = a.sortOrder.CompareTo(b.sortOrder);
                return order != 0 ? order : string.CompareOrdinal(a.catalogEntryId, b.catalogEntryId);
            });
        }

        void Validate(RepWarsCharacterRegistry registry)
        {
            if (registry.defaultActorPrefab == null)
            {
                Report.Warnings.Add("Registry has no defaultActorPrefab. Spawner falls back to a bare actor object.");
            }

            foreach (var rig in rigs.Values)
            {
                if (rig.sockets == null || rig.sockets.Length == 0)
                {
                    Report.Warnings.Add("Rig profile '" + rig.rigProfileId + "' declares no sockets");
                }
                var socketSeen = new HashSet<string>();
                if (rig.sockets != null)
                {
                    foreach (var socket in rig.sockets)
                    {
                        if (socket == null || string.IsNullOrEmpty(socket.socketName))
                        {
                            Report.Errors.Add("Rig profile '" + rig.rigProfileId + "' has a socket with an empty name");
                        }
                        else if (!socketSeen.Add(socket.socketName))
                        {
                            Report.Errors.Add("Rig profile '" + rig.rigProfileId + "' declares socket '" + socket.socketName + "' twice");
                        }
                    }
                }
                if (rig.supportedAnimationProfileIds != null)
                {
                    foreach (var animationId in rig.supportedAnimationProfileIds)
                    {
                        if (!animations.ContainsKey(animationId ?? ""))
                        {
                            Report.Errors.Add("Rig profile '" + rig.rigProfileId + "' supports unknown animation profile '" + animationId + "'");
                        }
                    }
                }
            }

            foreach (var characterBase in bases.Values)
            {
                if (!rigs.TryGetValue(characterBase.rigProfileId ?? "", out var rig))
                {
                    Report.Errors.Add("Base '" + characterBase.baseId + "' references missing rig profile '" + characterBase.rigProfileId + "'");
                }
                else
                {
                    if (rig.compatibilityTier != characterBase.compatibilityTier)
                    {
                        Report.Errors.Add("Base '" + characterBase.baseId + "' is " + characterBase.compatibilityTier + " but rig '" + rig.rigProfileId + "' is " + rig.compatibilityTier);
                    }
                    if (!rig.SupportsAnimationProfile(characterBase.animationProfileId))
                    {
                        Report.Errors.Add("Base '" + characterBase.baseId + "' uses animation profile '" + characterBase.animationProfileId + "' that rig '" + rig.rigProfileId + "' does not support");
                    }
                }
                if (!animations.ContainsKey(characterBase.animationProfileId ?? ""))
                {
                    Report.Errors.Add("Base '" + characterBase.baseId + "' references missing animation profile '" + characterBase.animationProfileId + "'");
                }
                if (characterBase.defaultScale <= 0f)
                {
                    Report.Errors.Add("Base '" + characterBase.baseId + "' has a non-positive defaultScale");
                }
                if (characterBase.intrinsicVisuals == null || characterBase.intrinsicVisuals.Length == 0)
                {
                    Report.Warnings.Add("Base '" + characterBase.baseId + "' has no intrinsic visuals");
                }
                else
                {
                    foreach (var layer in characterBase.intrinsicVisuals)
                    {
                        if (layer == null || layer.sprite == null)
                        {
                            Report.Errors.Add("Base '" + characterBase.baseId + "' has an intrinsic layer without a sprite");
                        }
                    }
                }
                if (characterBase.actorPrefab == null && registry.defaultActorPrefab == null)
                {
                    Report.Warnings.Add("Base '" + characterBase.baseId + "' has no actor prefab and the registry has no default");
                }
            }

            foreach (var appearance in appearances.Values)
            {
                ValidateAppearance(appearance);
            }

            foreach (var variant in variants.Values)
            {
                if (!TryResolveVariant(variant.variantId, out _, out var error))
                {
                    Report.Errors.Add(error);
                }
                if (variant.visualOverrides != null && variant.visualOverrides.scaleMultiplier <= 0f)
                {
                    Report.Errors.Add("Variant '" + variant.variantId + "' has a non-positive scaleMultiplier");
                }
            }

            ValidateEntries(emperorEntries, "Emperor catalog");
            ValidateEntries(infantryEntries, "Infantry catalog");

            if (string.IsNullOrEmpty(DefaultInfantryVariantId))
            {
                Report.Errors.Add("Infantry catalog has no defaultInfantryVariantId");
            }
            else if (!variants.ContainsKey(DefaultInfantryVariantId))
            {
                Report.Errors.Add("Infantry catalog defaultInfantryVariantId '" + DefaultInfantryVariantId + "' is not a known variant");
            }
        }

        void ValidateAppearance(AppearanceDefinition appearance)
        {
            if (appearance.bindings == null) return;
            for (var i = 0; i < appearance.bindings.Length; i++)
            {
                var binding = appearance.bindings[i];
                var where = "Appearance '" + appearance.appearanceId + "' binding " + i;
                if (binding == null)
                {
                    Report.Errors.Add(where + " is empty");
                    continue;
                }
                switch (binding.mechanism)
                {
                    case AppearanceMechanism.SocketSprite:
                        if (binding.sprite == null) Report.Errors.Add(where + " (SocketSprite) has no sprite");
                        if (string.IsNullOrEmpty(binding.socketName)) Report.Errors.Add(where + " (SocketSprite) has no socketName");
                        break;
                    case AppearanceMechanism.SocketPrefab:
                        if (binding.prefab == null) Report.Errors.Add(where + " (SocketPrefab) has no prefab");
                        if (string.IsNullOrEmpty(binding.socketName)) Report.Errors.Add(where + " (SocketPrefab) has no socketName");
                        break;
                    case AppearanceMechanism.SpriteLibraryCategory:
                        if (string.IsNullOrEmpty(binding.libraryCategory)) Report.Errors.Add(where + " (SpriteLibraryCategory) has no libraryCategory");
                        break;
                    case AppearanceMechanism.SkinnedOverlay:
                        if (binding.sprite == null) Report.Errors.Add(where + " (SkinnedOverlay) has no sprite");
                        break;
                }
            }
        }

        void ValidateEntries(List<CharacterCatalogEntry> entries, string label)
        {
            foreach (var entry in entries)
            {
                if (string.IsNullOrEmpty(entry.variantId))
                {
                    Report.Errors.Add(label + " entry '" + entry.catalogEntryId + "' has an empty variantId");
                }
                else if (!variants.ContainsKey(entry.variantId))
                {
                    Report.Errors.Add(label + " entry '" + entry.catalogEntryId + "' references missing variant '" + entry.variantId + "'");
                }
            }
        }

        static string Capitalize(string text)
        {
            return string.IsNullOrEmpty(text) ? text : char.ToUpperInvariant(text[0]) + text.Substring(1);
        }
    }
}
