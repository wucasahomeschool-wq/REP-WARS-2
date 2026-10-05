using System;
using NUnit.Framework;
using RepWars.CharacterProduction.EditorTools;
using UnityEditor;
using UnityEngine;

namespace RepWars.CharacterProduction.Tests
{
    public sealed class SelectiveTeamColorTests
    {
        [Test]
        public void DisabledAndZeroMaskReturnExactOriginalIncludingAlpha()
        {
            var original = new Color(0.06f,0.15f,0.31f,0.43f);
            Assert.AreEqual(original,IllustratedTeamColorMath.RecolorLinear(original,Color.red,0f,true));
            Assert.AreEqual(original,IllustratedTeamColorMath.RecolorLinear(original,Color.red,1f,false));
        }

        [TestCase(0.02f)] [TestCase(0.2f)] [TestCase(0.7f)] [TestCase(0.99f)]
        public void RecolorPreservesPaintedLuminanceAndAlphaWithinGamut(float value)
        {
            var original = new Color(value,value,value,0.37f);
            foreach (var team in new[] { Color.red,Color.green,Color.blue,Color.black,Color.white,new Color(0.3f,0.55f,0.8f) })
            {
                var result = IllustratedTeamColorMath.RecolorLinear(original,team,1f,true);
                Assert.AreEqual(value,IllustratedTeamColorMath.Luminance(result),0.00001f);
                Assert.AreEqual(original.a,result.a);
                Assert.That(result.r,Is.InRange(-0.00001f,1.00001f));
                Assert.That(result.g,Is.InRange(-0.00001f,1.00001f));
                Assert.That(result.b,Is.InRange(-0.00001f,1.00001f));
            }
        }

        [Test]
        public void PartialMaskBlendsWithoutChangingUnmaskedNeighbor()
        {
            var original = new Color(0.1f,0.2f,0.6f,0.5f);
            var full = IllustratedTeamColorMath.RecolorLinear(original,Color.red,1f,true);
            var expected = Color.LerpUnclamped(original,full,0.5f);
            var actual = IllustratedTeamColorMath.RecolorLinear(original,Color.red,0.5f,true);
            for (var i = 0; i < 4; i++) Assert.AreEqual(expected[i],actual[i],0.000001f);
            Assert.AreEqual(original,IllustratedTeamColorMath.RecolorLinear(original,Color.red,0f,true));
        }

        [TestCase(HumanoidFacing.FrontLeft)] [TestCase(HumanoidFacing.FrontRight)]
        [TestCase(HumanoidFacing.Left)] [TestCase(HumanoidFacing.Right)]
        [TestCase(HumanoidFacing.BackLeft)] [TestCase(HumanoidFacing.BackRight)]
        public void OneColorAndSharedMaterialPersistAcrossEveryFacing(HumanoidFacing direction)
        {
            using (var fixture = new Fixture())
            {
                var sample = new Color(0.2f,0.6f,0.15f);
                var untouched = Shader.PropertyToID("_UnrelatedProofValue");
                var block = new MaterialPropertyBlock();
                block.SetFloat(untouched,42f);
                fixture.bindings[0].renderer.SetPropertyBlock(block);
                Assert.IsTrue(fixture.presentation.SetTeamColor(sample));
                Assert.IsTrue(fixture.facing.TrySetFacing(direction));
                Assert.AreEqual(sample,fixture.presentation.TeamColor);
                Assert.IsTrue(fixture.presentation.RecolorEnabled);
                foreach (var section in fixture.bindings)
                {
                    Assert.AreSame(fixture.material,section.renderer.sharedMaterial);
                    section.renderer.GetPropertyBlock(block);
                    Assert.AreSame(fixture.mask,block.GetTexture("_TeamColorMask"));
                    Assert.AreEqual(1f,block.GetFloat("_TeamColorEnabled"));
                    var linear = sample.linear;
                    Assert.AreEqual(new Vector4(linear.r,linear.g,linear.b,1f),block.GetVector("_TeamColor"));
                    Assert.AreEqual(Color.white,section.renderer.color);
                    Assert.IsFalse(section.renderer.flipX);
                }
                fixture.bindings[0].renderer.GetPropertyBlock(block);
                Assert.AreEqual(42f,block.GetFloat(untouched));
                fixture.presentation.DisableTeamColor();
                Assert.IsFalse(fixture.presentation.RecolorEnabled);
                Assert.AreEqual(direction,fixture.facing.Facing);
                foreach (var section in fixture.bindings)
                { section.renderer.GetPropertyBlock(block); Assert.AreEqual(0f,block.GetFloat("_TeamColorEnabled")); }
            }
        }

