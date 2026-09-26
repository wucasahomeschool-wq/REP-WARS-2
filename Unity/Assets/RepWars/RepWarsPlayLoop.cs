using System.Collections;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.InputSystem;

namespace RepWars
{
    /// <summary>
    /// First playable loop. Sends workout and attack commands and renders the authoritative replies.
    /// Troop awards, attack legality, and battle results stay on the backend.
    /// </summary>
    public class RepWarsPlayLoop : MonoBehaviour
    {
        enum Mode
        {
            Map,
            Workout,
            Reward,
            Battle,
        }

        RepWarsMapScreen map;
        RepWarsApiClient client;
        Mode mode = Mode.Map;
        bool busy;
        bool pointerOverUi;
        int sessionClock = 120000;
        int commitAmount;
        string notice = "";
        string workoutTitle = "";
        string battleReport = "";
        string rewardReport = "";
        string resultTitle = "Result";
        bool confirmingAttack;
        bool showingDevelop;
        string confirmTerritoryId;
        bool commandFailed;
        readonly Dictionary<string, string> exerciseNames = new Dictionary<string, string>();
        readonly Dictionary<string, string> exerciseNotes = new Dictionary<string, string>();
        readonly Dictionary<string, string> workoutNames = new Dictionary<string, string>();

        public string Notice { get { return notice; } }
        public string BattleReport { get { return battleReport; } }
        public string RewardReport { get { return rewardReport; } }
        public string ResultTitle { get { return resultTitle; } }
        public string ResultBody { get { return mode == Mode.Battle ? battleReport : rewardReport; } }
        public string WorkoutTitle { get { return workoutTitle; } }
        public bool Busy { get { return busy; } }
        public bool IsWorkout { get { return mode == Mode.Workout; } }
        public bool IsResult { get { return mode == Mode.Reward || mode == Mode.Battle; } }
        public bool ConfirmingAttack { get { return confirmingAttack; } }
        public bool ShowingDevelop { get { return showingDevelop; } }
        public int CommitAmount { get { return commitAmount; } }
        public PublicGameState MapState { get { return map != null ? map.LiveState : null; } }

        void Awake()
        {
            map = GetComponent<RepWarsMapScreen>();
            client = new RepWarsApiClient(map.baseUrl);
        }

        void Update()
        {
            if (map == null) return;
            map.suppressMapInput = mode != Mode.Map || pointerOverUi || busy;
        }

        public void PressWorkOut()
        {
            if (!busy) StartCoroutine(WorkOut());
        }

        public void PressDefend()
        {
            if (!busy) StartCoroutine(Defend());
        }

        public void PressRecord()
        {
            if (!busy) StartCoroutine(RecordCurrent());
        }

        public void PressSkipRest()
        {
            if (!busy) StartCoroutine(SkipCurrentRest());
        }

        public void PressPause()
        {
            if (!busy) StartCoroutine(TogglePause());
        }

        public void PressFeedback(string value)
        {
            if (!busy) StartCoroutine(SendFeedback(value));
        }

        public void PressFinalize()
        {
            if (!busy) StartCoroutine(FinalizeWorkout());
        }

        public void PressReturn()
        {
            if (!busy) StartCoroutine(ReturnToMap());
        }

        public void BeginAttack()
        {
            if (busy) return;
            confirmingAttack = true;
            confirmTerritoryId = map.SelectedTerritoryId;
            if (commitAmount <= 0) commitAmount = Banked();
            showingDevelop = false;
        }

        public void CancelAttack()
        {
            confirmingAttack = false;
        }

        public void PressAttack()
        {
            if (!busy) StartCoroutine(AttackSelected());
        }

        public void SetDevelop(bool open)
        {
            showingDevelop = open;
            if (open) confirmingAttack = false;
        }

        public void PressConstruct(string projectType)
        {
            if (!busy) StartCoroutine(Construct(projectType));
        }

        public void PressReload()
        {
            if (!busy) StartCoroutine(Reload());
        }

        public void PressFinishWorkout()
        {
            if (!busy) StartCoroutine(FinishWorkout());
        }

        public void SetCommit(int amount)
        {
            commitAmount = Mathf.Max(0, amount);
        }

