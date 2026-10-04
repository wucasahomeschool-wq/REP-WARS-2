using System;
using System.Collections.Generic;
using UnityEngine;

namespace RepWars.CharacterProduction
{
    public enum MasterHumanoidView { Front = 0, Side = 1, Back = 2 }
    public enum MasterHumanoidSocket { MainHand = 0, OffHand = 1, Ground = 2, Head = 3, Back = 4 }

    [Serializable]
    public struct MasterHumanoidBoneDefinition
    {
        public string name;
        public string parentName;
        public Vector3 referenceLocalPosition;

        public MasterHumanoidBoneDefinition(string name, string parentName, Vector3 referenceLocalPosition)
        {
            this.name = name;
            this.parentName = parentName;
            this.referenceLocalPosition = referenceLocalPosition;
        }
    }

    /// <summary>Canonical names and parent relationships. Positions are only a neutral starting pose, not final art binds.</summary>
    public static class MasterHumanoidRigContract
    {
        public const int Version = 1;
        public static readonly IList<MasterHumanoidBoneDefinition> Bones = Array.AsReadOnly(new[]
        {
            new MasterHumanoidBoneDefinition("Root", null, Vector3.zero),
            new MasterHumanoidBoneDefinition("Pelvis", "Root", new Vector3(0f, 0.95f, 0f)),
            new MasterHumanoidBoneDefinition("Spine", "Pelvis", new Vector3(0f, 0.10f, 0f)),
            new MasterHumanoidBoneDefinition("Chest", "Spine", new Vector3(0f, 0.24f, 0f)),
            new MasterHumanoidBoneDefinition("Neck", "Chest", new Vector3(0f, 0.27f, 0f)),
            new MasterHumanoidBoneDefinition("Head", "Neck", new Vector3(0f, 0.14f, 0f)),
            new MasterHumanoidBoneDefinition("LeftClavicle", "Chest", new Vector3(-0.10f, 0.16f, 0f)),
            new MasterHumanoidBoneDefinition("LeftUpperArm", "LeftClavicle", new Vector3(-0.12f, -0.03f, 0f)),
            new MasterHumanoidBoneDefinition("LeftForearm", "LeftUpperArm", new Vector3(-0.25f, -0.05f, 0f)),
            new MasterHumanoidBoneDefinition("LeftHand", "LeftForearm", new Vector3(-0.22f, -0.03f, 0f)),
            new MasterHumanoidBoneDefinition("RightClavicle", "Chest", new Vector3(0.10f, 0.16f, 0f)),
            new MasterHumanoidBoneDefinition("RightUpperArm", "RightClavicle", new Vector3(0.12f, -0.03f, 0f)),
            new MasterHumanoidBoneDefinition("RightForearm", "RightUpperArm", new Vector3(0.25f, -0.05f, 0f)),
            new MasterHumanoidBoneDefinition("RightHand", "RightForearm", new Vector3(0.22f, -0.03f, 0f)),
            new MasterHumanoidBoneDefinition("LeftThigh", "Pelvis", new Vector3(-0.11f, -0.11f, 0f)),
            new MasterHumanoidBoneDefinition("LeftShin", "LeftThigh", new Vector3(0f, -0.43f, 0f)),
            new MasterHumanoidBoneDefinition("LeftFoot", "LeftShin", new Vector3(0f, -0.41f, 0f)),
            new MasterHumanoidBoneDefinition("RightThigh", "Pelvis", new Vector3(0.11f, -0.11f, 0f)),
            new MasterHumanoidBoneDefinition("RightShin", "RightThigh", new Vector3(0f, -0.43f, 0f)),
            new MasterHumanoidBoneDefinition("RightFoot", "RightShin", new Vector3(0f, -0.41f, 0f)),
        });

        public static string SocketName(MasterHumanoidSocket socket) { return "Socket_" + socket; }
    }

}
