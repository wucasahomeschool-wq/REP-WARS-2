"""Read-only recipe/kinematic reference checks. This does not execute C#, Unity or rendered skinning."""
from hashlib import sha256
import json
import math
from pathlib import Path
import subprocess

PRODUCTION = Path(__file__).resolve().parent.parent
REPO = PRODUCTION.parents[3]

def signal(recipe,phase,name):
    phase %= 1
    index = int(phase*8)
    t = phase*8-index
    ps = recipe['phases']
    def slope(i):
        a=(ps[i][name]-ps[(i+7)%8][name])*8
        b=(ps[(i+1)%8][name]-ps[i][name])*8
        return 0 if a*b <= 0 else 2*a*b/(a+b)
    return ((2*t**3-3*t*t+1)*ps[index][name] + (t**3-2*t*t+t)*slope(index)/8
            +(-2*t**3+3*t*t)*ps[index+1][name]+(t**3-t*t)*slope((index+1)%8)/8)

def rotate(v,degrees):
    r=math.radians(degrees)
    return (v[0]*math.cos(r)-v[1]*math.sin(r),v[0]*math.sin(r)+v[1]*math.cos(r))

def points(skin):
    return {b['name']:(b['x'],-b['y']) for b in skin['bones']}

def solve(recipe,view,skin,side,phase):
    p=points(skin); h=p[side+'Thigh']; k=p[side+'Shin']; f=p[side+'Foot']
    u=(k[0]-h[0],k[1]-h[1]); l=(f[0]-k[0],f[1]-k[1]); sole=(0,-skin['groundY']-f[1])
    roll=view['footRollDegrees']*signal(recipe,phase,'roll'); rs=rotate(sole,roll)
    target=(f[0]+view['stridePixels']*signal(recipe,phase,'stride'), f[1]+sole[1]+view['liftPixels']*signal(recipe,phase,'lift'))
    d=(target[0]-rs[0]-h[0],target[1]-rs[1]-h[1]+view['pelvisDropPixels'])
    a=math.hypot(*u); b=math.hypot(*l)
    cosine=(d[0]**2+d[1]**2-a*a-b*b)/(2*a*b)
    assert -1 < cosine < 1, ('unreachable or singular',side,phase,cosine)
    joint=view['kneeBendSign']*math.acos(cosine)
    upper=math.atan2(d[1],d[0])-math.atan2(b*math.sin(joint),a+b*math.cos(joint))
    thigh=math.degrees(upper-math.atan2(u[1],u[0]))
    shin=math.degrees(upper+joint-math.atan2(l[1],l[0]))-thigh
    return thigh,shin,roll-thigh-shin

def sample_bake(values,duration,phase):
    n=len(values)-1
    phase=min(1,max(0,phase)); index=min(n-1,int(phase*n)); u=phase*n-index
    step=duration/n
    def slope(i): return (values[(i+1)%n]-values[(i+n-1)%n])/(2*step)
    return ((2*u**3-3*u*u+1)*values[index]+(u**3-2*u*u+u)*step*slope(index)
            +(-2*u**3+3*u*u)*values[index+1]+(u**3-u*u)*step*slope(index+1))

def contact(skin,side,angles,drop):
    p=points(skin); h=p[side+'Thigh']; k=p[side+'Shin']; f=p[side+'Foot']
    u=rotate((k[0]-h[0],k[1]-h[1]),angles[0]); l=rotate((f[0]-k[0],f[1]-k[1]),angles[0]+angles[1]); sole=rotate((0,-skin['groundY']-f[1]),sum(angles))
    return (h[0]+u[0]+l[0]+sole[0],h[1]-drop+u[1]+l[1]+sole[1])