        [Test]
        public void MissingMaskIsSafeOriginalModeAndInvalidColorPreservesState()
        {
            using (var fixture = new Fixture(true))
            {
                Assert.IsEmpty(fixture.presentation.Validate());
                Assert.IsTrue(fixture.presentation.SetTeamColor(Color.red));
                Assert.IsFalse(fixture.presentation.SetTeamColor(new Color(float.NaN,0f,0f)));
                Assert.IsFalse(fixture.presentation.SetTeamColor(new Color(2f,0f,0f)));
                Assert.AreEqual(Color.red,fixture.presentation.TeamColor);
                var block = new MaterialPropertyBlock();
                foreach (var section in fixture.bindings)
                {
                    section.renderer.GetPropertyBlock(block);
                    Assert.AreEqual(0f,block.GetFloat("_TeamColorEnabled"));
                    Assert.AreSame(Texture2D.blackTexture,block.GetTexture("_TeamColorMask"));
                }
            }
        }

        [Test]
        public void ChangedSpriteFailsClosedWithoutDestroyingSharedColorState()
        {
            using (var fixture = new Fixture())
            {
                fixture.presentation.SetTeamColor(Color.blue);
                fixture.bindings[0].renderer.sprite = null;
                fixture.presentation.ApplyStoredColor();
                Assert.IsNotEmpty(fixture.presentation.Validate());
                var block = new MaterialPropertyBlock();
                fixture.bindings[0].renderer.GetPropertyBlock(block);
                Assert.AreEqual(0f,block.GetFloat("_TeamColorEnabled"));
                Assert.AreEqual(Color.blue,fixture.presentation.TeamColor);
            }
        }

        [Test]
        public void DisabledComponentRendersOriginalAndReenableRestoresStoredColor()
        {
            using (var fixture = new Fixture())
            {
                fixture.presentation.SetTeamColor(Color.red);
                fixture.presentation.enabled = false;
                var block = new MaterialPropertyBlock();
                fixture.bindings[0].renderer.GetPropertyBlock(block);
                Assert.AreEqual(0f,block.GetFloat("_TeamColorEnabled"));
                fixture.presentation.enabled = true;
                fixture.bindings[0].renderer.GetPropertyBlock(block);
                Assert.AreEqual(1f,block.GetFloat("_TeamColorEnabled"));
                Assert.AreEqual(Color.red,fixture.presentation.TeamColor);
            }
        }

        [Test]
        public void BadMaskAlignmentAndDuplicateBindingsAreRejectedBeforeMaterialAssignment()
        {
            using (var fixture = new Fixture())
            {
                var owner = new GameObject("InvalidProofOwner");
                var small = new Texture2D(2,2);
                try
                {
                    var renderer = new GameObject("Section").AddComponent<SpriteRenderer>();
                    renderer.transform.SetParent(owner.transform,false);
                    renderer.sprite = fixture.sprite;
                    var presentation = owner.AddComponent<SelectiveTeamColorPresentation>();
                    var binding = new TeamColorSectionBinding { view = MasterHumanoidView.Front,sectionId = "LowerTorso",
                        renderer = renderer,sourceSprite = fixture.sprite,mask = small,sourceBounds = new RectInt(0,0,8,8) };
                    var before = renderer.sharedMaterial;
                    string error;
                    Assert.IsFalse(presentation.Configure(fixture.material,new[] { binding },"test",out error));
                    StringAssert.Contains("mask dimensions",error);
                    Assert.AreSame(before,renderer.sharedMaterial);
                    binding.mask = fixture.mask;
                    Assert.IsFalse(presentation.Configure(fixture.material,new[] { binding,binding },"test",out error));
                    StringAssert.Contains("duplicate",error);
                    Assert.AreSame(before,renderer.sharedMaterial);
                }
                finally { UnityEngine.Object.DestroyImmediate(owner); UnityEngine.Object.DestroyImmediate(small); }
            }
        }

