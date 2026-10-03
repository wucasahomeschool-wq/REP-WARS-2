using System;
using System.Collections.Generic;

namespace RepWars
{
    public enum RepWarsSessionPhase
    {
        Closed,
        Opening,
        Active,
        Ended,
        Expired,
        ProtocolFault,
    }

    public enum RepWarsSessionCallKind
    {
        Open,
        Heartbeat,
        End,
    }

    /// <summary>
    /// One logical session or heartbeat or end request. Transport retries reuse this object.
    /// </summary>
    public sealed class RepWarsSessionCall
    {
        public RepWarsSessionCallKind Kind;
        public string RequestId;
        public string GameplaySessionId;
        public int RenewalSequence;
    }

    /// <summary>
    /// One logical state-changing command. commandSequence and renewalSequence are allocated once.
    /// </summary>
    public sealed class RepWarsMutation
    {
        public string CommandId;
        public string ParametersJson;
        public string RequestId;
        public string GameplaySessionId;
        public int CommandSequence;
        public int RenewalSequence;
        public bool IdentityAllocated;
        public bool Sent;
        public bool Settled;
        public bool ResubmitForbidden;
        public bool AcceptedReplay;
        public string TerminalCode;
    }

    /// <summary>
    /// Client-side gameplay session. The server issues the session id, the receipt time, and the lease expiry.
    /// This object only allocates request identities and orders state-changing commands.
    /// </summary>
    public sealed class RepWarsGameplaySession
    {
        public const int HeartbeatIntervalMs = 30_000;

        static readonly HashSet<string> MutatingCommands = new HashSet<string>
        {
            "ATTACK",
            "MOVE",
            "BUILD",
            "REINFORCE",
            "DECLARE_WAR",
            "NEGOTIATE",
            "SYNC_PLAYER_WORLD",
            "TRANSITION_TO_NEXT_WORLD",
            "START_CONSTRUCTION",
            "APPLY_CONSTRUCTION_ACCELERATION",
            "COLLECT_RESOURCES",
            "SET_PLAYER_PAUSE",
            "START_WORKOUT",
            "PAUSE_WORKOUT",
            "RESUME_WORKOUT",
            "RECORD_EXERCISE",
            "SKIP_REST",
            "SUBMIT_WORKOUT_FEEDBACK",
            "FINALIZE_WORKOUT",
            "ABANDON_WORKOUT",
            "RECORD_INTEGRITY_FLAG",
        };

        readonly Func<string> mintId;
        readonly List<RepWarsMutation> pending = new List<RepWarsMutation>();
        RepWarsSessionCall openCall;
        RepWarsSessionCall heartbeatCall;
        RepWarsSessionCall endCall;
        RepWarsMutation current;
        long nextHeartbeatDueMs;
        bool replacing;
        bool shuttingDown;

        public RepWarsGameplaySession()
            : this(null)
        {
        }

        public RepWarsGameplaySession(Func<string> mintId)
        {
            this.mintId = mintId ?? DefaultMint;
        }

        public string GameplaySessionId { get; private set; }
        public int NextRenewalSequence { get; private set; } = 1;
        public int NextCommandSequence { get; private set; } = 1;
        public RepWarsSessionPhase Phase { get; private set; } = RepWarsSessionPhase.Closed;
        public long InformationalExpiresAtMs { get; private set; }
        public string LastUnusableOutcome { get; private set; }
        public string ProtocolFault { get; private set; }
        public RepWarsMutation CurrentMutation { get { return current; } }
        public int QueuedMutationCount { get { return pending.Count; } }
        public bool EndRequested { get { return endCall != null; } }

        public bool AcceptsRenewal
        {
            get { return Phase == RepWarsSessionPhase.Active && !string.IsNullOrEmpty(GameplaySessionId) && !shuttingDown; }
        }

        public static bool ChangesState(string commandId)
        {
            return !string.IsNullOrEmpty(commandId) && MutatingCommands.Contains(commandId);
        }

