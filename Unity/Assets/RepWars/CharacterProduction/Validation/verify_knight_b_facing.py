"""Read-only Phase 10 recipe/provenance and source checks. Never executes C#/Unity."""
from hashlib import sha256
import json
from pathlib import Path
import re

PRODUCTION = Path(__file__).resolve().parent.parent
REPO = PRODUCTION.parents[3]


def verify():
    recipe = json.loads((PRODUCTION / 'Editor/KnightBFacing.configuration.json').read_text())
    assert recipe['version'] == 1 and recipe['characterId'] == 'KnightB'
    assert len(recipe['views']) == 3
    assert sorted(v['view'] for v in recipe['views']) == [0, 1, 2]
    # Expected source orientation is reviewed independently of the generic Knight A mapping.
    right_facings = {0: 1, 1: 3, 2: 5}
    expected = {0: (0, True), 1: (0, False), 2: (1, True),
                3: (1, False), 4: (2, True), 5: (2, False)}
    actual = {}
    for entry in recipe['views']:
        view = entry['view']
        assert entry['unmirroredFacing'] == right_facings[view]
        name = ('Front', 'Side', 'Back')[view]
        skin_path = PRODUCTION / f'Editor/KnightB{name}.configuration.json'
        skin = json.loads(skin_path.read_text())
        assert entry['skinConfigurationSha256'] == sha256(skin_path.read_bytes()).hexdigest()
        source = REPO / skin['sourcePath']
        assert entry['sourceSha256'] == skin['sourceSha256'] == sha256(source.read_bytes()).hexdigest()
        assert len(skin['sections']) == 11
        for facing in (view * 2, view * 2 + 1):
            actual[facing] = (view, facing != entry['unmirroredFacing'])
    assert actual == expected
    runtime = (PRODUCTION / 'Runtime/HumanoidFacingPresentation.cs').read_text()
    definition = (PRODUCTION / 'Runtime/HumanoidFacingDefinition.cs').read_text()
    assert 'canonical.Mirrored ^ reverse' in definition
    assert 'new HumanoidFacingSelection(canonical.View,' in definition
    assert 'definition = newDefinition;' in runtime
    assert 'default(HumanoidFacingDefinition), out error' in runtime
    assert 'new[] { front, side, back }' not in runtime
    assert 'return intent.HasValue && TrySetFacing(intent.Value);' in runtime
    assert 'rig.VisualRoot.localScale = scale;' in runtime
    assert 'if (view != selection.View) rig.GetViewRoot(view).gameObject.SetActive(false);' in runtime
    assert not re.search(r'\b(Update|LateUpdate|FixedUpdate)\s*\(', runtime)
    assert not re.search(r'\.(position|localPosition|flipX|flipY|sortingOrder)\s*=', runtime)
    assert all(token not in runtime + definition for token in
               ('GameState', 'UnityWebRequest', 'MaterialPropertyBlock', 'new Material(', 'new Texture2D(', 'KnightB'))
    builder = (PRODUCTION / 'Editor/KnightBFacingProofBuilder.cs').read_text()
    assembly = (PRODUCTION / 'Editor/HumanoidFacingProofAssembly.cs').read_text()
    config = (PRODUCTION / 'Editor/KnightBFacingConfiguration.cs').read_text()
    assert 'KnightB_SixDirectionProof.prefab' in builder
    assert 'KnightBFacingConfiguration.Load().ToRuntimeDefinition()' in builder
    assert 'HumanoidFacingProofAssembly.AssembleViews(rig, KnightBSkinBuilder.ProofPrefabPathFor,' in builder
    assert 'view => KnightBSkinConfiguration.Load(view), root => root.AddComponent<KnightBSkin>()' in builder
    assert 'presentation.Configure(rig, HumanoidFacing.FrontLeft, mapping, out error)' in builder
    for token in ('SelectiveTeamColorPresentation', 'HumanoidIdlePresentation', 'Animator'):
        assert f'GetComponentsInChildren<{token}>(true).Length != 0' in builder
        assert f'AddComponent<{token}>' not in builder
    assert 'GetComponentsInChildren<SpriteSkin>(true).Length != 33' in builder
    assert 'GetComponentsInChildren<KnightBSkin>(true).Length != 3' in builder
    assert 'Existing direction proof was not overwritten' in builder
    assert 'source.Skeleton' not in assembly
    assert 'Instantiate(source.Rig.GetViewRoot(view).gameObject, rig.VisualRoot, false)' in assembly
    assert 'var views = new Transform[3];' in assembly
    assert 'skin.VerifySource();' in config and 'skin.ConfigurationHash' in config
    assert 'reviewed Knight B source handedness' in config
    tests = (PRODUCTION / 'Tests/Editor/KnightBFacingTests.cs').read_text()
    cases = re.findall(r'TestCase\(HumanoidFacing\.(\w+), MasterHumanoidView\.(\w+), (true|false)\)', tests)
    assert len(cases) == 12  # Each recipe and real hierarchy switch has all six cases.
    assert ('Right', 'Side', 'false') in cases and ('Left', 'Side', 'true') in cases
    for method in ('DefaultDefinitionPreservesAllKnightAMappings',
                   'StationaryAndInvalidIntentPreserveLastFacing',
                   'SocketsMirrorWithTheRigWithoutSwappingTheirIdentity',
                   'RecipeRejectsWrongHandednessDuplicateViewAndStaleProvenance',
                   'FacingNeedsNeitherAnimationNorTeamColorAndKeepsSerializedDefinitionOnEnable'):
        assert method in tests
    from verify_knight_a_regression import verify as verify_knight_a
    verify_knight_a()
    print('PASS Phase 10 source checks: Knight B six mappings, three provenance-pinned authored views, explicit Right unmirrored Side, shared mirror/activation boundary, no color/animation creation, preserved Knight A baseline.')
    print('REQUIRES UNITY EXECUTION: compilation, NUnit tests and prefab generation. REQUIRES HUMAN VISUAL REVIEW: facing, SpriteSkin mirroring, sorting and socket alignment.')


if __name__ == '__main__':
    verify()
