using System;
using UnityEngine;

namespace RepWars.CharacterProduction
{
    /// <summary>Visual rig only. Gameplay/world position belongs to the external parent.</summary>
    public sealed class MasterHumanoidRig : MonoBehaviour
    {
        [SerializeField] int contractVersion = MasterHumanoidRigContract.Version;
        [SerializeField] Transform visualRoot;
        [SerializeField] Transform groundSocket;
        [SerializeField] Transform frontView;
        [SerializeField] Transform sideView;
        [SerializeField] Transform backView;

        public int ContractVersion { get { return contractVersion; } }
        public Transform VisualRoot { get { return visualRoot; } }
        public Transform GroundSocket { get { return groundSocket; } }

        public Transform GetViewRoot(MasterHumanoidView view)
        {
            switch (view)
            {
                case MasterHumanoidView.Front: return frontView;
                case MasterHumanoidView.Side: return sideView;
                case MasterHumanoidView.Back: return backView;
                default: throw new ArgumentOutOfRangeException("view", view, "Unknown Master Humanoid view");
            }
        }

        public Transform FindBone(MasterHumanoidView view, string boneName)
        {
            var viewRoot = GetViewRoot(view);
            if (viewRoot == null || string.IsNullOrEmpty(boneName)) return null;
            foreach (var item in viewRoot.GetComponentsInChildren<Transform>(true))
                if (item.name == boneName) return item;
            return null;
        }

        public Transform FindSocket(MasterHumanoidView view, MasterHumanoidSocket socket)
        {
            if (socket == MasterHumanoidSocket.Ground) return groundSocket;
            var viewRoot = GetViewRoot(view);
            if (viewRoot == null) return null;
            var expectedName = MasterHumanoidRigContract.SocketName(socket);
            foreach (var item in viewRoot.GetComponentsInChildren<Transform>(true))
                if (item.name == expectedName) return item;
            return null;
        }

        public void Configure(Transform newVisualRoot, Transform newGroundSocket,
            Transform newFrontView, Transform newSideView, Transform newBackView)
        {
            visualRoot = newVisualRoot;
            groundSocket = newGroundSocket;
            frontView = newFrontView;
            sideView = newSideView;
            backView = newBackView;
            contractVersion = MasterHumanoidRigContract.Version;
        }
    }
}
