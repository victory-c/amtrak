"""Small corruptions exercise the gate; integration tests protect existing output."""
import copy
import json
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest

BUILD = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BUILD))
from validate import Report, check_intervals, coverage_intervals, parse_data, validate


def fixture():
    return {
        'tz': ['America/New_York', 'America/Chicago'],
        'stops': {
            'AAA': ['Origin', 40, -80, 0, 'PA'],
            'BBB': ['Middle', 40, -80.1, 1, 'OH'],
            'CCC': ['Destination', 40, -80.2, 1, 'OH'],
        },
        'its': [{
            'n': 'Test train', 'tr': '1', 'dep': '23:45', 'dy': '1111111',
            's': [['AAA', 0, 10], ['BBB', 90, 30], ['CCC', 180, 15]],
            'p': [[40, -80], [40, -80.1], [40, -80.2]],
            'i': [0, 1, 2], 'sn': [2, 1], 'kl': [9, 9],
            'cv': {'verizon': 'gsd', 'att': 'sgd', 'tmobile': 'ddd'},
        }],
    }


class ValidationTests(unittest.TestCase):
    def setUp(self):
        self.data = fixture()
        self.it = self.data['its'][0]

    def codes(self):
        return {i['code'] for i in validate(self.data).issues}

    def test_cross_midnight_and_station_timezone_change(self):
        self.assertEqual(validate(self.data).issues, [])
        intervals = list(coverage_intervals(self.it['s'], self.it['sn']))
        # Board at departure; exclude origin and destination dwell.
        self.assertEqual(intervals, [(0, 30), (30, 60), (60, 90), (90, 165)])
        self.assertEqual(sum(b - a for a, b in intervals), 165)

    def test_gtfs_hours_beyond_midnight_and_legacy_hour(self):
        for dep in ('25:10', '8:20:', '8:20', '08:20'):
            with self.subTest(dep=dep):
                self.it['dep'] = dep
                self.assertEqual(validate(self.data).issues, [])

    def test_invalid_departure_and_days(self):
        for dep in ('08:60', '-1:20', '08:20:10', '', None):
            self.it['dep'] = dep
            self.assertIn('departure', self.codes())
        for days in ('0000000', '111111', '111111x', None):
            self.it['dy'] = days
            self.assertIn('service_days', self.codes())

    def test_invalid_coordinates(self):
        for value in (float('nan'), float('inf'), 91, '40', True):
            with self.subTest(value=value):
                self.data['stops']['AAA'][1] = value
                self.assertIn('coordinate', self.codes())

    def test_timezone_names_and_indices(self):
        self.data['tz'][0] = 'Not/A_Timezone'
        self.assertIn('timezone', self.codes())
        for value in (-1, 2, True, 0.5):
            self.data['stops']['AAA'][3] = value
            self.assertIn('timezone_reference', self.codes())

    def test_negative_dwell_and_nonpositive_travel(self):
        self.it['s'][1][2] = -1
        self.assertIn('negative_dwell', self.codes())
        for dwell in (90, 91):
            self.it['s'][1][2] = dwell
            self.assertIn('nonpositive_travel', self.codes())

    def test_bad_offsets(self):
        self.it['s'][0][1] = 1
        self.assertIn('departure_offset', self.codes())
        self.it['s'][1][1] = -1
        self.assertIn('nonpositive_travel', self.codes())

    def test_unknown_and_repeated_stations(self):
        self.it['s'][1][0] = 'MISSING'
        self.assertIn('station_reference', self.codes())
        self.it['s'][1][0] = 'AAA'
        self.assertIn('repeated_station', self.codes())

    def test_duplicate_keys_are_not_silently_overwritten(self):
        with self.assertRaisesRegex(ValueError, 'duplicate JSON key'):
            parse_data('{"stops":{"AAA":[],"AAA":[]}}')

    def test_polyline_discontinuities(self):
        for anchors in ([0, 0, 2], [0, 2, 1], [0, 1, 99], [0, True, 2]):
            self.it['i'] = anchors
            self.assertTrue({'route_continuity', 'anchor_index'} & self.codes())
        self.it['i'] = [0, 1, 2]
        self.it['p'][1] = [40, -81]
        self.assertIn('station_anchor', self.codes())

    def test_coverage_missing_extra_and_invalid(self):
        for coverage in ('gs', 'gsdg'):
            self.it['cv']['att'] = coverage
            self.assertIn('coverage_length', self.codes())
        self.it['cv']['att'] = 'gsx'
        self.assertIn('coverage_status', self.codes())
        del self.it['cv']['att']
        self.assertIn('coverage_status', self.codes())
        self.it['sn'] = [0, 1]
        self.assertIn('coverage_samples', self.codes())

    def test_interval_gaps_overlaps_and_truncated_duration(self):
        for intervals, expected in (
            ([(0, 20), (30, 60)], 'coverage_gap'),
            ([(0, 40), (30, 60)], 'coverage_overlap'),
            ([(0, 59)], 'journey_duration'),
        ):
            report = Report()
            check_intervals(intervals, 0, 60, report, 'test')
            self.assertIn(expected, {i['code'] for i in report.issues})

    def test_distance_and_speed_findings(self):
        self.it['kl'][0] = 1
        self.assertIn('short_segment_distance', self.codes())
        self.it['kl'][0] = 250
        report = validate(self.data)
        self.assertIn('implied_speed', {i['code'] for i in report.issues})
        self.assertFalse(report.failed())
        self.assertTrue(report.failed(strict=True))
        self.assertNotIn('implied_speed', {i['code'] for i in validate(self.data, max_kmh=300).issues})
        for value in (0, -1, float('inf'), None):
            self.it['kl'][0] = value
            self.assertIn('segment_distance', self.codes())

    def test_malformed_containers_return_findings(self):
        for key in ('s', 'p', 'i', 'sn', 'kl', 'cv'):
            for value in (None, {}, [], 'bad', [None]):
                data = copy.deepcopy(self.data)
                data['its'][0][key] = value
                with self.subTest(key=key, value=value):
                    self.assertTrue(validate(data).failed())
        for data in (None, [], {}, {'tz': [], 'stops': {}, 'its': []}):
            self.assertTrue(validate(data).failed())