        void OnGUI()
        {
            pointerOverUi = false;
            if (confirmingAttack && map.SelectedTerritoryId != confirmTerritoryId) confirmingAttack = false;
            var scale = Mathf.Max(1f, Screen.height / 900f);
            GUI.matrix = Matrix4x4.TRS(Vector3.zero, Quaternion.identity, new Vector3(scale, scale, 1f));
            RepWarsGameInterface.Draw(this, Screen.width / scale, Screen.height / scale);
            GUI.matrix = Matrix4x4.identity;
        }

        public void MarkUi(Rect panel)
        {
            Mark(panel);
        }

        void Mark(Rect panel)
        {
            var mouse = Event.current != null ? Event.current.mousePosition : Vector2.zero;
            if (panel.Contains(mouse)) pointerOverUi = true;
            if (Mouse.current != null)
            {
                var pointer = Mouse.current.position.ReadValue();
                var gui = new Vector2(pointer.x, Screen.height - pointer.y);
                var scale = Mathf.Max(1f, Screen.height / 900f);
                if (panel.Contains(gui / scale)) pointerOverUi = true;
            }
        }

        IEnumerator Defend()
        {
            var invasion = OpenInvasion();
            if (invasion == null || string.IsNullOrEmpty(invasion.invasionId))
            {
                notice = "There is no invasion to defend.";
                yield break;
            }
            yield return StartWorkout("DEFENSE", invasion.invasionId);
        }

        IEnumerator WorkOut()
        {
            yield return StartWorkout("NORMAL_TROOPS", null);
        }

        IEnumerator StartWorkout(string purpose, string invasionId)
        {
            busy = true;
            notice = "Choosing a workout...";
            client = new RepWarsApiClient(map.baseUrl);
            if (exerciseNames.Count == 0) yield return LoadCatalog();
            RepWarsCommandResult selection = null;
            yield return client.PostCommand("GET_WORKOUT_SELECTION", map.playerId, NextId("select"), "{\"purpose\":\"" + purpose + "\"}", result => selection = result);
            if (!Ok(selection)) { busy = false; yield break; }
            workoutTitle = RepWarsJson.StringIn(RepWarsJson.Object(selection.RawJson, "workout"), "name");
            if (string.IsNullOrEmpty(workoutTitle)) workoutTitle = purpose;
            if (purpose == "DEFENSE" && string.IsNullOrEmpty(invasionId)) invasionId = InvasionId(selection.RawJson);
            var startParams = "{\"purpose\":\"" + purpose + "\"" + (string.IsNullOrEmpty(invasionId) ? "" : ",\"invasionId\":\"" + invasionId + "\"") + "}";
            RepWarsCommandResult started = null;
            yield return client.PostCommand("START_WORKOUT", map.playerId, NextId("start"), startParams, result => started = result);
            if (!Ok(started)) { busy = false; yield break; }
            var selectedId = RepWarsJson.FindString(started.RawJson, "selectedWorkoutId");
            if (!string.IsNullOrEmpty(selectedId) && workoutNames.TryGetValue(selectedId, out var named)) workoutTitle = named;
            yield return RefreshState();
            mode = Mode.Workout;
            notice = "";
            busy = false;
        }

        IEnumerator RecordCurrent()
        {
            var step = Active() != null ? Active().currentExercise : null;
            if (step == null || step.prescription == null)
            {
                notice = "This workout has no current exercise.";
                yield break;
            }
            busy = true;
            var parameters = "{\"order\":" + step.order + ",\"now\":" + NextClock() + ",";
            if (step.prescription.kind == "repetitions") parameters += "\"repetitions\":" + step.prescription.repetitions + "}";
            else parameters += "\"durationSeconds\":" + step.prescription.durationSeconds + "}";
            RepWarsCommandResult recorded = null;
            yield return client.PostCommand("RECORD_EXERCISE", map.playerId, NextId("record"), parameters, result => recorded = result);
            if (!Ok(recorded)) { busy = false; yield break; }
            yield return RefreshState();
            notice = "Exercise recorded.";
            busy = false;
        }

