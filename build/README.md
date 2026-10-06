# Build

`index.html` is generated. Do not edit it directly; edit the sources here and re-assemble.

## Sources
- `core.js` — leg construction, time zones, coverage lookups, solar position, station names, scenery
- `map.js` — dynamic projection and SVG basemap
- `ui.js` — timeline, coverage cards, sights, dining
- `agenda.js` — "now happening / up next"
- `app.js` — station-first picker, live position, shareable URL, Leaflet map
- `style.css`, `body.html`, `head_extra.html` — page shell, favicon and link-preview metadata
- `assemble.sh` — concatenates the above plus `data.json` into `index.html`

## Data

`data.json` is built from three public sources, none of which are vendored here:

1. Amtrak GTFS — https://content.amtrak.com/content/gtfs/GTFS.zip
2. US state boundaries — https://cdn.jsdelivr.net/npm/us-atlas@3/states-10m.json (US Census, public domain)
3. GeoNames cities5000 — https://download.geonames.org/export/dump/cities5000.zip (CC BY 4.0)

Download those into a working directory, then:

Unpack the GTFS zip into `gtfs/` beside the other two, then, from that
directory:

```bash
python3 /path/to/repo/build/build_pat.py   # GTFS -> routes_raw.json
python3 /path/to/repo/build/build_geo.py   # boundaries + cities -> geo_raw.json
python3 /path/to/repo/build/build_all.py   # -> data.json
/path/to/repo/build/assemble.sh data.json  # -> index.html at the repo root
```

The scripts read their inputs from the working directory and write their
outputs there; only `assemble.sh` touches the repository, and it takes the
path to `data.json`. Nothing has a path baked into it, so the tree can live
anywhere.

One thing the scripts do not set: `FEED_WEEK` at the top of `core.js`, the week
the snapshot describes. Update it when you rebuild `data.json`. Both the footer
sentence and the warning shown when someone picks a date more than two months
away are generated from it, so they cannot drift apart, but neither can know
the feed has moved on unless you say so.

To change only the stylesheet or the scripts, run `build/assemble.sh` with no
argument: it reuses the data already embedded in `index.html`, so none of the
source feeds are needed.

Running days come from `calendar.txt`, unioned across every trip sharing a
terminal pair, so the Sunset Limited reads Mon/Wed/Sat westbound and Wed/Fri/Sun
eastbound rather than a route-wide blur.

Three GTFS details the build depends on:

- **Times are in the agency timezone (Eastern), not local to each stop.** Elapsed
  time is the raw difference; only the displayed clock changes zone. Reading them
  as stop-local inflates a transcontinental trip by the zone shift and can produce
  negative durations on short eastbound hops.
- **Some shapes are stored running the opposite way down the line.** Snapping
  stations to the track stalls unless the shape is flipped first. Detected by
  comparing the first stop's distance to each end.
- **A stop's time is its departure, and the dwell is a separate field.** Some
  waits are hours: four at San Antonio on the Texas Eagle, where the cars are
  handed to the Sunset Limited, and nearly as long at Philadelphia on the
  overnight Regional, which spends a third of its schedule standing. Reading the
  one time as the whole stop models the wait as motion, which put the train 73 km
  from San Antonio at the moment it pulled in. Travel runs from one departure to
  the next arrival; a stop with a wait appears twice in the polyline so position
  lookups hold still through it.

One feed error the page does not paper over: the Mardi Gras Service is
scheduled New Orleans to Bay St Louis in 24 minutes eastbound and 151 westbound,
over the same 92 km. Both cannot be right, and hand-writing a schedule would be
worse than reflecting the published one, so the page says so instead. Any hop
implying more than 200 km/h gets the same treatment — the fastest credible hop
on the network is 185 km/h, on the Corridor, so the check is quiet everywhere
else and will stay useful if the feed churns again.

Coverage is sampled roughly every 25 km, so a long nonstop leg gets real
resolution rather than a fixed handful of samples: the Auto Train's single
1,377 km run is 55 spans, not 10.

Those spans divide cumulative track distance, not the number of GTFS shape
vertices. `coverage_geometry.py` interpolates each midpoint along the track and
retains the interior vertices of the same distance window for the terrain
calculation. Adding collinear or duplicate vertices must not move the samples
or invent turns. The page still assigns equal running time to equal-distance
spans: this is a constant-speed approximation within each station-to-station
hop, not a model of local speed limits or acceleration.

