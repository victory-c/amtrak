#!/usr/bin/env python3
"""Validate the compact DATA schema without fetching source feeds.

Times are agency-clock minutes, including values beyond midnight. Station time
zones affect display only; subtracting their offsets would invent elapsed time.
"""
import argparse
from collections import Counter
from dataclasses import dataclass, field
import json
import math
from pathlib import Path
import re
import sys
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

CARRIERS = ('verizon', 'att', 'tmobile')
REGIONS = set(('AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD '
               'MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD '
               'TN TX UT VT VA WA WV WI WY AB BC MB NB NL NS NT NU ON PE QC SK YT').split())


def number(value):
    return type(value) in (int, float) and math.isfinite(value)


def integer(value):
    return type(value) is int


def coordinate(point):
    return (isinstance(point, list) and len(point) == 2
            and all(number(v) for v in point)
            and -90 <= point[0] <= 90 and -180 <= point[1] <= 180)


def hav(a, b):
    lat1, lat2 = map(math.radians, (a[0], b[0]))
    dlat, dlon = lat2 - lat1, math.radians(b[1] - a[1])
    x = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon / 2) ** 2
    return 12742 * math.asin(math.sqrt(max(0, min(1, x))))


def unique_object(pairs):
    out = {}
    for key, value in pairs:
        if key in out:
            raise ValueError(f'duplicate JSON key: {key!r}')
        out[key] = value
    return out


def parse_data(text, embedded=False):
    if embedded:
        match = re.search(r'\nconst DATA=(.*?);\n', text, re.S)
        if not match:
            raise ValueError('could not find the embedded const DATA block')
        text = match[1]
    return json.loads(text, object_pairs_hook=unique_object)


def coverage_intervals(seq, samples):
    """Agency-clock intervals, including intermediate dwell but not either end."""
    for j, (a, b) in enumerate(zip(seq, seq[1:])):
        arrival = b[1] - b[2]
        span = arrival - a[1]
        for k in range(samples[j]):
            yield (a[1] + span * k / samples[j], a[1] + span * (k + 1) / samples[j])
        if j + 1 < len(seq) - 1 and b[2]:
            yield (arrival, b[1])


def check_intervals(intervals, start, end, report, location):
    previous = start
    total = 0
    for a, b in intervals:
        if not math.isclose(a, previous, abs_tol=1e-7):
            code = 'coverage_gap' if a > previous else 'coverage_overlap'
            report.add(code, location, f'interval starts at {a:g}, expected {previous:g}')
        if b <= a:
            report.add('coverage_interval', location, f'nonpositive interval [{a:g}, {b:g}]')
        total += b - a
        previous = b
    if not math.isclose(previous, end, abs_tol=1e-7) or not math.isclose(total, end - start, abs_tol=1e-7):
        report.add('journey_duration', location, 'coverage intervals do not partition the departure-to-arrival duration')


@dataclass
class Report:
    counts: dict = field(default_factory=lambda: dict(stations=0, itineraries=0, hops=0, station_pairs=0))
    issues: list = field(default_factory=list)

    def add(self, code, location, message, severity='error'):
        self.issues.append(dict(severity=severity, code=code, location=location, message=message))

    def failed(self, strict=False):
        return any(i['severity'] == 'error' or strict for i in self.issues)

    def as_dict(self, strict=False):
        return dict(status='FAIL' if self.failed(strict) else 'PASS', counts=self.counts,
                    errors=sum(i['severity'] == 'error' for i in self.issues),
                    warnings=sum(i['severity'] == 'warning' for i in self.issues), issues=self.issues)