        IEnumerator SkipCurrentRest()
        {
            var step = Active() != null ? Active().currentExercise : null;
            if (step == null)
            {
                notice = "This workout has no current exercise.";
                yield break;
            }
            busy = true;
            RepWarsCommandResult skipped = null;
            yield return client.PostCommand("SKIP_REST", map.playerId, NextId("skip"), "{\"order\":" + step.order + ",\"now\":" + NextClock() + "}", result => skipped = result);
            if (!Ok(skipped)) { busy = false; yield break; }
            yield return RefreshState();
            notice = "Rest skipped.";
            busy = false;
        }

        IEnumerator TogglePause()
        {
            var session = Active();
            if (session == null) yield break;
            busy = true;
            var command = session.state == "PAUSED" ? "RESUME_WORKOUT" : "PAUSE_WORKOUT";
            RepWarsCommandResult toggled = null;
            yield return client.PostCommand(command, map.playerId, NextId("pause"), "{\"now\":" + NextClock() + "}", result => toggled = result);
            if (!Ok(toggled)) { busy = false; yield break; }
            yield return RefreshState();
            notice = command == "PAUSE_WORKOUT" ? "Paused." : "Resumed.";
            busy = false;
        }

        IEnumerator SendFeedback(string value)
        {
            busy = true;
            RepWarsCommandResult sent = null;
            yield return client.PostCommand("SUBMIT_WORKOUT_FEEDBACK", map.playerId, NextId("feedback"), "{\"value\":\"" + value + "\",\"now\":" + NextClock() + "}", result => sent = result);
            if (!Ok(sent)) { busy = false; yield break; }
            yield return RefreshState();
            notice = "Feedback sent.";
            busy = false;
        }

        IEnumerator FinishWorkout()
        {
            var guard = 0;
            while (guard < 40)
            {
                guard++;
                var session = Active();
                if (session == null)
                {
                    notice = "No active workout to finish.";
                    yield break;
                }
                if (session.state == "PAUSED")
                {
                    yield return TogglePause();
                    continue;
                }
                if (session.feedbackState == "FEEDBACK_REQUIRED")
                {
                    yield return SendFeedback("ABOUT_RIGHT");
                    continue;
                }
                if (session.state == "COMPLETED")
                {
                    yield return FinalizeWorkout();
                    yield break;
                }
                var step = session.currentExercise;
                if (step == null)
                {
                    notice = "Workout is " + session.state + " and has no current exercise.";
                    yield break;
                }
                if (step.isRest || step.exerciseType == "REST") yield return SkipCurrentRest();
                else yield return RecordCurrent();
                if (commandFailed) yield break;
            }
        }

        IEnumerator FinalizeWorkout()
        {
            busy = true;
            RepWarsCommandResult finalized = null;
            yield return client.PostCommand("FINALIZE_WORKOUT", map.playerId, NextId("finalize"), "{\"now\":" + NextClock() + "}", result => finalized = result);
            if (!Ok(finalized)) { busy = false; yield break; }
            var payload = RepWarsJson.Object(finalized.RawJson, "payload");
            var invasionOutcome = RepWarsJson.FindString(payload, "invasionOutcome");
            if (!string.IsNullOrEmpty(invasionOutcome))
            {
                resultTitle = DefenseTitle(invasionOutcome);
                rewardReport = resultTitle;
                yield return RefreshMap();
                mode = Mode.Reward;
                notice = "";
                busy = false;
                yield break;
            }
            var troopEffect = RepWarsJson.Object(payload, "amountOrEffect");
            var amount = RepWarsJson.FindInt(troopEffect, "amount");
            if (amount == 0) amount = RepWarsJson.FindInt(troopEffect, "bankedTroopsAfter");
            yield return RefreshMap();
            resultTitle = amount > 0 ? "+" + amount + " Troops" : "Workout complete";
            rewardReport = resultTitle + "\nTroops ready  " + Banked();
            mode = Mode.Reward;
            notice = "";
            busy = false;
        }

        static string DefenseTitle(string outcome)
        {
            if (outcome == "defense_success" || outcome == "anchor_protected") return "Territory defended";
            if (outcome == "defense_failure" || outcome == "undefended" || outcome == "defense_timeout") return "Territory lost";
            if (outcome == "defense_abandoned") return "Defense abandoned";
            return outcome.Replace('_', ' ');
        }

