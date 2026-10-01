namespace RepWars.Characters
{
    /// <summary>
    /// Maps a base's backendKind to a backend instance. The only place that knows which backends exist.
    /// An unregistered kind fails loudly. It never falls back to the stub, because that would hide a broken base.
    /// </summary>
    public static class CharacterBackendRegistry
    {
        public static bool TryCreate(CharacterBackendKind kind, out ICharacterAnimationBackend backend, out string error)
        {
            switch (kind)
            {
                case CharacterBackendKind.Stub:
                    backend = new StubCharacterAnimationBackend();
                    error = null;
                    return true;
                default:
                    backend = null;
                    error = "Animation backend '" + kind + "' is not implemented yet (Phase A provides only the Stub backend)";
                    return false;
            }
        }
    }
}
