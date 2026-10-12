using System;
using System.Collections.Generic;

namespace RepWars.Environment.Effects
{
    /// <summary>
    /// Fixed-capacity pool. All items are created up front by Prewarm, so steady-state
    /// Get/Release never allocates or creates objects. Get returns null when exhausted
    /// (callers skip the spawn instead of growing).
    /// </summary>
    public sealed class ObjectPool<T> where T : class
    {
        readonly Stack<T> _free;
        readonly List<T> _all;
        readonly Func<T> _create;
        readonly Action<T> _onGet;
        readonly Action<T> _onRelease;

        public int Capacity { get; }
        public int CreatedCount => _all.Count;
        public int FreeCount => _free.Count;
        public int ActiveCount => _all.Count - _free.Count;
        public IReadOnlyList<T> All => _all;

        public ObjectPool(int capacity, Func<T> create, Action<T> onGet = null, Action<T> onRelease = null)
        {
            if (create == null) throw new ArgumentNullException(nameof(create));
            Capacity = capacity < 0 ? 0 : capacity;
            _create = create;
            _onGet = onGet;
            _onRelease = onRelease;
            _free = new Stack<T>(Capacity);
            _all = new List<T>(Capacity);
        }

        public void Prewarm()
        {
            while (_all.Count < Capacity)
            {
                var item = _create();
                _all.Add(item);
                _onRelease?.Invoke(item);
                _free.Push(item);
            }
        }

        public T Get()
        {
            if (_free.Count == 0)
            {
                if (_all.Count >= Capacity) return null;
                var created = _create();
                _all.Add(created);
                _onGet?.Invoke(created);
                return created;
            }
            var item = _free.Pop();
            _onGet?.Invoke(item);
            return item;
        }

        public void Release(T item)
        {
            if (item == null) return;
            _onRelease?.Invoke(item);
            _free.Push(item);
        }
    }
}
