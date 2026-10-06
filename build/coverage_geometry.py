"""Distance-based windows for the coverage model (coordinates are lat, lon)."""
from bisect import bisect_left, bisect_right
import math


def hav(a, b, c, d):
    p = math.pi / 180
    x = math.sin((c - a) * p / 2) ** 2
    x += math.cos(a * p) * math.cos(c * p) * math.sin((d - b) * p / 2) ** 2
    return 12742 * math.asin(math.sqrt(max(0.0, min(1.0, x))))


def distinct_points(points):
    """Consecutive duplicate vertices carry no distance or heading information."""
    out = []
    for point in points:
        point = tuple(point)
        if not out or point != out[-1]:
            out.append(point)
    return out


def turnrate(seg):
    seg = distinct_points(seg)
    path = sum(hav(*a, *b) for a, b in zip(seg, seg[1:]))
    if path < 0.5 or len(seg) < 3:
        return 0.0, path
    turn = 0.0
    for a, b, c in zip(seg, seg[1:], seg[2:]):
        h1 = math.atan2(b[1] - a[1], b[0] - a[0])
        h2 = math.atan2(c[1] - b[1], c[0] - b[0])
        difference = abs(math.degrees(h2 - h1))
        turn += min(difference, 360 - difference)
    return turn / path, path


def distance_samples(points, count):
    """Yield (along-track midpoint, track window) for equal-distance spans.

    Interpolate on the original polyline, preserving all interior vertices in
    each terrain window. Work is proportional to input vertices and samples,
    rather than making a dense copy of the entire track. A zero-length shape
    yields stationary samples; callers remain responsible for data validation.
    """
    if not isinstance(count, int) or isinstance(count, bool) or count < 1:
        raise ValueError('sample count must be a positive integer')
    pts = distinct_points(points)
    if not pts:
        raise ValueError('cannot sample an empty track')
    cumulative = [0.0]
    for a, b in zip(pts, pts[1:]):
        cumulative.append(cumulative[-1] + hav(*a, *b))
    total = cumulative[-1]
    if total == 0:
        for _ in range(count):
            yield pts[0], [pts[0], pts[0]]
        return

    def at(distance):
        if distance <= 0:
            return pts[0]
        if distance >= total:
            return pts[-1]
        i = bisect_right(cumulative, distance) - 1
        f = (distance - cumulative[i]) / (cumulative[i + 1] - cumulative[i])
        a, b = pts[i], pts[i + 1]
        return (a[0] + f * (b[0] - a[0]), a[1] + f * (b[1] - a[1]))

    for k in range(count):
        start, end = total * k / count, total * (k + 1) / count
        lo, hi = bisect_right(cumulative, start), bisect_left(cumulative, end)
        window = [at(start)] + pts[lo:hi] + [at(end)]
        yield at(total * (k + 0.5) / count), window
