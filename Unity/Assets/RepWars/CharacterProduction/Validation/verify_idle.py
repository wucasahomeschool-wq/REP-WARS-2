"""Read-only idle recipe/source/reference checks. No C#, Unity, clip or visual execution is claimed."""
from hashlib import sha256
import json
from math import cos, sin, radians, isclose
from pathlib import Path
import re
import subprocess


def curve_value(recipe, motion, phase):
    for a, b in zip(recipe["phases"],recipe["phases"][1:]):
        if a["normalizedTime"] <= phase <= b["normalizedTime"]:
            t = (phase-a["normalizedTime"])/(b["normalizedTime"]-a["normalizedTime"])
            smooth = t*t*(3-2*t)
            va = motion["breathDegrees"]*a["breath"]+motion["settleDegrees"]*a["settle"]
            vb = motion["breathDegrees"]*b["breath"]+motion["settleDegrees"]*b["settle"]
            return va+(vb-va)*smooth
    raise AssertionError("Phase outside the idle cycle")


def verify():
    production = Path(__file__).resolve().parent.parent
    repo = production.parents[3]
    recipe = json.loads((production/"Editor/KnightAIdle.configuration.json").read_text())
    assert (recipe["version"],recipe["characterId"],recipe["state"]) == (1,"KnightA","Idle")
    assert recipe["duration"] == 4.8 and len(recipe["phases"]) == 6
    phases = recipe["phases"]
    assert phases[0] == dict(normalizedTime=0,breath=0,settle=0)
    assert phases[-1] == dict(normalizedTime=1,breath=0,settle=0)
    assert all(b["normalizedTime"]-a["normalizedTime"] >= .05 for a,b in zip(phases,phases[1:]))
    assert all(abs(p["breath"]) <= 1 and abs(p["settle"]) <= 1 for p in phases)
    allowed = {"Spine","Chest","Neck","Head","LeftClavicle","RightClavicle","LeftUpperArm","RightUpperArm"}
    contract = (production/"Runtime/MasterHumanoidRigContract.cs").read_text()
    hierarchy = re.findall(r'new MasterHumanoidBoneDefinition\("([^"]+)", (null|"[^"]+")',contract)
    assert len(hierarchy) == 20
    names = [name for name,_ in hierarchy]
    assert [v["view"] for v in recipe["views"]] == [0,1,2]
    for view, view_name in zip(recipe["views"],("Front","Side","Back")):
        file = production/f"Editor/KnightA{view_name}.configuration.json"
        skin = json.loads(file.read_text())
        assert view["skinConfigurationSha256"] == sha256(file.read_bytes()).hexdigest()
        assert file.read_bytes() == subprocess.check_output(["git","show","HEAD:"+str(file.relative_to(repo))],cwd=repo)
        assert view["sourceSha256"] == skin["sourceSha256"] == sha256((repo/skin["sourcePath"]).read_bytes()).hexdigest()
        motions = {m["bone"]:m for m in view["motions"]}
        assert len(view["motions"]) == 8 and motions.keys() == allowed
        for motion in motions.values():
            assert abs(motion["breathDegrees"])+abs(motion["settleDegrees"]) <= .75
            assert curve_value(recipe,motion,0) == curve_value(recipe,motion,1) == 0
            assert all(abs(curve_value(recipe,motion,n/1000)) <= .75 for n in range(1001))
        points = {b["name"]:(b["x"],b["y"]) for b in skin["bones"]}
        def pose(phase):
            output = {}
            for name, raw_parent in hierarchy:
                parent = None if raw_parent == "null" else raw_parent.strip('"')
                angle = curve_value(recipe,motions[name],phase) if name in motions else 0
                if parent is None:
                    output[name] = (*points[name],radians(angle))
                else:
                    px,py,pa = output[parent]
                    dx,dy = points[name][0]-points[parent][0],points[name][1]-points[parent][1]
                    output[name] = (px+dx*cos(pa)-dy*sin(pa),py+dx*sin(pa)+dy*cos(pa),pa+radians(angle))
            return output
        neutral = pose(0)
        for phase in (0,.17,.37,.60,.81,.999999,1):
            posed = pose(phase)
            for bone in ("Root","Pelvis","LeftThigh","RightThigh","LeftShin","RightShin","LeftFoot","RightFoot"):
                assert all(isclose(a,b,abs_tol=1e-10) for a,b in zip(neutral[bone],posed[bone]))
        print(f"PASS {view_name}: eight restrained rotation definitions, matching loop endpoints, unchanged calibration/source and static lower-body reference chains")
    assert len({tuple((m["breathDegrees"],m["settleDegrees"]) for m in v["motions"]) for v in recipe["views"]}) == 3

    runtime = (production/"Runtime/HumanoidIdlePresentation.cs").read_text()
    builder = (production/"Editor/KnightAIdleProofBuilder.cs").read_text()
    facing = (production/"Runtime/HumanoidFacingPresentation.cs").read_text()
    assert "DirectorUpdateMode.Manual" in runtime and "Time.deltaTime" in runtime
    assert "FacingChanged += OnFacingChanged" in runtime and "FacingChanged?.Invoke(facing)" in facing
    assert "if (IsPlaying) Sample();" in runtime
    assert "normalizedPhase * profile.Duration" in runtime and "graph.Evaluate(0f)" in runtime
    assert "binding.bone.localRotation = binding.neutralLocalRotation" in runtime
    assert not re.search(r'\.(?:position|localPosition|localScale)\s*=',runtime)
    assert "MaterialPropertyBlock" not in runtime and "Random" not in runtime and "GameState" not in runtime
    assert '"localEulerAnglesRaw.z"' in builder and 'CalculateTransformPath(bone,rig.GetViewRoot(view.view))' in builder
    assert "settings.loopTime = true" in builder and "animator.applyRootMotion = false" in builder
    assert "AnimatorController" not in builder and "FrontRight_Idle" not in builder and "Right_Idle" not in builder
    for relative in ("Runtime/SelectiveTeamColorPresentation.cs","Rendering/SelectiveTeamColorUnlit.shader","Editor/KnightATeamColor.configuration.json",
                     "Runtime/MasterHumanoidRigContract.cs","Editor/KnightASkinBuilder.cs","Editor/KnightASkinGeometry.cs"):
        path = production/relative
        assert path.read_bytes() == subprocess.check_output(["git","show","HEAD:"+str(path.relative_to(repo))],cwd=repo)
    for source in (repo/"assets/misc/Character Skin PNG pieces").glob("*.png"):
        assert source.read_bytes() == subprocess.check_output(["git","show","HEAD:"+str(source.relative_to(repo))],cwd=repo)
    print("PASS three-view/shared-phase/whole-rig-facing source boundary; unchanged source PNGs, team-color rendering, mesh/weight generation and Master Humanoid contract")
    print("Unity compilation, generated clips/profile/prefab, Playable sampling, SpriteSkin rendering, visual loop quality and mobile performance are NOT verified.")


if __name__ == "__main__":
    verify()
