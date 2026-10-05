using System;
using System.Collections.Generic;
using System.IO;
using UnityEditor;
using UnityEngine;
using UnityEngine.Rendering;
using UnityEngine.U2D;
using UnityEngine.U2D.Animation;

namespace RepWars.CharacterProduction.EditorTools
{
    public static class HumanoidSkinValidator
    {
        public static List<string> Validate(IHumanoidSkin skin, HumanoidSkinConfiguration config, bool isolatedViewProof = true, Animator allowedIdleAnimator = null)
        {
            var errors = config != null ? config.Validate() : new List<string> { "Humanoid authored view configuration is missing." };
            if (skin == null) { errors.Add("Select an authored humanoid skin proof root."); return errors; }
            if (config == null || errors.Count > 0) return errors;
            try { config.VerifySource(); }
            catch (Exception exception) { errors.Add(exception.Message); return errors; }
            if (skin.CharacterId != config.CharacterId) errors.Add("Skin and configuration character families differ.");
            if (skin.SourceSha256 != config.sourceSha256) errors.Add("Proof source provenance does not match the reviewed source.");
            if (skin.ConfigurationSha256 != config.ConfigurationHash) errors.Add("Proof configuration is stale; it was not silently regenerated.");
            errors.AddRange(MasterHumanoidRigValidator.Validate(skin.Rig));
            MasterHumanoidRigBuilder.ValidateDependencies(skin.Owner, errors);
            if (skin.Rig == null || skin.Rig.VisualRoot == null) return errors;
            if (skin.Rig.VisualRoot.GetComponent<SortingGroup>() == null) errors.Add("The visual root must group the authored view body-section renderer ordering.");
            if (isolatedViewProof && skin.Rig.gameObject != skin.Owner) errors.Add("Skin proof must reference its own MasterHumanoidRig root.");
            if (!isolatedViewProof && skin.Owner.transform != skin.Rig.GetViewRoot(config.view))
                errors.Add("Combined skin metadata must be on its own authored-view root.");
            if (skin.Rig.GroundSocket != null && skin.Rig.GroundSocket.localPosition.sqrMagnitude > 0.000001f) errors.Add("Ground socket must remain at the visual origin.");
            if (skin.View != config.view) errors.Add("Proof authored-view identity differs from its configuration.");
            foreach (MasterHumanoidView view in Enum.GetValues(typeof(MasterHumanoidView)))
            {
                if (!isolatedViewProof) break;
                if (view == config.view) continue;
                var root = skin.Rig.GetViewRoot(view);
                if (root != null && (root.GetComponentsInChildren<SpriteRenderer>(true).Length > 0 || root.GetComponentsInChildren<SpriteSkin>(true).Length > 0))
                    errors.Add(view + " must remain unintegrated in this phase.");
            }
            foreach (var animator in skin.Owner.GetComponentsInChildren<Animator>(true))
                if (animator != allowedIdleAnimator || isolatedViewProof || animator.transform != skin.Rig.GetViewRoot(config.view) ||
                    animator.applyRootMotion || animator.runtimeAnimatorController != null || animator.avatar != null)
                    errors.Add("Only an explicitly supplied view-local Idle Animator is permitted in an animation proof.");
            if (skin.Owner.GetComponentsInChildren<Animation>(true).Length > 0)
                errors.Add("Legacy animation components are not allowed in the authored view skin proof.");
            if (isolatedViewProof && (skin.Owner.GetComponentsInChildren<HumanoidFacingPresentation>(true).Length != 0 ||
                skin.Owner.GetComponentsInChildren<SelectiveTeamColorPresentation>(true).Length != 0 ||
                skin.Owner.GetComponentsInChildren<HumanoidIdlePresentation>(true).Length != 0))
                errors.Add("Isolated skin proofs must not introduce facing, recolor or animation presentation.");
            if (skin.Sections == null || skin.Sections.Length != 11) { errors.Add("Proof must reference exactly eleven body sections."); return errors; }
            var front = skin.Rig.GetViewRoot(config.view);
            if (front == null) return errors;
            var mount = front.Find("SkinMount");
            if (isolatedViewProof && !front.gameObject.activeSelf) errors.Add("The proof's authored view must be active.");
            if (mount == null || mount.localPosition != Vector3.zero || mount.localScale != Vector3.one || mount.localRotation != Quaternion.identity)
                errors.Add("SkinMount must retain an identity transform under the authored view.");
            if (skin.Owner.GetComponentsInChildren<SpriteRenderer>(true).Length != 11 || skin.Owner.GetComponentsInChildren<SpriteSkin>(true).Length != 11)
                errors.Add("The isolated proof must contain exactly eleven renderer/SpriteSkin pairs.");
            var identities = new HashSet<string>();
            var renderers = new HashSet<SpriteRenderer>();
            var source = new Texture2D(2, 2, TextureFormat.RGBA32, false);
            try
            {
                if (!source.LoadImage(File.ReadAllBytes(config.SourceFullPath), false) || source.width != config.sourceWidth || source.height != config.sourceHeight)
                { errors.Add("Source decoding/dimensions failed."); return errors; }
                var sourcePixels = source.GetPixels32();
                var ownership = HumanoidSkinGeometry.BuildOwnership(config, sourcePixels);
                foreach (var binding in skin.Sections)
                {
                    if (binding == null || binding.sectionId == null || !identities.Add(binding.sectionId))
                    { errors.Add("Section identities are null or duplicated."); continue; }
                    var definition = Array.Find(config.sections, s => s.id == binding.sectionId);
                    if (definition == null) { errors.Add("Unexpected section " + binding.sectionId); continue; }
                    if (binding.renderer == null || binding.spriteSkin == null || binding.renderer.sprite == null)
                    { errors.Add(binding.sectionId + " has a missing renderer/SpriteSkin/sprite reference."); continue; }
                    if (!renderers.Add(binding.renderer)) errors.Add(binding.sectionId + " reuses another section renderer.");
                    if (binding.renderer.transform.parent != mount || binding.spriteSkin.gameObject != binding.renderer.gameObject)
                        errors.Add(binding.sectionId + " renderer and SpriteSkin must share one object under authored view/SkinMount.");
                    if (binding.renderer.sortingOrder != definition.sortingOrder || binding.renderer.drawMode != SpriteDrawMode.Simple)
                        errors.Add(binding.sectionId + " sorting/draw mode differs from authored view configuration.");
                    if (binding.renderer.color != Color.white) errors.Add(binding.sectionId + " must preserve source colors without whole-character tint.");
                    if (binding.renderer.flipX || binding.renderer.flipY || binding.renderer.transform.localScale != Vector3.one ||
                        binding.renderer.transform.localRotation != Quaternion.identity)
                        errors.Add(binding.sectionId + " must not independently mirror, rotate, or rescale authored body sections.");
                    if (binding.spriteSkin.rootBone != skin.Rig.FindBone(config.view, "Root") || binding.spriteSkin.autoRebind)
                        errors.Add(binding.sectionId + " must explicitly bind the authored view Root, without automatic rebinding.");
                    var expectedPixels = HumanoidSkinGeometry.Extract(config, definition, sourcePixels, ownership);
                    var bounds = expectedPixels.sourceBounds;
                    var expectedPosition = config.ToRigPoint(bounds.x + bounds.width * 0.5f + definition.offsetX,
                        bounds.y + bounds.height * 0.5f + definition.offsetY);
                    if (Vector3.Distance(binding.renderer.transform.localPosition, expectedPosition) > 0.00001f)
                        errors.Add(binding.sectionId + " neutral placement differs from the reviewed configuration.");
                    ValidateSprite(skin.Rig, binding, definition, config, bounds, errors);
                    var texture = binding.renderer.sprite.texture;
                    if (texture == null || !texture.isReadable || texture.width != bounds.width || texture.height != bounds.height)
                        errors.Add(binding.sectionId + " derived texture dimensions/readability are invalid.");
                    else
                    {
                        var actualPixels = texture.GetPixels32();
                        for (var i = 0; i < actualPixels.Length; i++)
                        {
                            var a = actualPixels[i]; var b = expectedPixels.pixels[i];
                            if (a.r != b.r || a.g != b.g || a.b != b.b || a.a != b.a)
                            { errors.Add(binding.sectionId + " derived pixels no longer match the source-preserving extraction."); break; }
                        }
                    }
                }
                if (!identities.SetEquals(HumanoidSkinConfiguration.SectionIds)) errors.Add("The expected eleven body-section identities are incomplete.");
                if (front.GetComponentsInChildren<SpriteRenderer>(true).Length != 11) errors.Add("authored view must contain exactly eleven renderers; no extra visible subdivisions.");
                foreach (var calibration in config.bones)
                {
                    var bone = skin.Rig.FindBone(config.view, calibration.name);
                    if (bone != null && Vector3.Distance(skin.Rig.VisualRoot.InverseTransformPoint(bone.position), config.ToRigPoint(calibration.x, calibration.y)) > 0.00001f)
                        errors.Add(calibration.name + " no longer matches authored view bind calibration.");
                }
            }
            finally { UnityEngine.Object.DestroyImmediate(source); }
            return errors;
        }

