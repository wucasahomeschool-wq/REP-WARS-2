"""Read-only Knight B configuration/extraction/weight reference checks. Requires Pillow, never executes Unity."""
from hashlib import sha256
import json
from math import isfinite
from pathlib import Path
import re
import subprocess

from PIL import Image
from humanoid_skin_reference import build_ownership, weights

PRODUCTION = Path(__file__).resolve().parent.parent
REPO = PRODUCTION.parents[3]
VIEWS = ("Front", "Side", "Back")
SOURCES = (
    ("Disassembled Dark Knight Armor Set (1).png", "bb11b29fcd7d5da1238e69a3e35f7ffb8208b80cc71f1ac300a95f5838170466", (1254,1254)),
    ("ChatGPT Image Oct 3, 2026, 08_01_25 AM.png", "7b6b48290af8c18424503659e4e7d436551be7b0cee3f08dad1934c26b83084e", (1024,1536)),
    ("ChatGPT Image Oct 3, 2026, 08_06_16 AM.png", "5a2ce9487d1df375ded6472c21b367664274e8a527efa989bde427c5104d7b03", (1024,1536)),
)
SECTIONS = {"HeadNeck", "UpperTorso", "LowerTorso", "LeftUpperArm", "RightUpperArm", "LeftForearmHand",
            "RightForearmHand", "LeftUpperLeg", "RightUpperLeg", "LeftLowerLegFoot", "RightLowerLegFoot"}


