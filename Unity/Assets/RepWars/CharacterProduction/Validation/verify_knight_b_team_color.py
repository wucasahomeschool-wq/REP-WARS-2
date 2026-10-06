"""Read-only Phase 11 configuration/raster reference and regression checks; never runs Unity/C#."""
from hashlib import sha256
import json
from math import isfinite
from pathlib import Path
import re
import subprocess

from PIL import Image
from humanoid_skin_reference import build_ownership
from verify_team_color import coverage
from verify_knight_a_regression import body, verify as verify_knight_a

PRODUCTION = Path(__file__).resolve().parent.parent
REPO = PRODUCTION.parents[3]


def verify():
    baseline = json.loads((PRODUCTION / 'Validation/TeamColor.phase10-regression.json').read_text())
    assert baseline['checkpoint'] == '47da66805f7644abb692351d5b1a1bb728cc5422'
    for name, digest in baseline['files'].items():
        assert sha256((PRODUCTION / name).read_bytes()).hexdigest() == digest, name
    for key, digest in baseline['methodHashes'].items():
        name, method = key.split(':')
        text = body((PRODUCTION / name).read_text(), method).replace('KnightASkinConfiguration.', 'HumanoidSkinConfiguration.')
        assert sha256(re.sub(r'\s+', '', text).encode()).hexdigest() == digest, key
    verify_knight_a()
    recipe = json.loads((PRODUCTION / 'Editor/KnightBTeamColor.configuration.json').read_text())
    assert recipe['version'] == 1 and recipe['characterId'] == 'KnightB'
    assert [v['view'] for v in recipe['views']] == [0, 1, 2]
    memory = 0
    for view, name in zip(recipe['views'], ('Front', 'Side', 'Back')):
        skin_file = PRODUCTION / f'Editor/KnightB{name}.configuration.json'
        skin = json.loads(skin_file.read_text())
        source_file = REPO / skin['sourcePath']
        assert view['sourceSha256'] == skin['sourceSha256'] == sha256(source_file.read_bytes()).hexdigest()
        assert view['skinConfigurationSha256'] == sha256(skin_file.read_bytes()).hexdigest()
        image = Image.open(source_file)
        w, h = image.size
        assert image.mode == 'RGBA' and (w, h) == (skin['sourceWidth'], skin['sourceHeight'])
        alpha = image.getchannel('A').tobytes()
        owners = build_ownership(skin, alpha, w, h)
        assert len(view['sections']) == 11
        assert {s['sectionId'] for s in view['sections']} == {s['id'] for s in skin['sections']}
        nonempty = 0
        for section in view['sections']:
            assert section['reviewNote']
            if not section['polygons']:
                assert 'REQUIRES HUMAN VISUAL REVIEW' in section['reviewNote']
                continue
            assert section['sectionId'] == 'LowerTorso' and len(section['polygons']) == 1
            nonempty += 1
            identity = next(i for i, s in enumerate(skin['sections'], 1) if s['id'] == section['sectionId'])
            indices = {i for i, owner in enumerate(owners) if owner == identity}
            xs, ys = [i % w for i in indices], [i // w for i in indices]
            pad = skin['padding']
            # Native Extract deliberately preserves gutters even outside the source sheet.
            bounds = (min(xs) - pad, min(ys) - pad, max(xs) - min(xs) + 1 + 2*pad, max(ys) - min(ys) + 1 + 2*pad)
            polygon = section['polygons'][0]
            pts = polygon['points']
            assert 3 <= len(pts) <= 32 and 0 <= polygon['featherPixels'] <= 8
            assert all(isfinite(p[k]) for p in pts for k in ('x', 'y'))
            assert all(0 <= p['x'] < w and 0 <= p['y'] < h for p in pts)
            assert abs(sum(a['x']*b['y']-b['x']*a['y'] for a,b in zip(pts,pts[1:]+pts[:1]))) > 1
            assert all(bounds[0] <= p['x'] < bounds[0]+bounds[2] and bounds[1] <= p['y'] < bounds[1]+bounds[3] for p in pts)
            def raster():
                values = bytearray(bounds[2]*bounds[3])
                for y in range(bounds[1], bounds[1]+bounds[3]):
                    for x in range(bounds[0], bounds[0]+bounds[2]):
                        value = coverage(pts, polygon['featherPixels'], x+0.5, y+0.5)
                        amount = int(min(1, max(0, value))*255+0.5)
                        if amount:
                            assert 0 <= x < w and 0 <= y < h
                            assert y*w+x in indices and alpha[y*w+x] > 0, 'Mask spills into a different section or transparent gap'
                        values[(bounds[3]-1-(y-bounds[1]))*bounds[2]+x-bounds[0]] = amount
                return values
            values = raster()
            assert values == raster() and 0 in values and 255 in values
            count = sum(bool(v) for v in values)
            assert 0 < count < len(values)//4, 'Initial mask is a small cloth interior, not a whole section'
            memory += len(values)*4
            print(f'PASS Knight B {name}/LowerTorso: padded bounds={bounds}, {count} designated pixels, scalar reference hash={sha256(values).hexdigest()}')
        assert nonempty == 1
    runtime = (PRODUCTION / 'Runtime/SelectiveTeamColorPresentation.cs').read_text()
    builder = (PRODUCTION / 'Editor/HumanoidTeamColorProofBuilder.cs').read_text()
    inspector = (PRODUCTION / 'Editor/SelectiveTeamColorPresentationEditor.cs').read_text()
    for family in ('KnightA', 'KnightB'):
        facade = (PRODUCTION / f'Editor/{family}TeamColorProofBuilder.cs').read_text()
        assert 'MaterialPath = HumanoidTeamColorProofBuilder.MaterialPath' in facade
        assert f'{family}TeamColorConfiguration.Load()' in facade and 'HumanoidTeamColorProofBuilder.CreateProof' in facade
    assert 'skin.CharacterId != recipe.ExpectedCharacterId' in builder
    assert 'only this family' in builder
    assert 'if (material == null)' in builder and 'created.Add(MaterialPath)' in builder
    assert 'Existing shared material does not preserve original mode; it was not modified.' in builder
    assert 'if (section.polygons.Length != 0)' in builder
    assert 'renderer = renderer, sourceSprite = renderer.sprite, mask = mask' in builder
    assert 'KnightBTeamColorProofBuilder.Validate(presentation)' in inspector
    assert 'new Material(' not in runtime and not re.search(r'\b(Update|LateUpdate)\s*\(', runtime)
    assert 'GetPixels' not in runtime and '.material =' not in runtime
    for source in (REPO / 'assets/misc/Character Skin PNG pieces').glob('*.png'):
        assert source.read_bytes() == subprocess.check_output(['git', 'show', 'HEAD:'+str(source.relative_to(REPO))], cwd=REPO)
    print(f'PASS Phase 11: 33 explicit decisions, three selective authored masks, shared material, cross-family/provenance guards; derived RGBA32 masks would use {memory} bytes before readable copies/import overhead.')
    print('PASS frozen Phase 10 files, ten moved raster/import/schema/provenance method hashes and Knight A baseline; no generated files written.')
    print('Unity compilation/tests/assets/rendering, human mask approval and mobile profiling remain DEFERRED.')


if __name__ == '__main__':
    verify()
