using System;
using System.IO;
using NUnit.Framework;
using RepWars.CharacterProduction.EditorTools;
using UnityEditor;
using UnityEngine;

namespace RepWars.CharacterProduction.Tests
{
    public sealed class KnightBTeamColorTests
    {
        [Test]
        public void RecipePinsThreeSourcesAndAllThirtyThreeSectionDecisions()
        {
            var recipe = KnightBTeamColorConfiguration.Load();
            Assert.IsEmpty(recipe.Validate());
            Assert.AreEqual(3, recipe.views.Length);
            foreach (var view in recipe.views)
            {
                var skin = recipe.LoadSkin(view.view);
                skin.VerifySource();
                Assert.AreEqual(skin.sourceSha256, view.sourceSha256);
                Assert.AreEqual(skin.ConfigurationHash, view.skinConfigurationSha256);
                Assert.AreEqual(11, view.sections.Length);
                var identities = new string[11];
                var masks = 0;
                for (var i = 0; i < view.sections.Length; i++)
                {
                    identities[i] = view.sections[i].sectionId;
                    if (view.sections[i].polygons.Length == 0) continue;
                    Assert.AreEqual("LowerTorso", view.sections[i].sectionId);
                    masks++;
                }
                CollectionAssert.AreEquivalent(HumanoidSkinConfiguration.SectionIds, identities);
                Assert.AreEqual(1, masks);
            }
        }

        [TestCase(MasterHumanoidView.Front)]
        [TestCase(MasterHumanoidView.Side)]
        [TestCase(MasterHumanoidView.Back)]
        public void MaskRasterMapsOriginalCoordinatesIntoExactPaddedSectionBounds(MasterHumanoidView view)
        {
            var recipe = KnightBTeamColorConfiguration.Load();
            var config = recipe.LoadSkin(view);
            var source = new Texture2D(2, 2, TextureFormat.RGBA32, false);
            try
            {
                Assert.IsTrue(source.LoadImage(File.ReadAllBytes(config.SourceFullPath), false));
                var pixels = source.GetPixels32();
                var ownership = HumanoidSkinGeometry.BuildOwnership(config, pixels);
                var section = Array.Find(recipe.GetView(view).sections, s => s.sectionId == "LowerTorso");
                var art = HumanoidSkinGeometry.Extract(config, Array.Find(config.sections, s => s.id == section.sectionId), pixels, ownership);
                var mask = TeamColorMaskRasterizer.Rasterize(section, art.sourceBounds);
                CollectionAssert.AreEqual(mask, TeamColorMaskRasterizer.Rasterize(section, art.sourceBounds));
                Assert.AreEqual(art.pixels.Length, mask.Length);
                var selected = 0;
                for (var y = 0; y < art.sourceBounds.height; y++)
                for (var x = 0; x < art.sourceBounds.width; x++)
                {
                    var point = new Vector2(art.sourceBounds.x + x + 0.5f, art.sourceBounds.y + y + 0.5f);
                    var expected = (byte)Mathf.FloorToInt(TeamColorMaskRasterizer.Coverage(section.polygons[0], point) * 255f + 0.5f);
                    var index = (art.sourceBounds.height - 1 - y) * art.sourceBounds.width + x;
                    Assert.AreEqual(expected, mask[index].r);
                    Assert.AreEqual(255, mask[index].a); // Mask alpha never derives from source transparency.
                    if (expected == 0) continue;
                    Assert.Greater(art.pixels[index].a, 0, "Mask must remain inside this section's painted pixels.");
                    selected++;
                }
                Assert.Greater(selected, 0);
                Assert.Less(selected, mask.Length / 4, "The provisional interior must remain selective.");
            }
            finally { UnityEngine.Object.DestroyImmediate(source); }
        }

        [Test]
        public void WrongFamilySourceOrOutOfBoundsMaskIsRejected()
        {
            var recipe = KnightBTeamColorConfiguration.Load();
            recipe.characterId = "KnightA";
            Assert.IsNotEmpty(recipe.Validate());
            recipe = KnightBTeamColorConfiguration.Load();
            recipe.views[0].sourceSha256 = KnightATeamColorConfiguration.Load().views[0].sourceSha256;
            Assert.IsNotEmpty(recipe.Validate());
            recipe = KnightBTeamColorConfiguration.Load();
            var section = Array.Find(recipe.views[0].sections, s => s.sectionId == "LowerTorso");
            section.polygons[0].points[0] = new Vector2(-1, 0);
            Assert.IsNotEmpty(recipe.Validate());
            recipe = KnightBTeamColorConfiguration.Load();
            recipe.views[1].sections[1].sectionId = recipe.views[1].sections[0].sectionId;
            Assert.IsNotEmpty(recipe.Validate());
        }

