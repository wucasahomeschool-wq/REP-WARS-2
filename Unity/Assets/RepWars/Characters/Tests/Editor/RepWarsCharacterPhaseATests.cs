using System;
using System.Collections.Generic;
using System.Linq;
using System.Reflection;
using System.Text.RegularExpressions;
using NUnit.Framework;
using UnityEngine;
using UnityEngine.TestTools;
using Object = UnityEngine.Object;

namespace RepWars.Characters.Tests
{
    public class RepWarsCharacterPhaseATests
    {
        readonly List<Object> temporary = new List<Object>();
        readonly List<IRepWarsCharacterPresenter> spawned = new List<IRepWarsCharacterPresenter>();

        [SetUp]
        public void SetUp()
        {
            RepWarsCharacterCatalog.ReloadDefault();
        }

        [TearDown]
        public void TearDown()
        {
            foreach (var presenter in spawned)
            {
                if (presenter != null && presenter.Transform != null) presenter.Release();
            }
            spawned.Clear();
            foreach (var item in temporary)
            {
                if (item != null) Object.DestroyImmediate(item);
            }
            temporary.Clear();
            RepWarsCharacterCatalog.ReloadDefault();
        }

        // ------------------------------------------------------------ helpers

        static RepWarsCharacterCatalog Real { get { return RepWarsCharacterCatalog.Default; } }

        T Clone<T>(T source) where T : Object
        {
            var copy = Object.Instantiate(source);
            copy.name = source.name;
            temporary.Add(copy);
            return copy;
        }

        // Deep-enough copy of the real registry so tests can break it without touching assets.
        RepWarsCharacterRegistry CloneRegistry()
        {
            var real = Real.Registry;
            var registry = ScriptableObject.CreateInstance<RepWarsCharacterRegistry>();
            temporary.Add(registry);
            registry.bases = real.bases.Select(x => Clone(x)).ToArray();
            registry.appearances = real.appearances.Select(x => Clone(x)).ToArray();
            registry.variants = real.variants.Select(x => Clone(x)).ToArray();
            registry.rigs = real.rigs.Select(x => Clone(x)).ToArray();
            registry.animationProfiles = real.animationProfiles.Select(x => Clone(x)).ToArray();
            registry.emperorCatalog = Clone(real.emperorCatalog);
            registry.infantryCatalog = Clone(real.infantryCatalog);
            registry.defaultActorPrefab = real.defaultActorPrefab;
            return registry;
        }

        IRepWarsCharacterPresenter Spawn(string variantId)
        {
            var presenter = RepWarsCharacterSpawner.Spawn(variantId, null);
            Assert.IsNotNull(presenter, "Spawn failed for " + variantId);
            spawned.Add(presenter);
            return presenter;
        }

        static string Joined(IEnumerable<string> lines) { return string.Join("\n", lines); }

        // ------------------------------------------------------------ definitions and catalogs load

        [Test]
        public void RealRegistryLoadsAndValidatesWithoutErrors()
        {
            Assert.IsNotNull(Real.Registry, "Resources/RepWarsCharacterRegistry.asset must exist");
            Assert.IsTrue(Real.Report.IsValid, Real.Report.ToText());
        }

        [Test]
        public void AllDefinitionTypesAreRegistered()
        {
            var registry = Real.Registry;
            CollectionAssert.AreEquivalent(new[] { "human_male", "banana" }, registry.bases.Select(b => b.baseId));
            CollectionAssert.AreEquivalent(new[] { "soldier_gear_01", "emperor_regalia_01" }, registry.appearances.Select(a => a.appearanceId));
            CollectionAssert.AreEquivalent(new[] { "humanoid_v1", "banana_v1" }, registry.rigs.Select(r => r.rigProfileId));
            CollectionAssert.AreEquivalent(new[] { "humanoid_locomotion_v1", "banana_locomotion_v1" }, registry.animationProfiles.Select(a => a.animationProfileId));
            CollectionAssert.AreEquivalent(
                new[] { "generic_soldier", "generic_emperor", "banana_soldier", "banana_emperor" },
                registry.variants.Select(v => v.variantId));
        }

