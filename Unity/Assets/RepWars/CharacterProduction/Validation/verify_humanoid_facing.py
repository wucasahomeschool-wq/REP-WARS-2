"""Read-only checks of the locked C# facing contract. Does not execute C# or Unity."""

from pathlib import Path
import re


def verify():
    production = Path(__file__).resolve().parent.parent
    contract = (production / "Runtime/HumanoidFacingContract.cs").read_text()
    expected = {
        "FrontLeft": ("Front", False),
        "FrontRight": ("Front", True),
        "Left": ("Side", False),
        "Right": ("Side", True),
        "BackLeft": ("Back", False),
        "BackRight": ("Back", True),
    }
    enum_body = re.search(r"public enum HumanoidFacing\s*\{([^}]+)\}", contract).group(1)
    entries = re.findall(r"(\w+)\s*=\s*(\d+)", enum_body)
    assert entries == [(name, str(index)) for index, name in enumerate(expected)]
    mapped = re.findall(
        r"case HumanoidFacing\.(\w+): selection = new HumanoidFacingSelection"
        r"\(MasterHumanoidView\.(\w+), (true|false)\); return true;", contract)
    assert len(mapped) == 6
    assert {name: (view, mirrored == "true") for name, view, mirrored in mapped} == expected
    assert "default: selection = default(HumanoidFacingSelection); return false;" in contract
    presentation = (production / "Runtime/HumanoidFacingPresentation.cs").read_text()
    assert "return intent.HasValue && TrySetFacing(intent.Value);" in presentation
    assert "rig.VisualRoot.localScale = scale;" in presentation
    assert "scale.x = selection.Mirrored ? -scale.x : scale.x;" in presentation
    assert "view != selection.View" in presentation
    assert "rig.GetViewRoot(selection.View).gameObject.SetActive(true);" in presentation
    assert not re.search(r"(?:flipX|flipY|sortingOrder)\s*=", presentation)
    assert not re.search(r"\b(?:Update|FixedUpdate|LateUpdate)\s*\(", presentation)
    assert ".position =" not in presentation and ".localPosition =" not in presentation
    definition = (production / "Runtime/HumanoidFacingDefinition.cs").read_text()
    assert "canonical.Mirrored ^ reverse" in definition
    assert "new HumanoidFacingSelection(canonical.View," in definition
    assert "HumanoidFacingContract.TryResolve(facing, out canonical)" in definition
    assert "default(HumanoidFacingDefinition), out error" in presentation
    assert "return definition.TryResolve(intent, out selection);" in presentation
    assert "!TryResolveFacing(intent, out selection)" in presentation
    assert "[SerializeField] HumanoidFacing facing = HumanoidFacing.FrontLeft;" in presentation
    assert "[SerializeField] Vector3 unmirroredVisualScale = Vector3.one;" in presentation
    assert len(re.findall(r'\[SerializeField\] bool \w+;', definition)) == 3
    builder = (production / "Editor/KnightAFacingProofBuilder.cs").read_text()
    assembly = (production / "Editor/HumanoidFacingProofAssembly.cs").read_text()
    assert "Instantiate(source.Rig.GetViewRoot(view).gameObject, rig.VisualRoot, false)" in assembly
    assert "HumanoidFacingProofAssembly.AssembleViews(rig, KnightASkinBuilder.ProofPrefabPathFor," in builder
    assert "view => KnightASkinConfiguration.Load(view), root => root.AddComponent<KnightASkin>()" in builder
    assert "KnightASkinBuilder.CreateProof(view);" in builder
    assert "foreach (HumanoidFacing facing in Enum.GetValues(typeof(HumanoidFacing)))" in builder
    assert "KnightASkinValidator.Validate(skin, KnightASkinConfiguration.Load(view), false, allowedAnimator)" in builder
    print("PASS: six unchanged Knight A mappings, default definition compatibility, invalid/null retention, VisualRoot mirror boundary, shared three-view proof path (source checks).")
    print("C# execution, Unity compilation, prefab generation, SpriteSkin mirroring, and visual quality are NOT verified.")


if __name__ == "__main__":
    verify()
