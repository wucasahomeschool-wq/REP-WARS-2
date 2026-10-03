using NUnit.Framework;

namespace RepWars.Tests
{
    public class RepWarsGameplaySessionTests
    {
        sealed class Ids
        {
            int next;

            public string Next()
            {
                next++;
                return "req-" + next;
            }
        }

        static RepWarsGameplaySession Opened()
        {
            var ids = new Ids();
            var session = new RepWarsGameplaySession(ids.Next);
            session.BeginOpen();
            session.NoteOpenSucceeded("sess-server", 90_000, 0);
            return session;
        }

        [Test]
        public void StartupOpensOneSession()
        {
            var ids = new Ids();
            var session = new RepWarsGameplaySession(ids.Next);
            var opened = session.BeginOpen();
            Assert.IsNotNull(opened);
            session.NoteOpenSucceeded("sess-server", 90_000, 0);
            Assert.IsNull(session.BeginOpen());
            Assert.AreEqual(RepWarsSessionPhase.Active, session.Phase);
        }

        [Test]
        public void OpenTimeoutRetryUsesTheSameRequestId()
        {
            var ids = new Ids();
            var session = new RepWarsGameplaySession(ids.Next);
            var first = session.BeginOpen();
            session.NoteOpenTransportFailure();
            var second = session.BeginOpen();
            Assert.AreEqual(first.RequestId, second.RequestId);
            Assert.AreEqual("req-1", second.RequestId);
        }

        [Test]
        public void ServerIssuedSessionIdIsStored()
        {
            var ids = new Ids();
            var session = new RepWarsGameplaySession(ids.Next);
            var opened = session.BeginOpen();
            Assert.IsNull(opened.GameplaySessionId);
            session.NoteOpenSucceeded("issued-by-server", 90_000, 0);
            Assert.AreEqual("issued-by-server", session.GameplaySessionId);
        }

        [Test]
        public void HeartbeatSendsTheSessionId()
        {
            var session = Opened();
            var heartbeat = session.BeginHeartbeat(RepWarsGameplaySession.HeartbeatIntervalMs);
            Assert.AreEqual("sess-server", heartbeat.GameplaySessionId);
            var json = RepWarsApiClient.SessionJson("heartbeat", "player_local", heartbeat);
            Assert.IsTrue(json.Contains("\"gameplaySessionId\":\"sess-server\""));
            Assert.IsFalse(json.Contains("expiresAtMs"));
            Assert.IsFalse(json.Contains("online"));
        }

        [Test]
        public void HeartbeatUsesAnIncrementingRenewalSequence()
        {
            var session = Opened();
            Assert.IsFalse(session.HeartbeatDue(RepWarsGameplaySession.HeartbeatIntervalMs - 1));
            var first = session.BeginHeartbeat(RepWarsGameplaySession.HeartbeatIntervalMs);
            session.NoteHeartbeatSucceeded(120_000, RepWarsGameplaySession.HeartbeatIntervalMs);
            var second = session.BeginHeartbeat(RepWarsGameplaySession.HeartbeatIntervalMs * 2);
            Assert.AreEqual(1, first.RenewalSequence);
            Assert.AreEqual(2, second.RenewalSequence);
        }

        [Test]
        public void HeartbeatRetryReusesSequenceAndRequestId()
        {
            var session = Opened();
            var first = session.BeginHeartbeat(RepWarsGameplaySession.HeartbeatIntervalMs);
            session.NoteHeartbeatTransportFailure();
            var second = session.BeginHeartbeat(RepWarsGameplaySession.HeartbeatIntervalMs * 3);
            Assert.AreEqual(first.RequestId, second.RequestId);
            Assert.AreEqual(first.RenewalSequence, second.RenewalSequence);
            Assert.AreEqual(1, first.RenewalSequence);
        }

        [Test]
        public void MutatingCommandIncludesTheGameplaySessionId()
        {
            var session = Opened();
            var attack = session.SubmitMutation("ATTACK", "{\"territoryId\":\"t_01\",\"commitAmount\":140}");
            var json = Body(attack);
            Assert.IsTrue(json.Contains("\"gameplaySessionId\":\"sess-server\""));
            Assert.IsTrue(json.Contains("\"commandId\":\"ATTACK\""));
            Assert.IsFalse(json.Contains("expiresAtMs"));
        }

        [Test]
        public void MutatingCommandGetsOneCommandSequence()
        {
            var session = Opened();
            var command = session.SubmitMutation("PAUSE_WORKOUT", "{\"now\":1000}");
            Assert.AreEqual(1, command.CommandSequence);
            Assert.AreEqual(2, session.NextCommandSequence);
            Assert.IsTrue(session.NoteMutationRetry(command));
            Assert.AreEqual(1, command.CommandSequence);
            Assert.AreEqual(2, session.NextCommandSequence);
        }