        [Test]
        public void CatalogsListEntriesAndInfantryDefaultResolves()
        {
            Assert.AreEqual(2, Real.ListEmperor().Count);
            Assert.AreEqual(2, Real.ListInfantry().Count);
            Assert.AreEqual("generic_soldier", Real.DefaultInfantryVariantId);
            foreach (var entry in Real.ListEmperor().Concat(Real.ListInfantry()))
            {
                Assert.IsTrue(Real.TryResolveVariant(entry.variantId, out _, out var error), entry.catalogEntryId + ": " + error);
            }
            Assert.IsTrue(Real.TryResolveVariant(Real.DefaultInfantryVariantId, out _, out _));
        }

        [Test]
        public void BananaAndHumanoidUseSeparateRigAndAnimationFamilies()
        {
            Assert.IsTrue(Real.TryFindBase("human_male", out var human));
            Assert.IsTrue(Real.TryFindBase("banana", out var banana));
            Assert.AreNotEqual(human.rigProfileId, banana.rigProfileId);
            Assert.AreNotEqual(human.animationProfileId, banana.animationProfileId);
            Assert.AreEqual(CompatibilityTier.T0SharedHumanoid, human.compatibilityTier);
            Assert.AreEqual(CompatibilityTier.T1NonHumanRigFamily, banana.compatibilityTier);
        }

        [Test]
        public void BasesContainNoRoleClothing()
        {
            foreach (var characterBase in Real.Registry.bases)
            {
                foreach (var layer in characterBase.intrinsicVisuals)
                {
                    StringAssert.DoesNotContain("helmet", layer.layerId);
                    StringAssert.DoesNotContain("crown", layer.layerId);
                    StringAssert.DoesNotContain("belt", layer.layerId);
                    StringAssert.DoesNotContain("pack", layer.layerId);
                    Assert.IsFalse(layer.receivesTint, "Base body layers should not take faction tint");
                }
            }
        }

        // ------------------------------------------------------------ resolution

        [Test]
        public void GenericSoldierIsHumanMalePlusSoldierGear()
        {
            Assert.IsTrue(Real.TryResolveVariant("generic_soldier", out var resolved, out var error), error);
            Assert.AreEqual("human_male", resolved.Base.baseId);
            Assert.AreEqual("soldier_gear_01", resolved.Appearance.appearanceId);
            Assert.AreEqual("humanoid_v1", resolved.Rig.rigProfileId);
        }

        [Test]
        public void GenericEmperorIsHumanMalePlusEmperorRegalia()
        {
            Assert.IsTrue(Real.TryResolveVariant("generic_emperor", out var resolved, out var error), error);
            Assert.AreEqual("human_male", resolved.Base.baseId);
            Assert.AreEqual("emperor_regalia_01", resolved.Appearance.appearanceId);
        }

        [Test]
        public void SoldierAndEmperorShareOneBaseAssetAndOneActorPrefab()
        {
            Real.TryResolveVariant("generic_soldier", out var soldier, out _);
            Real.TryResolveVariant("generic_emperor", out var emperor, out _);
            Assert.AreSame(soldier.Base, emperor.Base, "Both variants must point at the same base definition");
            Assert.IsNull(soldier.Base.actorPrefab, "Base does not own a duplicate prefab");
            Assert.IsNotNull(Real.Registry.defaultActorPrefab, "One shared actor prefab");
        }

        [Test]
        public void BananaCanWearSoldierGearWithoutTheHumanoidRig()
        {
            Assert.IsTrue(Real.TryResolveVariant("banana_soldier", out var resolved, out var error), error);
            Assert.AreEqual("banana", resolved.Base.baseId);
            Assert.AreEqual("soldier_gear_01", resolved.Appearance.appearanceId);
            Assert.AreEqual("banana_v1", resolved.Rig.rigProfileId);
            Assert.AreNotEqual("humanoid_v1", resolved.Rig.rigProfileId);

            var presenter = Spawn("banana_soldier");
            var actor = (RepWarsCharacterActor)presenter;
            Assert.AreEqual("banana", presenter.BaseId);
            Assert.AreEqual("soldier_gear_01", presenter.AppearanceId);
            Assert.IsTrue(actor.Sockets.TryGet(SocketNames.HeadTop, out var headTop));
            Assert.IsNotNull(actor.transform.Find("VisualRoot/Body/Socket_head_top"));
            Assert.IsNotNull(headTop.Find("Appearance_Headwear"), "Helmet must be attached to the banana's own head_top socket");
        }

