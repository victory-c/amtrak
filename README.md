# Amtrak signal map

**[jonathanjtan.github.io/amtrak](https://jonathanjtan.github.io/amtrak/)**

Name any two stations on the Amtrak network. The page maps where cellular
holds up and where it dies along the way, what is out the window, when the
dining car opens, and what to do before the bars disappear.

It started as a single hand-built page about one train, the California
Zephyr, and now covers 118 itineraries across 47 named routes and 534
stations. A journey no single train covers is split into legs you can step
through: Seattle to Miami is the Empire Builder to Chicago, then the
Floridian.

Everything except the satellite view is built into the one file, so a loaded
page keeps working with no signal at all, which is the point.

## What it knows

- **Coverage**, estimated for Verizon, AT&T and T-Mobile, with the totals
  stated plainly: the Zephyr is dead for about 10 hours on Verizon and 22 on
  T-Mobile.
- **Times**, local to the train's own position, shifting as it crosses zones,
  and correct across daylight-saving changes, which every long-distance train
  meets twice a year.
- **Darkness**, from the real position of the sun at the train's position and
  date, rather than a fixed guess at nightfall.
- **Scenery**, with the side of the train computed for the direction you are
  travelling, so the Pacific is on your left going north and your right going
  south.
- **Dining**, on the wall clock, so a late train meets each meal at an earlier
  point on its route.
- **Which way to go**, priced in dark hours as well as travelling ones. Seattle
  to New Orleans is 69 hours via Chicago or 106 via Los Angeles; on Verizon the
  short way is also the connected one, and on T-Mobile it is not.

## How coverage is worked out

It is modelled, not measured. For each point along the track: the population
within reach, the density of towns around it, and how tightly the track
curves, which is a decent stand-in for the canyons and passes where signal
dies. Fitted against the hand-authored, rider-reported coverage of the
original single-route version of this page, it agrees about four times in
five. Left to itself it finds Alpine to Del Rio in West Texas, the Montana
Hi-Line, Raton Pass and the Cascade crossing.

Treat it as a guide and check your own carrier's map. [build/README.md](build/README.md)
has the details, including what was tried and did not work.

## Building

`index.html` is generated; edit the sources in [build/](build/) and run
`build/assemble.sh`. Data comes from Amtrak's published GTFS feed, US Census
state boundaries, and GeoNames. None of it is vendored here. See
[build/README.md](build/README.md).

Run `python3 build/validate.py` to check the embedded network without downloading
the feeds. Both build steps validate data before writing output; structural errors
fail the build, while suspicious source data is reported as warnings. Use
`--strict` to fail on warnings too, or `--json` for the complete report.
