using System;

namespace RepWars.Environment.Effects
{
    // Plain numeric settings per effect. Sprites live on components/presets so these stay
    // engine-free and unit-testable. Every Sanitize() clamps to safe bounds and returns true
    // if anything was corrected (the owning component logs that once).

    [Serializable]
    public class FogSettings
    {
        public int layerCount = 6;                       // more thin layers = thicker apparent fog
        public FloatRange opacity = new FloatRange(0.15f, 0.35f);
        public float areaWidth = 12f;
        public float areaHeight = 4f;
        public float driftX = 0.25f;                     // units/sec, sign = direction
        public float driftY = 0.03f;                     // small diagonal component
        public FloatRange speedVariation = new FloatRange(0.7f, 1.3f);
        public float verticalBobAmplitude = 0.08f;
        public FloatRange verticalBobPeriod = new FloatRange(6f, 12f);
        public FloatRange scale = new FloatRange(0.9f, 1.3f);
        public float scalePulseAmount = 0.03f;           // subtle breathing deformation
        public FloatRange opacityPulsePeriod = new FloatRange(5f, 11f);
        public float opacityPulseAmount = 0.25f;         // fraction of base opacity
        public float edgeFadeFraction = 0.2f;            // fade near area edges so wrap never pops
        public bool randomFlipX = true;

        public bool Sanitize()
        {
            bool c = false;
            layerCount = EffectClamp.Clamp(layerCount, 0, 64, ref c);
            opacity = EffectClamp.Clamp(opacity, 0f, 1f, ref c);
            areaWidth = EffectClamp.Clamp(areaWidth, 0.1f, 500f, ref c);
            areaHeight = EffectClamp.Clamp(areaHeight, 0f, 500f, ref c);
            driftX = EffectClamp.Clamp(driftX, -20f, 20f, ref c);
            driftY = EffectClamp.Clamp(driftY, -20f, 20f, ref c);
            speedVariation = EffectClamp.Clamp(speedVariation, 0f, 5f, ref c);
            verticalBobAmplitude = EffectClamp.Clamp(verticalBobAmplitude, 0f, 10f, ref c);
            verticalBobPeriod = EffectClamp.Clamp(verticalBobPeriod, 0.1f, 120f, ref c);
            scale = EffectClamp.Clamp(scale, 0.01f, 50f, ref c);
            scalePulseAmount = EffectClamp.Clamp(scalePulseAmount, 0f, 0.5f, ref c);
            opacityPulsePeriod = EffectClamp.Clamp(opacityPulsePeriod, 0.1f, 120f, ref c);
            opacityPulseAmount = EffectClamp.Clamp(opacityPulseAmount, 0f, 1f, ref c);
            edgeFadeFraction = EffectClamp.Clamp(edgeFadeFraction, 0.01f, 0.5f, ref c);
            return c;
        }
    }

    /// <summary>Particle-style sprite emission used by broad smoke, plumes, embers and sparks.</summary>
    [Serializable]
    public class SpriteEmissionSettings
    {
        public int maxParticles = 16;                    // pool capacity, hard cap
        public float ratePerSecond = 2f;
        public FloatRange lifetime = new FloatRange(3f, 5f);
        public FloatRange startScale = new FloatRange(0.4f, 0.6f);
        public FloatRange endScaleMultiplier = new FloatRange(1.4f, 1.9f); // expansion over life
        public FloatRange startAlpha = new FloatRange(0.35f, 0.6f);
        public float fadeInFraction = 0.15f;
        public float fadeOutFraction = 0.45f;
        public float velocityX = 0.05f;                  // wind / drift
        public float velocityY = 0.6f;                   // rise
        public float velocityJitter = 0.15f;
        public float gravity = 0f;                       // negative pulls down (sparks)
        public float drag = 0.2f;                        // velocity damping per second
        public float swayAmplitude = 0.1f;
        public FloatRange swayFrequency = new FloatRange(0.3f, 0.7f);
        public float spawnRadiusX = 0.1f;
        public float spawnRadiusY = 0.05f;
        public FloatRange rotationSpeed = new FloatRange(-10f, 10f); // deg/sec
        public float flickerAmount = 0f;                 // ember shimmer, 0..1
        public float flickerFrequency = 8f;

        public bool Sanitize()
        {
            bool c = false;
            maxParticles = EffectClamp.Clamp(maxParticles, 0, 256, ref c);
            ratePerSecond = EffectClamp.Clamp(ratePerSecond, 0f, 200f, ref c);
            lifetime = EffectClamp.Clamp(lifetime, 0.05f, 60f, ref c);
            startScale = EffectClamp.Clamp(startScale, 0.001f, 50f, ref c);
            endScaleMultiplier = EffectClamp.Clamp(endScaleMultiplier, 0f, 20f, ref c);
            startAlpha = EffectClamp.Clamp(startAlpha, 0f, 1f, ref c);
            fadeInFraction = EffectClamp.Clamp(fadeInFraction, 0f, 1f, ref c);
            fadeOutFraction = EffectClamp.Clamp(fadeOutFraction, 0f, 1f, ref c);
            if (fadeInFraction + fadeOutFraction > 1f) { fadeOutFraction = 1f - fadeInFraction; c = true; }
            velocityX = EffectClamp.Clamp(velocityX, -50f, 50f, ref c);
            velocityY = EffectClamp.Clamp(velocityY, -50f, 50f, ref c);
            velocityJitter = EffectClamp.Clamp(velocityJitter, 0f, 50f, ref c);
            gravity = EffectClamp.Clamp(gravity, -100f, 100f, ref c);
            drag = EffectClamp.Clamp(drag, 0f, 20f, ref c);
            swayAmplitude = EffectClamp.Clamp(swayAmplitude, 0f, 10f, ref c);
            swayFrequency = EffectClamp.Clamp(swayFrequency, 0f, 20f, ref c);
            spawnRadiusX = EffectClamp.Clamp(spawnRadiusX, 0f, 500f, ref c);
            spawnRadiusY = EffectClamp.Clamp(spawnRadiusY, 0f, 500f, ref c);
            rotationSpeed = EffectClamp.Clamp(rotationSpeed, -720f, 720f, ref c);
            flickerAmount = EffectClamp.Clamp(flickerAmount, 0f, 1f, ref c);
            flickerFrequency = EffectClamp.Clamp(flickerFrequency, 0f, 60f, ref c);
            return c;
        }
    }