        // ------------------------------------------------------------ error reporting

        [Test]
        public void UnknownVariantGivesUsefulError()
        {
            Assert.IsFalse(Real.TryResolveVariant("nope", out var resolved, out var error));
            Assert.IsNull(resolved);
            StringAssert.Contains("nope", error);
            Assert.IsFalse(Real.TryResolveVariant("", out _, out var emptyError));
            StringAssert.Contains("empty", emptyError);
            LogAssert.Expect(LogType.Error, new Regex("Unknown variant 'nope'"));
            Assert.IsNull(Real.ResolveVariant("nope"));
        }

        [Test]
        public void MissingBaseIsReportedNotSwallowed()
        {
            var registry = CloneRegistry();
            registry.variants.First(v => v.variantId == "generic_soldier").baseId = "ghost_base";
            var catalog = RepWarsCharacterCatalog.Build(registry);
            Assert.IsFalse(catalog.Report.IsValid);
            StringAssert.Contains("missing base 'ghost_base'", Joined(catalog.Report.Errors));
            Assert.IsFalse(catalog.TryResolveVariant("generic_soldier", out _, out var error));
            StringAssert.Contains("ghost_base", error);
        }

        [Test]
        public void MissingAppearanceIsReported()
        {
            var registry = CloneRegistry();
            registry.variants.First(v => v.variantId == "generic_emperor").appearanceId = "ghost_gear";
            var catalog = RepWarsCharacterCatalog.Build(registry);
            Assert.IsFalse(catalog.Report.IsValid);
            StringAssert.Contains("missing appearance 'ghost_gear'", Joined(catalog.Report.Errors));
        }

        [Test]
        public void DuplicateIdsAreDetected()
        {
            var registry = CloneRegistry();
            registry.variants[1].variantId = registry.variants[0].variantId;
            registry.bases[1].baseId = registry.bases[0].baseId;
            var catalog = RepWarsCharacterCatalog.Build(registry);
            var errors = Joined(catalog.Report.Errors);
            StringAssert.Contains("Duplicate variant id 'generic_soldier'", errors);
            StringAssert.Contains("Duplicate base id 'human_male'", errors);
        }

        [Test]
        public void DuplicateCatalogEntryIdsAreDetected()
        {
            var registry = CloneRegistry();
            registry.infantryCatalog.entries[1].catalogEntryId = registry.infantryCatalog.entries[0].catalogEntryId;
            var catalog = RepWarsCharacterCatalog.Build(registry);
            StringAssert.Contains("Duplicate catalogEntryId 'infantry_generic'", Joined(catalog.Report.Errors));
        }

        [Test]
        public void CatalogEntryPointingAtMissingVariantIsInvalid()
        {
            var registry = CloneRegistry();
            registry.emperorCatalog.entries[0].variantId = "ghost_variant";
            var catalog = RepWarsCharacterCatalog.Build(registry);
            StringAssert.Contains("references missing variant 'ghost_variant'", Joined(catalog.Report.Errors));
        }

        [Test]
        public void BadInfantryDefaultIsInvalid()
        {
            var registry = CloneRegistry();
            registry.infantryCatalog.defaultInfantryVariantId = "ghost";
            var catalog = RepWarsCharacterCatalog.Build(registry);
            StringAssert.Contains("defaultInfantryVariantId 'ghost'", Joined(catalog.Report.Errors));
        }

        [Test]
        public void RigAnimationMismatchIsInvalid()
        {
            var registry = CloneRegistry();
            registry.bases.First(b => b.baseId == "banana").animationProfileId = "humanoid_locomotion_v1";
            var catalog = RepWarsCharacterCatalog.Build(registry);
            StringAssert.Contains("does not support", Joined(catalog.Report.Errors));
        }

        [Test]
        public void MissingRegistryIsReported()
        {
            var catalog = RepWarsCharacterCatalog.Build(null);
            Assert.IsFalse(catalog.Report.IsValid);
            StringAssert.Contains("registry asset not found", catalog.Report.ToText());
        }