        IEnumerator ReturnToMap()
        {
            busy = true;
            yield return RefreshMap();
            mode = Mode.Map;
            notice = "";
            commitAmount = Banked();
            busy = false;
        }

        IEnumerator AttackSelected()
        {
            var territoryId = map.SelectedTerritoryId;
            if (string.IsNullOrEmpty(territoryId))
            {
                notice = "Select a territory first.";
                yield break;
            }
            busy = true;
            notice = "";
            client = new RepWarsApiClient(map.baseUrl);
            RepWarsCommandResult attacked = null;
            var parameters = "{\"territoryId\":\"" + territoryId + "\",\"commitAmount\":" + commitAmount + "}";
            yield return client.PostCommand("ATTACK", map.playerId, NextId("attack"), parameters, result => attacked = result);
            if (!Ok(attacked))
            {
                yield return RefreshMap();
                busy = false;
                yield break;
            }
            confirmingAttack = false;
            resultTitle = AttackTitle(attacked.RawJson);
            battleReport = resultTitle;
            yield return RefreshMap();
            mode = Mode.Battle;
            notice = "";
            busy = false;
        }

        static string AttackTitle(string json)
        {
            var payload = RepWarsJson.Object(json, "payload");
            var battle = RepWarsJson.Object(json, "battleResult");
            if (string.IsNullOrEmpty(battle)) battle = RepWarsJson.Object(payload, "battle");
            var territory = RepWarsJson.FindString(battle, "territoryOutcome");
            if (string.IsNullOrEmpty(territory)) territory = RepWarsJson.FindString(payload, "territoryOutcome");
            if (territory == "captured") return "Territory captured";
            if (territory == "unchanged") return "Territory held";
            if (territory == "contested") return "The battle was contested";
            if (string.IsNullOrEmpty(territory)) return "The attack is resolved";
            return territory.Replace('_', ' ');
        }

        IEnumerator Construct(string projectType)
        {
            var territoryId = map.SelectedTerritoryId;
            if (string.IsNullOrEmpty(territoryId))
            {
                notice = "Select a territory first.";
                yield break;
            }
            busy = true;
            notice = "";
            client = new RepWarsApiClient(map.baseUrl);
            RepWarsCommandResult started = null;
            var parameters = "{\"territoryId\":\"" + territoryId + "\",\"projectType\":\"" + projectType + "\"}";
            yield return client.PostCommand("START_CONSTRUCTION", map.playerId, NextId("build"), parameters, result => started = result);
            if (!Ok(started)) { busy = false; yield break; }
            var payload = RepWarsJson.Object(started.RawJson, "payload");
            var kind = RepWarsJson.FindString(payload, "projectType");
            if (string.IsNullOrEmpty(kind)) kind = projectType;
            resultTitle = RepWarsGameInterface.ProjectWords(kind) + " begun";
            rewardReport = resultTitle;
            showingDevelop = false;
            yield return RefreshMap();
            mode = Mode.Reward;
            notice = "";
            busy = false;
        }

        IEnumerator Reload()
        {
            busy = true;
            notice = "Reloading authoritative state...";
            client = new RepWarsApiClient(map.baseUrl);
            var before = map.LiveState;
            yield return RefreshMap();
            if (map.LiveState == null)
            {
                notice = "Reload failed.";
                busy = false;
                yield break;
            }
            notice = "";
            if (before == null) notice = "";
            busy = false;
        }

        IEnumerator LoadCatalog()
        {
            RepWarsCommandResult catalog = null;
            yield return client.PostCommand("GET_FITNESS_CATALOG", map.playerId, NextId("catalog"), result => catalog = result);
            if (catalog == null || !catalog.TransportOk) yield break;
            RepWarsJson.IndexCatalog(catalog.RawJson, exerciseNames, exerciseNotes, workoutNames);
        }

        IEnumerator RefreshState()
        {
            RepWarsCommandResult state = null;
            yield return client.GetGameState(map.playerId, result => state = result);
            if (!Ok(state)) yield break;
            if (state.Response.payload != null && state.Response.payload.gameState != null)
            {
                map.ApplySnapshot(state.Response.payload.gameState);
            }
        }