        [Test]
        public void SharedMaterialPathAndKnightAMaskIdentityRemainStableWithoutCrossFamilyPaths()
        {
            Assert.AreEqual(KnightATeamColorProofBuilder.MaterialPath, KnightBTeamColorProofBuilder.MaterialPath);
            var a = KnightATeamColorConfiguration.Load();
            Assert.IsEmpty(a.Validate());
            foreach (var view in a.views)
            {
                Assert.AreEqual(11, view.sections.Length);
                Assert.AreEqual(MasterHumanoidRigBuilder.Root + "/TeamColor/Generated/KnightA_" + view.view + "_LowerTorso.mask.png",
                    KnightATeamColorProofBuilder.MaskPath(view.view, "LowerTorso"));
                Assert.AreNotEqual(KnightATeamColorProofBuilder.MaskPath(view.view, "LowerTorso"),
                    KnightBTeamColorProofBuilder.MaskPath(view.view, "LowerTorso"));
                var section = Array.Find(view.sections, s => s.sectionId == "LowerTorso");
                var bounds = new RectInt(100, 200, 8, 8);
                var expected = "RepWarsTeamColorMask/v1|" + a.ConfigurationHash + "|" + view.view + "|LowerTorso|" + view.sourceSha256 + "|" + view.skinConfigurationSha256 + "|100,200,8,8";
                Assert.AreEqual(expected, KnightATeamColorProofBuilder.Provenance(a, view, section, bounds));
            }
        }

        [TestCase(HumanoidFacing.FrontLeft)] [TestCase(HumanoidFacing.FrontRight)]
        [TestCase(HumanoidFacing.Left)] [TestCase(HumanoidFacing.Right)]
        [TestCase(HumanoidFacing.BackLeft)] [TestCase(HumanoidFacing.BackRight)]
        public void ColorAndAuthoredMasksSurviveFacingMirroringAndOriginalMode(HumanoidFacing facing)
        {
            using (var fixture = new Fixture())
            {
                Assert.IsFalse(fixture.color.RecolorEnabled);
                var block = new MaterialPropertyBlock();
                fixture.bindings[0].renderer.GetPropertyBlock(block);
                Assert.AreEqual(0f, block.GetFloat("_TeamColorEnabled"));
                var unrelated = Shader.PropertyToID("_UnrelatedTestValue");
                block.SetFloat(unrelated, 17f);
                fixture.bindings[0].renderer.SetPropertyBlock(block);
                Assert.IsTrue(fixture.color.SetTeamColor(new Color(0.15f, 0.7f, 0.3f, 0.2f)));
                Assert.IsTrue(fixture.facing.TrySetFacing(facing));
                fixture.color.ApplyStoredColor();
                Assert.AreEqual(new Color(0.15f, 0.7f, 0.3f, 1f), fixture.color.TeamColor);
                foreach (var binding in fixture.bindings)
                {
                    binding.renderer.GetPropertyBlock(block);
                    Assert.AreSame(fixture.material, binding.renderer.sharedMaterial);
                    Assert.AreEqual(binding.mask != null ? 1f : 0f, block.GetFloat("_TeamColorEnabled"));
                    Assert.AreSame(binding.mask != null ? binding.mask : Texture2D.blackTexture, block.GetTexture("_TeamColorMask"));
                    Assert.AreEqual(Color.white, binding.renderer.color);
                    Assert.IsFalse(binding.renderer.flipX);
                    Assert.IsFalse(binding.renderer.flipY);
                }
                fixture.bindings[0].renderer.GetPropertyBlock(block);
                Assert.AreEqual(17f, block.GetFloat(unrelated));
                var beforeScale = fixture.rig.VisualRoot.localScale;
                fixture.color.DisableTeamColor();
                Assert.IsFalse(fixture.color.RecolorEnabled);
                Assert.AreEqual(facing, fixture.facing.Facing);
                Assert.AreEqual(beforeScale, fixture.rig.VisualRoot.localScale);
                foreach (var binding in fixture.bindings)
                { binding.renderer.GetPropertyBlock(block); Assert.AreEqual(0f, block.GetFloat("_TeamColorEnabled")); }
            }
        }

