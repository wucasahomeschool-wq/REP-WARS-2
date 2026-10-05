using System;
using System.Collections.Generic;
using System.IO;
using System.Security.Cryptography;
using UnityEngine;

namespace RepWars.CharacterProduction.EditorTools
{
    [Serializable]
    public sealed class KnightASkinBoneCalibration
    {
        public string name;
        public float x;
        public float y;
    }

    [Serializable]
    public sealed class KnightASkinSectionDefinition
    {
        public string id;
        public int seedX, seedY, minY, maxY, offsetX, offsetY, sortingOrder, meshColumns, meshRows;
        public string[] influences;
        public string dominantBone;
        public KnightASkinWeightTransition[] transitions;
        // Optional explicit seeds for disconnected authored fringe; never a new visible section.
        public HumanoidSkinPixelSeed[] secondarySeeds;
    }

    [Serializable]
    public sealed class KnightASkinWeightTransition
    {
        public string bone;
        public float fromY, toY, maximum;
        public bool useX;
        public float fromX, toX;
    }

    [Serializable]
    public sealed class HumanoidSkinPixelSeed { public int x, y; }

    /// <summary>Shared technical skin recipe. Historic KnightASkin* DTO names remain for API/serialization compatibility.</summary>
    [Serializable]
    public abstract class HumanoidSkinConfiguration
    {
        public abstract string CharacterId { get; }
        public abstract string ConfigurationAssetPath { get; }
        public abstract string LockedSourcePath { get; }
        public abstract int ExpectedSourceWidth { get; }
        public abstract int ExpectedSourceHeight { get; }
        // Only accepted Knight A Front uses the unchanged legacy recipe; all new views are data-driven.
        public virtual bool UseLegacyKnightAFrontWeights { get { return false; } }
        public static readonly string[] SectionIds =
        {
            "HeadNeck", "UpperTorso", "LowerTorso", "LeftUpperArm", "RightUpperArm",
            "LeftForearmHand", "RightForearmHand", "LeftUpperLeg", "RightUpperLeg",
            "LeftLowerLegFoot", "RightLowerLegFoot",
        };

        public MasterHumanoidView view;
        public int version, sourceWidth, sourceHeight, padding, isolationAlpha;
        public string sourcePath, sourceSha256;
        public float pixelsPerUnit, groundX, groundY;
        public KnightASkinBoneCalibration[] bones;
        public KnightASkinSectionDefinition[] sections;

        public static string ProjectRoot { get { return Directory.GetParent(Application.dataPath).FullName; } }
        public static string AssetFullPath(string assetPath) { return Path.Combine(ProjectRoot, assetPath); }
        public string SourceFullPath { get { return Path.Combine(Directory.GetParent(ProjectRoot).FullName, sourcePath); } }
        public string ConfigurationHash { get { return HashFile(AssetFullPath(ConfigurationAssetPath)); } }