        [Test]
        public void AppearanceNeedingMissingSocketDoesNotFit()
        {
            var registry = CloneRegistry();
            var soldier = registry.appearances.First(a => a.appearanceId == "soldier_gear_01");
            soldier.bindings[0].socketName = "tail_tip";
            var catalog = RepWarsCharacterCatalog.Build(registry);
            Assert.IsFalse(catalog.TryResolveVariant("generic_soldier", out _, out var error));
            StringAssert.Contains("tail_tip", error);
        }

        // ------------------------------------------------------------ backends and composer

        [Test]
        public void UnregisteredBackendKindFailsLoudlyWithoutFallback()
        {
            var registry = CloneRegistry();
            registry.bases.First(b => b.baseId == "banana").backendKind = CharacterBackendKind.HumanoidSkeletal;
            var catalog = RepWarsCharacterCatalog.Build(registry);
            Assert.IsTrue(catalog.Report.IsValid, catalog.Report.ToText());
            LogAssert.Expect(LogType.Error, new Regex("not implemented"));
            Assert.IsFalse(RepWarsCharacterSpawner.TrySpawn("banana_soldier", null, out var presenter, out var error, catalog));
            Assert.IsNull(presenter);
            StringAssert.Contains("not implemented", error);
        }

        [Test]
        public void ComposerReportsSkippedMechanismsInsteadOfDroppingThem()
        {
            var appearance = ScriptableObject.CreateInstance<AppearanceDefinition>();
            temporary.Add(appearance);
            appearance.appearanceId = "test_cape";
            appearance.bindings = new[]
            {
                new AppearanceSlotBinding { slot = AppearanceSlot.Cape, mechanism = AppearanceMechanism.SkinnedOverlay, sprite = Real.Registry.bases[0].intrinsicVisuals[0].sprite },
                new AppearanceSlotBinding { slot = AppearanceSlot.Torso, mechanism = AppearanceMechanism.SpriteLibraryCategory, libraryCategory = "torso" },
            };
            var composer = new AppearanceComposer();
            var result = composer.Apply(appearance, new SocketRegistry(), 0, null, Color.white);
            Assert.IsTrue(result.Success, result.Error);
            Assert.AreEqual(2, result.Skipped.Count);
            Assert.AreEqual(0, composer.SpawnedObjectCount);
        }

        [Test]
        public void ComposerIsAtomicWhenASocketIsMissing()
        {
            var presenter = Spawn("generic_soldier");
            var actor = (RepWarsCharacterActor)presenter;
            var appearance = ScriptableObject.CreateInstance<AppearanceDefinition>();
            temporary.Add(appearance);
            appearance.appearanceId = "half_broken";
            var sprite = Real.Registry.bases[0].intrinsicVisuals[0].sprite;
            appearance.bindings = new[]
            {
                new AppearanceSlotBinding { slot = AppearanceSlot.Headwear, mechanism = AppearanceMechanism.SocketSprite, socketName = SocketNames.HeadTop, sprite = sprite },
                new AppearanceSlotBinding { slot = AppearanceSlot.Belt, mechanism = AppearanceMechanism.SocketSprite, socketName = "nowhere", sprite = sprite },
            };
            var composer = new AppearanceComposer();
            var result = composer.Apply(appearance, actor.Sockets, 0, null, Color.white);
            Assert.IsFalse(result.Success);
            StringAssert.Contains("nowhere", result.Error);
            Assert.AreEqual(0, composer.SpawnedObjectCount, "Nothing from the failed application may remain");
            Assert.IsTrue(actor.Sockets.TryGet(SocketNames.HeadTop, out var headTop));
            Assert.AreEqual(1, headTop.childCount, "Only the original helmet remains");
        }

        // ------------------------------------------------------------ spawner and presenter

        [Test]
        public void SpawnedActorsMatchTheirVariants()
        {
            foreach (var id in new[] { "generic_soldier", "generic_emperor", "banana_soldier", "banana_emperor" })
            {
                var presenter = Spawn(id);
                Real.TryResolveVariant(id, out var resolved, out _);
                Assert.AreEqual(id, presenter.VariantId);
                Assert.AreEqual(resolved.Base.baseId, presenter.BaseId);
                Assert.AreEqual(resolved.Appearance.appearanceId, presenter.AppearanceId);
                Assert.IsNull(presenter.LastError);
            }
        }