        [Test]
        public void TransportRetryReusesTheCommandSequence()
        {
            var session = Opened();
            var command = session.SubmitMutation("RECORD_EXERCISE", "{\"order\":1,\"repetitions\":8,\"now\":1000}");
            var sequence = command.CommandSequence;
            var renewal = command.RenewalSequence;
            Assert.IsTrue(session.NoteMutationRetry(command));
            Assert.IsTrue(session.NoteMutationRetry(command));
            Assert.AreEqual(sequence, command.CommandSequence);
            Assert.AreEqual(renewal, command.RenewalSequence);
            Assert.IsFalse(command.Settled);
        }

        [Test]
        public void TransportRetryReusesTheCommandRequestId()
        {
            var session = Opened();
            var command = session.SubmitMutation("START_WORKOUT", "{\"purpose\":\"NORMAL_TROOPS\"}");
            var requestId = command.RequestId;
            Assert.IsTrue(session.NoteMutationRetry(command));
            Assert.AreEqual(requestId, command.RequestId);
            Assert.AreEqual(command.ParametersJson, "{\"purpose\":\"NORMAL_TROOPS\"}");
        }

        [Test]
        public void MutatingCommandsAreSerialized()
        {
            var session = Opened();
            var first = session.SubmitMutation("ATTACK", "{\"territoryId\":\"t_01\",\"commitAmount\":140}");
            var second = session.SubmitMutation("START_CONSTRUCTION", "{\"territoryId\":\"t_02\",\"projectType\":\"FARM\"}");
            Assert.IsTrue(first.IdentityAllocated);
            Assert.IsFalse(second.IdentityAllocated);
            Assert.IsNull(second.RequestId);
            Assert.AreEqual(1, session.QueuedMutationCount);
            Assert.AreEqual(first, session.CurrentMutation);
        }

        [Test]
        public void TwoRapidMutationsCannotCommitOutOfOrder()
        {
            var session = Opened();
            var first = session.SubmitMutation("ATTACK", "{\"territoryId\":\"t_01\",\"commitAmount\":140}");
            var second = session.SubmitMutation("START_CONSTRUCTION", "{\"territoryId\":\"t_02\",\"projectType\":\"FARM\"}");
            Assert.AreEqual(0, second.CommandSequence);
            session.NoteMutationSucceeded(first, false);
            Assert.AreEqual(second, session.CurrentMutation);
            Assert.Greater(second.CommandSequence, first.CommandSequence);
            Assert.AreEqual(0, session.QueuedMutationCount);
        }

        [Test]
        public void HeartbeatAndGameplayRenewalShareOneSequence()
        {
            var session = Opened();
            var heartbeat = session.BeginHeartbeat(RepWarsGameplaySession.HeartbeatIntervalMs);
            var command = session.SubmitMutation("ATTACK", "{\"territoryId\":\"t_01\",\"commitAmount\":140}");
            session.NoteHeartbeatSucceeded(120_000, RepWarsGameplaySession.HeartbeatIntervalMs);
            var later = session.BeginHeartbeat(RepWarsGameplaySession.HeartbeatIntervalMs * 2);
            Assert.AreEqual(1, heartbeat.RenewalSequence);
            Assert.AreEqual(2, command.RenewalSequence);
            Assert.AreEqual(3, later.RenewalSequence);
            Assert.AreEqual(1, command.CommandSequence);
        }

        [Test]
        public void ReadOnlyCommandDoesNotConsumeACommandSequence()
        {
            var session = Opened();
            var commandSequence = session.NextCommandSequence;
            var renewalSequence = session.NextRenewalSequence;
            var read = session.SubmitMutation("GET_GAME_STATE", "");
            Assert.IsFalse(RepWarsGameplaySession.ChangesState("GET_GAME_STATE"));
            Assert.IsFalse(RepWarsGameplaySession.ChangesState("GET_VISIBLE_WORLD"));
            Assert.IsFalse(RepWarsGameplaySession.ChangesState("GET_WORLD_DEFINITION"));
            Assert.IsFalse(RepWarsGameplaySession.ChangesState("GET_WORKOUT_SELECTION"));
            Assert.IsFalse(RepWarsGameplaySession.ChangesState("GET_FITNESS_CATALOG"));
            Assert.IsFalse(read.IdentityAllocated);
            Assert.AreEqual(commandSequence, session.NextCommandSequence);
            Assert.AreEqual(renewalSequence, session.NextRenewalSequence);
            var json = RepWarsApiClient.CommandJson("GET_GAME_STATE", "player_local", "read-1", null, null, 0, 0);
            Assert.IsFalse(json.Contains("commandSequence"));
            Assert.IsFalse(json.Contains("renewalSequence"));
            Assert.IsFalse(json.Contains("gameplaySessionId"));
        }

