using UnityEngine;

namespace RepWars
{
    /// <summary>
    /// Player-facing map chrome. Reads the live snapshot and calls the existing command flow.
    /// </summary>
    public static class RepWarsGameInterface
    {
        static GUIStyle titleStyle;
        static GUIStyle bodyStyle;
        static GUIStyle chipStyle;
        static GUIStyle buttonStyle;
        static GUIStyle goldButtonStyle;
        static bool stylesReady;

        public static void Draw(RepWarsPlayLoop loop, float width, float height)
        {
            EnsureStyles();
            if (loop.IsWorkout) DrawWorkout(loop, width, height);
            else if (loop.IsResult) DrawResult(loop, width, height);
            else DrawMap(loop, width, height);
        }

        static void DrawMap(RepWarsPlayLoop loop, float width, float height)
        {
            var state = loop.MapState;
            DrawTopBar(loop, state, width);
            DrawResourceBar(loop, state, width, height);
            var invasion = loop.OpenInvasion();
            if (invasion != null) DrawInvasionBanner(loop, state, invasion, width);
            var territory = loop.SelectedTerritory();
            if (territory != null) DrawTerritoryPanel(loop, state, territory, width, height);
            if (!string.IsNullOrEmpty(loop.Notice) && territory == null && invasion == null)
            {
                var note = new Rect(16, 78, Mathf.Min(420, width - 32), 64);
                Panel(note);
                GUI.Label(new Rect(note.x + 12, note.y + 16, note.width - 24, 36), loop.Notice, bodyStyle);
                loop.MarkUi(note);
            }
        }

        static void DrawTopBar(RepWarsPlayLoop loop, PublicGameState state, float width)
        {
            var bar = new Rect(12, 10, Mathf.Min(width - 24, 520), 58);
            Panel(bar);
            loop.MarkUi(bar);
            var level = state == null ? "Rep Wars" : (string.IsNullOrEmpty(state.worldName) ? "Level " + state.worldLevel : state.worldName);
            GUI.Label(new Rect(bar.x + 14, bar.y + 8, 220, 24), level, titleStyle);
            var fitness = "Fitness —";
            if (state != null && state.playerGameplay != null && state.playerGameplay.fitnessKnown)
            {
                fitness = "Fitness " + state.playerGameplay.fitnessLevel;
            }
            GUI.Label(new Rect(bar.x + 14, bar.y + 30, 220, 20), fitness, bodyStyle);
            var troops = state != null && state.playerGameplay != null ? state.playerGameplay.bankedTroops : 0;
            GUI.Label(new Rect(bar.x + bar.width - 160, bar.y + 16, 146, 28), "Troops  " + troops, titleStyle);
        }

        static void DrawResourceBar(RepWarsPlayLoop loop, PublicGameState state, float width, float height)
        {
            var resources = state != null && state.playerGameplay != null ? state.playerGameplay.resources : null;
            var bar = new Rect(12, height - 62, width - 24, 50);
            Panel(bar);
            loop.MarkUi(bar);
            var labels = new[]
            {
                "Gold " + Amount(resources, "gold"),
                "Food " + Amount(resources, "food"),
                "Iron " + Amount(resources, "iron"),
                "Wood " + Amount(resources, "wood"),
                "Stone " + Amount(resources, "stone"),
            };
            var slot = (bar.width - 16) / labels.Length;
            for (var i = 0; i < labels.Length; i++)
            {
                GUI.Label(new Rect(bar.x + 8 + slot * i, bar.y + 14, slot - 6, 24), labels[i], chipStyle);
            }
        }

        static void DrawInvasionBanner(RepWarsPlayLoop loop, PublicGameState state, PublicInvasion invasion, float width)
        {
            var banner = new Rect(12, 76, Mathf.Min(width - 24, 460), 92);
            Panel(banner);
            loop.MarkUi(banner);
            var place = loop.PlaceName(invasion.territoryId);
            var attacker = loop.FactionName(invasion.attackerFactionId);
            GUI.Label(new Rect(banner.x + 12, banner.y + 8, banner.width - 24, 22), "Incoming invasion", titleStyle);
            GUI.Label(new Rect(banner.x + 12, banner.y + 30, banner.width - 140, 40),
                attacker + " marches on " + place + "\n" + StatusWords(invasion) + "   " + invasion.remainingResponseTicks + " left",
                bodyStyle);
            if (!invasion.defenseInProgress && GUI.Button(new Rect(banner.x + banner.width - 118, banner.y + 28, 100, 40), "DEFEND", goldButtonStyle))
            {
                loop.PressDefend();
            }
        }

