using UnityEngine;

namespace RepWars.Environment.Effects
{
    /// <summary>
    /// Lightweight pooled sprite-particle simulator shared by smoke, plumes, embers and sparks.
    /// Creates a fixed number of child SpriteRenderers once; particles are struct arrays,
    /// so steady-state ticking performs no allocations and no Instantiate/Destroy.
    /// Uses one shared material per renderer (sharedMaterial), so no material instances are created.
    /// </summary>
    public sealed class SpriteParticleSystem
    {
        struct Particle
        {
            public bool alive;
            public Vector2 pos;      // local or world, depending on space
            public Vector2 vel;
            public float age, life;
            public float startScale, endScale;
            public float alpha;
            public float rot, rotSpeed;
            public float swayPhase, swayFreq, swayAmp;
            public float flickerPhase;
        }

        readonly Transform _owner;
        readonly SpriteRenderer[] _renderers;
        readonly Transform[] _transforms;
        readonly Particle[] _particles;
        readonly ObjectPool<object> _slotPool;    // capacity bookkeeping (indices boxed once at prewarm)
        readonly int[] _slotOfIndex;
        float _emitAccumulator;

        public int Capacity => _particles.Length;
        public int AliveCount { get; private set; }
        public EffectSimulationSpace Space { get; set; }
        public Color Tint = Color.white;

        public SpriteParticleSystem(Transform owner, string containerName, int capacity, Material sharedMaterial)
        {
            _owner = owner;
            _particles = new Particle[capacity];
            _renderers = new SpriteRenderer[capacity];
            _transforms = new Transform[capacity];
            _slotOfIndex = new int[capacity];
            var container = new GameObject(containerName).transform;
            container.SetParent(owner, false);
            for (int i = 0; i < capacity; i++)
            {
                var go = new GameObject("p" + i);
                go.transform.SetParent(container, false);
                var r = go.AddComponent<SpriteRenderer>();
                if (sharedMaterial != null) r.sharedMaterial = sharedMaterial;
                r.enabled = false;
                _renderers[i] = r;
                _transforms[i] = go.transform;
            }
            int next = 0;
            _slotPool = new ObjectPool<object>(capacity, () => next++);
            _slotPool.Prewarm();
        }

        public void ConfigureRenderers(Sprite[] sprites, string layer, int order, CosmeticRandom rng)
        {
            for (int i = 0; i < _renderers.Length; i++)
            {
                var r = _renderers[i];
                r.sortingLayerName = layer;
                r.sortingOrder = order;
                if (sprites != null && sprites.Length > 0) r.sprite = sprites[rng.Range(0, sprites.Length)];
            }
        }

        public void Clear()
        {
            for (int i = 0; i < _particles.Length; i++)
            {
                if (_particles[i].alive) _slotPool.Release(_slotOfIndex[i]);
                _particles[i].alive = false;
                _renderers[i].enabled = false;
            }
            AliveCount = 0;
            _emitAccumulator = 0f;
        }

        /// <summary>Emit by rate; returns number emitted this tick.</summary>
        public int EmitByRate(SpriteEmissionSettings s, float dt, Vector2 originLocal, CosmeticRandom rng, Sprite[] sprites)
        {
            _emitAccumulator += s.ratePerSecond * dt;
            int n = 0;
            while (_emitAccumulator >= 1f)
            {
                _emitAccumulator -= 1f;
                if (Emit(s, originLocal, rng, sprites, 1f, 1f, 1f)) n++;
            }
            return n;
        }

        public bool Emit(SpriteEmissionSettings s, Vector2 originLocal, CosmeticRandom rng, Sprite[] sprites,
                         float scaleMul, float speedMul, float lifeMul)
        {
            var slot = _slotPool.Get();
            if (slot == null) return false; // at cap: skip, never grow
            int i = FindDead();
            if (i < 0) { _slotPool.Release(slot); return false; }
            _slotOfIndex[i] = (int)slot;

            ref var p = ref _particles[i];
            p.alive = true;
            Vector2 local = originLocal + new Vector2(rng.Signed(s.spawnRadiusX), rng.Signed(s.spawnRadiusY));
            p.pos = Space == EffectSimulationSpace.World ? (Vector2)_owner.TransformPoint(local) : local;
            p.vel = new Vector2(s.velocityX + rng.Signed(s.velocityJitter), s.velocityY + rng.Signed(s.velocityJitter * 0.5f)) * speedMul;
            p.age = 0f;
            p.life = rng.Range(s.lifetime) * lifeMul;
            p.startScale = rng.Range(s.startScale) * scaleMul;
            p.endScale = p.startScale * rng.Range(s.endScaleMultiplier);
            p.alpha = rng.Range(s.startAlpha);
            p.rot = rng.Range(0f, 360f) * (s.rotationSpeed.min == 0f && s.rotationSpeed.max == 0f ? 0f : 1f);
            p.rotSpeed = rng.Range(s.rotationSpeed);
            p.swayPhase = rng.Range(0f, 6.2831853f);
            p.swayFreq = rng.Range(s.swayFrequency);
            p.swayAmp = s.swayAmplitude * rng.Range(0.6f, 1f);
            p.flickerPhase = rng.Range(0f, 6.2831853f);
            var r = _renderers[i];
            if (sprites != null && sprites.Length > 0) r.sprite = sprites[rng.Range(0, sprites.Length)];
            r.flipX = rng.Chance(0.5f);
            r.enabled = true;
            AliveCount++;
            return true;
        }

        int FindDead()
        {
            for (int i = 0; i < _particles.Length; i++) if (!_particles[i].alive) return i;
            return -1;
        }

        public void Simulate(SpriteEmissionSettings s, float dt, float masterOpacity)
        {
            float dragFactor = 1f / (1f + s.drag * dt);
            bool world = Space == EffectSimulationSpace.World;
            for (int i = 0; i < _particles.Length; i++)
            {
                ref var p = ref _particles[i];
                if (!p.alive) continue;
                p.age += dt;
                if (p.age >= p.life)
                {
                    p.alive = false;
                    _renderers[i].enabled = false;
                    _slotPool.Release(_slotOfIndex[i]);
                    AliveCount--;
                    continue;
                }
                p.vel.y += s.gravity * dt;
                p.vel *= dragFactor;
                p.pos += p.vel * dt;
                p.rot += p.rotSpeed * dt;
                float t = p.age / p.life;
                float a = 1f;
                if (s.fadeInFraction > 0f && t < s.fadeInFraction) a = t / s.fadeInFraction;
                else if (s.fadeOutFraction > 0f && t > 1f - s.fadeOutFraction) a = (1f - t) / s.fadeOutFraction;
                if (s.flickerAmount > 0f)
                    a *= 1f - s.flickerAmount * 0.5f * (1f + Mathf.Sin(p.flickerPhase + p.age * s.flickerFrequency * 6.2831853f));
                float sway = p.swayAmp * Mathf.Sin(p.swayPhase + p.age * p.swayFreq * 6.2831853f);
                float scale = Mathf.Lerp(p.startScale, p.endScale, t);

                var tr = _transforms[i];
                var pos = new Vector3(p.pos.x + sway, p.pos.y, 0f);
                if (world) tr.position = pos; else tr.localPosition = pos;
                tr.localRotation = Quaternion.Euler(0f, 0f, p.rot);
                tr.localScale = new Vector3(scale, scale, 1f);
                var c = Tint;
                c.a *= a * p.alpha * masterOpacity;
                _renderers[i].color = c;
            }
        }
    }
}