        [Test]
        public void RecipesExplicitlyCoverAllSectionsWithoutSixDirectionMaskDuplication()
        {
            var recipe = KnightATeamColorConfiguration.Load();
            Assert.IsEmpty(recipe.Validate()); // Includes actual source-file and skin-calibration hashes.
            Assert.AreEqual(3,recipe.views.Length);
            foreach (var view in recipe.views)
            {
                Assert.AreEqual(11,view.sections.Length);
                var nonempty = 0;
                foreach (var section in view.sections)
                    if (section.polygons.Length != 0) { nonempty++; Assert.AreEqual("LowerTorso",section.sectionId); }
                Assert.AreEqual(1,nonempty);
            }
        }

        [Test]
        public void PolygonRasterizationUsesSourceCoordinatesAndUnityTextureYOrder()
        {
            var polygon = new TeamColorMaskPolygon { id = "test",featherPixels = 0,
                points = new[] { new Vector2(101f,201f),new Vector2(103f,201f),new Vector2(103f,203f),new Vector2(101f,203f) } };
            var section = new TeamColorMaskSection { polygons = new[] { polygon } };
            var pixels = TeamColorMaskRasterizer.Rasterize(section,new RectInt(100,200,4,4));
            Assert.AreEqual(255,pixels[2*4+1].r);
            Assert.AreEqual(0,pixels[3*4].r);
            Assert.AreEqual(0,pixels[0].r);
            var again = TeamColorMaskRasterizer.Rasterize(section,new RectInt(100,200,4,4));
            CollectionAssert.AreEqual(pixels,again);
            polygon.featherPixels = 2f;
            Assert.That(TeamColorMaskRasterizer.Coverage(polygon,new Vector2(101.5f,201.5f)),Is.InRange(0.01f,0.99f));
            Assert.AreEqual(0f,TeamColorMaskRasterizer.Coverage(polygon,new Vector2(100.5f,201.5f)));
            section.polygons = Array.Empty<TeamColorMaskPolygon>();
            foreach (var pixel in TeamColorMaskRasterizer.Rasterize(section,new RectInt(100,200,4,4))) Assert.AreEqual(0,pixel.r);
        }

        sealed class Fixture : IDisposable
        {
            public readonly MasterHumanoidRig rig;
            public readonly HumanoidFacingPresentation facing;
            public readonly SelectiveTeamColorPresentation presentation;
            public readonly TeamColorSectionBinding[] bindings;
            public readonly Material material;
            public readonly Texture2D mask,texture;
            public readonly Sprite sprite;
            public Fixture(bool emptyMasks = false)
            {
                var shader = AssetDatabase.LoadAssetAtPath<Shader>(KnightATeamColorProofBuilder.ShaderPath);
                Assert.IsNotNull(shader,"Import/compile the production team-color shader before running these Editor tests.");
                material = new Material(shader);
                texture = new Texture2D(8,8);
                mask = new Texture2D(8,8);
                sprite = Sprite.Create(texture,new Rect(0,0,8,8),Vector2.one*0.5f);
                rig = MasterHumanoidRigBuilder.CreateRigObject("TeamColorTest");
                facing = rig.gameObject.AddComponent<HumanoidFacingPresentation>();
                string error;
                Assert.IsTrue(facing.Configure(rig,HumanoidFacing.FrontLeft,out error),error);
                bindings = new TeamColorSectionBinding[3];
                for (var i = 0; i < 3; i++)
                {
                    var renderer = new GameObject("LowerTorso").AddComponent<SpriteRenderer>();
                    renderer.transform.SetParent(rig.GetViewRoot((MasterHumanoidView)i).Find("SkinMount"),false);
                    renderer.sprite = sprite;
                    bindings[i] = new TeamColorSectionBinding { view = (MasterHumanoidView)i,sectionId = "LowerTorso",renderer = renderer,
                        sourceSprite = sprite,mask = emptyMasks ? null : mask,sourceBounds = new RectInt(100,200,8,8) };
                }
                presentation = rig.gameObject.AddComponent<SelectiveTeamColorPresentation>();
                Assert.IsTrue(presentation.Configure(material,bindings,"test",out error),error);
                Assert.IsFalse(presentation.RecolorEnabled);
            }
            public void Dispose()
            {
                UnityEngine.Object.DestroyImmediate(rig.gameObject);
                UnityEngine.Object.DestroyImmediate(sprite);
                UnityEngine.Object.DestroyImmediate(texture);
                UnityEngine.Object.DestroyImmediate(mask);
                UnityEngine.Object.DestroyImmediate(material);
            }
        }
    }
}
