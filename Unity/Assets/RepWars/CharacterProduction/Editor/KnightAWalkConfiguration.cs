using System;
using System.Collections.Generic;
using System.IO;
using UnityEngine;

namespace RepWars.CharacterProduction.EditorTools
{
    [Serializable] public sealed class HumanoidGaitPhase
    {
        public string label;
        public float normalizedTime, stride, lift, roll;
    }
    [Serializable] public sealed class HumanoidWalkUpperMotion
    {
        public string bone;
        public float strideDegrees, liftDegrees;
        public bool useRightPhase;
    }
    [Serializable] public sealed class KnightAWalkViewDefinition
    {
        public MasterHumanoidView view;
        public string sourceSha256, skinConfigurationSha256;
        public float stridePixels, liftPixels, pelvisDropPixels, footRollDegrees;
        public int kneeBendSign;
        public HumanoidWalkUpperMotion[] upperMotions;
    }

    /// <summary>Offline contact-target authoring. IK is Editor-only baking, never gameplay or runtime locomotion.</summary>
    [Serializable]
    public sealed class KnightAWalkConfiguration
    {
        public const string AssetPath = MasterHumanoidRigBuilder.Root + "/Editor/KnightAWalk.configuration.json";
        public int version, bakeIntervals;
        public string characterId, state;
        public float duration, transitionDuration;
        public HumanoidGaitPhase[] phases;
        public KnightAWalkViewDefinition[] views;
        public string ConfigurationHash { get { return KnightASkinConfiguration.HashFile(KnightASkinConfiguration.AssetFullPath(AssetPath)); } }
        public static KnightAWalkConfiguration Load()
        {
            var recipe = JsonUtility.FromJson<KnightAWalkConfiguration>(File.ReadAllText(KnightASkinConfiguration.AssetFullPath(AssetPath)));
            if (recipe == null) throw new InvalidOperationException("Walk recipe could not be parsed.");
            var errors = recipe.Validate();
            if (errors.Count != 0) throw new InvalidOperationException(string.Join("\n",errors.ToArray()));
            return recipe;
        }
        public List<string> Validate()
        {
            var errors = new List<string>();
            if (version != 1 || characterId != "KnightA" || state != "Walk") errors.Add("Expected KnightA Walk version 1.");
            if (!HumanoidWalkContract.Finite(duration) || duration < 1f || duration > 2f ||
                !HumanoidWalkContract.Finite(transitionDuration) || transitionDuration < 0.1f || transitionDuration > 0.4f)
                errors.Add("Walk needs conservative finite cycle/handoff durations.");
            if (bakeIntervals != 128) errors.Add("This reviewed recipe uses 128 offline bake intervals, not runtime curve construction.");
            if (phases == null || phases.Length != 9) errors.Add("Eight shared gait phases plus the exact loop endpoint are required.");
            else
            {
                for (var i = 0; i < phases.Length; i++)
                {
                    var p = phases[i];
                    if (p == null || string.IsNullOrEmpty(p.label) || p.normalizedTime != i/8f || !HumanoidWalkContract.Finite(p.stride) ||
                        !HumanoidWalkContract.Finite(p.lift) || !HumanoidWalkContract.Finite(p.roll) || Mathf.Abs(p.stride) > 1f || p.lift < 0f || p.lift > 1f || Mathf.Abs(p.roll) > 1f)
                    { errors.Add("Gait phases need labeled eighth-cycle times and bounded signals."); continue; }
                    if (i <= 4 && (p.lift != 0f || p.roll != 0f)) errors.Add("Left stance half-cycle has zero lift/roll to preserve the ground-contact reference.");
                }
                var a = phases[0]; var b = phases[8];
                if (a == null || b == null || a.stride != -1f || phases[4] == null || phases[4].stride != 1f || phases[6] == null || phases[6].lift != 1f ||
                    a.stride != b.stride || a.lift != b.lift || a.roll != b.roll) errors.Add("Left/right contacts, passing peak and loop seam must be defined consistently.");
            }
            var identities = new HashSet<MasterHumanoidView>();
            if (views == null || views.Length != 3) { errors.Add("Exactly three authored Walk views are required."); return errors; }
            foreach (var view in views)
            {
                if (view == null || !Enum.IsDefined(typeof(MasterHumanoidView),view.view) || !identities.Add(view.view))
                { errors.Add("Walk view identity is invalid or duplicated."); continue; }
                var skin = KnightASkinConfiguration.Load(view.view); skin.VerifySource();
                if (view.sourceSha256 != skin.sourceSha256 || view.skinConfigurationSha256 != skin.ConfigurationHash) errors.Add(view.view + ": source/calibration provenance changed.");
                if (!PositiveWithin(view.stridePixels,40f) || !PositiveWithin(view.liftPixels,40f) || !PositiveWithin(view.pelvisDropPixels,16f) ||
                    !PositiveWithin(view.footRollDegrees,5f) || (view.kneeBendSign != 1 && view.kneeBendSign != -1)) errors.Add(view.view + ": invalid/conservative projection limits exceeded.");
                var names = new HashSet<string>();
                if (view.upperMotions == null) { errors.Add("Upper-body counter-motion is missing."); continue; }
                foreach (var motion in view.upperMotions)
                    if (motion == null || !(HumanoidIdleContract.IsAllowedBone(motion.bone) || motion.bone == "LeftForearm" || motion.bone == "RightForearm") || !names.Add(motion.bone) ||
                        !HumanoidWalkContract.Finite(motion.strideDegrees) || !HumanoidWalkContract.Finite(motion.liftDegrees) || Mathf.Abs(motion.strideDegrees)+Mathf.Abs(motion.liftDegrees) > 9f)
                        errors.Add(view.view + ": only ten intentional, bounded upper-body rotation definitions are permitted.");
                if (names.Count != 10) errors.Add(view.view + ": ten upper-body semantic bindings are required.");
                if (errors.Count != 0) continue;
                try
                {
                    var curves = BuildCurves(view,skin);
                    ValidateKinematics(view,skin,curves,errors);
                }
                catch (InvalidOperationException exception) { errors.Add(view.view + ": " + exception.Message); }
            }
            return errors;
        }
        static bool PositiveWithin(float value,float maximum) { return HumanoidWalkContract.Finite(value) && value > 0f && value <= maximum; }