        static void DrawTerritoryPanel(RepWarsPlayLoop loop, PublicGameState state, PublicTerritory territory, float width, float height)
        {
            var panel = new Rect(width - 332, 76, 320, Mathf.Min(520, height - 150));
            Panel(panel);
            loop.MarkUi(panel);
            GUILayout.BeginArea(new Rect(panel.x + 14, panel.y + 12, panel.width - 28, panel.height - 20));
            GUILayout.Label(string.IsNullOrEmpty(territory.regionName) ? "Territory" : territory.regionName, titleStyle);
            GUILayout.Label(Relation(loop, state, territory), bodyStyle);
            GUILayout.Label(TerrainWords(territory.terrain), bodyStyle);
            GUILayout.Label("Stationed troops  " + loop.StationedTroops(territory.id), bodyStyle);
            GUILayout.Label("Fortification  " + territory.fortification, bodyStyle);
            GUILayout.Label(YieldLine(territory.resourceOutput), bodyStyle);
            GUILayout.Label(DevelopmentLine(territory, loop.CityOn(territory.id)), bodyStyle);
            var project = loop.ConstructionOn(territory.id);
            if (project != null) GUILayout.Label(ProjectWords(project.projectType) + " underway", bodyStyle);
            GUILayout.Space(8);
            if (!string.IsNullOrEmpty(loop.Notice)) GUILayout.Label(loop.Notice, bodyStyle);
            DrawActions(loop, state, territory);
            GUILayout.EndArea();
        }

        static void DrawActions(RepWarsPlayLoop loop, PublicGameState state, PublicTerritory territory)
        {
            var relation = RelationKind(state, territory);
            if (relation == "yours")
            {
                if (GUILayout.Button("WORK OUT", buttonStyle, GUILayout.Height(46))) loop.PressWorkOut();
                if (GUILayout.Button(loop.ShowingDevelop ? "CLOSE DEVELOP" : "DEVELOP", buttonStyle, GUILayout.Height(42)))
                {
                    loop.SetDevelop(!loop.ShowingDevelop);
                }
                if (loop.ShowingDevelop)
                {
                    if (GUILayout.Button("City", buttonStyle, GUILayout.Height(36))) loop.PressConstruct("CITY");
                    if (GUILayout.Button("Farm", buttonStyle, GUILayout.Height(36))) loop.PressConstruct("FARM");
                    if (GUILayout.Button("Mine", buttonStyle, GUILayout.Height(36))) loop.PressConstruct("MINE");
                    if (GUILayout.Button("Lumber", buttonStyle, GUILayout.Height(36))) loop.PressConstruct("LUMBER");
                }
                if (GUILayout.Button("FORTIFY", buttonStyle, GUILayout.Height(42))) loop.PressConstruct("FORTIFICATION");
                return;
            }
            if (relation == "enemy")
            {
                if (!loop.ConfirmingAttack)
                {
                    if (GUILayout.Button("ATTACK", goldButtonStyle, GUILayout.Height(46))) loop.BeginAttack();
                    return;
                }
                GUILayout.Label("Commit troops", bodyStyle);
                GUILayout.BeginHorizontal();
                if (GUILayout.Button("-", buttonStyle, GUILayout.Width(48), GUILayout.Height(40))) loop.SetCommit(loop.CommitAmount - 10);
                GUILayout.Label(loop.CommitAmount.ToString(), titleStyle, GUILayout.Height(40));
                if (GUILayout.Button("+", buttonStyle, GUILayout.Width(48), GUILayout.Height(40))) loop.SetCommit(loop.CommitAmount + 10);
                GUILayout.EndHorizontal();
                if (GUILayout.Button("CONFIRM ATTACK", goldButtonStyle, GUILayout.Height(46))) loop.PressAttack();
                if (GUILayout.Button("CANCEL", buttonStyle, GUILayout.Height(36))) loop.CancelAttack();
                return;
            }
            GUILayout.Label("No orders can be given here.", bodyStyle);
        }

