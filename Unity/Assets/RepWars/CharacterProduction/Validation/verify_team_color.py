"""Read-only Phase 6 source/configuration/reference checks. Does NOT execute C#, shaders or Unity.

Requires Python 3 and Pillow, as does the existing skin verifier. No outputs are written.
"""
from collections import deque
from hashlib import sha256
import json
from math import hypot
from pathlib import Path
import random
import subprocess

from PIL import Image
from verify_knight_a_skins import build_ownership


def coverage(points, feather, x, y):
    inside, distance = False, float("inf")
    for a, b in zip(points, points[1:] + points[:1]):
        ax, ay = a["x"], a["y"]
        bx, by = b["x"], b["y"]
        if (ay > y) != (by > y) and x < (bx-ax)*(y-ay)/(by-ay)+ax:
            inside = not inside
        dx, dy = bx-ax, by-ay
        t = min(1, max(0, ((x-ax)*dx+(y-ay)*dy)/(dx*dx+dy*dy)))
        distance = min(distance, hypot(x-ax-dx*t, y-ay-dy*t))
    if not inside:
        return 0.0
    if feather <= 0:
        return 1.0
    t = min(1, distance/feather)
    return t*t*(3-2*t)


def extract_bounds(config, section, alpha, ownership):
    width, height = config["sourceWidth"], config["sourceHeight"]
    if ownership is not None:
        identity = config["sections"].index(section)+1
        indices = {i for i, value in enumerate(ownership) if value == identity}
    else:
        seed = section["seedY"]*width+section["seedX"]
        indices, queue = {seed}, deque([seed])
        while queue:
            i = queue.popleft()
            x, y = i % width, i // width
            for nx, ny in ((x-1,y),(x+1,y),(x,y-1),(x,y+1)):
                if not (0 <= nx < width and section["minY"] <= ny < section["maxY"]):
                    continue
                other = ny*width+nx
                if other not in indices and alpha[other]:
                    indices.add(other)
                    queue.append(other)
    xs, ys = [i % width for i in indices], [i // width for i in indices]
    pad = config["padding"]
    minx, miny = max(0,min(xs)-pad), max(0,min(ys)-pad)
    maxx, maxy = min(width,max(xs)+1+pad), min(height,max(ys)+1+pad)
    return (minx,miny,maxx-minx,maxy-miny), indices


def verify():
    production = Path(__file__).resolve().parent.parent
    repo = production.parents[3]
    recipe = json.loads((production/"Editor/KnightATeamColor.configuration.json").read_text())
    assert recipe["version"] == 1 and recipe["characterId"] == "KnightA"
    assert [v["view"] for v in recipe["views"]] == [0,1,2]
    generated_count = 0
    for view, name in zip(recipe["views"], ("Front","Side","Back")):
        skin_file = production/f"Editor/KnightA{name}.configuration.json"
        skin = json.loads(skin_file.read_text())
        source_file = repo/skin["sourcePath"]
        assert view["sourceSha256"] == skin["sourceSha256"] == sha256(source_file.read_bytes()).hexdigest()
        assert view["skinConfigurationSha256"] == sha256(skin_file.read_bytes()).hexdigest()
        assert len(view["sections"]) == 11
        assert {s["sectionId"] for s in view["sections"]} == {s["id"] for s in skin["sections"]}
        image = Image.open(source_file)
        assert image.size == (1024,1536) and image.mode == "RGBA"
        alpha = image.getchannel("A").tobytes()
        ownership = build_ownership(skin,alpha,1024,1536)
        for section in view["sections"]:
            assert section["reviewNote"]
            if not section["polygons"]:
                assert "REQUIRES HUMAN VISUAL REVIEW" in section["reviewNote"]
                continue
            assert section["sectionId"] == "LowerTorso", "Any wider initial designation needs a deliberate reviewed recipe change."
            definition = next(s for s in skin["sections"] if s["id"] == section["sectionId"])
            bounds, indices = extract_bounds(skin,definition,alpha,ownership)
            assert len({p["id"] for p in section["polygons"]}) == len(section["polygons"])
            for polygon in section["polygons"]:
                pts = polygon["points"]
                assert 3 <= len(pts) <= 32 and 0 <= polygon["featherPixels"] <= 8
                assert all(0 <= p["x"] < 1024 and 0 <= p["y"] < 1536 for p in pts)
                assert abs(sum(a["x"]*b["y"]-b["x"]*a["y"] for a,b in zip(pts,pts[1:]+pts[:1]))) > 1
                assert all(bounds[0] <= p["x"] < bounds[0]+bounds[2] and bounds[1] <= p["y"] < bounds[1]+bounds[3] for p in pts)
            def raster():
                pixels = bytearray(bounds[2]*bounds[3])
                for y in range(bounds[1],bounds[1]+bounds[3]):
                    for x in range(bounds[0],bounds[0]+bounds[2]):
                        value = max(coverage(p["points"],p["featherPixels"],x+0.5,y+0.5) for p in section["polygons"])
                        amount = int(min(1,max(0,value))*255+0.5)
                        if amount:
                            assert y*1024+x in indices and alpha[y*1024+x], "Polygon spills beyond the actual section artwork."
                        pixels[(bounds[3]-1-(y-bounds[1]))*bounds[2]+x-bounds[0]] = amount
                return pixels
            first = raster()
            assert first == raster() and 0 in first and 255 in first
            assert len(first) == bounds[2]*bounds[3]
            generated_count += 1
            print(f"PASS {name}/LowerTorso: mask bounds {bounds}; {sum(bool(x) for x in first)} designated pixels; deterministic scalar-mask SHA256 {sha256(first).hexdigest()}")
    assert generated_count == 3

    # Independent numeric reference, not shader execution or visual-fidelity evidence.
    coefficients = (0.2126,0.7152,0.0722)
    lum = lambda c: sum(a*b for a,b in zip(c,coefficients))
    rng = random.Random(6)
    for _ in range(1000):
        source, team = tuple(rng.random() for _ in range(3)), tuple(rng.random() for _ in range(3))
        value, team_value = lum(source), lum(team)
        amp = min(value/max(team_value,0.00001),(1-value)/max(1-team_value,0.00001))
        result = tuple(value+(t-team_value)*amp for t in team)
        assert abs(lum(result)-value) < 1e-12 and all(-1e-12 <= x <= 1+1e-12 for x in result)
    runtime = (production/"Runtime/SelectiveTeamColorPresentation.cs").read_text()
    shader = (production/"Rendering/SelectiveTeamColorUnlit.shader").read_text()
    assert "GetPropertyBlock(properties)" in runtime and "SetPropertyBlock(properties)" in runtime
    assert "Texture2D.blackTexture" in runtime and "RecolorEnabled" in runtime
    assert ".material =" not in runtime and "new Material(" not in runtime
    assert "Update()" not in runtime and "GetPixels" not in runtime and "SetPixels" not in runtime
    assert "UNITY_SKINNED_VERTEX_COMPUTE(input)" in shader and "SKINNED_SPRITE" in shader
    assert "if (amount <= 0.0) return original;" in shader and "return half4(result, original.a);" in shader
    assert "sampler_TeamColorMask, input.uv).r" in shader and "(painted, target, amount)" in shader
    assert "teamColor.linear" in runtime and "UNITY_COLORSPACE_GAMMA" in shader

    sources = list((repo/"assets/misc/Character Skin PNG pieces").glob("*.png"))
    assert len(sources) == 6
    for source in sources:
        relative = source.relative_to(repo).as_posix()
        assert source.read_bytes() == subprocess.check_output(["git","show","HEAD:"+relative],cwd=repo)
    print("PASS: 33 explicit section decisions / 3 authored mask definitions, all six original source blobs, and 1,000 luminance/gamut reference cases.")
    print("C# execution, shader compilation, mask/prefab generation, SpriteSkin rendering and visual fidelity are NOT verified.")


if __name__ == "__main__":
    verify()