        [Test]
        public void IdempotentReplayIsAcceptedAsTheOriginalResult()
        {
            var session = Opened();
            var command = session.SubmitMutation("START_CONSTRUCTION", "{\"territoryId\":\"t_02\",\"projectType\":\"FARM\"}");
            session.NoteMutationSucceeded(command, true);
            Assert.IsTrue(command.AcceptedReplay);
            Assert.IsTrue(command.Settled);
            Assert.IsNull(session.CurrentMutation);
            Assert.IsTrue(RepWarsApiClient.IndicatesIdempotentReplay("{\"success\":true,\"idempotentReplay\":true,\"payload\":{\"projectType\":\"FARM\"}}"));
        }

        [Test]
        public void ExpiredSessionStopsRenewal()
        {
            var session = Opened();
            var heartbeat = session.BeginHeartbeat(RepWarsGameplaySession.HeartbeatIntervalMs);
            session.NoteHeartbeatSucceeded(120_000, RepWarsGameplaySession.HeartbeatIntervalMs);
            session.NoteSessionUnusable("expired");
            Assert.IsFalse(session.AcceptsRenewal);
            Assert.IsNull(session.GameplaySessionId);
            Assert.IsNull(session.BeginHeartbeat(long.MaxValue));
            Assert.AreEqual(1, heartbeat.RenewalSequence);
        }

        [Test]
        public void ExpiredSessionCanOpenANewSessionWithoutResendingTheInFlightCommand()
        {
            var session = Opened();
            var firstOpen = "req-1";
            var inflight = session.SubmitMutation("ATTACK", "{\"territoryId\":\"t_01\",\"commitAmount\":140}");
            session.MarkSent(inflight);
            var oldRequest = inflight.RequestId;
            session.NoteSessionUnusable("expired");
            Assert.IsTrue(inflight.ResubmitForbidden);
            Assert.IsFalse(session.NoteMutationRetry(inflight));
            var replacement = session.BeginReplacementOpen();
            Assert.AreNotEqual(firstOpen, replacement.RequestId);
            session.NoteOpenSucceeded("sess-2", 180_000, 0);
            Assert.AreEqual("sess-2", session.GameplaySessionId);
            Assert.IsTrue(inflight.Settled);
            Assert.AreEqual(1, session.NextCommandSequence);
            Assert.AreEqual(1, session.NextRenewalSequence);
            var follow = session.SubmitMutation("START_CONSTRUCTION", "{\"territoryId\":\"t_02\",\"projectType\":\"FARM\"}");
            Assert.AreEqual(1, follow.CommandSequence);
            Assert.AreEqual("sess-2", follow.GameplaySessionId);
            Assert.AreNotEqual(oldRequest, follow.RequestId);
        }

        [Test]
        public void EndedSessionStopsRenewal()
        {
            var session = Opened();
            session.NoteSessionUnusable("ended");
            Assert.AreEqual(RepWarsSessionPhase.Ended, session.Phase);
            Assert.IsFalse(session.AcceptsRenewal);
            Assert.IsNull(session.BeginHeartbeat(long.MaxValue));
        }

        [Test]
        public void UnknownSessionIsHandled()
        {
            var session = Opened();
            session.NoteSessionUnusable("unknown_session");
            Assert.AreEqual("unknown_session", session.LastUnusableOutcome);
            Assert.IsFalse(session.AcceptsRenewal);
            Assert.IsNull(session.GameplaySessionId);
            Assert.IsNull(session.BeginHeartbeat(long.MaxValue));
            var replacement = session.BeginReplacementOpen();
            Assert.IsNotNull(replacement);
            Assert.IsNull(replacement.GameplaySessionId);
        }

        [Test]
        public void CommandStaleIsNotResubmitted()
        {
            var session = Opened();
            var command = session.SubmitMutation("SET_PLAYER_PAUSE", "{\"paused\":true}");
            var next = session.NextCommandSequence;
            session.NoteCommandStale(command);
            Assert.AreEqual("COMMAND_STALE", command.TerminalCode);
            Assert.IsTrue(command.ResubmitForbidden);
            Assert.IsFalse(session.NoteMutationRetry(command));
            Assert.IsNull(session.CurrentMutation);
            Assert.AreEqual(next, session.NextCommandSequence);
        }

        [Test]
        public void CommandSequenceConflictIsAProtocolFailure()
        {
            var session = Opened();
            var command = session.SubmitMutation("ATTACK", "{\"territoryId\":\"t_01\",\"commitAmount\":140}");
            var next = session.NextCommandSequence;
            session.NoteCommandSequenceConflict(command);
            Assert.AreEqual(RepWarsSessionPhase.ProtocolFault, session.Phase);
            Assert.AreEqual("COMMAND_SEQUENCE_CONFLICT", session.ProtocolFault);
            var extra = session.SubmitMutation("START_WORKOUT", "{\"purpose\":\"NORMAL_TROOPS\"}");
            Assert.IsFalse(extra.IdentityAllocated);
            Assert.AreEqual(next, session.NextCommandSequence);
            Assert.IsFalse(session.NoteMutationRetry(command));
        }

