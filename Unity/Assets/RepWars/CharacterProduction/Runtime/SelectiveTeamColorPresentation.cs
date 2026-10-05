using System;
using System.Collections.Generic;
using UnityEngine;

namespace RepWars.CharacterProduction
{
    [Serializable]
    public sealed class TeamColorSectionBinding
    {
        public MasterHumanoidView view;
        public string sectionId;
        public SpriteRenderer renderer;
        public Sprite sourceSprite;
        // Null means explicitly no recolorable pixels, never whole-sprite recoloring.
        public Texture2D mask;
        public RectInt sourceBounds;
    }

    /// <summary>One cosmetic color for all authored views. No gameplay dependencies or frame loop.</summary>
    [DisallowMultipleComponent]
    public sealed class SelectiveTeamColorPresentation : MonoBehaviour
    {
        public const string ShaderName = "RepWars/CharacterProduction/SelectiveTeamColorUnlit";
        static readonly int MaskId = Shader.PropertyToID("_TeamColorMask");
        static readonly int ColorId = Shader.PropertyToID("_TeamColor");
        static readonly int EnabledId = Shader.PropertyToID("_TeamColorEnabled");
        [SerializeField] Material sharedMaterial;
        [SerializeField] TeamColorSectionBinding[] sections = Array.Empty<TeamColorSectionBinding>();
        [SerializeField] string configurationSha256;
        [SerializeField] bool recolorEnabled;
        [SerializeField] Color teamColor = Color.white;
        MaterialPropertyBlock properties;

        public Material SharedMaterial { get { return sharedMaterial; } }
        public IReadOnlyList<TeamColorSectionBinding> Sections { get { return sections; } }
        public string ConfigurationSha256 { get { return configurationSha256; } }
        public bool RecolorEnabled { get { return recolorEnabled; } }
        public Color TeamColor { get { return teamColor; } }

        public bool Configure(Material material, TeamColorSectionBinding[] bindings, string recipeHash, out string error)
        {
            var errors = ValidateBindings(material, bindings, transform);
            if (errors.Count != 0) { error = string.Join("\n", errors.ToArray()); return false; }
            if (sections.Length != 0) { error = "Already configured; author a new proof instead of replacing renderer bindings."; return false; }
            sharedMaterial = material;
            sections = (TeamColorSectionBinding[])bindings.Clone();
            configurationSha256 = recipeHash;
            foreach (var section in sections) section.renderer.sharedMaterial = material;
            ApplyStoredColor();
            error = null;
            return true;
        }

        /// <summary>Receives an sRGB cosmetic color. Alpha is ignored; sprite transparency is preserved.</summary>
        public bool SetTeamColor(Color color)
        {
            if (!ValidColor(color)) return false;
            teamColor = new Color(color.r, color.g, color.b, 1f);
            recolorEnabled = true;
            ApplyStoredColor();
            return true;
        }

        public void DisableTeamColor() { recolorEnabled = false; ApplyStoredColor(); }

        public void ApplyStoredColor()
        {
            if (properties == null) properties = new MaterialPropertyBlock();
            var linear = teamColor.linear;
            foreach (var section in sections)
            {
                if (section == null || section.renderer == null) continue;
                // Preserve SpriteSkin and any unrelated property-block inputs. Never instantiate materials.
                section.renderer.GetPropertyBlock(properties);
                var safe = sharedMaterial != null && section.renderer.sharedMaterial == sharedMaterial &&
                    section.sourceSprite != null && section.renderer.sprite == section.sourceSprite &&
                    section.mask != null && section.mask.width == section.sourceSprite.texture.width &&
                    section.mask.height == section.sourceSprite.texture.height;
                properties.SetTexture(MaskId, safe ? section.mask : Texture2D.blackTexture);
                properties.SetVector(ColorId, new Vector4(linear.r, linear.g, linear.b, 1f));
                properties.SetFloat(EnabledId, safe && isActiveAndEnabled && recolorEnabled && ValidColor(teamColor) ? 1f : 0f);
                section.renderer.SetPropertyBlock(properties);
            }
        }

        void OnEnable() { ApplyStoredColor(); }
        void OnDisable() { ApplyStoredColor(); }

        public List<string> Validate()
        {
            var errors = ValidateBindings(sharedMaterial, sections, transform);
            if (!ValidColor(teamColor)) errors.Add("Team color must contain finite RGB values in [0,1].");
            foreach (var section in sections)
                if (section != null && section.renderer != null && section.renderer.sharedMaterial != sharedMaterial)
                    errors.Add(section.view + "/" + section.sectionId + ": shared team-color material was replaced.");
            return errors;
        }

        static List<string> ValidateBindings(Material material, TeamColorSectionBinding[] bindings, Transform owner)
        {
            var errors = new List<string>();
            if (material == null || material.shader == null || material.shader.name != ShaderName ||
                !material.HasProperty(MaskId) || !material.HasProperty(ColorId) || !material.HasProperty(EnabledId))
                errors.Add("Required selective team-color shader/material is missing; there is no tint fallback.");
            var identities = new HashSet<string>();
            var renderers = new HashSet<SpriteRenderer>();
            if (bindings == null || bindings.Length == 0) { errors.Add("Explicit body-section bindings are required."); return errors; }
            foreach (var section in bindings)
            {
                if (section == null) { errors.Add("Null section binding."); continue; }
                var id = section.view + "/" + section.sectionId;
                if (!Enum.IsDefined(typeof(MasterHumanoidView), section.view) || string.IsNullOrEmpty(section.sectionId) || !identities.Add(id))
                    errors.Add(id + ": invalid or duplicate authored-view/section identity.");
                var renderer = section.renderer;
                if (renderer == null || !renderers.Add(renderer) || !renderer.transform.IsChildOf(owner) ||
                    section.sourceSprite == null || renderer.sprite != section.sourceSprite)
                { errors.Add(id + ": missing, duplicated, external, or mismatched renderer/sprite reference."); continue; }
                if (renderer.color != Color.white || renderer.flipX || renderer.flipY)
                    errors.Add(id + ": preserve white renderer color and whole-rig mirroring.");
                var sprite = section.sourceSprite;
                if (sprite.packed || sprite.rect != new Rect(0, 0, sprite.texture.width, sprite.texture.height))
                    errors.Add(id + ": mask UV contract requires the existing standalone full-rect sprite; atlas packing needs an explicit paired-UV extension.");
                if (section.sourceBounds.width != sprite.texture.width || section.sourceBounds.height != sprite.texture.height)
                    errors.Add(id + ": recorded source extraction bounds do not match the sprite texture dimensions.");
                if (section.mask != null && (section.mask.width != sprite.texture.width || section.mask.height != sprite.texture.height))
                    errors.Add(id + ": mask dimensions must exactly match the section texture.");
            }
            return errors;
        }

        static bool ValidColor(Color color)
        { return InRange(color.r) && InRange(color.g) && InRange(color.b); }
        static bool InRange(float value)
        { return !float.IsNaN(value) && !float.IsInfinity(value) && value >= 0f && value <= 1f; }
    }
}
