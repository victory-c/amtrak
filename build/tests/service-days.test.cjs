const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {test} = require('node:test');
const BUILD = path.resolve(__dirname, '..');
const core = readFileSync(path.join(BUILD, 'core.js'), 'utf8');
const app = readFileSync(path.join(BUILD, 'app.js'), 'utf8');
const ui = readFileSync(path.join(BUILD, 'ui.js'), 'utf8');
const agenda = readFileSync(path.join(BUILD, 'agenda.js'), 'utf8');
const html = readFileSync(path.join(BUILD, '..', 'index.html'), 'utf8');
const snapshot = JSON.parse(html.match(/\nconst DATA=(.*?);\n/s)[1]);

function section(source, start, end) {
  const a = source.indexOf(start), b = source.indexOf(end, a);
  assert.ok(a >= 0 && b > a, `source section ${start}`);
  return source.slice(a, b);
}

function runtime(data, date = '2026-10-06') {
  const controls = new Map();
  const element = () => ({value: '', appendChild() {}});
  const context = vm.createContext({
    DATA: data,
    document: {
      getElementById(id) {
        if (!controls.has(id)) controls.set(id, element());
        return controls.get(id);
      },
      createElement: element,
    },
    window: {matchMedia: () => ({matches: false})},
  });
  // Execute the shipped core and routing functions without the page bootstrap,
  // drawing, event handlers or external map library. No copied date algorithms.
  const boundary = app.indexOf('let journey=null;');
  assert.ok(boundary > 0, 'routing section boundary exists');
  vm.runInContext(core + '\n' + ui + '\n' + app.slice(0, boundary) + '\nlet journey=null;\n' +
    section(app, 'function labelRoutes(){', 'function fillRouteSel(') + '\n' +
    section(app, 'function runAboardNow(){', 'function offerRunAboard(') + '\n' + agenda, context);
  controls.get('depDate').value = date;
  return code => JSON.parse(JSON.stringify(vm.runInContext(code, context)));
}

function fixture(its, west = false) {
  return {tz: ['America/New_York', 'America/Los_Angeles'],
    stops: {A: ['A', 40, -80, west ? 1 : 0, 'PA'],
            X: ['X', 40, -81, west ? 1 : 0, 'OH'],
            B: ['B', 40, -82, 0, 'OH'], C: ['C', 40, -83, 0, 'OH']}, its};
}
function train(n, dep, dy, s) {return {n, tr: n, dep, dy, s};}

test('Sunset Limited at Alpine Tuesday belongs to Monday originating service', () => {
  const run = runtime(snapshot);
  const result = run(`(() => {
    const it=ITS.find(it=>it.n==='Sunset Limited' && it.s[0][0]==='NOL');
    const o=it.s.findIndex(s=>s[0]==='ALP');
    return {date:boardingRun(it,o,'2026-10-06').date,
      tuesday:runsOn(it,'2026-10-06',o), monday:runsOn(it,'2026-10-05',o),
      days:runDays(it,'2026-10-06',o)};
  })()`);
  assert.equal(result.date, '2026-10-05');
  assert.equal(result.tuesday, true);
  assert.equal(result.monday, false);
  assert.deepEqual(result.days, ['Tue', 'Thu', 'Sun']);
});

test('first stop, daily service, and missing date retain their behavior', () => {
  const run = runtime(fixture([
    train('Monday', '08:00', '1000000', [['A', 0, 0], ['B', 60, 0]]),
    train('Daily', '08:00', '1111111', [['A', 0, 0], ['B', 60, 0]]),
  ]));
  assert.equal(run(`runsOn(ITS[0],'2026-10-05',0)`), true);
  assert.equal(run(`runsOn(ITS[0],'2026-10-06',0)`), false);
  assert.equal(run(`runsOn(ITS[0],'',0)`), true);
  assert.equal(run(`runDays(ITS[1],'2026-10-06',0).length`), 7);
});