def validate(data, max_kmh=200):
    report = Report()
    add = report.add
    if not isinstance(data, dict):
        add('schema', 'DATA', 'expected an object')
        return report
    tzs, stops, its = (data.get(k) for k in ('tz', 'stops', 'its'))
    if not isinstance(tzs, list) or not tzs:
        add('schema', 'tz', 'expected a nonempty timezone list')
        tzs = []
    for i, name in enumerate(tzs):
        try:
            if not isinstance(name, str):
                raise ValueError('expected a timezone name')
            ZoneInfo(name)
        except (ValueError, ZoneInfoNotFoundError):
            add('timezone', f'tz[{i}]', f'invalid/unavailable IANA timezone: {name!r}')
    if not isinstance(stops, dict) or not stops:
        add('schema', 'stops', 'expected a nonempty station object')
        stops = {}
    good_stops = {}
    report.counts['stations'] = len(stops)
    for code, stop in stops.items():
        loc = f'stops.{code}'
        if not isinstance(code, str) or not code.strip():
            add('station_code', loc, 'station code must be nonempty text')
        if not isinstance(stop, list) or len(stop) != 5:
            add('schema', loc, 'expected [name, lat, lon, timezone index, state/province]')
            continue
        name, lat, lon, tz, region = stop
        if not isinstance(name, str) or not name.strip():
            add('station_name', loc, 'station name must be nonempty text')
        if not coordinate([lat, lon]):
            add('coordinate', loc, 'expected finite latitude/longitude in geographic bounds')
        else:
            good_stops[code] = stop
            if not (24 <= lat <= 60 and -130 <= lon <= -50):
                add('station_location', loc, 'outside the expected continental Amtrak area', 'warning')
        if not integer(tz) or not 0 <= tz < len(tzs):
            add('timezone_reference', loc, f'invalid timezone index: {tz!r}')
        if not isinstance(region, str) or (region and region not in REGIONS):
            add('region', loc, f'unknown state/province abbreviation: {region!r}')
        elif not region:
            add('region_missing', loc, 'no region in source data; Canadian and coastal stops may be blank', 'warning')
    if not isinstance(its, list) or not its:
        add('schema', 'its', 'expected a nonempty itinerary list')
        return report
    report.counts['itineraries'] = len(its)
    used = set()
    for index, it in enumerate(its):
        loc = f'its[{index}]'
        if not isinstance(it, dict):
            add('schema', loc, 'expected an itinerary object')
            continue
        loc += f' ({it.get("n", "?")} train {it.get("tr", "?")})'
        for key in ('n', 'tr'):
            if not isinstance(it.get(key), str) or not it[key].strip():
                add('schema', loc, f'{key} must be nonempty text')
        dep = it.get('dep')
        # build_pat.py slices GTFS strings to five characters, so a one-digit
        # hour is stored as "8:20:". core.js uses only the first two fields.
        if not isinstance(dep, str) or not re.fullmatch(r'(?:\d{2,}:[0-5]\d|\d:[0-5]\d:?)', dep):
            add('departure', loc, 'dep must be HH:MM in agency time (hours may exceed 23)')
        days = it.get('dy')
        if not isinstance(days, str) or not re.fullmatch(r'[01]{7}', days) or '1' not in days:
            add('service_days', loc, 'dy must contain seven 0/1 flags with at least one running day')
        seq = it.get('s')
        if not isinstance(seq, list) or len(seq) < 2:
            add('schema', loc, 's must contain at least two stops')
            continue
        n = len(seq)
        report.counts['hops'] += n - 1
        report.counts['station_pairs'] += n * (n - 1) // 2
        timing_ok = True
        seen = set()
        for j, row in enumerate(seq):
            rowloc = f'{loc}.s[{j}]'
            if (not isinstance(row, list) or len(row) != 3
                    or not isinstance(row[0], str) or not all(number(v) for v in row[1:])):
                add('schema', rowloc, 'expected [station code, departure minutes, dwell minutes]')
                timing_ok = False
                continue
            code, minute, dwell = row
            used.add(code)
            if code not in stops:
                add('station_reference', rowloc, f'unknown station: {code}')
            if code in seen:
                add('repeated_station', rowloc, f'{code} appears twice; check for a loop or duplicated stop', 'warning')
            seen.add(code)
            if minute < 0 or (j == 0 and minute != 0):
                add('departure_offset', rowloc, 'departure offsets must be nonnegative and start at zero')
            if dwell < 0:
                add('negative_dwell', rowloc, f'negative dwell: {dwell:g} minutes')
        arrays_ok = {}
        for key, size in (('i', n), ('sn', n - 1), ('kl', n - 1)):
            value = it.get(key)
            arrays_ok[key] = isinstance(value, list) and len(value) == size
            if not arrays_ok[key]:
                add('array_length', loc, f'{key} must have {size} entries')
        poly = it.get('p')
        poly_ok = isinstance(poly, list) and len(poly) >= 2 and all(coordinate(p) for p in poly)
        if not poly_ok:
            add('polyline', loc, 'p must contain at least two valid [lat, lon] points')
        anchors = it.get('i', [])
        if arrays_ok['i']:
            if not poly_ok or not all(integer(i) and 0 <= i < len(poly) for i in anchors):
                add('anchor_index', loc, 'station anchors must index the polyline')
            else:
                if anchors[0] != 0 or anchors[-1] != len(poly) - 1 or any(a >= b for a, b in zip(anchors, anchors[1:])):
                    add('route_continuity', loc, 'anchors must strictly increase and cover the whole polyline')
                for j, row in enumerate(seq):
                    if isinstance(row, list) and row and isinstance(row[0], str) and row[0] in good_stops:
                        distance = hav(poly[anchors[j]], good_stops[row[0]][1:3])
                        if distance > 0.1:
                            add('station_anchor', f'{loc}.i[{j}]', f'polyline misses {row[0]} by {distance:.2f} km')
        sn = it.get('sn', [])
        sampling_ok = arrays_ok['sn'] and all(integer(v) and v > 0 for v in sn)
        if arrays_ok['sn'] and not sampling_ok:
            add('coverage_samples', loc, 'sn entries must be positive integers')
        cv = it.get('cv')
        coverage_ok = sampling_ok and isinstance(cv, dict)
        if not isinstance(cv, dict):
            add('coverage', loc, 'cv must be an object with all three carriers')
        else:
            for carrier in CARRIERS:
                value = cv.get(carrier)
                if not isinstance(value, str) or any(c not in 'gsd' for c in value):
                    coverage_ok = False
                    add('coverage_status', loc, f'{carrier}: expected a string of g/s/d statuses')
                elif sampling_ok and len(value) != sum(sn):
                    coverage_ok = False
                    add('coverage_length', loc, f'{carrier}: {len(value)} samples, expected {sum(sn)}; missing or extra coverage')
        kl = it.get('kl', [])
        distance_ok = arrays_ok['kl'] and all(number(v) and v > 0 for v in kl)
        if arrays_ok['kl'] and not distance_ok:
            add('segment_distance', loc, 'kl entries must be finite positive kilometres')
        if timing_ok:
            for j, (a, b) in enumerate(zip(seq, seq[1:])):
                hoploc = f'{loc} {a[0]}->{b[0]}'
                minutes = b[1] - b[2] - a[1]
                if minutes <= 0:
                    add('nonpositive_travel', hoploc, f'{minutes:g} travel minutes after subtracting destination dwell')
                elif distance_ok and kl[j] * 60 / minutes > max_kmh:
                    add('implied_speed', hoploc, f'{kl[j] * 60 / minutes:.1f} km/h ({kl[j]:g} km in {minutes:g} min), limit {max_kmh:g}', 'warning')
                if distance_ok and a[0] in good_stops and b[0] in good_stops:
                    direct = hav(good_stops[a[0]][1:3], good_stops[b[0]][1:3])
                    # Source shapes can end short of station coordinates. Report
                    # substantial discrepancies, not rounding or small snap errors.
                    if kl[j] + max(1, direct * 0.02) < direct:
                        add('short_segment_distance', hoploc, f'{kl[j]:g} track km < {direct:.1f} straight-line km', 'warning')
            # Do not expand bogus sample counts when the coverage strings have
            # already proved incomplete; validation work stays bounded by input.
            if coverage_ok and all(row[2] >= 0 for row in seq):
                check_intervals(coverage_intervals(seq, sn), seq[0][1], seq[-1][1] - seq[-1][2], report, loc)
    for code in sorted(set(stops) - used):
        add('unused_station', f'stops.{code}', 'not referenced by an itinerary', 'warning')
    return report