        [Test]
        public void GracefulEndAddressesOnlyTheCurrentSession()
        {
            var session = Opened();
            var end = session.BeginEnd();
            session.NoteEndTransportFailure();
            var retry = session.BeginEnd();
            Assert.AreEqual(end.RequestId, retry.RequestId);
            Assert.AreEqual("sess-server", end.GameplaySessionId);
            Assert.AreEqual(session.GameplaySessionId, end.GameplaySessionId);
            var json = RepWarsApiClient.SessionJson("end", "player_local", end);
            Assert.IsTrue(json.Contains("\"gameplaySessionId\":\"sess-server\""));
            Assert.IsFalse(json.Contains("sess-other"));
            session.NoteEndSucceeded();
            Assert.AreEqual(RepWarsSessionPhase.Ended, session.Phase);
            Assert.IsNull(session.BeginHeartbeat(long.MaxValue));
        }

        [Test]
        public void CrashWithoutEndIsServerLeaseExpiry()
        {
            var session = Opened();
            Assert.IsFalse(session.EndRequested);
            session.NoteSessionUnusable("expired");
            Assert.IsFalse(session.EndRequested);
            Assert.AreEqual("expired", session.LastUnusableOutcome);
            Assert.AreEqual(RepWarsSessionPhase.Expired, session.Phase);
            Assert.IsFalse(session.AcceptsRenewal);
        }

        [Test]
        public void AttackFlowKeepsItsParametersAndSessionIdentity()
        {
            var session = Opened();
            var attack = session.SubmitMutation("ATTACK", "{\"territoryId\":\"t_01\",\"commitAmount\":140}");
            var json = Body(attack);
            Assert.IsTrue(json.Contains("\"commandId\":\"ATTACK\""));
            Assert.IsTrue(json.Contains("\"territoryId\":\"t_01\""));
            Assert.IsTrue(json.Contains("\"commitAmount\":140"));
            Assert.IsTrue(json.Contains("\"commandSequence\":1"));
            Assert.IsTrue(json.Contains("\"renewalSequence\":1"));
            Assert.IsTrue(RepWarsGameplaySession.ChangesState("ATTACK"));
        }

        [Test]
        public void WorkoutFlowKeepsItsParametersAndSessionIdentity()
        {
            var session = Opened();
            var start = session.SubmitMutation("START_WORKOUT", "{\"purpose\":\"NORMAL_TROOPS\"}");
            var json = Body(start);
            Assert.IsTrue(json.Contains("\"commandId\":\"START_WORKOUT\""));
            Assert.IsTrue(json.Contains("\"purpose\":\"NORMAL_TROOPS\""));
            Assert.IsTrue(json.Contains("\"gameplaySessionId\":\"sess-server\""));
            Assert.AreEqual(1, start.CommandSequence);
            session.NoteMutationSucceeded(start, false);
            var record = session.SubmitMutation("RECORD_EXERCISE", "{\"order\":1,\"repetitions\":8,\"now\":1000}");
            Assert.AreEqual(2, record.CommandSequence);
            Assert.IsTrue(RepWarsGameplaySession.ChangesState("FINALIZE_WORKOUT"));
            Assert.IsTrue(RepWarsGameplaySession.ChangesState("SKIP_REST"));
        }

        [Test]
        public void ConstructionFlowKeepsItsParametersAndSessionIdentity()
        {
            var session = Opened();
            var build = session.SubmitMutation("START_CONSTRUCTION", "{\"territoryId\":\"t_02\",\"projectType\":\"FARM\"}");
            var json = Body(build);
            Assert.IsTrue(json.Contains("\"commandId\":\"START_CONSTRUCTION\""));
            Assert.IsTrue(json.Contains("\"territoryId\":\"t_02\""));
            Assert.IsTrue(json.Contains("\"projectType\":\"FARM\""));
            Assert.IsTrue(json.Contains("\"gameplaySessionId\":\"sess-server\""));
            Assert.IsTrue(json.Contains("\"commandSequence\":1"));
            Assert.IsFalse(json.Contains("expiresAtMs"));
        }

        static string Body(RepWarsMutation mutation)
        {
            return RepWarsApiClient.CommandJson(
                mutation.CommandId,
                "player_local",
                mutation.RequestId,
                mutation.ParametersJson,
                mutation.GameplaySessionId,
                mutation.CommandSequence,
                mutation.RenewalSequence);
        }
    }
}