        static void DrawWorkout(RepWarsPlayLoop loop, float width, float height)
        {
            var panel = new Rect(24, 24, Mathf.Min(640, width - 48), height - 48);
            Panel(panel);
            loop.MarkUi(panel);
            GUILayout.BeginArea(new Rect(panel.x + 18, panel.y + 16, panel.width - 36, panel.height - 28));
            GUILayout.Label(string.IsNullOrEmpty(loop.WorkoutTitle) ? "Workout" : loop.WorkoutTitle, titleStyle);
            var session = loop.ActiveSession();
            if (session == null)
            {
                GUILayout.Label(loop.Notice, bodyStyle);
            }
            else
            {
                var total = session.prescribedExercises != null ? session.prescribedExercises.Length : 0;
                var step = session.currentExercise;
                if (step != null)
                {
                    GUILayout.Label("Exercise " + (step.order + 1) + " of " + total, bodyStyle);
                    GUILayout.Label(loop.ExerciseTitle(step), titleStyle);
                    GUILayout.Label(loop.ExerciseInstructions(step), bodyStyle);
                    GUILayout.Label(loop.PrescriptionText(step), bodyStyle);
                    GUILayout.Space(8);
                    if (step.isRest || step.exerciseType == "REST")
                    {
                        if (GUILayout.Button("SKIP REST", buttonStyle, GUILayout.Height(44))) loop.PressSkipRest();
                    }
                    if (GUILayout.Button(step.isRest ? "FINISH REST" : "DONE", goldButtonStyle, GUILayout.Height(48))) loop.PressRecord();
                    if (GUILayout.Button(session.state == "PAUSED" ? "RESUME" : "PAUSE", buttonStyle, GUILayout.Height(40))) loop.PressPause();
                }
                else if (session.feedbackState == "FEEDBACK_REQUIRED")
                {
                    GUILayout.Label("How hard was this workout?", bodyStyle);
                    Feedback(loop, "TOO EASY", "TOO_EASY");
                    Feedback(loop, "EASY", "EASY");
                    Feedback(loop, "ABOUT RIGHT", "ABOUT_RIGHT");
                    Feedback(loop, "HARD", "HARD");
                    Feedback(loop, "TOO HARD", "TOO_HARD");
                }
                else if (session.state == "COMPLETED")
                {
                    GUILayout.Label("Finish to receive what the empire grants.", bodyStyle);
                    if (GUILayout.Button("FINISH", goldButtonStyle, GUILayout.Height(48))) loop.PressFinalize();
                }
                else GUILayout.Label(loop.Notice, bodyStyle);
            }
            if (!string.IsNullOrEmpty(loop.Notice)) GUILayout.Label(loop.Notice, bodyStyle);
            GUILayout.EndArea();
        }

        static void Feedback(RepWarsPlayLoop loop, string label, string value)
        {
            if (GUILayout.Button(label, buttonStyle, GUILayout.Height(38))) loop.PressFeedback(value);
        }

        static void DrawResult(RepWarsPlayLoop loop, float width, float height)
        {
            var panel = new Rect(24, 24, Mathf.Min(640, width - 48), height - 48);
            Panel(panel);
            loop.MarkUi(panel);
            GUILayout.BeginArea(new Rect(panel.x + 18, panel.y + 16, panel.width - 36, panel.height - 28));
            GUILayout.Label(loop.ResultTitle, titleStyle);
            GUILayout.Space(8);
            GUILayout.Label(loop.ResultBody, bodyStyle);
            GUILayout.Space(12);
            if (GUILayout.Button("RETURN TO MAP", goldButtonStyle, GUILayout.Height(48))) loop.PressReturn();
            GUILayout.EndArea();
        }

        static void Panel(Rect rect)
        {
            var previous = GUI.color;
            GUI.color = new Color(0.09f, 0.06f, 0.07f, 0.94f);
            GUI.DrawTexture(rect, Texture2D.whiteTexture);
            GUI.color = new Color(0.78f, 0.63f, 0.35f, 1f);
            GUI.DrawTexture(new Rect(rect.x, rect.y, rect.width, 2), Texture2D.whiteTexture);
            GUI.DrawTexture(new Rect(rect.x, rect.yMax - 2, rect.width, 2), Texture2D.whiteTexture);
            GUI.color = previous;
        }