        [Test]
        public void SpawnOfUnknownVariantReturnsNullAndLogs()
        {
            LogAssert.Expect(LogType.Error, new Regex("Spawn\\('ghost'\\) failed: Unknown variant 'ghost'"));
            Assert.IsNull(RepWarsCharacterSpawner.Spawn("ghost", null));
        }

        [Test]
        public void SpawnParentsTheActor()
        {
            var parent = new GameObject("test_parent");
            temporary.Add(parent);
            var presenter = RepWarsCharacterSpawner.Spawn("generic_soldier", parent.transform);
            spawned.Add(presenter);
            Assert.AreSame(parent.transform, presenter.Transform.parent);
        }

        [Test]
        public void TrySetVariantSwapsHumanToBananaAndBack()
        {
            var presenter = Spawn("generic_soldier");
            presenter.SetTint(Color.red);
            presenter.SetFacing(FacingKind.Left);
            presenter.SetLocomotion(LocomotionKind.Walk);

            Assert.IsTrue(presenter.TrySetVariant("banana_emperor", out var error), error);
            Assert.AreEqual("banana_emperor", presenter.VariantId);
            Assert.AreEqual("banana", presenter.BaseId);
            Assert.AreEqual("emperor_regalia_01", presenter.AppearanceId);
            Assert.AreEqual(Color.red, presenter.Tint, "Requested tint survives a variant change");
            Assert.AreEqual(FacingKind.Left, presenter.Facing);
            Assert.AreEqual(LocomotionKind.Walk, presenter.Locomotion);

            Assert.IsTrue(presenter.TrySetVariant("generic_soldier", out error), error);
            Assert.AreEqual("human_male", presenter.BaseId);
        }

        [Test]
        public void FailedTrySetVariantChangesNothing()
        {
            var presenter = Spawn("generic_soldier");
            Assert.IsFalse(presenter.TrySetVariant("ghost", out var error));
            StringAssert.Contains("ghost", error);
            Assert.AreEqual("generic_soldier", presenter.VariantId);
            Assert.AreEqual("human_male", presenter.BaseId);
            Assert.AreEqual("soldier_gear_01", presenter.AppearanceId);
            Assert.AreEqual(error, presenter.LastError);
        }

        [Test]
        public void TrySetAppearanceWorksOnBothBases()
        {
            foreach (var id in new[] { "generic_soldier", "banana_soldier" })
            {
                var presenter = Spawn(id);
                Assert.IsTrue(presenter.TrySetAppearance("emperor_regalia_01", out var error), error);
                Assert.AreEqual("emperor_regalia_01", presenter.AppearanceId);
                Assert.AreEqual(presenter.BaseId, id.StartsWith("banana") ? "banana" : "human_male", "Base is unchanged");
                var actor = (RepWarsCharacterActor)presenter;
                Assert.IsTrue(actor.Sockets.TryGet(SocketNames.HeadTop, out var headTop));
                Assert.AreEqual(1, headTop.childCount, "Old helmet removed, crown added");
                Assert.IsTrue(presenter.TrySetAppearance("soldier_gear_01", out error), error);
            }
        }

        [Test]
        public void FailedTrySetAppearanceChangesNothing()
        {
            var presenter = Spawn("generic_emperor");
            Assert.IsFalse(presenter.TrySetAppearance("ghost_gear", out var error));
            StringAssert.Contains("ghost_gear", error);
            Assert.AreEqual("emperor_regalia_01", presenter.AppearanceId);
        }

        [Test]
        public void SetTintReachesBodyAndAccessoriesThatAcceptIt()
        {
            var presenter = Spawn("generic_soldier");
            presenter.SetTint(new Color(1f, 0f, 0f));
            Assert.AreEqual(new Color(1f, 0f, 0f), presenter.Tint);
            var renderers = ((RepWarsCharacterActor)presenter).GetComponentsInChildren<SpriteRenderer>();
            var helmet = renderers.First(r => r.transform.name == "Appearance_Headwear");
            var head = renderers.First(r => r.transform.name == "head");
            Assert.AreEqual(new Color(1f, 0f, 0f), helmet.color, "Soldier helmet takes faction tint");
            Assert.AreEqual(Color.white, head.color, "Base skin does not");
        }

