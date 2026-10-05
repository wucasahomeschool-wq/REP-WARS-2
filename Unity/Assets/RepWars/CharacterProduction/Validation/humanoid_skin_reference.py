"""Read-only Python reference for shared authored-core/fringe ownership. No Unity/C# execution."""
from collections import deque

def build_ownership(config, alpha, width, height):
    threshold = config.get("isolationAlpha", 0)
    if not threshold:
        return None
    assert 0 < threshold <= 32
    owners = bytearray(width * height)

    def flood(queue, minimum):
        while queue:
            index = queue.popleft()
            x, y = index % width, index // width
            for nx, ny in ((x-1, y), (x+1, y), (x, y-1), (x, y+1)):
                if not (0 <= nx < width and 0 <= ny < height):
                    continue
                other = ny * width + nx
                if not owners[other] and alpha[other] > minimum:
                    owners[other] = owners[index]
                    queue.append(other)

    for identity, section in enumerate(config["sections"], 1):
        seed = section["seedY"] * width + section["seedX"]
        assert not owners[seed] and alpha[seed] > threshold
        owners[seed] = identity
        flood(deque([seed]), threshold)
    for identity, section in enumerate(config["sections"], 1):
        for seed in section.get("secondarySeeds", []):
            index = seed["y"] * width + seed["x"]
            assert not owners[index] and alpha[index] > 0, "Secondary fringe seed is transparent/already owned"
            owners[index] = identity
            flood(deque([index]), 0)
    flood(deque(i for i, owner in enumerate(owners) if owner), 0)
    return owners


def smooth(start, end, value):
    t = min(1, max(0, (value - start) / (end - start)))
    return t * t * (3 - 2 * t)


def weights(section, x, y):
    result = {section["dominantBone"]: 1.0}
    for transition in section["transitions"]:
        amount = transition["maximum"] * smooth(transition["fromY"], transition["toY"], y)
        if transition.get("useX"):
            amount *= smooth(transition["fromX"], transition["toX"], x)
        result = {bone: value * (1 - amount) for bone, value in result.items()}
        result[transition["bone"]] = result.get(transition["bone"], 0) + amount
    return {bone: value for bone, value in result.items() if value > 0}