def verify():
    recipe=json.loads((PRODUCTION/'Editor/KnightAWalk.configuration.json').read_text())
    assert (recipe['version'],recipe['characterId'],recipe['state'])==(1,'KnightA','Walk')
    assert recipe['duration']==1.6 and recipe['transitionDuration']==.2 and recipe['bakeIntervals']==128
    assert len(recipe['phases'])==9 and [p['normalizedTime'] for p in recipe['phases']]==[i/8 for i in range(9)]
    assert recipe['phases'][0]['label']=='LeftContact' and recipe['phases'][4]['label']=='RightContact'
    assert recipe['phases'][0]['stride']==-1 and recipe['phases'][4]['stride']==1
    assert all(p['lift']==p['roll']==0 for p in recipe['phases'][:5])
    assert all(recipe['phases'][0][k]==recipe['phases'][-1][k] for k in ('stride','lift','roll'))
    for i in range(2049):
        phase=i/2048
        assert -1-1e-9 <= signal(recipe,phase,'stride') <= 1+1e-9
        assert 0 <= signal(recipe,phase,'lift') <= 1
        assert -1 <= signal(recipe,phase,'roll') <= 1
        if phase <= .5: assert signal(recipe,phase,'lift')==signal(recipe,phase,'roll')==0
    assert [v['view'] for v in recipe['views']]==[0,1,2]
    upper={'Spine','Chest','Neck','Head','LeftClavicle','RightClavicle','LeftUpperArm','RightUpperArm','LeftForearm','RightForearm'}
    assert recipe['views'][1]['stridePixels'] > max(v['stridePixels'] for v in (recipe['views'][0],recipe['views'][2]))
    for view,name in zip(recipe['views'],('Front','Side','Back')):
        file=PRODUCTION/f'Editor/KnightA{name}.configuration.json'; skin=json.loads(file.read_text())
        assert view['skinConfigurationSha256']==sha256(file.read_bytes()).hexdigest()
        assert view['sourceSha256']==skin['sourceSha256']==sha256((REPO/skin['sourcePath']).read_bytes()).hexdigest()
        assert len(view['upperMotions'])==10 and {m['bone'] for m in view['upperMotions']}==upper
        assert 0 < view['pelvisDropPixels'] <= 16
        p=points(skin); maximum_error=0; maximum_angles=[0,0,0]; transition_undershoot=0
        for side in ('Left','Right'):
            offset=.5 if side=='Right' else 0
            samples=[solve(recipe,view,skin,side,i/128+offset) for i in range(129)]
            for j in range(3): assert abs(samples[0][j]-samples[-1][j]) < 1e-10
            # Contact is not constrained by the simple transition mixer. Bound and report this known limitation.
            for pose in samples:
                for blend_index in range(65):
                    weight=blend_index/64
                    actual=contact(skin,side,[a*weight for a in pose],view['pelvisDropPixels']*weight)
                    transition_undershoot=max(transition_undershoot,-skin['groundY']-actual[1])
            assert transition_undershoot < 6, (name,'transition ground-reference undershoot',transition_undershoot)
            for i in range(2049):
                phase=i/2048
                angles=[sample_bake([s[j] for s in samples],recipe['duration'],phase) for j in range(3)]
                maximum_angles=[max(a,abs(b)) for a,b in zip(maximum_angles,angles)]
                actual=contact(skin,side,angles,view['pelvisDropPixels'])
                expected=(p[side+'Foot'][0]+view['stridePixels']*signal(recipe,phase+offset,'stride'),-skin['groundY']+view['liftPixels']*signal(recipe,phase+offset,'lift'))
                error=math.dist(actual,expected); maximum_error=max(error,maximum_error)
                assert error < .25,(name,side,phase,error)
                if signal(recipe,phase+offset,'lift')==0: assert abs(actual[1]+skin['groundY']) < .25
                assert actual[1] >= -skin['groundY']-.25
        assert all(a<=b for a,b in zip(maximum_angles,(28,48,48))), (name,maximum_angles)
        motions={m['bone']:m for m in view['upperMotions']}
        for phase in (0,.125,.25,.5,.75):
            left=motions['LeftUpperArm']; right=motions['RightUpperArm']
            a=left['strideDegrees']*signal(recipe,phase,'stride'); b=right['strideDegrees']*signal(recipe,phase+.5,'stride')
            assert abs(a+b) < 1e-8
            assert a*signal(recipe,phase,'stride') <= 0 and b*signal(recipe,phase+.5,'stride') <= 0
        print(f'NOTE {name}: simple handoff reference undershoot {transition_undershoot:.6f}px requires gameplay-scale visual review')
        print(f'PASS {name}: two reachable alternating leg targets, bounded joint curves, loop seam, 4098 dense reference samples; max contact error {maximum_error:.6f}px, max |thigh/shin/foot| {maximum_angles}')
    for source in (REPO/'assets/misc/Character Skin PNG pieces').glob('*.png'):
        assert source.read_bytes()==subprocess.check_output(['git','show','HEAD:'+str(source.relative_to(REPO))],cwd=REPO)
    for relative in ('Runtime/MasterHumanoidRigContract.cs','Runtime/SelectiveTeamColorPresentation.cs','Rendering/SelectiveTeamColorUnlit.shader','Editor/KnightATeamColor.configuration.json',
                     'Editor/KnightAIdle.configuration.json'):
        path=PRODUCTION/relative
        assert path.read_bytes()==subprocess.check_output(['git','show','HEAD:'+str(path.relative_to(REPO))],cwd=REPO)
    from verify_knight_a_regression import verify as verify_skin_regression
    verify_skin_regression()
    runtime=(PRODUCTION/'Runtime/HumanoidIdlePresentation.cs').read_text()
    assert 'AnimationMixerPlayable.Create(graph,2)' in runtime and 'DirectorUpdateMode.Manual' in runtime
    assert 'if (IsPlaying) Sample();' in runtime and 'SetAutomaticAdvance' in runtime
    assert 'binding.boneName == "Pelvis"' in runtime and 'binding.bone.localPosition = binding.neutralLocalPosition' in runtime
    assert all(t not in runtime for t in ('GameState','MaterialPropertyBlock','UnityEngine.Random','new AnimatorController','WalkSpeed','transform.position ='))
    print('PASS unchanged original source blobs, rig contract, calibrated skins/weights, facing and team-color renderer/configuration; manual Playables Idle/Walk extension and explicit pause/neutral recovery boundary')
    print('REFERENCE MATH ONLY: Unity compilation, native generation, Playables, weighted foot artwork, transition/loop appearance, mirrored rendering and mobile cost remain unverified.')

if __name__=='__main__': verify()