    [Serializable]
    public class PlumeSettings
    {
        public SpriteEmissionSettings body = new SpriteEmissionSettings();
        public bool detachedPuffs = true;
        public float puffChancePerSecond = 0.35f;         // occasional break-away puffs
        public FloatRange puffScaleMultiplier = new FloatRange(0.5f, 0.8f);
        public FloatRange puffSpeedMultiplier = new FloatRange(1.3f, 1.8f);
        public FloatRange puffLifetimeMultiplier = new FloatRange(1.1f, 1.5f);

        public bool Sanitize()
        {
            bool c = body == null;
            if (body == null) body = new SpriteEmissionSettings();
            c |= body.Sanitize();
            puffChancePerSecond = EffectClamp.Clamp(puffChancePerSecond, 0f, 20f, ref c);
            puffScaleMultiplier = EffectClamp.Clamp(puffScaleMultiplier, 0.01f, 10f, ref c);
            puffSpeedMultiplier = EffectClamp.Clamp(puffSpeedMultiplier, 0f, 10f, ref c);
            puffLifetimeMultiplier = EffectClamp.Clamp(puffLifetimeMultiplier, 0.05f, 10f, ref c);
            return c;
        }
    }

    [Serializable]
    public class FireSettings
    {
        public FloatRange frameTime = new FloatRange(0.08f, 0.14f);   // bounded per-frame hold
        public bool pulse = true;
        public float pulseAmount = 0.04f;                // scale fraction, grows upward from base
        public FloatRange pulsePeriod = new FloatRange(0.6f, 1.2f);
        public bool sway = true;
        public float swayDegrees = 2f;                   // rotation about the anchored base
        public FloatRange swayPeriod = new FloatRange(1.5f, 2.5f);
        public float glowBase = 0.6f;
        public float glowFlicker = 0.25f;

        public bool Sanitize()
        {
            bool c = false;
            frameTime = EffectClamp.Clamp(frameTime, 0.02f, 2f, ref c);
            pulseAmount = EffectClamp.Clamp(pulseAmount, 0f, 0.3f, ref c);
            pulsePeriod = EffectClamp.Clamp(pulsePeriod, 0.05f, 30f, ref c);
            swayDegrees = EffectClamp.Clamp(swayDegrees, 0f, 15f, ref c);
            swayPeriod = EffectClamp.Clamp(swayPeriod, 0.05f, 30f, ref c);
            glowBase = EffectClamp.Clamp(glowBase, 0f, 1f, ref c);
            glowFlicker = EffectClamp.Clamp(glowFlicker, 0f, 1f, ref c);
            return c;
        }
    }

    [Serializable]
    public class EmberSparkSettings
    {
        public bool embersEnabled = true;
        public SpriteEmissionSettings embers = DefaultEmbers();
        public bool sparksEnabled = true;
        public SpriteEmissionSettings sparks = DefaultSparks();

        public static SpriteEmissionSettings DefaultEmbers()
        {
            return new SpriteEmissionSettings
            {
                maxParticles = 8, ratePerSecond = 1.2f, lifetime = new FloatRange(1.5f, 2.8f),
                startScale = new FloatRange(0.04f, 0.08f), endScaleMultiplier = new FloatRange(0.4f, 0.7f),
                startAlpha = new FloatRange(0.7f, 1f), fadeInFraction = 0.1f, fadeOutFraction = 0.5f,
                velocityX = 0.05f, velocityY = 0.7f, velocityJitter = 0.25f, drag = 0.3f,
                swayAmplitude = 0.15f, swayFrequency = new FloatRange(0.8f, 1.6f),
                spawnRadiusX = 0.15f, spawnRadiusY = 0.05f, rotationSpeed = new FloatRange(0f, 0f),
                flickerAmount = 0.5f, flickerFrequency = 9f
            };
        }

        public static SpriteEmissionSettings DefaultSparks()
        {
            return new SpriteEmissionSettings
            {
                maxParticles = 6, ratePerSecond = 0.5f, lifetime = new FloatRange(0.3f, 0.6f),
                startScale = new FloatRange(0.03f, 0.05f), endScaleMultiplier = new FloatRange(0.2f, 0.4f),
                startAlpha = new FloatRange(0.9f, 1f), fadeInFraction = 0f, fadeOutFraction = 0.6f,
                velocityX = 0f, velocityY = 2.2f, velocityJitter = 1.2f, gravity = -4f, drag = 0.5f,
                swayAmplitude = 0f, spawnRadiusX = 0.1f, spawnRadiusY = 0.05f,
                rotationSpeed = new FloatRange(0f, 0f), flickerAmount = 0.2f, flickerFrequency = 20f
            };
        }

        public bool Sanitize()
        {
            bool c = false;
            if (embers == null) { embers = DefaultEmbers(); c = true; }
            if (sparks == null) { sparks = DefaultSparks(); c = true; }
            c |= embers.Sanitize();
            c |= sparks.Sanitize();
            return c;
        }
    }
}
