using System;
using System.Collections.Generic;
using System.IO;
using RepWars.CharacterProduction;
using UnityEditor;
using UnityEngine;

namespace RepWars.CharacterProduction.EditorTools
{
    public static class MasterHumanoidRigBuilder
    {
        public const string Root = "Assets/RepWars/CharacterProduction";
        public const string ProofPrefabPath = Root + "/Proof/MasterHumanoidRig_Proof.prefab";

        [MenuItem("RepWars/Character Production/Create Master Humanoid Proof Rig")]
        public static void CreateProofMenu()
        {
            string message;
            var success = TryCreateProofPrefab(out message);
            EditorUtility.DisplayDialog("Master Humanoid Rig", message, "OK");
            if (!success) Debug.LogError("[CharacterProduction] " + message);
        }

        [MenuItem("RepWars/Character Production/Validate Selected Master Humanoid Rig")]
        public static void ValidateSelectedMenu()
        {
            var selected = Selection.activeObject as GameObject;
            var rig = selected != null ? selected.GetComponent<MasterHumanoidRig>() : null;
            if (rig == null)
            {
                EditorUtility.DisplayDialog("Master Humanoid Rig", "Select a prefab root containing MasterHumanoidRig.", "OK");
                return;
            }
            var errors = MasterHumanoidRigValidator.Validate(rig);
            ValidateDependencies(selected, errors);
            if (!IsSpriteSkinPackageDeclared()) errors.Add("Unity 2D Animation is not declared in Packages/manifest.json.");
            ShowValidation(selected.name, errors);
        }

        public static bool TryCreateProofPrefab(out string message)
        {
            EnsureFolders();
            var existing = AssetDatabase.LoadAssetAtPath<GameObject>(ProofPrefabPath);
            if (existing != null)
            {
                var existingRig = existing.GetComponent<MasterHumanoidRig>();
                var existingErrors = MasterHumanoidRigValidator.Validate(existingRig);
                if (existingErrors.Count == 0)
                {
                    message = "Proof prefab already exists and validates. It was left unchanged: " + ProofPrefabPath;
                    return true;
                }
                message = "Proof prefab exists but is invalid; it was not overwritten. Resolve or explicitly remove it first.\n" + Join(existingErrors);
                return false;
            }
            if (File.Exists(ProofPrefabPath))
            {
                message = "A file exists at " + ProofPrefabPath + " but Unity could not load it as a prefab. It was not overwritten.";
                return false;
            }

            var root = new GameObject("MasterHumanoidRig_Proof");
            try
            {
                var rig = root.AddComponent<MasterHumanoidRig>();
                var visualRoot = NewChild("VisualRoot", root.transform);
                var ground = NewChild(MasterHumanoidRigContract.SocketName(MasterHumanoidSocket.Ground), visualRoot);
                var viewRoots = new Transform[3];
                for (var i = 0; i < viewRoots.Length; i++)
                {
                    var view = (MasterHumanoidView)i;
                    var viewRoot = NewChild("View_" + view, visualRoot);
                    var skeleton = NewChild("Skeleton", viewRoot);
                    BuildSkeleton(skeleton);
                    BuildSockets(viewRoot);
                    NewChild("SkinMount", viewRoot);
                    viewRoots[i] = viewRoot;
                    viewRoot.gameObject.SetActive(view == MasterHumanoidView.Front);
                }
                rig.Configure(visualRoot, ground, viewRoots[0], viewRoots[1], viewRoots[2]);
                var errors = MasterHumanoidRigValidator.Validate(rig);
                ValidateDependencies(root, errors);
                if (!IsSpriteSkinPackageDeclared()) errors.Add("Unity 2D Animation is not declared in Packages/manifest.json.");
                if (errors.Count > 0)
                {
                    message = "Generated hierarchy failed validation; no prefab was saved.\n" + Join(errors);
                    return false;
                }

                var prefab = PrefabUtility.SaveAsPrefabAsset(root, ProofPrefabPath);
                if (prefab == null)
                {
                    message = "Unity could not save the proof prefab at " + ProofPrefabPath + ".";
                    return false;
                }
                AssetDatabase.SaveAssets();
                AssetDatabase.Refresh();
                Selection.activeObject = prefab;
                message = "Created and validated " + ProofPrefabPath + ". Front is active; Side and Back have independent calibration hierarchies. No character artwork was added.";
                return true;
            }
            catch (Exception exception)
            {
                message = "Proof prefab creation failed: " + exception.Message;
                return false;
            }
            finally
            {
                if (root != null) UnityEngine.Object.DestroyImmediate(root);
            }
        }

