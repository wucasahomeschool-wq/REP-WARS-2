"""Phase 8 Knight A baseline guards for the shared-skin move. Source checks only, never executes C#/Unity."""
from hashlib import sha256
import json
from pathlib import Path
import re

PRODUCTION = Path(__file__).resolve().parent.parent
REPO = PRODUCTION.parents[3]


def body(text, name):
    match=re.search(r'\b'+name+r'\s*\([^;{]*\)\s*\{',text)
    assert match, f'Missing method {name}'
    start=text.index('{',match.start()); depth=1; i=start+1
    while depth:
        depth+=(text[i]=='{')-(text[i]=='}'); i+=1
    return text[start:i]


def normalize(text):
    text=re.sub(r'//[^\n]*','',text)
    text=text.replace('KnightASkinGeometry.','HumanoidSkinGeometry.').replace('KnightASkinConfiguration.','HumanoidSkinConfiguration.')
    text=text.replace('config.UseLegacyKnightAFrontWeights','config.view == MasterHumanoidView.Front')
    text=text.replace('config.CharacterId','"KnightA"')
    text=re.sub(r'\bview\b','config.view',text).replace('config.config.view','config.view')
    text=text.replace('GeneratedDirectoryFor(config.view)','GeneratedDirectoryFor(config)')
    text=text.replace('"KnightA" + "_"','"KnightA_"').replace('"/" + "KnightA_"','"/KnightA_"')
    text=text.replace('"/Skins/" + "KnightA" + "/"','"/Skins/KnightA/"').replace('"/Skins/" + "KnightA"','"/Skins/KnightA"')
    return re.sub(r'\s+','',text)


def restore_phase8_facing(relative, text):
    """Invert ONLY reviewed Phase 10 mapping edits, then hash against the frozen original.

    This does not refresh/relax the Phase 8 baseline. Any other change in either
    shared file still fails its original whole-file hash, including mirror/event logic.
    Runtime execution of the default mapping remains a Unity test dependency.
    """
    if relative == 'Runtime/HumanoidFacingPresentation.cs':
        text = text.replace('        [SerializeField] HumanoidFacingDefinition definition;\n', '')
        text = text.replace('        public HumanoidFacingDefinition Definition { get { return definition; } }\n'
                            '        public bool TryResolveFacing(HumanoidFacing intent, out HumanoidFacingSelection selection)\n'
                            '        { return definition.TryResolve(intent, out selection); }\n', '')
        text = text.replace('        { return Configure(newRig, initialFacing, default(HumanoidFacingDefinition), out error); }\n\n'
                            '        public bool Configure(MasterHumanoidRig newRig, HumanoidFacing initialFacing, HumanoidFacingDefinition newDefinition, out string error)\n', '')
        text = text.replace('newDefinition.TryResolve(', 'HumanoidFacingContract.TryResolve(')
        text = text.replace('            definition = newDefinition;\n', '')
        text = text.replace('TryResolveFacing(', 'HumanoidFacingContract.TryResolve(')
        text = text.replace('            // No temporary array allocation on a facing change; searches occur only on explicit requests.\n'
                            '            return HasSafeView(front, candidate.VisualRoot) && HasSafeView(side, candidate.VisualRoot) && HasSafeView(back, candidate.VisualRoot);',
                            '            foreach (var view in new[] { front, side, back })\n'
                            '                if (view.parent != candidate.VisualRoot || view.Find("SkinMount") == null) return false;\n'
                            '            return true;')
        text = text.replace('        static bool HasSafeView(Transform view, Transform visualRoot)\n'
                            '        { return view.parent == visualRoot && view.Find("SkinMount") != null; }\n\n', '')
    elif relative == 'Runtime/HumanoidFacingValidator.cs':
        text = text.replace('!(presentation != null ? presentation.TryResolveFacing(facing, out mapped) : HumanoidFacingContract.TryResolve(facing, out mapped))',
                            '!HumanoidFacingContract.TryResolve(facing, out mapped)')
        text = text.replace('presentation.TryResolveFacing(presentation.Facing, out selection)',
                            'HumanoidFacingContract.TryResolve(presentation.Facing, out selection)')
    return text


def verify():
    baseline=json.loads((PRODUCTION/'Validation/KnightA.phase8-regression.json').read_text())
    assert baseline['checkpoint']=='7560d1e84b827f298c0e36f12d88b03f1633e727'
    for relative,digest in baseline['files'].items():
        file=REPO/relative[5:] if relative.startswith('repo:') else PRODUCTION/relative
        data = file.read_bytes()
        if relative in ('Runtime/HumanoidFacingPresentation.cs', 'Runtime/HumanoidFacingValidator.cs'):
            data = restore_phase8_facing(relative, data.decode()).encode()
        assert sha256(data).hexdigest()==digest, f'Knight A/source regression: {relative}'
    for key,digest in baseline['methodHashes'].items():
        relative,name=key.split(':')
        assert sha256(normalize(body((PRODUCTION/relative).read_text(),name)).encode()).hexdigest()==digest, f'Native generation algorithm changed: {key}'
    runtime=(PRODUCTION/'Runtime/KnightASkin.cs').read_text()
    assert re.findall(r'\[SerializeField\][^\n]+',runtime)==baseline['knightASerializedFields']
    for view in ('Front','Side','Back'):
        recipe=json.loads((PRODUCTION/f'Editor/KnightA{view}.configuration.json').read_text())
        assert all(not s.get('secondarySeeds') for s in recipe['sections'])
    facade=(PRODUCTION/'Editor/KnightASkinConfiguration.cs').read_text()
    assert 'UseLegacyKnightAFrontWeights { get { return view == MasterHumanoidView.Front; } }' in facade
    builder=(PRODUCTION/'Editor/KnightASkinBuilder.cs').read_text()
    assert 'HumanoidSkinBuilder.CreateProof(KnightASkinConfiguration.Load(view)' in builder
    assert 'root.AddComponent<KnightAFrontSkin>()' in builder and 'root.AddComponent<KnightASkin>()' in builder
    geometry=(PRODUCTION/'Editor/HumanoidSkinGeometry.cs').read_text()
    assert 'if (config.UseLegacyKnightAFrontWeights) return FrontWeights' in geometry
    assert 'if (section.secondarySeeds == null) continue;' in geometry
    from verify_humanoid_facing import verify as verify_facing
    verify_facing()
    print(f"PASS Knight A Phase 8 baseline: {len(baseline['files'])-2} unchanged file/source hashes, two exact inverse-refactor facing hashes, {len(baseline['methodHashes'])} shared mesh/extraction/weight/native-binding method hashes. Frozen baseline unchanged; calibration/Idle/Walk/masks protected. Unity regression execution is deferred.")


if __name__=='__main__': verify()
