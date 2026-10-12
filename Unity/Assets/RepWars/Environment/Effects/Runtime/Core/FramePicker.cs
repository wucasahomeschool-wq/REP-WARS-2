namespace RepWars.Environment.Effects
{
    /// <summary>
    /// Picks the next authored frame index at random, never repeating the previous index
    /// immediately (when more than one frame exists). Pure logic, allocation-free.
    /// </summary>
    public sealed class FramePicker
    {
        readonly CosmeticRandom _random;
        int _count;

        public int Current { get; private set; } = -1;
        public int Count => _count;

        public FramePicker(CosmeticRandom random, int frameCount)
        {
            _random = random ?? new CosmeticRandom();
            SetFrameCount(frameCount);
        }

        public void SetFrameCount(int frameCount)
        {
            _count = frameCount < 0 ? 0 : frameCount;
            if (Current >= _count) Current = -1;
        }

        /// <summary>Returns -1 for an empty list, 0 for a single frame, otherwise a non-repeating index.</summary>
        public int Next()
        {
            if (_count <= 0) { Current = -1; return -1; }
            if (_count == 1) { Current = 0; return 0; }
            int next;
            if (Current < 0) next = _random.Range(0, _count);
            else
            {
                // Choose from the other count-1 indices uniformly, skipping Current.
                next = _random.Range(0, _count - 1);
                if (next >= Current) next++;
            }
            Current = next;
            return next;
        }
    }
}