        public List<string> Validate()
        {
            var errors = new List<string>();
            if (version != 1) errors.Add("Humanoid authored-view configuration version must be 1.");
            if (!Enum.IsDefined(typeof(MasterHumanoidView), view)) { errors.Add("Unknown authored view."); return errors; }
            if (sourcePath != LockedSourcePath) errors.Add("Configuration must use only the locked character authored-view PNG.");
            if (sourceWidth != ExpectedSourceWidth || sourceHeight != ExpectedSourceHeight) errors.Add("Source dimensions differ from the reviewed character/view.");
            if (padding < 8 || padding > 32 || pixelsPerUnit <= 0) errors.Add("Use 8-32 transparent padding pixels and positive pixelsPerUnit.");
            if (isolationAlpha < 0 || isolationAlpha > 32) errors.Add("Isolation alpha must be a low fringe threshold from 0 to 32.");
            var canonical = new HashSet<string>();
            foreach (var bone in MasterHumanoidRigContract.Bones) canonical.Add(bone.name);
            var calibrated = new HashSet<string>();
            if (bones != null) foreach (var bone in bones)
            {
                if (bone == null || !canonical.Contains(bone.name) || !calibrated.Add(bone.name)) errors.Add("Bone calibration must contain each canonical name once.");
                else if (!Finite(bone.x) || !Finite(bone.y)) errors.Add(bone.name + " calibration must be finite.");
            }
            if (!calibrated.SetEquals(canonical)) errors.Add("View calibration does not cover the full Master Humanoid contract.");
            if (!Finite(groundX) || !Finite(groundY) || !Finite(pixelsPerUnit)) errors.Add("Ground and scale must be finite.");
            if (bones != null)
            {
                var root = Array.Find(bones, b => b != null && b.name == "Root");
                if (root != null && (root.x != groundX || root.y != groundY)) errors.Add("Root calibration must coincide with the ground reference.");
            }
            var identities = new HashSet<string>();
            var sorting = new HashSet<int>();
            if (sections != null) foreach (var section in sections)
            {
                if (section == null || section.id == null || Array.IndexOf(SectionIds, section.id) < 0 || !identities.Add(section.id))
                { errors.Add("Section identities must be the eleven intended body sections, without duplicates."); continue; }
                if (!sorting.Add(section.sortingOrder)) errors.Add(section.id + " has a duplicate view sorting order.");
                if (section.seedX < 0 || section.seedX >= sourceWidth || section.minY < 0 || section.maxY > sourceHeight || section.minY >= section.maxY || section.seedY < section.minY || section.seedY >= section.maxY)
                    errors.Add(section.id + " has an invalid source seed/partition.");
                if (section.secondarySeeds != null)
                {
                    var seeds = new HashSet<int>();
                    foreach (var seed in section.secondarySeeds)
                        if (seed == null || seed.x < 0 || seed.x >= sourceWidth || seed.y < section.minY || seed.y >= section.maxY ||
                            !seeds.Add(seed.y * sourceWidth + seed.x)) errors.Add(section.id + " has invalid/duplicate secondary fringe seeds.");
                    if (isolationAlpha == 0) errors.Add(section.id + " secondary seeds require core isolation.");
                }
                if (section.meshColumns < 2 || section.meshRows < 2 || (section.meshColumns + 1) * (section.meshRows + 1) > 160)
                    errors.Add(section.id + " needs a modest mesh with 2+ rows/columns and at most 160 vertices.");
                if (section.influences == null || section.influences.Length < 2) errors.Add(section.id + " must permit multiple canonical bone influences.");
                else foreach (var name in section.influences) if (!canonical.Contains(name)) errors.Add(section.id + " references noncanonical bone " + name + ".");
                if (!UseLegacyKnightAFrontWeights)
                {
                    if (section.dominantBone == null || Array.IndexOf(section.influences ?? Array.Empty<string>(), section.dominantBone) < 0)
                        errors.Add(section.id + " needs a permitted dominant bone.");
                    if (section.transitions == null || section.transitions.Length == 0 || section.transitions.Length > 3)
                        errors.Add(section.id + " needs 1-3 controlled transitions.");
                    else foreach (var transition in section.transitions)
                        if (transition == null || Array.IndexOf(section.influences ?? Array.Empty<string>(), transition.bone) < 0 ||
                            !Finite(transition.fromY) || !Finite(transition.toY) || !Finite(transition.maximum) ||
                            transition.fromY == transition.toY || transition.maximum <= 0 || transition.maximum > 1 ||
                            (transition.useX && (!Finite(transition.fromX) || !Finite(transition.toX))) ||
                            (transition.useX && transition.fromX == transition.toX))
                            errors.Add(section.id + " has an invalid weight transition.");
                }
            }
            if (!identities.SetEquals(SectionIds)) errors.Add("Humanoid authored-view must contain exactly eleven body sections.");
            return errors;
        }

        public void VerifySource()
        {
            if (!File.Exists(SourceFullPath)) throw new FileNotFoundException("Locked humanoid authored-view source was not found.", SourceFullPath);
            if (HashFile(SourceFullPath) != sourceSha256) throw new InvalidOperationException("Source PNG hash differs from the reviewed source. Nothing may be generated from unreviewed art.");
        }

        static bool Finite(float value) { return !float.IsNaN(value) && !float.IsInfinity(value); }

        public Vector3 ToRigPoint(float x, float y) { return new Vector3((x - groundX) / pixelsPerUnit, (groundY - y) / pixelsPerUnit, 0f); }

        public static string HashFile(string path)
        {
            using (var sha = SHA256.Create())
            using (var input = File.OpenRead(path))
                return BitConverter.ToString(sha.ComputeHash(input)).Replace("-", "").ToLowerInvariant();
        }
    }
}
