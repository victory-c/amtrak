import csv
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

BUILD = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BUILD))
from coverage_geometry import distance_samples, hav, turnrate

EVEN = [(0, 0), (0, .25), (0, .5), (0, .75), (0, 1)]
DENSE = [(0, 0), (0, .01), (0, .02), (0, .03), (0, .04),
         (0, .05), (0, .06), (0, .07), (0, .25), (0, .5), (0, .75), (0, 1)]


class GeometryTests(unittest.TestCase):
    def assertPointAlmostEqual(self, a, b):
        self.assertAlmostEqual(a[0], b[0], places=9)
        self.assertAlmostEqual(a[1], b[1], places=9)

    def test_midpoints_ignore_uneven_vertex_density(self):
        for points in (EVEN, DENSE, [p for p in DENSE for _ in range(3)]):
            samples = list(distance_samples(points, 4))
            for (midpoint, window), expected in zip(samples, (.125, .375, .625, .875)):
                self.assertPointAlmostEqual(midpoint, (0, expected))
                self.assertAlmostEqual(turnrate(window)[0], 0)
                self.assertAlmostEqual(turnrate(window)[1], hav(0, 0, 0, 1) / 4)

    def test_windows_partition_track_without_gaps(self):
        samples = list(distance_samples(DENSE, 7))
        self.assertPointAlmostEqual(samples[0][1][0], DENSE[0])
        self.assertPointAlmostEqual(samples[-1][1][-1], DENSE[-1])
        for (_, a), (_, b) in zip(samples, samples[1:]):
            self.assertPointAlmostEqual(a[-1], b[0])
        self.assertAlmostEqual(sum(turnrate(window)[1] for _, window in samples), turnrate(DENSE)[1])

    def test_midpoint_follows_bent_track_instead_of_endpoint_chord(self):
        points = [(0, 0), (0, 1), (1, 1)]
        midpoint, window = next(distance_samples(points, 1))
        self.assertPointAlmostEqual(midpoint, (0, 1))
        self.assertEqual(window, points)
        rate, distance = turnrate(window)
        self.assertAlmostEqual(rate, 90 / distance)

    def test_terrain_uses_each_distance_window(self):
        # The first half contains the corner; the second is straight. Do not
        # substitute whole-hop terrain merely because a window has two points.
        points = [(0, 0), (0, .5), (1.5, .5)]
        samples = list(distance_samples(points, 2))
        self.assertGreater(turnrate(samples[0][1])[0], 0)
        self.assertAlmostEqual(turnrate(samples[1][1])[0], 0)
        self.assertAlmostEqual(turnrate(samples[0][1])[1], turnrate(samples[1][1])[1])

    def test_duplicate_vertices_do_not_invent_turns(self):
        points = [(0, 0), (0, .25), (.25, .25), (.75, .25)]
        duplicated = [p for p in points for _ in range(3)]
        self.assertEqual(turnrate(points), turnrate(duplicated))
        self.assertEqual(list(distance_samples(points, 3)), list(distance_samples(duplicated, 3)))

    def test_reversing_track_reverses_sample_positions(self):
        forward = list(distance_samples(DENSE, 4))
        backward = list(distance_samples(DENSE[::-1], 4))
        for (a, _), (b, _) in zip(forward, backward[::-1]):
            self.assertPointAlmostEqual(a, b)

    def test_two_vertices_can_supply_many_samples(self):
        self.assertEqual(len(list(distance_samples([(0, 0), (0, 1)], 60))), 60)
        self.assertPointAlmostEqual(next(distance_samples([(0, 0), (0, 1)], 4))[0], (0, .125))

    def test_degenerate_track_and_invalid_sample_count(self):
        self.assertEqual(list(distance_samples([(40, -80)] * 3, 2)),
                         [((40, -80), [(40, -80), (40, -80)])] * 2)
        for count in (0, -1, True, 1.5):
            with self.assertRaises(ValueError):
                list(distance_samples(EVEN, count))
        with self.assertRaises(ValueError):
            list(distance_samples([], 1))


class BuilderTests(unittest.TestCase):
    def build(self, points):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / 'gtfs').mkdir()
            (root / 'gtfs' / 'stops.txt').write_text(
                'stop_id,stop_name,stop_lat,stop_lon,stop_timezone\n'
                'AAA,Origin,0,0,America/New_York\n'
                'BBB,Destination,0,1,America/New_York\n')
            with (root / 'gtfs' / 'shapes.txt').open('w', newline='') as stream:
                writer = csv.writer(stream)
                writer.writerow(['shape_id', 'shape_pt_sequence', 'shape_pt_lat', 'shape_pt_lon'])
                writer.writerows(['track', i, lat, lon] for i, (lat, lon) in enumerate(points))
            (root / 'geo_raw.json').write_text(json.dumps({
                'cities': [[0, .9, 5000, 'Town']], 'states': [], 'labels': []}))
            (root / 'routes_raw.json').write_text(json.dumps({
                'used': ['AAA', 'BBB'],
                'patterns': [{'name': 'Test', 'train': '1', 'dep': '08:00', 'days': '1111111',
                              'shape': 'track', 'stops': [['AAA', 0, 0], ['BBB', 120, 0]]}]}))
            result = subprocess.run([sys.executable, str(BUILD / 'build_all.py')],
                                    cwd=tmp, text=True, capture_output=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            return json.loads((root / 'data.json').read_text())['its'][0]

    def test_production_coverage_is_invariant_to_vertex_density_and_direction(self):
        baseline = self.build(EVEN)
        self.assertEqual(baseline['sn'], [4])
        self.assertEqual(baseline['cv']['verizon'], 'ddsg')
        for points in (DENSE, DENSE[::-1], [p for p in DENSE for _ in range(2)]):
            with self.subTest(points=points):
                result = self.build(points)
                self.assertEqual(result['cv'], baseline['cv'])
                self.assertEqual(result['sn'], baseline['sn'])
                self.assertEqual(result['kl'], baseline['kl'])
                for value in result['cv'].values():
                    self.assertEqual(len(value), sum(result['sn']))
                    self.assertLessEqual(set(value), set('gsd'))

    def test_missing_shape_retains_straight_line_fallback(self):
        result = self.build([])
        self.assertEqual(result['sn'], [4])
        self.assertEqual(result['cv'], self.build(EVEN)['cv'])


if __name__ == '__main__':
    unittest.main()