        static void ValidateSprite(MasterHumanoidRig rig, KnightASkinSectionBinding binding,
            KnightASkinSectionDefinition definition, HumanoidSkinConfiguration config, RectInt bounds, List<string> errors)
        {
            var sprite = binding.renderer.sprite;
            Vector2[] expectedVertices; ushort[] expectedIndices; BoneWeight[] expectedWeights;
            HumanoidSkinGeometry.BuildGrid(config, definition, bounds, out expectedVertices, out expectedIndices, out expectedWeights);
            var actualVertices = sprite.vertices;
            var actualIndices = sprite.triangles;
            if (actualVertices.Length != expectedVertices.Length || actualIndices.Length != expectedIndices.Length)
                errors.Add(binding.sectionId + " has a different mesh vertex/index count.");
            else
            {
                for (var i = 0; i < actualVertices.Length; i++)
                    if (Vector2.Distance(actualVertices[i], expectedVertices[i]) > 0.00001f)
                    { errors.Add(binding.sectionId + " vertex positions differ from deterministic mesh generation."); break; }
                for (var i = 0; i < actualIndices.Length; i++)
                    if (actualIndices[i] != expectedIndices[i])
                    { errors.Add(binding.sectionId + " triangle indices differ from deterministic mesh generation."); break; }
            }
            var bones = sprite.GetBones();
            var transforms = binding.spriteSkin.boneTransforms;
            var bindPoses = sprite.GetBindPoses();
            var count = MasterHumanoidRigContract.Bones.Count;
            if (bones.Length != count || bindPoses.Length != count || transforms == null || transforms.Length != count)
            { errors.Add(binding.sectionId + " has incomplete SpriteSkin bone/bind-pose data."); return; }
            for (var i = 0; i < count; i++)
            {
                var canonical = MasterHumanoidRigContract.Bones[i];
                if (bones[i].name != canonical.name || transforms[i] != rig.FindBone(config.view, canonical.name))
                    errors.Add(binding.sectionId + " has mismatched bone slot " + i + " (" + canonical.name + ").");
                if (transforms[i] != null)
                {
                    var expectedBind = transforms[i].worldToLocalMatrix * binding.renderer.transform.localToWorldMatrix;
                    for (var entry = 0; entry < 16; entry++)
                        if (float.IsNaN(bindPoses[i][entry]) || Mathf.Abs(bindPoses[i][entry] - expectedBind[entry]) > 0.0001f)
                        { errors.Add(binding.sectionId + " bind pose does not match its neutral calibration at bone " + canonical.name + "."); break; }
                }
                var expectedParent = -1;
                for (var j = 0; j < i; j++) if (MasterHumanoidRigContract.Bones[j].name == canonical.parentName) expectedParent = j;
                if (bones[i].parentId != expectedParent) errors.Add(binding.sectionId + " SpriteBone parent differs from the Master Humanoid contract.");
            }
            if (!sprite.HasVertexAttribute(VertexAttribute.BlendWeight)) { errors.Add(binding.sectionId + " has no skin weights."); return; }
            var weights = sprite.GetVertexAttribute<BoneWeight>(VertexAttribute.BlendWeight);
            if (weights.Length != (definition.meshColumns + 1) * (definition.meshRows + 1) || sprite.triangles.Length != definition.meshColumns * definition.meshRows * 6)
                errors.Add(binding.sectionId + " mesh topology differs from its configured grid.");
            for (var vertex = 0; vertex < weights.Length; vertex++)
            {
                var weight = weights[vertex];
                var sum = weight.weight0 + weight.weight1 + weight.weight2 + weight.weight3;
                if (float.IsNaN(sum) || Mathf.Abs(sum - 1f) > 0.0001f) { errors.Add(binding.sectionId + " has non-normalized weights."); break; }
                var indices = new[] { weight.boneIndex0, weight.boneIndex1, weight.boneIndex2, weight.boneIndex3 };
                var values = new[] { weight.weight0, weight.weight1, weight.weight2, weight.weight3 };
                if (vertex < expectedWeights.Length)
                {
                    var expected = expectedWeights[vertex];
                    if (weight.boneIndex0 != expected.boneIndex0 || weight.boneIndex1 != expected.boneIndex1 || weight.boneIndex2 != expected.boneIndex2 || weight.boneIndex3 != expected.boneIndex3 ||
                        Mathf.Abs(weight.weight0 - expected.weight0) > 0.00001f || Mathf.Abs(weight.weight1 - expected.weight1) > 0.00001f ||
                        Mathf.Abs(weight.weight2 - expected.weight2) > 0.00001f || Mathf.Abs(weight.weight3 - expected.weight3) > 0.00001f)
                        errors.Add(binding.sectionId + " vertex " + vertex + " weights differ from the current generation profile.");
                }
                for (var i = 0; i < 4; i++)
                {
                    if (values[i] < 0 || float.IsNaN(values[i])) { errors.Add(binding.sectionId + " has an invalid weight."); break; }
                    if (values[i] > 0 && (indices[i] < 0 || indices[i] >= count || Array.IndexOf(definition.influences, bones[indices[i]].name) < 0))
                    { errors.Add(binding.sectionId + " weights reference an unexpected bone."); break; }
                }
            }
            if (Mathf.Abs(sprite.pixelsPerUnit - config.pixelsPerUnit) > 0.0001f) errors.Add(binding.sectionId + " pixelsPerUnit does not match its calibration.");
            if (!AssetDatabase.GetAssetPath(sprite).StartsWith(HumanoidSkinBuilder.GeneratedDirectoryFor(config) + "/", StringComparison.Ordinal))
                errors.Add(binding.sectionId + " must reference an isolated generated production sprite asset.");
            if (!AssetDatabase.GetAssetPath(sprite.texture).StartsWith(HumanoidSkinBuilder.GeneratedDirectoryFor(config) + "/", StringComparison.Ordinal))
                errors.Add(binding.sectionId + " must reference an isolated derived texture, never an altered source file.");
        }
    }
}