        [Test]
        public void SetFacingMirrorsBodyAndAccessories()
        {
            var presenter = Spawn("generic_soldier");
            var visualRoot = presenter.Transform.Find("VisualRoot");
            Assert.AreEqual(1f, visualRoot.localScale.x);
            presenter.SetFacing(FacingKind.Left);
            Assert.AreEqual(-1f, visualRoot.localScale.x);
            Assert.AreEqual(FacingKind.Left, presenter.Facing);
            presenter.SetFacing(FacingKind.Right);
            Assert.AreEqual(1f, visualRoot.localScale.x);
        }

        [Test]
        public void SetLocomotionAndReactionsWorkOnEveryBase()
        {
            foreach (var id in new[] { "generic_soldier", "banana_soldier" })
            {
                var presenter = Spawn(id);
                Assert.IsTrue(presenter.SetLocomotion(LocomotionKind.Walk));
                Assert.AreEqual(LocomotionKind.Walk, presenter.Locomotion);
                Assert.IsTrue(presenter.SetLocomotion(LocomotionKind.Idle));
                Assert.IsTrue(presenter.SetLocomotion(LocomotionKind.None));
                Assert.IsTrue(presenter.PlayReaction(ReactionKind.Celebrate));
                Assert.IsTrue(presenter.PlayReaction(ReactionKind.Defeat));
            }
        }

        [Test]
        public void MissingAnimationBindingIsReportedByLocomotionCall()
        {
            var registry = CloneRegistry();
            var profile = registry.animationProfiles.First(a => a.animationProfileId == "banana_locomotion_v1");
            profile.locomotion = profile.locomotion.Where(l => l.kind != LocomotionKind.Walk).ToArray();
            var catalog = RepWarsCharacterCatalog.Build(registry);
            Assert.IsTrue(RepWarsCharacterSpawner.TrySpawn("banana_soldier", null, out var presenter, out _, catalog));
            spawned.Add(presenter);
            LogAssert.Expect(LogType.Error, new Regex("no locomotion binding for Walk"));
            Assert.IsFalse(presenter.SetLocomotion(LocomotionKind.Walk));
            StringAssert.Contains("Walk", presenter.LastError);
            Assert.AreEqual(LocomotionKind.None, presenter.Locomotion);
        }

        [Test]
        public void VariantScaleMultiplierIsApplied()
        {
            var soldier = Spawn("generic_soldier");
            var emperor = Spawn("generic_emperor");
            Assert.Greater(emperor.Transform.localScale.x, soldier.Transform.localScale.x);
        }

        [Test]
        public void ReleaseDestroysTheActor()
        {
            var presenter = RepWarsCharacterSpawner.Spawn("generic_soldier", null);
            var root = presenter.Transform;
            presenter.Release();
            Assert.IsTrue(root == null);
        }

        // ------------------------------------------------------------ API discipline

        [Test]
        public void PresenterInterfaceExposesNoRenderingTypes()
        {
            var banned = new[] { typeof(Renderer), typeof(SpriteRenderer), typeof(Animator), typeof(GameObject), typeof(Component) };
            foreach (var member in typeof(IRepWarsCharacterPresenter).GetMembers())
            {
                Type type = null;
                if (member is PropertyInfo property) type = property.PropertyType;
                else if (member is MethodInfo method) type = method.ReturnType;
                if (type == null || type == typeof(Transform)) continue;
                foreach (var forbidden in banned)
                {
                    Assert.IsFalse(forbidden.IsAssignableFrom(type), member.Name + " exposes " + type.Name);
                }
            }
        }

        [Test]
        public void ExistingArmyVisualsStillExist()
        {
            Assert.IsNotNull(Type.GetType("RepWars.RepWarsArmyVisual, RepWars"));
            Assert.IsNotNull(Type.GetType("RepWars.RepWarsSoldierVisual, RepWars"));
        }
    }
}