class IntegrationTests(unittest.TestCase):
    def run_cli(self, *args, cwd=None):
        return subprocess.run([sys.executable, str(BUILD / 'validate.py'), *map(str, args)],
                              cwd=cwd, text=True, capture_output=True)

    def test_committed_snapshot_and_default_path_outside_repo(self):
        with tempfile.TemporaryDirectory() as tmp:
            result = self.run_cli('--json', cwd=tmp)
        self.assertEqual(result.returncode, 0, result.stderr)
        report = json.loads(result.stdout)
        self.assertEqual(report['errors'], 0)
        self.assertGreater(report['counts']['hops'], 0)

    def test_json_cli_strict_and_bad_input(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'data.json'
            data = fixture()
            data['its'][0]['kl'][0] = 250
            path.write_text(json.dumps(data))
            self.assertEqual(self.run_cli(path).returncode, 0)
            result = self.run_cli(path, '--strict', '--json')
            self.assertEqual(result.returncode, 1)
            self.assertEqual(json.loads(result.stdout)['status'], 'FAIL')
            path.write_text('{broken json')
            result = self.run_cli(path, '--json')
            self.assertEqual(result.returncode, 1)
            self.assertEqual(json.loads(result.stdout)['issues'][0]['code'], 'input')
            self.assertEqual(self.run_cli(Path(tmp) / 'missing.json').returncode, 1)
            self.assertEqual(self.run_cli('--max-kmh', 'nan').returncode, 2)

    def test_large_inconsistent_sample_count_fails_promptly(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'data.json'
            data = fixture()
            data['its'][0]['sn'][0] = 1_000_000_000
            path.write_text(json.dumps(data))
            result = subprocess.run([sys.executable, str(BUILD / 'validate.py'), str(path), '--json'],
                                    capture_output=True, text=True, timeout=5)
            self.assertEqual(result.returncode, 1)
            self.assertIn('coverage_length', {i['code'] for i in json.loads(result.stdout)['issues']})

    def test_assembly_is_reproducible_and_failure_preserves_output(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            shutil.copytree(BUILD, root / 'build', ignore=shutil.ignore_patterns('__pycache__'))
            output = root / 'index.html'
            original = (BUILD.parent / 'index.html').read_bytes()
            output.write_bytes(original)
            command = ['sh', str(root / 'build' / 'assemble.sh')]
            result = subprocess.run(command, cwd=tmp, capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(output.read_bytes(), original)
            # Both explicit data and reused embedded data must pass the gate.
            data = fixture()
            data['its'][0]['cv']['att'] = 'g'
            path = root / 'bad.json'
            path.write_text(json.dumps(data))
            result = subprocess.run(command + [str(path)], cwd=tmp, capture_output=True)
            self.assertNotEqual(result.returncode, 0)
            self.assertEqual(output.read_bytes(), original)
            invalid_html = '\nconst DATA=' + json.dumps(data) + ';\n'
            output.write_text(invalid_html)
            result = subprocess.run(command, cwd=tmp, capture_output=True)
            self.assertNotEqual(result.returncode, 0)
            self.assertEqual(output.read_text(), invalid_html)

    def test_data_builder_validates_before_replacing_output(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / 'gtfs').mkdir()
            (root / 'gtfs' / 'stops.txt').write_text(
                'stop_id,stop_name,stop_lat,stop_lon,stop_timezone\n'
                'AAA,Origin,40,-80,America/New_York\n'
                'BBB,Destination,40,-80.1,America/New_York\n')
            (root / 'gtfs' / 'shapes.txt').write_text(
                'shape_id,shape_pt_sequence,shape_pt_lat,shape_pt_lon\n')
            (root / 'geo_raw.json').write_text(json.dumps(dict(cities=[], states=[], labels=[])))
            pattern = dict(name='Test', train='1', dep='08:00', days='1111111',
                           shape='none', stops=[['AAA', 0, 0], ['BBB', 60, 0]])
            source = root / 'routes_raw.json'
            source.write_text(json.dumps(dict(used=['AAA', 'BBB'], patterns=[pattern])))
            command = [sys.executable, str(BUILD / 'build_all.py')]
            result = subprocess.run(command, cwd=tmp, capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            output = root / 'data.json'
            original = output.read_bytes()
            self.assertFalse(validate(json.loads(original)).failed())
            pattern['stops'][1][2] = -1
            source.write_text(json.dumps(dict(used=['AAA', 'BBB'], patterns=[pattern])))
            result = subprocess.run(command, cwd=tmp, capture_output=True, text=True)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn('negative_dwell', result.stdout)
            self.assertEqual(output.read_bytes(), original)


if __name__ == '__main__':
    unittest.main()