The sampling change applies when `build_all.py` rebuilds `data.json`; reusing the
embedded data with `assemble.sh` does not recalculate coverage. The geometry and
builder regression tests need only Python's standard library and small fixtures:

```bash
python3 -m unittest discover -s build/tests -p test_coverage_geometry.py -v
```

`build_pat.py` keeps one itinerary per terminal pair per direction, dropping
short-turn variants whose stops are a subset of a longer one, so real branches
(Empire Builder to Seattle vs Portland) survive but 761 Northeast Regional trips
collapse to 10.

## What is curated by hand

Three things the page asserts are not in any feed and are named in `core.js`:

- `SIGHTS` — the scenery, with a match radius, which way to look and a
  description. A sight attaches to any route whose track passes within its
  radius, so adding one is a claim about geography, not about a route.
- `DINING_ROUTES` and `SIGHTSEER_ROUTES` — which trains carry a dining car, and
  which of those are Superliner and so have the glass-roofed Sightseer Lounge.
  GTFS says nothing about equipment, and trip length is a bad proxy: one
  Northeast Regional is scheduled for seventeen hours with only a café counter.
- The three long tunnels in the coverage model, below.

## The coverage model

Coverage is estimated, not measured. For each sub-segment midpoint:

```
strength = (nearest-town reach + density floor) / terrain penalty
```

- **nearest-town reach** — `max over towns of A*(pop/5000)^B / distance`. A town of
  5,000 reaches about 11 km, a city of 5,000,000 about 90 km.
- **density floor** — `C * max(0, log10(sum of population within 75 km) - D)`, so
  farmland dotted with small towns does not score the same as true wilderness.
  Without this the model called rural Nebraska dead.
- **terrain penalty** — from how tightly the track curves, in degrees of heading
  change per km. Mountain segments run 59–92; plains run 2–12. This is what catches
  canyons and passes, where towns are close but signal is not.
- Three long tunnels (Moffat, Cascade, Flathead) are marked by hand, because a
  10 km bore is invisible at 25 km sub-segment resolution.

`tune3.py` (run the same way) re-fits the parameters against the hand-authored, rider-reported
California Zephyr arrays from the first version of this page, which are preserved
in git at `1be12e7:index.html`. Current fit: **84%** agreement at station-segment
midpoints, and **76%** when sub-segments are collapsed to one status per station
segment. Errors are nearly all one class apart.

### Spot checks on other routes

The fit is against one route, so the model was checked against places known to be
bad. Its longest dead runs land where they should:

| Route | Longest dead run found |
|---|---|
| Sunset Limited | Alpine → Del Rio, 2h 09m (the Sanderson stretch of West Texas) |
| Empire Builder | Williston → Havre, 2h 57m (the Montana Hi-Line) |
| Coast Starlight | Redding → Klamath Falls, 3h 46m (the Cascade crossing) |
| Southwest Chief | Trinidad → Raton, 1h 02m (Raton Pass) |

None of these are curated; they fall out of population, town density and track
sinuosity alone.

### What did not work

**Highway proximity**, from the US Census TIGER primary-roads shapefile
(interstates and US routes, 17k records), made no difference: the fit chose a
weight of zero for both interstate and other-primary terms. Railroads and highways
follow the same valleys, so along a rail line the distance to a major road barely
varies and carries almost no signal. Not worth the build dependency.

**Measured terrain**, in place of the sinuosity proxy. Local relief was sampled
around each Zephyr segment midpoint (a 6 km ring of eight points, from Open-Meteo's
elevation API) and fitted three ways:

| Terrain term | Fit |
|---|---|
| Sinuosity only | 84% |
| Relief only | 80% |
| Both | 85% |

Relief on its own is worse than how tightly the track curves, and adding it on top
buys one segment out of ninety-nine. That is inside the noise, and the full build
would need roughly 135,000 elevation queries against a free API. The cheap proxy,
which comes free with track geometry the feed already ships, wins.

**Density-dependent carrier factors**, so that T-Mobile is penalised harder in
empty country rather than by a flat multiplier everywhere. Fits identically, 84%
either way. The flat multiplier already produces the behaviour, because a
multiplier below one pushes marginal rural segments under the threshold while
cities stay well clear of it.

### Where this leaves the model

Three separate additions have now failed to beat it, and the fit sits at 84%
whatever is added. That is the resolution limit of the validation data: ninety-nine
hand-authored judgements across one route cannot distinguish finer models, so a
more elaborate one could not be shown to be better even if it were. Improving the
estimate meaningfully needs more ground truth, not more parameters.