        static void EnsureStyles()
        {
            if (stylesReady) return;
            titleStyle = new GUIStyle(GUI.skin.label);
            titleStyle.fontSize = 20;
            titleStyle.fontStyle = FontStyle.Bold;
            titleStyle.normal.textColor = new Color(0.95f, 0.90f, 0.78f);
            titleStyle.wordWrap = true;
            bodyStyle = new GUIStyle(GUI.skin.label);
            bodyStyle.fontSize = 16;
            bodyStyle.normal.textColor = new Color(0.95f, 0.90f, 0.78f);
            bodyStyle.wordWrap = true;
            chipStyle = new GUIStyle(bodyStyle);
            chipStyle.fontSize = 15;
            buttonStyle = new GUIStyle(GUI.skin.button);
            buttonStyle.fontSize = 16;
            buttonStyle.fontStyle = FontStyle.Bold;
            buttonStyle.normal.textColor = new Color(0.95f, 0.90f, 0.78f);
            buttonStyle.normal.background = Solid(new Color(0.32f, 0.12f, 0.16f, 1f));
            buttonStyle.hover.background = buttonStyle.normal.background;
            buttonStyle.active.background = buttonStyle.normal.background;
            goldButtonStyle = new GUIStyle(buttonStyle);
            goldButtonStyle.normal.textColor = new Color(0.16f, 0.10f, 0.06f);
            goldButtonStyle.normal.background = Solid(new Color(0.78f, 0.63f, 0.35f, 1f));
            goldButtonStyle.hover.background = goldButtonStyle.normal.background;
            goldButtonStyle.active.background = goldButtonStyle.normal.background;
            stylesReady = true;
        }

        static Texture2D Solid(Color color)
        {
            var texture = new Texture2D(1, 1);
            texture.SetPixel(0, 0, color);
            texture.Apply();
            return texture;
        }

        static string Amount(PublicResources resources, string key)
        {
            if (resources == null) return "—";
            switch (key)
            {
                case "gold": return resources.gold.ToString();
                case "food": return resources.food.ToString();
                case "iron": return resources.iron.ToString();
                case "wood": return resources.wood.ToString();
                case "stone": return resources.stone.ToString();
                default: return "—";
            }
        }

        static string Relation(RepWarsPlayLoop loop, PublicGameState state, PublicTerritory territory)
        {
            var kind = RelationKind(state, territory);
            if (kind == "yours") return "Your territory";
            if (kind == "enemy") return loop.FactionName(territory.owner);
            if (string.IsNullOrEmpty(territory.owner)) return "Unclaimed";
            return loop.FactionName(territory.owner);
        }

        static string RelationKind(PublicGameState state, PublicTerritory territory)
        {
            if (state == null || territory == null) return "other";
            if (!string.IsNullOrEmpty(territory.owner) && territory.owner == state.playerFactionId) return "yours";
            if (!string.IsNullOrEmpty(territory.owner)) return "enemy";
            return "other";
        }

        static string TerrainWords(string terrain)
        {
            if (string.IsNullOrEmpty(terrain)) return "Terrain unknown";
            return char.ToUpper(terrain[0]) + terrain.Substring(1);
        }

        static string YieldLine(PublicResources output)
        {
            if (output == null) return "No listed yield";
            var text = "";
            text = AppendYield(text, "Gold", output.gold);
            text = AppendYield(text, "Food", output.food);
            text = AppendYield(text, "Iron", output.iron);
            text = AppendYield(text, "Wood", output.wood);
            text = AppendYield(text, "Stone", output.stone);
            return string.IsNullOrEmpty(text) ? "No listed yield" : "Yield  " + text;
        }

        static string AppendYield(string text, string name, int amount)
        {
            if (amount == 0) return text;
            if (text.Length > 0) text += ", ";
            return text + name + " " + amount;
        }

        static string DevelopmentLine(PublicTerritory territory, bool city)
        {
            var text = "";
            if (city) text = Join(text, "City");
            if (territory.farm) text = Join(text, "Farm");
            if (territory.mine) text = Join(text, "Mine");
            if (territory.lumber) text = Join(text, "Lumber");
            return string.IsNullOrEmpty(text) ? "Undeveloped" : text;
        }

        static string Join(string text, string part)
        {
            return string.IsNullOrEmpty(text) ? part : text + ", " + part;
        }

        static string StatusWords(PublicInvasion invasion)
        {
            if (invasion.defenseInProgress) return "Defense underway";
            if (invasion.status == "pending_response") return "Awaiting defense";
            if (string.IsNullOrEmpty(invasion.status)) return "Invasion";
            return invasion.status.Replace('_', ' ');
        }

        public static string ProjectWords(string projectType)
        {
            switch (projectType)
            {
                case "CITY": return "City";
                case "FARM": return "Farm";
                case "MINE": return "Mine";
                case "LUMBER": return "Lumber";
                case "FORTIFICATION": return "Fortification";
                default: return "Work";
            }
        }
    }
}