test('western local boarding date can precede the agency service date', () => {
  const run = runtime(fixture([
    train('Monday', '01:00', '1000000', [['A', 0, 0], ['B', 300, 0]]),
  ], true), '2026-10-04');
  assert.equal(run(`boardingRun(ITS[0],0,'2026-10-04').date`), '2026-10-05');
  assert.equal(run(`runsOn(ITS[0],'2026-10-04',0)`), true);
  assert.equal(run(`runsOn(ITS[0],'2026-10-05',0)`), false);
  assert.deepEqual(run(`runDays(ITS[0],'2026-10-04',0)`), ['Sun']);
});

test('multi-day offsets and year boundaries resolve originating weekday', () => {
  const run = runtime(fixture([
    train('Monday', '08:00', '1000000', [['A', 0, 0], ['X', 2880, 0], ['B', 3000, 0]]),
  ]));
  assert.equal(run(`boardingRun(ITS[0],1,'2026-12-30').date`), '2026-12-28');
  assert.equal(run(`runsOn(ITS[0],'2026-12-30',1)`), true);
  assert.equal(run(`runsOn(ITS[0],'2027-01-01',1)`), false);
});

test('direct services rank the valid originating run above a shorter unavailable one', () => {
  const run = runtime(fixture([
    train('Unavailable Tuesday run', '08:00', '0100000', [['A', 0, 0], ['X', 1440, 0], ['B', 1470, 0]]),
    train('Available Monday run', '08:00', '1000000', [['A', 0, 0], ['X', 1440, 0], ['B', 1500, 0]]),
  ]));
  assert.deepEqual(run(`servicesFor('X','B').map(c=>c.i)`), [1, 0]);
});

test('transfer boards a Monday train at its Tuesday intermediate stop', () => {
  const run = runtime(fixture([
    train('First', '08:00', '1111111', [['A', 0, 0], ['X', 60, 0]]),
    train('Monday train', '10:00', '1000000', [['B', 0, 0], ['X', 1440, 0], ['C', 1500, 0]]),
  ]));
  assert.deepEqual(run(`chainWaits([{i:0,o:0,e:1,mins:60},{i:1,o:1,e:2,mins:60}])`),
    {waits: [60], offsets: [0, 0]});
});

test('missing a sparse connection waits for its next originating service', () => {
  const run = runtime(fixture([
    train('First', '09:00', '1111111', [['A', 0, 0], ['X', 45, 0]]),
    train('Monday train', '10:00', '1000000', [['B', 0, 0], ['X', 1440, 0], ['C', 1500, 0]]),
  ]));
  assert.deepEqual(run(`chainWaits([{i:0,o:0,e:1,mins:45},{i:1,o:1,e:2,mins:60}])`),
    {waits: [10095], offsets: [0, 7]});
});

test('first mid-route boarding and next train both retain their service dates', () => {
  const run = runtime(fixture([
    train('First', '08:00', '1000000', [['B', 0, 0], ['A', 1440, 0], ['X', 1500, 0]]),
    train('Second', '10:00', '0100000', [['X', 0, 0], ['C', 60, 0]]),
  ]));
  assert.deepEqual(run(`chainWaits([{i:0,o:1,e:2,mins:60},{i:1,o:0,e:1,mins:60}])`),
    {waits: [60], offsets: [0, 0]});
});

test('connection offsets use the next boarding station local date', () => {
  const run = runtime(fixture([
    train('First', '23:30', '1111111', [['A', 0, 0], ['X', 60, 0]]),
    train('Monday agency run', '01:00', '1000000', [['X', 0, 0], ['B', 300, 0]]),
  ], true), '2026-10-04');
  assert.deepEqual(run(`chainWaits([{i:0,o:0,e:1,mins:60},{i:1,o:0,e:1,mins:300}])`),
    {waits: [30], offsets: [0, 0]});
});

