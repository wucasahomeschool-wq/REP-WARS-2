namespace RepWars.Environment.Effects
{
    /// <summary>Linear master-opacity fade state used by every controller's lifecycle API.</summary>
    public sealed class EffectFade
    {
        float _target;
        float _speed;

        public float Value { get; private set; }
        public bool IsFading => Value != _target;
        public float Target => _target;

        public void Set(float value) { Value = Clamp01(value); _target = Value; _speed = 0f; }

        /// <summary>Fade toward target over duration seconds (duration &lt;= 0 snaps).</summary>
        public void FadeTo(float target, float duration)
        {
            _target = Clamp01(target);
            if (duration <= 0f) { Value = _target; _speed = 0f; return; }
            float d = _target - Value;
            _speed = (d < 0f ? -d : d) / duration;
        }

        public float Tick(float dt)
        {
            if (Value == _target || dt <= 0f) return Value;
            if (_speed <= 0f) { Value = _target; return Value; }
            float step = _speed * dt;
            if (Value < _target) { Value += step; if (Value > _target) Value = _target; }
            else { Value -= step; if (Value < _target) Value = _target; }
            return Value;
        }

        static float Clamp01(float v) { return v < 0f || float.IsNaN(v) ? 0f : (v > 1f ? 1f : v); }
    }
}