def print_report(report, strict=False):
    result = report.as_dict(strict)
    for key, value in result['counts'].items():
        # Pairs are a size statistic, not an assertion that the application's
        # routing or date-dependent JS code has been exercised.
        verb = 'represented' if key == 'station_pairs' else 'inspected'
        print(f'{value:,} {key.replace("_", " ")} {verb}')
    groups = Counter((i['severity'], i['code']) for i in report.issues)
    for (severity, code), count in sorted(groups.items()):
        print(f'{severity.upper()} {code}: {count}')
        matches = [i for i in report.issues if (i['severity'], i['code']) == (severity, code)]
        for issue in matches[:3]:
            print(f'  {issue["location"]}: {issue["message"]}')
        if count > 3:
            print(f'  ... {count - 3} more (use --json for all findings)')
    print(f'{result["errors"]} errors, {result["warnings"]} warnings')
    print(f'AMTRAK_DATA_VALIDATION = {result["status"]}')


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('path', nargs='?', type=Path, help='data.json or index.html (default: repository index.html)')
    parser.add_argument('--strict', action='store_true', help='also fail on warnings')
    parser.add_argument('--json', action='store_true', help='emit the complete machine-readable report')
    parser.add_argument('--max-kmh', type=float, default=200, help='speed warning threshold (default: 200, matching core.js)')
    args = parser.parse_args(argv)
    if not math.isfinite(args.max_kmh) or args.max_kmh <= 0:
        parser.error('--max-kmh must be finite and positive')
    path = args.path or Path(__file__).resolve().parent.parent / 'index.html'
    try:
        text = path.read_text(encoding='utf-8')
        report = validate(parse_data(text, path.suffix.lower() in ('.html', '.htm')), args.max_kmh)
    except (OSError, ValueError) as exc:
        report = Report()
        report.add('input', str(path), str(exc))
    if args.json:
        print(json.dumps(report.as_dict(args.strict), indent=2))
    else:
        print_report(report, args.strict)
    return int(report.failed(args.strict))


if __name__ == '__main__':
    sys.exit(main())