        static void BuildSkeleton(Transform skeleton)
        {
            var bones = new Dictionary<string, Transform>();
            foreach (var definition in MasterHumanoidRigContract.Bones)
            {
                Transform parent = skeleton;
                if (definition.parentName != null && !bones.TryGetValue(definition.parentName, out parent))
                    throw new InvalidOperationException("Bone '" + definition.name + "' references parent '" + definition.parentName + "' before it is built.");
                var bone = NewChild(definition.name, parent);
                bone.localPosition = definition.referenceLocalPosition;
                bones.Add(definition.name, bone);
            }
        }

        static void BuildSockets(Transform viewRoot)
        {
            var bones = new Dictionary<string, Transform>();
            foreach (var item in viewRoot.GetComponentsInChildren<Transform>(true)) bones[item.name] = item;
            NewChild(MasterHumanoidRigContract.SocketName(MasterHumanoidSocket.MainHand), bones["RightHand"]);
            NewChild(MasterHumanoidRigContract.SocketName(MasterHumanoidSocket.OffHand), bones["LeftHand"]);
            NewChild(MasterHumanoidRigContract.SocketName(MasterHumanoidSocket.Head), bones["Head"]);
            var back = NewChild(MasterHumanoidRigContract.SocketName(MasterHumanoidSocket.Back), bones["Chest"]);
            back.localPosition = new Vector3(0f, 0.02f, 0.05f);
        }

        static Transform NewChild(string name, Transform parent)
        {
            var child = new GameObject(name).transform;
            child.SetParent(parent, false);
            return child;
        }

        static bool IsSpriteSkinPackageDeclared()
        {
            try
            {
                var projectRoot = Directory.GetParent(Application.dataPath).FullName;
                var manifestPath = Path.Combine(projectRoot, "Packages/manifest.json");
                return File.Exists(manifestPath) && File.ReadAllText(manifestPath).Contains("\"com.unity.2d.animation\"");
            }
            catch { return false; }
        }

        static void ValidateDependencies(GameObject root, List<string> errors)
        {
            var forbidden = new[] { "RepWarsArmyVisual", "RepWarsSoldierVisual", "RepWarsMapScreen" };
            foreach (var component in root.GetComponentsInChildren<Component>(true))
            {
                if (component == null) continue;
                foreach (var name in forbidden)
                    if (component.GetType().Name == name)
                        errors.Add("Proof rig must not depend on production map component " + name + ".");
            }
        }

        static void ShowValidation(string title, List<string> errors)
        {
            var message = errors.Count == 0 ? title + " passed structural validation. SpriteSkin is available." : title + " has validation errors:\n" + Join(errors);
            EditorUtility.DisplayDialog("Master Humanoid Rig", message, "OK");
            if (errors.Count == 0) Debug.Log("[CharacterProduction] " + message);
            else Debug.LogError("[CharacterProduction] " + message);
        }

        static string Join(List<string> values) { return string.Join("\n", values.ToArray()); }

        static void EnsureFolders()
        {
            EnsureFolder(Root);
            EnsureFolder(Root + "/Proof");
        }

        static void EnsureFolder(string folder)
        {
            if (AssetDatabase.IsValidFolder(folder)) return;
            var parent = Path.GetDirectoryName(folder).Replace('\\', '/');
            AssetDatabase.CreateFolder(parent, Path.GetFileName(folder));
        }
    }
}