test('a western connection can board on the previous local calendar date', () => {
  const data = fixture([
    train('First', '00:30', '1000000', [['A', 0, 0], ['X', 30, 0]]),
    train('Monday agency run', '01:30', '1000000', [['X', 0, 0], ['B', 300, 0]]),
  ]);
  data.stops.X[3] = 1;
  const run = runtime(data, '2026-10-05');
  assert.deepEqual(run(`chainWaits([{i:0,o:0,e:1,mins:30},{i:1,o:0,e:1,mins:300}])`),
    {waits: [30], offsets: [0, -1]});
});

test('two transfers retain service dates and accumulate local boarding offsets', () => {
  const run = runtime(fixture([
    train('First', '22:00', '1111111', [['A', 0, 0], ['X', 60, 0]]),
    train('Monday train', '01:00', '1000000', [['B', 0, 0], ['X', 2880, 0], ['C', 4380, 0]]),
    train('Tuesday train', '03:00', '0100000', [['B', 0, 0], ['C', 2880, 0], ['A', 2940, 0]]),
  ]));
  assert.deepEqual(run(`chainWaits([{i:0,o:0,e:1,mins:60},{i:1,o:1,e:2,mins:1500},{i:2,o:1,e:2,mins:60}])`),
    {waits: [120, 60], offsets: [0, 1, 2]});
});

test('station weekday mapping follows offset differences in the selected week', () => {
  const data = fixture([train('Monday', '01:30', '1000000', [['A', 0, 0], ['X', 60, 0]])]);
  data.tz[1] = 'America/Phoenix';
  data.stops.X[3] = 1;
  const run = runtime(data);
  assert.deepEqual(run(`runDays(ITS[0],'2026-01-05',1)`), ['Mon']);
  assert.deepEqual(run(`runDays(ITS[0],'2026-07-06',1)`), ['Sun']);
});

test('route picker labels show running days at the selected boarding stop', () => {
  const run = runtime(snapshot);
  const label = run(`(() => {
    const i=ITS.findIndex(it=>it.n==='Sunset Limited' && it.s[0][0]==='NOL');
    const o=ITS[i].s.findIndex(s=>s[0]==='ALP');
    routeSel.options=[{value:i+':'+o+':'+(o+1)}];
    labelRoutes();
    return routeSel.options[0].textContent;
  })()`);
  assert.match(label, /Tue\/Thu\/Sun/);
  assert.doesNotMatch(label, /Mon\/Wed\/Sat/);
});

test('connection agenda shows the next train running days at the interchange', () => {
  const run = runtime(fixture([
    train('First', '08:00', '1111111', [['A', 0, 0], ['X', 60, 0]]),
    train('Monday train', '10:00', '1000000', [['B', 0, 0], ['X', 1440, 0], ['C', 1500, 0]]),
  ]));
  assert.deepEqual(run(`(() => {
    IT=ITS[0]; O=0; E=1;
    LEG={dep:boardingRun(IT,O,depDate.value).inst,TOTAL:1};
    journey={start:depDate.value,pick:0,leg:1,list:[
      withWaits(['X'],[{i:0,o:0,e:1,mins:60},{i:1,o:1,e:2,mins:60}])]};
    return journeyLegContext().nextDays;
  })()`), ['Tue']);
});

test('live boarding hint does not offer a run on a nonoperating service date', () => {
  const run = runtime(fixture([
    train('Monday', '08:00', '1000000', [['A', 0, 0], ['B', 60, 0]]),
  ]), '2026-10-07');
  assert.equal(run(`(() => {
    IT=ITS[0]; O=0; E=1; LEG={TOTAL:1};
    Date.now=()=>Date.parse('2026-10-06T12:30:00Z');
    return runAboardNow();
  })()`), null);
  assert.equal(run(`(() => {IT.dy='1111111'; return runAboardNow().date;})()`), '2026-10-06');
});