        /// <summary>Shape-preserving periodic cubic semantic signals. Right limb is half a cycle later.</summary>
        public float SampleSignal(double phase, string signal)
        {
            var t = phase-Math.Floor(phase);
            var scaled = t*8d; var index = (int)scaled; var u = (float)(scaled-index);
            var a = Signal(phases[index],signal); var b = Signal(phases[index+1],signal);
            var ma = SignalSlope(index,signal)/8f; var mb = SignalSlope((index+1)%8,signal)/8f;
            return (2*u*u*u-3*u*u+1)*a + (u*u*u-2*u*u+u)*ma + (-2*u*u*u+3*u*u)*b + (u*u*u-u*u)*mb;
        }
        float SignalSlope(int index,string signal)
        {
            var value = Signal(phases[index],signal);
            var before = (value-Signal(phases[(index+7)%8],signal))*8f;
            var after = (Signal(phases[(index+1)%8],signal)-value)*8f;
            return before*after <= 0f ? 0f : 2f*before*after/(before+after);
        }
        static float Signal(HumanoidGaitPhase p,string signal)
        {
            switch (signal) { case "stride": return p.stride; case "lift": return p.lift; case "roll": return p.roll; default: throw new ArgumentException("Unknown gait signal: " + signal); }
        }
        public Dictionary<string,AnimationCurve> BuildCurves(KnightAWalkViewDefinition view,KnightASkinConfiguration skin)
        {
            var samples = new Dictionary<string,float[]>();
            foreach (var bone in HumanoidWalkContract.RotationBones) samples.Add(bone,new float[bakeIntervals+1]);
            samples.Add("PelvisY",new float[bakeIntervals+1]);
            for (var i = 0; i <= bakeIntervals; i++)
            {
                var phase = i/(double)bakeIntervals;
                // Constant small local drop gives the calibrated, almost-straight legs safe reach. No bobbing or world movement.
                samples["PelvisY"][i] = -view.pelvisDropPixels / skin.pixelsPerUnit;
                foreach (var motion in view.upperMotions)
                {
                    var time = phase + (motion.useRightPhase ? 0.5d : 0d);
                    samples[motion.bone][i] = motion.strideDegrees*SampleSignal(time,"stride") + motion.liftDegrees*SampleSignal(time,"lift");
                }
                foreach (var side in new[] { "Left","Right" })
                {
                    var time = phase + (side == "Right" ? 0.5d : 0d);
                    var leg = SolveLeg(view,skin,side,time);
                    samples[side+"Thigh"][i] = leg.x; samples[side+"Shin"][i] = leg.y; samples[side+"Foot"][i] = leg.z;
                }
            }
            var result = new Dictionary<string,AnimationCurve>();
            foreach (var pair in samples)
            {
                var keys = new Keyframe[bakeIntervals+1]; var step = duration/bakeIntervals;
                for (var i = 0; i < keys.Length; i++)
                {
                    var previous = pair.Value[(i+bakeIntervals-1)%bakeIntervals]; var next = pair.Value[(i+1)%bakeIntervals];
                    var slope = (next-previous)/(2f*step);
                    keys[i] = new Keyframe(i*step,pair.Value[i],slope,slope);
                }
                result.Add(pair.Key,new AnimationCurve(keys) { preWrapMode = WrapMode.Loop, postWrapMode = WrapMode.Loop });
            }
            return result;
        }
        // Source pixels projected into Unity's +Y-up plane; no changes to calibration/binds are made.
        static Vector2 Point(KnightASkinConfiguration skin,string name)
        {
            foreach (var bone in skin.bones) if (bone.name == name) return new Vector2(bone.x,-bone.y);
            throw new InvalidOperationException("Missing calibrated bone " + name);
        }
        public Vector3 SolveLeg(KnightAWalkViewDefinition view,KnightASkinConfiguration skin,string side,double phase)
        {
            var hip = Point(skin,side+"Thigh"); var knee = Point(skin,side+"Shin"); var ankle = Point(skin,side+"Foot");
            var u = knee-hip; var l = ankle-knee;
            var roll = view.footRollDegrees*SampleSignal(phase,"roll");
            var sole = new Vector2(0f,-(skin.groundY+ankle.y));
            var target = ankle+sole + new Vector2(view.stridePixels*SampleSignal(phase,"stride"),view.liftPixels*SampleSignal(phase,"lift")) - Rotate(sole,roll);
            hip.y -= view.pelvisDropPixels;
            var delta = target-hip; var a = (double)u.magnitude; var b = (double)l.magnitude;
            var cosine = (delta.sqrMagnitude-a*a-b*b)/(2d*a*b);
            if (cosine < -1d || cosine > 1d) throw new InvalidOperationException(side + " contact target is unreachable; adjust presentation recipe, never stretch bones.");
            var joint = view.kneeBendSign*Math.Acos(cosine);
            var upper = Math.Atan2(delta.y,delta.x)-Math.Atan2(b*Math.Sin(joint),a+b*Math.Cos(joint));
            var lower = upper+joint;
            var thigh = Mathf.DeltaAngle(Mathf.Atan2(u.y,u.x)*Mathf.Rad2Deg,(float)(upper*180d/Math.PI));
            var shin = Mathf.DeltaAngle(Mathf.Atan2(l.y,l.x)*Mathf.Rad2Deg,(float)(lower*180d/Math.PI))-thigh;
            return new Vector3(thigh,shin,roll-thigh-shin);
        }
        public Vector2 ContactPoint(KnightASkinConfiguration skin,string side,float thigh,float shin,float foot,float pelvisDrop)
        {
            var hip = Point(skin,side+"Thigh"); var knee = Point(skin,side+"Shin"); var ankle = Point(skin,side+"Foot");
            hip.y += pelvisDrop*skin.pixelsPerUnit;
            var sole = new Vector2(0f,-(skin.groundY+ankle.y));
            return hip+Rotate(knee-Point(skin,side+"Thigh"),thigh)+Rotate(ankle-knee,thigh+shin)+Rotate(sole,thigh+shin+foot);
        }
        static Vector2 Rotate(Vector2 v,float degrees)
        { var angle = degrees*Mathf.Deg2Rad; return new Vector2(v.x*Mathf.Cos(angle)-v.y*Mathf.Sin(angle),v.x*Mathf.Sin(angle)+v.y*Mathf.Cos(angle)); }
        public void ValidateKinematics(KnightAWalkViewDefinition view,KnightASkinConfiguration skin,Dictionary<string,AnimationCurve> curves,List<string> errors)
        {
            foreach (var side in new[] { "Left","Right" })
            for (var i = 0; i <= 1024; i++)
            {
                var phase = i/1024d; var time = (float)phase*duration;
                var thigh = curves[side+"Thigh"].Evaluate(time); var shin = curves[side+"Shin"].Evaluate(time); var foot = curves[side+"Foot"].Evaluate(time);
                if (Mathf.Abs(thigh) > 28f || Mathf.Abs(shin) > 48f || Mathf.Abs(foot) > 48f)
                { errors.Add(view.view + "/" + side + ": conservative joint limits exceeded."); break; }
                var actual = ContactPoint(skin,side,thigh,shin,foot,curves["PelvisY"].Evaluate(time));
                var signalTime = phase + (side == "Right" ? 0.5d : 0d);
                var expected = new Vector2(Point(skin,side+"Foot").x+view.stridePixels*SampleSignal(signalTime,"stride"),-skin.groundY+view.liftPixels*SampleSignal(signalTime,"lift"));
                if (Vector2.Distance(actual,expected) > 0.25f) { errors.Add(view.view + "/" + side + ": baked contact error exceeds 0.25 source pixel."); break; }
            }
        }
    }
}