        IEnumerator RefreshMap()
        {
            if (client == null) client = new RepWarsApiClient(map.baseUrl);
            RepWarsCommandResult state = null;
            yield return client.GetGameState(map.playerId, result => state = result);
            if (!Ok(state) || state.Response.payload == null || state.Response.payload.gameState == null) yield break;
            VisibleWorldResult visible = null;
            yield return client.GetVisibleWorld(map.playerId, result => visible = result);
            if (visible == null || !visible.TransportOk)
            {
                notice = visible != null && !string.IsNullOrEmpty(visible.Failure) ? visible.Failure : "Visible world reload failed.";
                map.PresentAuthoritative(state.Response.payload.gameState, null);
                yield break;
            }
            map.PresentAuthoritative(state.Response.payload.gameState, visible.World);
        }

        bool Ok(RepWarsCommandResult result)
        {
            if (result != null && result.TransportOk)
            {
                commandFailed = false;
                return true;
            }
            commandFailed = true;
            notice = PlayerFacing(result != null ? result.Failure : "");
            return false;
        }

        static string PlayerFacing(string failure)
        {
            if (string.IsNullOrEmpty(failure)) return "That could not be done.";
            const string prefix = "Command failed: ";
            var text = failure.StartsWith(prefix) ? failure.Substring(prefix.Length) : failure;
            var space = text.IndexOf(' ');
            if (space > 0)
            {
                var head = text.Substring(0, space);
                var coded = true;
                for (var i = 0; i < head.Length; i++)
                {
                    var character = head[i];
                    if (character != '_' && !char.IsUpper(character) && !char.IsDigit(character)) coded = false;
                }
                if (coded && head.IndexOf('_') >= 0) text = text.Substring(space + 1);
            }
            if (text.StartsWith("Connection failed")) return "The empire could not be reached.";
            return text;
        }

        string ExpectedPurpose()
        {
            var tutorial = Tutorial();
            if (tutorial != null && !string.IsNullOrEmpty(tutorial.expectedPurpose)) return tutorial.expectedPurpose;
            return "NORMAL_TROOPS";
        }

        string InvasionId(string selectionJson)
        {
            var open = OpenInvasion();
            if (open != null && !string.IsNullOrEmpty(open.invasionId)) return open.invasionId;
            var tutorial = Tutorial();
            if (tutorial != null && !string.IsNullOrEmpty(tutorial.scriptedInvasionId)) return tutorial.scriptedInvasionId;
            return RepWarsJson.FindString(selectionJson, "recommendedInvasionId");
        }

        public PublicInvasion OpenInvasion()
        {
            var state = map.LiveState;
            if (state == null || state.playerGameplay == null) return null;
            var invasions = state.playerGameplay.activeInvasionsAgainstPlayer;
            if (invasions == null) return null;
            for (var i = 0; i < invasions.Length; i++)
            {
                var invasion = invasions[i];
                if (invasion != null && !string.IsNullOrEmpty(invasion.invasionId)) return invasion;
            }
            return null;
        }

        PublicTutorial Tutorial()
        {
            var state = map.LiveState;
            if (state == null) return null;
            if (state.tutorial != null && state.tutorial.active) return state.tutorial;
            if (state.playerGameplay != null) return state.playerGameplay.tutorial;
            return state.tutorial;
        }

        public PublicActiveWorkout ActiveSession()
        {
            return Active();
        }

        PublicActiveWorkout Active()
        {
            var state = map.LiveState;
            if (state == null || state.playerGameplay == null) return null;
            return state.playerGameplay.activeWorkout;
        }

        int Banked()
        {
            var state = map.LiveState;
            if (state == null || state.playerGameplay == null) return 0;
            return state.playerGameplay.bankedTroops;
        }

        public PublicTerritory SelectedTerritory()
        {
            if (map == null || string.IsNullOrEmpty(map.SelectedTerritoryId) || map.LiveState == null) return null;
            return FindTerritory(map.SelectedTerritoryId);
        }

        public string FactionName(string factionId)
        {
            if (string.IsNullOrEmpty(factionId)) return "Unclaimed";
            var state = map.LiveState;
            if (state != null && factionId == state.playerFactionId) return "You";
            if (state != null && state.factions != null)
            {
                for (var i = 0; i < state.factions.Length; i++)
                {
                    var faction = state.factions[i];
                    if (faction != null && faction.id == factionId && !string.IsNullOrEmpty(faction.name)) return faction.name;
                }
            }
            return "Another realm";
        }

