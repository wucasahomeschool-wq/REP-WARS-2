using System;
using System.Collections.Generic;
using System.IO;
using System.Security.Cryptography;
using UnityEngine;

namespace RepWars.CharacterProduction.EditorTools
{
    [Serializable]
    public sealed class KnightAFrontBoneCalibration
    {
        public string name;
        public float x;
        public float y;
    }

    [Serializable]
    public sealed class KnightAFrontSectionDefinition
    {
        public string id;
        public int seedX, seedY, minY, maxY, offsetX, offsetY, sortingOrder, meshColumns, meshRows;
        public string[] influences;
    }

    [Serializable]
    public sealed class KnightAFrontConfiguration
    {
        public const string AssetPath = MasterHumanoidRigBuilder.Root + "/Editor/KnightAFront.configuration.json";
        public const string LockedSourcePath = "assets/misc/Character Skin PNG pieces/ChatGPT Image Sep 30, 2026, 09_27_22 AM.png";
        public static readonly string[] SectionIds =
        {
            "HeadNeck", "UpperTorso", "LowerTorso", "LeftUpperArm", "RightUpperArm",
            "LeftForearmHand", "RightForearmHand", "LeftUpperLeg", "RightUpperLeg",
            "LeftLowerLegFoot", "RightLowerLegFoot",
        };

        public int version, sourceWidth, sourceHeight, padding;
        public string sourcePath, sourceSha256;
        public float pixelsPerUnit, groundX, groundY;
        public KnightAFrontBoneCalibration[] bones;
        public KnightAFrontSectionDefinition[] sections;

        public static string ProjectRoot { get { return Directory.GetParent(Application.dataPath).FullName; } }
        public static string AssetFullPath(string assetPath) { return Path.Combine(ProjectRoot, assetPath); }
        public string SourceFullPath { get { return Path.Combine(Directory.GetParent(ProjectRoot).FullName, sourcePath); } }
        public static string ConfigurationHash { get { return HashFile(AssetFullPath(AssetPath)); } }

        public static KnightAFrontConfiguration Load()
        {
            var result = JsonUtility.FromJson<KnightAFrontConfiguration>(File.ReadAllText(Path.Combine(ProjectRoot, AssetPath)));
            if (result == null) throw new InvalidOperationException("Knight A Front configuration could not be parsed.");
            var errors = result.Validate();
            if (errors.Count > 0) throw new InvalidOperationException(string.Join("\n", errors.ToArray()));
            return result;
        }

        public List<string> Validate()
        {
            var errors = new List<string>();
            if (version != 1) errors.Add("Knight A Front configuration version must be 1.");
            if (sourcePath != LockedSourcePath) errors.Add("Configuration must use only the locked Knight A Front PNG.");
            if (sourceWidth != 1024 || sourceHeight != 1536) errors.Add("Expected source dimensions are 1024 x 1536.");
            if (padding < 8 || padding > 32 || pixelsPerUnit <= 0) errors.Add("Use 8-32 transparent padding pixels and positive pixelsPerUnit.");
            var canonical = new HashSet<string>();
            foreach (var bone in MasterHumanoidRigContract.Bones) canonical.Add(bone.name);
            var calibrated = new HashSet<string>();
            if (bones != null) foreach (var bone in bones)
            {
                if (bone == null || !canonical.Contains(bone.name) || !calibrated.Add(bone.name)) errors.Add("Bone calibration must contain each canonical name once.");
            }
            if (!calibrated.SetEquals(canonical)) errors.Add("Front calibration does not cover the full Master Humanoid contract.");
            var identities = new HashSet<string>();
            var sorting = new HashSet<int>();
            if (sections != null) foreach (var section in sections)
            {
                if (section == null || section.id == null || Array.IndexOf(SectionIds, section.id) < 0 || !identities.Add(section.id))
                { errors.Add("Section identities must be the eleven intended body sections, without duplicates."); continue; }
                if (!sorting.Add(section.sortingOrder)) errors.Add(section.id + " has a duplicate Front sorting order.");
                if (section.seedX < 0 || section.seedX >= sourceWidth || section.minY < 0 || section.maxY > sourceHeight || section.minY >= section.maxY || section.seedY < section.minY || section.seedY >= section.maxY)
                    errors.Add(section.id + " has an invalid source seed/partition.");
                if (section.meshColumns < 2 || section.meshRows < 2 || (section.meshColumns + 1) * (section.meshRows + 1) > 160)
                    errors.Add(section.id + " needs a modest mesh with 2+ rows/columns and at most 160 vertices.");
                if (section.influences == null || section.influences.Length < 2) errors.Add(section.id + " must permit multiple canonical bone influences.");
                else foreach (var name in section.influences) if (!canonical.Contains(name)) errors.Add(section.id + " references noncanonical bone " + name + ".");
            }
            if (!identities.SetEquals(SectionIds)) errors.Add("Knight A Front must contain exactly eleven body sections.");
            return errors;
        }

        public void VerifySource()
        {
            if (!File.Exists(SourceFullPath)) throw new FileNotFoundException("Locked Knight A Front source was not found.", SourceFullPath);
            if (HashFile(SourceFullPath) != sourceSha256) throw new InvalidOperationException("Source PNG hash differs from the reviewed source. Nothing may be generated from unreviewed art.");
        }

        public Vector3 ToRigPoint(float x, float y) { return new Vector3((x - groundX) / pixelsPerUnit, (groundY - y) / pixelsPerUnit, 0f); }

        public static string HashFile(string path)
        {
            using (var sha = SHA256.Create())
            using (var input = File.OpenRead(path))
                return BitConverter.ToString(sha.ComputeHash(input)).Replace("-", "").ToLowerInvariant();
        }
    }
}