def verify():
    canonical = re.findall(r'new MasterHumanoidBoneDefinition\("([^"]+)", (null|"[^"]+")',
                           (PRODUCTION/"Runtime/MasterHumanoidRigContract.cs").read_text())
    names = {name for name, _ in canonical}
    assert len(canonical) == len(names) == 20
    for vi, (view, (filename, digest, dimensions)) in enumerate(zip(VIEWS, SOURCES)):
        file = PRODUCTION/f"Editor/KnightB{view}.configuration.json"
        c = json.loads(file.read_text())
        assert c['version'] == 1 and c['view'] == vi
        assert c['sourcePath'] == "assets/misc/Character Skin PNG pieces/"+filename
        source = REPO/c['sourcePath']
        assert sha256(source.read_bytes()).hexdigest() == c['sourceSha256'] == digest
        assert source.read_bytes() == subprocess.check_output(['git','show','HEAD:'+c['sourcePath']],cwd=REPO)
        im = Image.open(source)
        assert im.mode == 'RGBA' and im.size == dimensions == (c['sourceWidth'],c['sourceHeight'])
        w,h=im.size; alpha=im.getchannel('A').tobytes()
        assert len(c['bones']) == 20 and {b['name'] for b in c['bones']} == names
        assert all(isfinite(b[k]) for b in c['bones'] for k in ('x','y'))
        root=next(b for b in c['bones'] if b['name']=='Root')
        assert (root['x'],root['y']) == (c['groundX'],c['groundY'])
        assert c['padding'] == 8 and c['isolationAlpha'] == 32 and c['pixelsPerUnit'] > 0
        assert len(c['sections']) == len({s['sortingOrder'] for s in c['sections']}) == 11
        assert {s['id'] for s in c['sections']} == SECTIONS
        torso=next(s for s in c['sections'] if s['id']=='UpperTorso')
        right_x,left_x,y=((470,810,260) if view=='Front' else (400,635,300) if view=='Side' else (660,360,305))
        for sample_x, expected, other in ((right_x,'RightClavicle','LeftClavicle'),(left_x,'LeftClavicle','RightClavicle')):
            influence=weights(torso,sample_x,y)
            assert influence.get(expected,0)>0.02 and influence.get(other,0)<1e-6, 'Shoulder gate swapped anatomical identities'
        ownership=build_ownership(c,alpha,w,h)
        assert not any(a>2 and not ownership[i] for i,a in enumerate(alpha)), 'Lost painted source pixels'
        vertex_total=triangle_total=secondary_total=0
        for identity,s in enumerate(c['sections'],1):
            assert s['minY'] == 0 and s['maxY'] == h
            assert 0 <= s['seedX'] < w and 0 <= s['seedY'] < h
            assert alpha[s['seedY']*w+s['seedX']] > 32
            assert len(set(s['influences'])) == len(s['influences']) and set(s['influences']) <= names
            assert s['dominantBone'] in s['influences'] and 1 <= len(s['transitions']) <= 3
            secondary_total+=len(s.get('secondarySeeds',[]))
            points=[i for i,o in enumerate(ownership) if o==identity]
            assert sum(alpha[i]>32 for i in points)>10000
            xs=[i%w for i in points];ys=[i//w for i in points];pad=c['padding']
            bounds=(min(xs)-pad,min(ys)-pad,max(xs)-min(xs)+1+2*pad,max(ys)-min(ys)+1+2*pad)
            # Exact RGBA ownership never removes an authored seam extension; only renderer placement changes.
            assert all(0 <= x < w and 0 <= y < h for x,y in zip(xs,ys))
            cols,rows=s['meshColumns'],s['meshRows'];count=(cols+1)*(rows+1)
            assert cols>=2 and rows>=2 and count<=160
            for transition in s['transitions']:
                assert transition['bone'] in s['influences'] and transition['fromY']!=transition['toY']
                assert 0 < transition['maximum'] <= 1
                if transition.get('useX'): assert transition['fromX'] != transition['toX']
            multi=False
            for gy in range(rows+1):
                for gx in range(cols+1):
                    x=bounds[0]+gx/cols*bounds[2];y=bounds[1]+(1-gy/rows)*bounds[3]
                    values=weights(s,x,y)
                    assert set(values)<=set(s['influences']) and 1 <= len(values) <= 4
                    assert abs(sum(values.values())-1) < 1e-6 and all(isfinite(v) and v>0 for v in values.values())
                    multi |= len(values)>1
            assert multi, f"Rigid-only section recipe: {s['id']}"
            if s['id'].endswith('LowerLegFoot'):
                assert 0 <= c['groundY']-(max(ys)+s['offsetY']) <= 1
            vertex_total+=count;triangle_total+=cols*rows*2
            print(f"{view}/{s['id']}: bounds+padding={bounds}, offset=({s['offsetX']},{s['offsetY']}), grid={cols}x{rows}")
        assert (vertex_total,triangle_total)==(629,926)
        assert secondary_total==(48 if view=='Front' else 0)
        print(f"PASS Knight B {view}: 11 sections/20 bones/11 future SpriteSkins, {vertex_total} vertices/{triangle_total} triangles, complete painted ownership and normalized multi-bone reference weights")
    builder=(PRODUCTION/'Editor/KnightBSkinBuilder.cs').read_text()
    assert 'HumanoidSkinBuilder.CreateProof(' in builder and 'root.AddComponent<KnightBSkin>()' in builder
    assert 'OverrideGeometry' not in builder and 'AnimationClip' not in builder
    shared=(PRODUCTION/'Editor/HumanoidSkinBuilder.cs').read_text()
    assert 'spriteSkin.SetBoneTransforms(transforms)' in shared and 'spriteSkin.autoRebind = false' in shared
    assert 'HumanoidSkinGeometry.BuildGrid(' in shared and 'HumanoidSkinValidator.Validate(' in shared
    assert 'Existing derived outputs were not overwritten' in shared
    for directory in ('Proof','Skins','Animation'):
        root=PRODUCTION/directory
        assert not any('KnightB' in p.name for p in root.rglob('*') if p.is_file()), 'Unity outputs/B animation must remain unexecuted'
    # Phase 11 adds isolated recolor tooling, not color behavior to the Phase 9 skin builder/metadata.
    assert 'AddComponent<SelectiveTeamColorPresentation>' not in builder
    assert 'SelectiveTeamColor' not in (PRODUCTION/'Runtime/KnightBSkin.cs').read_text()
    allowed_color_files = {'KnightBTeamColorConfiguration.cs', 'KnightBTeamColorProofBuilder.cs',
                           'KnightBTeamColor.configuration.json', 'KnightBTeamColorTests.cs'}
    for path in PRODUCTION.rglob('*TeamColor*'):
        if 'KnightB' in path.name:
            assert path.name.removesuffix('.meta') in allowed_color_files, 'Unexpected Knight B recolor asset outside the approved Phase 11 tooling'
    from verify_knight_a_regression import verify as verify_regression
    verify_regression()
    print('STATIC/REFERENCE ONLY: Unity C# compilation, native Sprite assets/prefabs, SpriteSkin deformation, sorting, seams, sockets and mobile performance remain deferred.')


if __name__=='__main__': verify()