        public string PlaceName(string territoryId)
        {
            var territory = FindTerritory(territoryId);
            if (territory != null && !string.IsNullOrEmpty(territory.regionName)) return territory.regionName;
            return "the territory";
        }

        public int StationedTroops(string territoryId)
        {
            var state = map.LiveState;
            if (state == null || state.armies == null) return 0;
            var total = 0;
            for (var i = 0; i < state.armies.Length; i++)
            {
                var army = state.armies[i];
                if (army != null && army.location == territoryId) total += army.troops;
            }
            return total;
        }

        public bool CityOn(string territoryId)
        {
            var play = map.LiveState != null ? map.LiveState.playerGameplay : null;
            if (play == null || play.cities == null) return false;
            for (var i = 0; i < play.cities.Length; i++)
            {
                if (play.cities[i] != null && play.cities[i].territoryId == territoryId) return true;
            }
            return false;
        }

        public PublicConstruction ConstructionOn(string territoryId)
        {
            var play = map.LiveState != null ? map.LiveState.playerGameplay : null;
            if (play == null || play.constructions == null) return null;
            for (var i = 0; i < play.constructions.Length; i++)
            {
                var project = play.constructions[i];
                if (project != null && project.territoryId == territoryId && project.status != "completed") return project;
            }
            return null;
        }

        PublicTerritory FindTerritory(string territoryId)
        {
            if (map.LiveState == null) return null;
            var territories = map.LiveState.territories;
            if (territories == null) return null;
            for (var i = 0; i < territories.Length; i++)
            {
                if (territories[i] != null && territories[i].id == territoryId) return territories[i];
            }
            return null;
        }

        string LegalTargets()
        {
            var tutorial = Tutorial();
            if (tutorial == null) return "";
            var ids = tutorial.beat == "FINAL_ATTACK_AVAILABLE" ? tutorial.finalAttackTerritoryIds : tutorial.firstAttackTerritoryIds;
            if (ids == null || ids.Length == 0) return "Backend target list is empty.";
            return "Backend targets " + string.Join(", ", ids);
        }

        public string ExerciseTitle(PublicExerciseStep step)
        {
            if (step == null || string.IsNullOrEmpty(step.exerciseId)) return "Exercise";
            if (exerciseNames.TryGetValue(step.exerciseId, out var name)) return name;
            return step.exerciseId;
        }

        public string ExerciseInstructions(PublicExerciseStep step)
        {
            if (step == null || string.IsNullOrEmpty(step.exerciseId)) return "Exercise";
            if (exerciseNotes.TryGetValue(step.exerciseId, out var notes) && !string.IsNullOrEmpty(notes)) return notes;
            return step.exerciseType + " · " + (step.isRest ? "Rest" : "Exercise");
        }

        public string PrescriptionText(PublicExerciseStep step)
        {
            if (step.prescription == null) return "No prescription";
            if (step.prescription.kind == "repetitions") return step.prescription.repetitions + " repetitions";
            return step.prescription.durationSeconds + " seconds";
        }

        string OwnershipSummary()
        {
            var lines = "";
            var territories = map.LiveState.territories;
            if (territories == null) return lines;
            for (var i = 0; i < territories.Length; i++)
            {
                var territory = territories[i];
                if (territory == null) continue;
                lines += territory.id + " " + territory.owner + "\n";
            }
            return lines;
        }