        public RepWarsSessionCall BeginOpen()
        {
            if (Phase == RepWarsSessionPhase.Active) return null;
            if (Phase == RepWarsSessionPhase.Opening && openCall != null) return openCall;
            if (Phase != RepWarsSessionPhase.Closed) return null;
            openCall = MintOpen();
            Phase = RepWarsSessionPhase.Opening;
            NextRenewalSequence = 1;
            NextCommandSequence = 1;
            GameplaySessionId = null;
            return openCall;
        }

        public void NoteOpenTransportFailure()
        {
        }

        public void NoteOpenRejected()
        {
            openCall = null;
            replacing = false;
            if (Phase == RepWarsSessionPhase.Opening) Phase = RepWarsSessionPhase.Closed;
        }

        public void NoteOpenSucceeded(string sessionId, long expiresAtMs, long nowMs)
        {
            if (string.IsNullOrEmpty(sessionId)) return;
            GameplaySessionId = sessionId;
            if (expiresAtMs > 0) InformationalExpiresAtMs = expiresAtMs;
            Phase = RepWarsSessionPhase.Active;
            replacing = false;
            shuttingDown = false;
            LastUnusableOutcome = null;
            nextHeartbeatDueMs = nowMs + HeartbeatIntervalMs;
            Promote();
        }

        public bool HeartbeatDue(long nowMs)
        {
            return AcceptsRenewal && heartbeatCall == null && nowMs >= nextHeartbeatDueMs;
        }

        public RepWarsSessionCall BeginHeartbeat(long nowMs)
        {
            if (heartbeatCall != null) return heartbeatCall;
            if (!HeartbeatDue(nowMs)) return null;
            var call = new RepWarsSessionCall
            {
                Kind = RepWarsSessionCallKind.Heartbeat,
                RequestId = mintId(),
                GameplaySessionId = GameplaySessionId,
                RenewalSequence = NextRenewalSequence,
            };
            NextRenewalSequence++;
            heartbeatCall = call;
            nextHeartbeatDueMs = nowMs + HeartbeatIntervalMs;
            return call;
        }

        public void NoteHeartbeatTransportFailure()
        {
        }

        public void NoteHeartbeatSucceeded(long expiresAtMs, long nowMs)
        {
            if (expiresAtMs > 0) InformationalExpiresAtMs = expiresAtMs;
            heartbeatCall = null;
            if (nowMs > 0 && nextHeartbeatDueMs < nowMs) nextHeartbeatDueMs = nowMs + HeartbeatIntervalMs;
        }

        public RepWarsMutation SubmitMutation(string commandId, string parametersJson)
        {
            var mutation = new RepWarsMutation
            {
                CommandId = commandId,
                ParametersJson = parametersJson ?? "",
            };
            if (!ChangesState(commandId) || Phase == RepWarsSessionPhase.ProtocolFault)
            {
                mutation.Settled = true;
                mutation.ResubmitForbidden = Phase == RepWarsSessionPhase.ProtocolFault;
                mutation.TerminalCode = Phase == RepWarsSessionPhase.ProtocolFault
                    ? "COMMAND_SEQUENCE_CONFLICT"
                    : "READ_ONLY";
                return mutation;
            }
            if (current == null && Phase == RepWarsSessionPhase.Active && !string.IsNullOrEmpty(GameplaySessionId))
            {
                Allocate(mutation);
            }
            else
            {
                pending.Add(mutation);
            }
            return mutation;
        }

        public void MarkSent(RepWarsMutation mutation)
        {
            if (mutation != null) mutation.Sent = true;
        }

        public bool NoteMutationRetry(RepWarsMutation mutation)
        {
            if (mutation == null || mutation.Settled || mutation.ResubmitForbidden) return false;
            return current == mutation && mutation.IdentityAllocated;
        }

        public void NoteMutationSucceeded(RepWarsMutation mutation, bool idempotentReplay)
        {
            if (mutation == null) return;
            if (idempotentReplay) mutation.AcceptedReplay = true;
            if (mutation.Settled) return;
            mutation.Settled = true;
            if (current == mutation)
            {
                current = null;
                Promote();
            }
        }

