using System;
using System.Collections;
using UnityEngine;

namespace RepWars
{
    /// <summary>
    /// Sends the gameplay-session lifecycle. The session object decides identities and when a heartbeat is due.
    /// </summary>
    public static class RepWarsSessionDriver
    {
        const int TransportAttempts = 8;

        public static long NowMs()
        {
            return (long)(Time.realtimeSinceStartupAsDouble * 1000.0);
        }

        public static IEnumerator Open(RepWarsApiClient client, RepWarsGameplaySession session, string playerId, bool replacement)
        {
            if (client == null || session == null) yield break;
            var call = replacement ? session.BeginReplacementOpen() : session.BeginOpen();
            if (call == null) yield break;
            for (var attempt = 0; attempt < TransportAttempts; attempt++)
            {
                RepWarsSessionResult result = null;
                yield return client.PostSession("open", playerId, call, value => result = value);
                if (result != null && result.TransportOk && IsOpened(result.Outcome) && !string.IsNullOrEmpty(result.SessionId))
                {
                    session.NoteOpenSucceeded(result.SessionId, result.ExpiresAtMs, NowMs());
                    yield break;
                }
                if (result != null && result.Retryable)
                {
                    session.NoteOpenTransportFailure();
                    yield return new WaitForSecondsRealtime(1f);
                    continue;
                }
                session.NoteOpenRejected();
                yield break;
            }
        }

        public static IEnumerator Heartbeat(RepWarsApiClient client, RepWarsGameplaySession session, string playerId, Func<bool> quitting)
        {
            while (quitting == null || !quitting())
            {
                var call = session.BeginHeartbeat(NowMs());
                if (call == null)
                {
                    yield return new WaitForSecondsRealtime(1f);
                    continue;
                }
                while (call != null && (quitting == null || !quitting()))
                {
                    RepWarsSessionResult result = null;
                    yield return client.PostSession("heartbeat", playerId, call, value => result = value);
                    if (quitting != null && quitting()) yield break;
                    if (result != null && result.Retryable)
                    {
                        session.NoteHeartbeatTransportFailure();
                        yield return new WaitForSecondsRealtime(1f);
                        call = session.BeginHeartbeat(NowMs());
                        continue;
                    }
                    if (result != null && result.TransportOk)
                    {
                        var outcome = result.Outcome ?? "";
                        if (outcome == "expired" || outcome == "ended" || outcome == "unknown_session")
                        {
                            session.NoteSessionUnusable(outcome);
                            if (quitting == null || !quitting())
                            {
                                yield return Open(client, session, playerId, true);
                            }
                            break;
                        }
                        session.NoteHeartbeatSucceeded(result.ExpiresAtMs, NowMs());
                        break;
                    }
                    session.NoteHeartbeatTransportFailure();
                    yield return new WaitForSecondsRealtime(1f);
                    call = session.BeginHeartbeat(NowMs());
                }
            }
        }

        public static void EndBestEffort(RepWarsApiClient client, RepWarsGameplaySession session, string playerId)
        {
            if (client == null || session == null) return;
            var call = session.BeginEnd();
            if (call == null) return;
            client.PostSessionEndNoWait(playerId, call);
        }

        static bool IsOpened(string outcome)
        {
            return outcome == "opened" || outcome == "idempotent_replay";
        }
    }
}
