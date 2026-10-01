using System;
using System.Collections.Generic;
using UnityEngine;

namespace RepWars.Characters
{
    /// <summary>
    /// A reusable role or cosmetic kit, for example soldier_gear_01 or emperor_regalia_01.
    /// Each binding names its own mechanism, so the kit is not one big Sprite Library.
    /// </summary>
    [CreateAssetMenu(fileName = "appearance", menuName = "RepWars/Characters/Appearance")]
    public class AppearanceDefinition : ScriptableObject
    {
        public string appearanceId;
        public string displayName;
        public AppearanceSlotBinding[] bindings = Array.Empty<AppearanceSlotBinding>();

        /// <summary>Sockets this kit attaches to. A rig must provide all of them for the kit to fit.</summary>
        public IEnumerable<string> RequiredSocketNames()
        {
            var seen = new HashSet<string>();
            if (bindings == null) yield break;
            foreach (var binding in bindings)
            {
                if (binding == null || !binding.UsesSocket) continue;
                if (string.IsNullOrEmpty(binding.socketName)) continue;
                if (seen.Add(binding.socketName)) yield return binding.socketName;
            }
        }
    }
}