        public void NoteMutationFinished(RepWarsMutation mutation)
        {
            if (mutation == null || mutation.Settled) return;
            mutation.Settled = true;
            if (current == mutation)
            {
                current = null;
                Promote();
            }
        }

        public void NoteCommandStale(RepWarsMutation mutation)
        {
            if (mutation == null) return;
            mutation.Settled = true;
            mutation.ResubmitForbidden = true;
            mutation.TerminalCode = "COMMAND_STALE";
            if (current == mutation)
            {
                current = null;
                Promote();
            }
        }

        public void NoteCommandSequenceConflict(RepWarsMutation mutation)
        {
            if (mutation == null) return;
            mutation.Settled = true;
            mutation.ResubmitForbidden = true;
            mutation.TerminalCode = "COMMAND_SEQUENCE_CONFLICT";
            ProtocolFault = "COMMAND_SEQUENCE_CONFLICT";
            Phase = RepWarsSessionPhase.ProtocolFault;
            if (current == mutation) current = null;
        }

        public void NoteMutationSessionDead(RepWarsMutation mutation, string outcome)
        {
            if (mutation != null)
            {
                mutation.Sent = true;
                mutation.ResubmitForbidden = true;
                mutation.Settled = true;
                mutation.TerminalCode = outcome;
                if (current == mutation) current = null;
            }
            NoteSessionUnusable(outcome);
        }

        public void CancelUnsent(RepWarsMutation mutation)
        {
            if (mutation == null || mutation.Sent || mutation.Settled) return;
            mutation.Settled = true;
            mutation.TerminalCode = "CANCELLED";
            pending.Remove(mutation);
            if (current == mutation)
            {
                current = null;
                Promote();
            }
        }

        public void NoteSessionUnusable(string outcome)
        {
            if (outcome != "expired" && outcome != "ended" && outcome != "unknown_session") return;
            LastUnusableOutcome = outcome;
            Phase = outcome == "ended" ? RepWarsSessionPhase.Ended : RepWarsSessionPhase.Expired;
            GameplaySessionId = null;
            heartbeatCall = null;
            if (current == null || current.Settled) return;
            if (current.Sent)
            {
                current.ResubmitForbidden = true;
                if (string.IsNullOrEmpty(current.TerminalCode)) current.TerminalCode = outcome;
                return;
            }
            ClearIdentity(current);
            pending.Insert(0, current);
            current = null;
        }

        public RepWarsSessionCall BeginReplacementOpen()
        {
            if (replacing && Phase == RepWarsSessionPhase.Opening && openCall != null) return openCall;
            if (Phase != RepWarsSessionPhase.Expired && Phase != RepWarsSessionPhase.Ended) return null;
            DetachCurrentForReplacement();
            openCall = MintOpen();
            replacing = true;
            shuttingDown = false;
            Phase = RepWarsSessionPhase.Opening;
            GameplaySessionId = null;
            NextRenewalSequence = 1;
            NextCommandSequence = 1;
            heartbeatCall = null;
            endCall = null;
            ProtocolFault = null;
            return openCall;
        }

        public RepWarsSessionCall BeginEnd()
        {
            if (endCall != null) return endCall;
            if (Phase != RepWarsSessionPhase.Active || string.IsNullOrEmpty(GameplaySessionId)) return null;
            shuttingDown = true;
            endCall = new RepWarsSessionCall
            {
                Kind = RepWarsSessionCallKind.End,
                RequestId = mintId(),
                GameplaySessionId = GameplaySessionId,
            };
            return endCall;
        }

        public void NoteEndTransportFailure()
        {
        }

        public void NoteEndSucceeded()
        {
            Phase = RepWarsSessionPhase.Ended;
            heartbeatCall = null;
            shuttingDown = true;
        }

