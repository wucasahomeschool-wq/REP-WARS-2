"""Read-only configuration/source checks. Requires Python 3 and Pillow; does not execute Unity/C#."""

from collections import deque
from hashlib import sha256
import json
from pathlib import Path
import re

from PIL import Image


def verify():
    production = Path(__file__).resolve().parent.parent
    repo = production.parents[3]
    config = json.loads((production / "Editor/KnightAFront.configuration.json").read_text())
    source = repo / config["sourcePath"]
    expected_path = "assets/misc/Character Skin PNG pieces/ChatGPT Image Sep 30, 2026, 09_27_22 AM.png"
    assert config["sourcePath"] == expected_path
    assert sha256(source.read_bytes()).hexdigest() == config["sourceSha256"]
    image = Image.open(source)
    assert image.mode == "RGBA" and image.size == (1024, 1536)
    width, height = image.size
    alpha = image.getchannel("A").tobytes()
    assert (config["sourceWidth"], config["sourceHeight"]) == image.size
    contract = (production / "Runtime/MasterHumanoidRigContract.cs").read_text()
    bones = re.findall(r'new MasterHumanoidBoneDefinition\("([^"]+)", (null|"[^"]+")', contract)
    names = [name for name, _ in bones]
    assert len(names) == 20 and len(set(names)) == 20
    assert {b["name"] for b in config["bones"]} == set(names)
    assert len(config["bones"]) == len(names)
    root = next(b for b in config["bones"] if b["name"] == "Root")
    assert (root["x"], root["y"]) == (config["groundX"], config["groundY"])
    expected_sections = {"HeadNeck", "UpperTorso", "LowerTorso", "LeftUpperArm", "RightUpperArm",
                         "LeftForearmHand", "RightForearmHand", "LeftUpperLeg", "RightUpperLeg",
                         "LeftLowerLegFoot", "RightLowerLegFoot"}
    assert len(config["sections"]) == 11
    assert {s["id"] for s in config["sections"]} == expected_sections
    assert len({s["sortingOrder"] for s in config["sections"]}) == 11
    assert 8 <= config["padding"] <= 32 and config["pixelsPerUnit"] > 0
    ownership = bytearray(width * height)
    retained = bytearray(width * height)
    vertices = triangles = 0
    for section in config["sections"]:
        assert 0 <= section["minY"] <= section["seedY"] < section["maxY"] <= height
        assert 0 <= section["seedX"] < width
        assert len(section["influences"]) >= 2 and set(section["influences"]) <= set(names)
        seen = bytearray(width * height)
        seed = section["seedY"] * width + section["seedX"]
        assert alpha[seed] > 2
        queue = deque([seed])
        seen[seed] = 1
        points = []
        while queue:
            index = queue.popleft()
            points.append(index)
            assert not ownership[index], f"Sections share painted pixels: {section['id']}"
            ownership[index] = 1
            retained[index] = 1
            x, y = index % width, index // width
            for nx, ny in ((x-1, y), (x+1, y), (x, y-1), (x, y+1)):
                if not (0 <= nx < width and section["minY"] <= ny < section["maxY"]):
                    continue
                other = ny * width + nx
                if not seen[other] and alpha[other]:
                    seen[other] = 1
                    queue.append(other)
        assert sum(alpha[p] > 2 for p in points) > 10000, section["id"]
        xs, ys = [p % width for p in points], [p // width for p in points]
        pad = config["padding"]
        bounds = (min(xs)-pad, min(ys)-pad, max(xs)-min(xs)+1+2*pad, max(ys)-min(ys)+1+2*pad)
        for y in range(max(section["minY"], bounds[1]), min(section["maxY"], bounds[1]+bounds[3])):
            for x in range(max(0, bounds[0]), min(width, bounds[0]+bounds[2])):
                index = y*width+x
                if alpha[index] <= 2:
                    retained[index] = 1
        count = (section["meshColumns"]+1) * (section["meshRows"]+1)
        assert section["meshColumns"] >= 2 and section["meshRows"] >= 2 and count <= 160
        vertices += count
        triangles += section["meshColumns"] * section["meshRows"] * 2
        if section["id"].endswith("LowerLegFoot"):
            assert 0 <= config["groundY"] - (max(ys)+section["offsetY"]) <= 8
        print(f"{section['id']}: source bounds with padding={bounds}, vertices={count}, painted pixels={len(points)}")
    assert not any(value > 1 and not retained[i] for i, value in enumerate(alpha)), "Unassigned painted pixels require source review."
    assert sha256(source.read_bytes()).hexdigest() == config["sourceSha256"]
    print(f"PASS: 11 source islands/partitions; 20 calibrated bones; {vertices} vertices/{triangles} triangles configured; source unchanged.")
    print("Unity generation, C# compilation, SpriteSkin rendering, and visual deformation are NOT verified by this script.")


if __name__ == "__main__":
    verify()