        static string DescribeBattle(string json, string territoryId)
        {
            var outcome = RepWarsJson.FindString(json, "attackOutcome");
            var battle = RepWarsJson.Object(json, "battleResult");
            var presentation = RepWarsJson.Object(json, "presentation");
            var summary = RepWarsJson.StringIn(presentation, "summary");
            var attacker = RepWarsJson.Object(battle, "attacker");
            var defender = RepWarsJson.Object(battle, "defender");
            return "Target " + territoryId
                + "\nOutcome " + outcome
                + "\nWinner " + RepWarsJson.StringIn(battle, "winner")
                + "\nTerritory " + RepWarsJson.StringIn(battle, "territoryOutcome")
                + "\nCommitted " + RepWarsJson.FindInt(json, "committedTroops")
                + "\nBanked remaining " + RepWarsJson.FindInt(json, "remainingBankedTroops")
                + "\nAttacker remaining " + RepWarsJson.FindInt(attacker, "remainingTroops")
                + "  casualties " + RepWarsJson.FindInt(RepWarsJson.Object(attacker, "casualties"), "total")
                + "\nDefender remaining " + RepWarsJson.FindInt(defender, "remainingTroops")
                + "  casualties " + RepWarsJson.FindInt(RepWarsJson.Object(defender, "casualties"), "total")
                + (string.IsNullOrEmpty(summary) ? "" : "\n" + summary);
        }

        int NextClock()
        {
            sessionClock += 1000;
            return sessionClock;
        }

        static string NextId(string prefix)
        {
            return "unity-" + prefix + "-" + System.Guid.NewGuid().ToString("N").Substring(0, 8);
        }
    }

    static class RepWarsJson
    {
        public static string FindString(string json, string key)
        {
            if (string.IsNullOrEmpty(json) || string.IsNullOrEmpty(key)) return "";
            var token = "\"" + key + "\":";
            var index = json.IndexOf(token, System.StringComparison.Ordinal);
            if (index < 0) return "";
            index += token.Length;
            while (index < json.Length && char.IsWhiteSpace(json[index])) index++;
            if (index >= json.Length || json[index] != '"') return "";
            index++;
            var end = index;
            while (end < json.Length && json[end] != '"')
            {
                if (json[end] == '\\') end++;
                end++;
            }
            return json.Substring(index, Mathf.Max(0, end - index));
        }

        public static int FindInt(string json, string key)
        {
            if (string.IsNullOrEmpty(json)) return 0;
            var token = "\"" + key + "\":";
            var index = json.IndexOf(token, System.StringComparison.Ordinal);
            if (index < 0) return 0;
            index += token.Length;
            while (index < json.Length && char.IsWhiteSpace(json[index])) index++;
            var end = index;
            if (end < json.Length && (json[end] == '-' || json[end] == '+')) end++;
            var start = end;
            while (end < json.Length && char.IsDigit(json[end])) end++;
            if (end == start) return 0;
            int value;
            return int.TryParse(json.Substring(index, end - index), out value) ? value : 0;
        }

        public static string StringIn(string json, string key)
        {
            return FindString(json, key);
        }

        public static string Object(string json, string key)
        {
            if (string.IsNullOrEmpty(json)) return "";
            var token = "\"" + key + "\":";
            var index = json.IndexOf(token, System.StringComparison.Ordinal);
            if (index < 0) return "";
            index += token.Length;
            while (index < json.Length && char.IsWhiteSpace(json[index])) index++;
            if (index >= json.Length || json[index] != '{') return "";
            var depth = 0;
            var start = index;
            for (var i = index; i < json.Length; i++)
            {
                var character = json[i];
                if (character == '"')
                {
                    i++;
                    while (i < json.Length && json[i] != '"')
                    {
                        if (json[i] == '\\') i++;
                        i++;
                    }
                    continue;
                }
                if (character == '{') depth++;
                else if (character == '}')
                {
                    depth--;
                    if (depth == 0) return json.Substring(start, i - start + 1);
                }
            }
            return "";
        }

        public static void IndexCatalog(string json, Dictionary<string, string> names, Dictionary<string, string> notes, Dictionary<string, string> workouts)
        {
            var index = 0;
            while (index < json.Length)
            {
                var idAt = json.IndexOf("\"id\":\"", index, System.StringComparison.Ordinal);
                if (idAt < 0) break;
                var id = FindString(json.Substring(idAt), "id");
                var window = json.Substring(idAt, Mathf.Min(500, json.Length - idAt));
                var name = FindString(window, "name");
                if (id.StartsWith("ex_"))
                {
                    names[id] = name;
                    var note = FindString(window, "notes");
                    if (!string.IsNullOrEmpty(note)) notes[id] = note;
                }
                else if (id.StartsWith("wk_"))
                {
                    workouts[id] = name;
                }
                index = idAt + 6;
            }
        }
    }
}