        void DetachCurrentForReplacement()
        {
            if (current == null) return;
            if (!current.Sent)
            {
                ClearIdentity(current);
                pending.Insert(0, current);
                current = null;
                return;
            }
            current.ResubmitForbidden = true;
            current.Settled = true;
            if (string.IsNullOrEmpty(current.TerminalCode)) current.TerminalCode = "NOT_RESENT";
            current = null;
        }

        void Allocate(RepWarsMutation mutation)
        {
            mutation.RequestId = mintId();
            mutation.CommandSequence = NextCommandSequence;
            mutation.RenewalSequence = NextRenewalSequence;
            mutation.GameplaySessionId = GameplaySessionId;
            NextCommandSequence++;
            NextRenewalSequence++;
            mutation.IdentityAllocated = true;
            current = mutation;
        }

        void Promote()
        {
            if (Phase != RepWarsSessionPhase.Active || string.IsNullOrEmpty(GameplaySessionId) || current != null) return;
            while (pending.Count > 0)
            {
                var next = pending[0];
                pending.RemoveAt(0);
                if (next.Settled) continue;
                Allocate(next);
                return;
            }
        }

        RepWarsSessionCall MintOpen()
        {
            return new RepWarsSessionCall
            {
                Kind = RepWarsSessionCallKind.Open,
                RequestId = mintId(),
            };
        }

        static void ClearIdentity(RepWarsMutation mutation)
        {
            mutation.IdentityAllocated = false;
            mutation.RequestId = null;
            mutation.GameplaySessionId = null;
            mutation.CommandSequence = 0;
            mutation.RenewalSequence = 0;
        }

        string DefaultMint()
        {
            return "unity-" + Guid.NewGuid().ToString("N");
        }
    }

    public static class RepWarsSessionSignals
    {
        public static bool IsCommandStale(RepWarsCommandResult result)
        {
            return Code(result) == "COMMAND_STALE";
        }

        public static bool IsSequenceConflict(RepWarsCommandResult result)
        {
            return Code(result) == "COMMAND_SEQUENCE_CONFLICT";
        }

        public static bool IsRetryable(RepWarsCommandResult result)
        {
            if (result == null) return true;
            if (IsCommandStale(result) || IsSequenceConflict(result)) return false;
            if (TrySessionUnusable(result, out _)) return false;
            if (result.IdempotentReplay) return false;
            var code = Code(result);
            if (code == "persistence.conflict" || code == "STALE_RECEIPT") return true;
            if (!string.IsNullOrEmpty(result.Failure) && result.Failure.StartsWith("Connection failed")) return true;
            return result.HttpStatus == 0 && !result.TransportOk && string.IsNullOrEmpty(code);
        }

        public static bool TrySessionUnusable(RepWarsCommandResult result, out string outcome)
        {
            outcome = "";
            if (Code(result) != "GAMEPLAY_SESSION_INVALID") return false;
            var message = Message(result);
            if (message.IndexOf("expired", StringComparison.Ordinal) >= 0)
            {
                outcome = "expired";
                return true;
            }
            if (message.IndexOf("ended", StringComparison.Ordinal) >= 0)
            {
                outcome = "ended";
                return true;
            }
            if (message.IndexOf("unknown", StringComparison.Ordinal) >= 0)
            {
                outcome = "unknown_session";
                return true;
            }
            return false;
        }

        static string Code(RepWarsCommandResult result)
        {
            if (result == null) return "";
            if (!string.IsNullOrEmpty(result.ServerCode)) return result.ServerCode;
            var errors = result.Response != null ? result.Response.errors : null;
            if (errors != null && errors.Length > 0 && !string.IsNullOrEmpty(errors[0].code)) return errors[0].code;
            return "";
        }

        static string Message(RepWarsCommandResult result)
        {
            var errors = result != null && result.Response != null ? result.Response.errors : null;
            if (errors != null && errors.Length > 0 && errors[0].message != null) return errors[0].message;
            return result != null && result.Failure != null ? result.Failure : "";
        }
    }
}
