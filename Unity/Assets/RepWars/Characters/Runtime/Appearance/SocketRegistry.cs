using System.Collections.Generic;
using UnityEngine;

namespace RepWars.Characters
{
    /// <summary>
    /// Well-known socket names shared by every rig family. Rigs place them wherever their body needs.
    /// A banana and a human both have a head_top, so one appearance can dress both.
    /// </summary>
    public static class SocketNames
    {
        public const string HeadTop = "head_top";
        public const string Neck = "neck";
        public const string Torso = "torso";
        public const string Back = "back";
        public const string Waist = "waist";
    }

    /// <summary>
    /// Runtime map from socket name to Transform for one character instance.
    /// The backend fills it: the stub backend makes plain child objects, a skeletal backend will use bones.
    /// The appearance composer only ever asks this registry for a socket.
    /// </summary>
    public sealed class SocketRegistry
    {
        readonly Dictionary<string, Transform> sockets = new Dictionary<string, Transform>();

        public int Count { get { return sockets.Count; } }
        public IEnumerable<string> Names { get { return sockets.Keys; } }

        public bool Register(string socketName, Transform socket)
        {
            if (string.IsNullOrEmpty(socketName) || socket == null) return false;
            if (sockets.ContainsKey(socketName)) return false;
            sockets.Add(socketName, socket);
            return true;
        }

        public bool TryGet(string socketName, out Transform socket)
        {
            socket = null;
            if (string.IsNullOrEmpty(socketName)) return false;
            return sockets.TryGetValue(socketName, out socket) && socket != null;
        }

        public void Clear()
        {
            sockets.Clear();
        }
    }
}