        [Test]
        public void InvalidColorsAndChangedSpriteFailClosedWithoutLosingStoredColor()
        {
            using (var fixture = new Fixture())
            {
                Assert.IsTrue(fixture.color.SetTeamColor(Color.blue));
                foreach (var input in new[] { new Color(float.NaN, 0, 0), new Color(0, float.PositiveInfinity, 0), new Color(-0.1f, 0, 0), new Color(0, 0, 1.1f) })
                    Assert.IsFalse(fixture.color.SetTeamColor(input));
                Assert.AreEqual(Color.blue, fixture.color.TeamColor);
                fixture.color.enabled = false;
                var binding = Array.Find(fixture.bindings, b => b.mask != null);
                var block = new MaterialPropertyBlock();
                binding.renderer.GetPropertyBlock(block);
                Assert.AreEqual(0f, block.GetFloat("_TeamColorEnabled"));
                fixture.color.enabled = true;
                binding.renderer.GetPropertyBlock(block);
                Assert.AreEqual(1f, block.GetFloat("_TeamColorEnabled"));
                binding.renderer.sprite = null;
                fixture.color.ApplyStoredColor();
                binding.renderer.GetPropertyBlock(block);
                Assert.AreEqual(0f, block.GetFloat("_TeamColorEnabled"));
                Assert.IsNotEmpty(fixture.color.Validate());
                Assert.AreEqual(Color.blue, fixture.color.TeamColor);
            }
        }

        sealed class Fixture : IDisposable
        {
            public readonly MasterHumanoidRig rig;
            public readonly HumanoidFacingPresentation facing;
            public readonly SelectiveTeamColorPresentation color;
            public readonly TeamColorSectionBinding[] bindings;
            public readonly Material material;
            readonly Texture2D texture;
            readonly Texture2D[] masks = new Texture2D[3];
            readonly Sprite sprite;
            public Fixture()
            {
                var shader = AssetDatabase.LoadAssetAtPath<Shader>(HumanoidTeamColorProofBuilder.ShaderPath);
                Assert.IsNotNull(shader, "Unity must import the shared production shader before these tests run.");
                material = new Material(shader); // Test-owned only; production shares an asset and never clones at runtime.
                texture = new Texture2D(8, 8);
                sprite = Sprite.Create(texture, new Rect(0, 0, 8, 8), Vector2.one * 0.5f);
                rig = MasterHumanoidRigBuilder.CreateRigObject("KnightBTeamColorTest");
                facing = rig.gameObject.AddComponent<HumanoidFacingPresentation>();
                string error;
                Assert.IsTrue(facing.Configure(rig, HumanoidFacing.Right, KnightBFacingConfiguration.Load().ToRuntimeDefinition(), out error), error);
                bindings = new TeamColorSectionBinding[33];
                var index = 0;
                for (var view = 0; view < 3; view++)
                {
                    masks[view] = new Texture2D(8, 8);
                    foreach (var id in HumanoidSkinConfiguration.SectionIds)
                    {
                        var renderer = new GameObject(id).AddComponent<SpriteRenderer>();
                        renderer.transform.SetParent(rig.GetViewRoot((MasterHumanoidView)view).Find("SkinMount"), false);
                        renderer.sprite = sprite;
                        bindings[index++] = new TeamColorSectionBinding { view = (MasterHumanoidView)view, sectionId = id,
                            renderer = renderer, sourceSprite = sprite, mask = id == "LowerTorso" ? masks[view] : null, sourceBounds = new RectInt(100, 200, 8, 8) };
                    }
                }
                color = rig.gameObject.AddComponent<SelectiveTeamColorPresentation>();
                Assert.IsTrue(color.Configure(material, bindings, "test", out error), error);
                Assert.IsEmpty(color.Validate());
            }
            public void Dispose()
            {
                UnityEngine.Object.DestroyImmediate(rig.gameObject);
                UnityEngine.Object.DestroyImmediate(sprite);
                UnityEngine.Object.DestroyImmediate(texture);
                foreach (var mask in masks) UnityEngine.Object.DestroyImmediate(mask);
                UnityEngine.Object.DestroyImmediate(material);
            }
        }
    }
}
