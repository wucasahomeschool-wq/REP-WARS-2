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
    builder = (production / "Editor/KnightAFacingProofBuilder.cs").read_text()
    assert "Instantiate(source.Rig.GetViewRoot(view).gameObject, rig.VisualRoot, false)" in builder
    assert "KnightASkinBuilder.CreateProof(view);" in builder
    assert "foreach (HumanoidFacing facing in Enum.GetValues(typeof(HumanoidFacing)))" in builder
    assert "KnightASkinValidator.Validate(skin, KnightASkinConfiguration.Load(view), false)" in builder
    print("PASS: six locked mappings, invalid rejection, null-intent retention, VisualRoot mirror boundary, and three-view proof path.")
    print("C# execution, Unity compilation, prefab generation, SpriteSkin mirroring, and visual quality are NOT verified.")


if __name__ == "__main__":
    verify()
