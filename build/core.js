/* ================= California Zephyr → any Amtrak leg =================
   DATA is built from Amtrak's published GTFS feed; coverage is modelled
   (see the footer) rather than measured. Everything here runs offline. */
const NS="http://www.w3.org/2000/svg";
const el=(n,a)=>{const e=document.createElementNS(NS,n);for(const k in a)e.setAttribute(k,a[k]);return e;};
const $=id=>document.getElementById(id);
const TZ=DATA.tz, ST=DATA.stops, ITS=DATA.its;
const CARRIER_NAME={verizon:"Verizon",att:"AT&T",tmobile:"T-Mobile"};
/* Nothing in the feed says what equipment a train runs, and length is a poor
   guess: one Northeast Regional is scheduled for 17 hours and still has only a
   café counter. So the two things the page asserts about the inside of a train
   are named, not inferred.
   A dining car goes with sleeping cars, on the long-distance network.
   The glass-roofed Sightseer Lounge is a Superliner car, so it runs west and
   south of Chicago and not on the eastern routes, which are single-level
   because of the tunnels into New York and Washington. */
const DINING_ROUTES=new Set(["California Zephyr","Coast Starlight","Empire Builder",
  "Southwest Chief","Sunset Limited","Texas Eagle","City of New Orleans",
  "Lake Shore Limited","Crescent","Silver Meteor","Silver Star","Cardinal",
  "Floridian","Capitol Limited","Auto Train"]);
const SIGHTSEER_ROUTES=new Set(["California Zephyr","Coast Starlight","Empire Builder",
  "Southwest Chief","Sunset Limited","Texas Eagle","City of New Orleans",
  "Capitol Limited","Auto Train"]);
const hasSightseer=()=>!!(IT&&SIGHTSEER_ROUTES.has(IT.n));
/* Read the coverage colours from the stylesheet rather than keeping a second
   copy here. They were edited in one place and not the other, which left the
   legend swatches and the strip drawing two different greens. */
let _palTheme=null,_pal=null;
function covColors(){
  const t=document.documentElement.dataset.theme||"dark";
  if(t===_palTheme&&_pal) return _pal;
  const cs=getComputedStyle(document.documentElement);
  const read=(n,fallback)=>(cs.getPropertyValue(n)||"").trim()||fallback;
  _palTheme=t;
  _pal={good:read("--good","#43b98a"),spotty:read("--spotty","#e6a93c"),dead:read("--dead","#e5544a")};
  return _pal;
}
const STAT={good:"Usable",spotty:"Spotty",dead:"No service"};
const LONG={g:"good",s:"spotty",d:"dead"};
/* The week the GTFS snapshot in this file describes. Update it whenever
   data.json is rebuilt: the footer sentence and the stale-date warning are both
   generated from it, so they cannot drift apart or from the data. */
const FEED_WEEK="2026-09-03";
const FEED_HORIZON=60;                      /* days either side we will vouch for */
/* Not every train runs every day: the Sunset Limited goes three times a week,
   and the Texas Eagle's through cars to Los Angeles likewise. */
const DAY3=["Mon","Tue","Wed","Thu","Fri","Sat","Sun"];
const shiftDate=(str,days)=>{const p=str.split("-").map(Number);
  return new Date(Date.UTC(p[0],p[1]-1,p[2]+days)).toISOString().slice(0,10);};
/* Show running days at the boarding stop, in the selected week. The originating
   service's Monday can be this stop's Tuesday (or its Sunday, farther west). */
function runDays(it,dateStr,o=0){
  if(!dateStr) return DAY3.filter((d,i)=>(it.dy||"1111111")[i]==="1");
  const monday=shiftDate(dateStr,-weekdayOf(dateStr));
  return DAY3.filter((d,i)=>runsOn(it,shiftDate(monday,i),o));
}
/* Monday-based weekday, to index the seven running-day flags */
function weekdayOf(dateStr){
  if(!dateStr) return 0;
  const p=dateStr.split("-").map(Number);
  return (new Date(p[0],p[1]-1,p[2]).getDay()+6)%7;
}
function runsOn(it,dateStr,o=0){
  if(!dateStr) return true;
  const serviceDate=boardingRun(it,o,dateStr).date;
  return ((it.dy||"1111111")[weekdayOf(serviceDate)]==="1");
}
const listDays=a=>a.length>1?a.slice(0,-1).join(", ")+" and "+a[a.length-1]:a[0];
/* The feed's names are inconsistent for a few big stations, and three Boston
   stops share one name; these are display fixes, not new data. */
const NAME_FIX={NYP:"New York Penn Station",BOS:"Boston South Station",BBY:"Boston Back Bay",
  BON:"Boston North Station",WAS:"Washington Union Station",PHL:"Philadelphia 30th Street",
  NHV:"New Haven Union Station",STS:"New Haven State Street",
  /* the timetable and every rider call these what follows; the feed does not */
  ABQ:"Albuquerque",BWI:"BWI Thurgood Marshall Airport"};
/* extra words people are likely to type */
const ALIAS={NYP:"nyc new york city penn moynihan",WAS:"dc washington",LAX:"los angeles la union",
  CHI:"chicago union",EMY:"emeryville san francisco bay",SFC:"san francisco",PDX:"portland oregon",
  POR:"portland maine",SEA:"seattle king street",NOL:"new orleans",
  /* the feed carries no province, so the words people would type are not there */
  VAC:"vancouver bc british columbia canada",VAN:"vancouver washington",
  TWO:"toronto ontario canada",MTR:"montreal quebec canada"};
/* the feed title-cases crudely: Mccook, Ny State Fair */
const tidy=n=>n.replace(/\bMc([a-z])/g,(m,x)=>"Mc"+x.toUpperCase()).replace(/^Ny /,"New York ");
const stationName=c=>NAME_FIX[c]||tidy(ST[c][0]);
/* The feed puts Vancouver in Oregon. It is at 45.63N, north of the Columbia and
   of Portland, and the train's next stop up the line is already in Washington —
   a northbound run does not cross the state line twice. Six more US stops carry
   no state at all, all of them on a coast or a riverbank. Canadian stops
   correctly have none and keep it that way. */
const STATE_FIX={VAN:"WA",BAS:"MS",SJM:"MI",EDM:"WA",BEL:"WA",BNG:"WA",VEC:"CA",WAS:"DC"};
const stateOf=c=>STATE_FIX[c]||(ST[c]&&ST[c][4])||"";
const stopLabel=c=>stationName(c)+(stateOf(c)?", "+stateOf(c):"")+" ("+c+")";
const searchKey=c=>(stationName(c)+" "+stateOf(c)+" "+c+" "+(ALIAS[c]||"")).toLowerCase();
/* Headings want the city, not the paperwork: "Chicago Union Station, IL" reads
   as Chicago. But nineteen names on the network belong to more than one town —
   Portland OR and Portland ME, Springfield IL and MA, three Burlingtons — and
   for those the state is the whole point, so it stays. */
const bareName=n=>n.replace(/ Amtrak.*/,"").replace(/ Station$/,"").replace(/,.*/,"")
  .replace(/ Union.*/,"").replace(/ (Regional )?Transportation Center$/,"").trim();
const PLACE=(()=>{
  const codes=[...new Set([].concat.apply([],ITS.map(it=>it.s.map(x=>x[0]))))].filter(c=>ST[c]);
  const bare={},n1={},lvl={},n2={},out={};
  codes.forEach(c=>{const b=bareName(stationName(c)); bare[c]=b; n1[b]=(n1[b]||0)+1;});
  /* shared name: add the state */
  codes.forEach(c=>{const l=(n1[bare[c]]>1&&stateOf(c))?bare[c]+", "+stateOf(c):bare[c];
    lvl[c]=l; n2[l]=(n2[l]||0)+1;});
  /* still shared: two stations in one city, and only the code tells them apart.
     Burbank has a downtown stop and an airport stop, and the feed names both
     of them Burbank. */
  codes.forEach(c=>{out[c]=n2[lvl[c]]>1?lvl[c]+" ("+c+")":lvl[c];});
  return out;
})();
const place=c=>PLACE[c]||bareName(stationName(c));


/* ---------- time zones ---------- */
const _dtf={};
function tzOffset(tz,d){                    // true minutes east of UTC for that zone at that instant
  const f=_dtf[tz]||(_dtf[tz]=new Intl.DateTimeFormat("en-US",{timeZone:tz,hour12:false,
    year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",second:"2-digit"}));
  const p={}; f.formatToParts(d).forEach(x=>p[x.type]=x.value);
  return Math.round((Date.UTC(+p.year,+p.month-1,+p.day,(+p.hour)%24,+p.minute,+p.second)-d.getTime())/60000);
}
function fmtLocal(d,tz){
  const p=new Intl.DateTimeFormat("en-US",{timeZone:tz,hour:"numeric",minute:"2-digit",weekday:"short",hour12:true}).formatToParts(d);
  const g=t=>(p.find(x=>x.type===t)||{}).value||"";
  return {time:(g("hour")+":"+g("minute")+(g("dayPeriod")==="AM"?"a":"p")).replace(/ /g,""),day:g("weekday")};
}
const AGENCY_TZ="America/New_York";
function agencyInstant(dateStr,minutes){        // an agency-local wall time on a given agency date
  const d=dateStr.split("-").map(Number);
  const off=Math.floor(minutes/1440), mm=((minutes%1440)+1440)%1440;
  const base=()=>Date.UTC(d[0],d[1]-1,d[2]+off,Math.floor(mm/60),mm%60);
  let g=base();
  for(let k=0;k<3;k++) g=base()-tzOffset(AGENCY_TZ,new Date(g))*60000;
  return new Date(g);
}
function ymdIn(d,tz){
  const p={}; new Intl.DateTimeFormat("en-US",{timeZone:tz,year:"numeric",month:"2-digit",day:"2-digit"})
    .formatToParts(d).forEach(x=>p[x.type]=x.value);
  return p.year+"-"+p.month+"-"+p.day;
}
/* The date the user picks is the date they board, local to the origin station.
   Returns the agency calendar date the run starts on, so every other stop can be
   resolved from its own wall-clock time rather than by adding raw minutes. */
function originInstant(dateStr,originMin,oTz){
  if(!dateStr) dateStr="2026-01-01";
  let base=dateStr;
  let inst=agencyInstant(base,originMin);
  const got=ymdIn(inst,oTz);
  if(got!==dateStr){
    const diff=Math.round((Date.parse(got+"T12:00:00Z")-Date.parse(dateStr+"T12:00:00Z"))/86400000);
    if(diff){
      const d=dateStr.split("-").map(Number);
      base=new Date(Date.UTC(d[0],d[1]-1,d[2]-diff)).toISOString().slice(0,10);
      inst=agencyInstant(base,originMin);
    }
  }
  return {inst:inst,date:base};
}
function departureMinutes(it,o){
  const hm=it.dep.split(":").map(Number);
  return hm[0]*60+hm[1]+it.s[o][1];
}
/* Availability and leg construction must refer to the same originating run. */
function boardingRun(it,o,dateStr){
  return originInstant(dateStr,departureMinutes(it,o),TZ[ST[it.s[o][0]][3]]);
}
const ZAB={"America/Los_Angeles":"PT","America/Denver":"MT","America/Chicago":"CT","America/New_York":"ET"};

/* ---------- geo helpers ---------- */
function hav(a,b,c,d){const p=Math.PI/180;
  return 12742*Math.asin(Math.sqrt(Math.max(0,0.5-Math.cos((c-a)*p)/2+Math.cos(a*p)*Math.cos(c*p)*(1-Math.cos((d-b)*p))/2)));}
/* Distance from a point to a track segment, not just to its endpoints: the
   polyline is simplified hardest where the country is flattest, so vertices
   alone can be tens of km from a feature the train runs straight past. */
function distToSeg(plat,plng,alat,alng,blat,blng){
  const k=Math.cos(plat*Math.PI/180);
  const ax=(alng-plng)*k, ay=alat-plat, bx=(blng-plng)*k, by=blat-plat;
  const dx=bx-ax, dy=by-ay, L=dx*dx+dy*dy;
  let t=L?-(ax*dx+ay*dy)/L:0; t=Math.max(0,Math.min(1,t));
  return Math.hypot(ax+dx*t,ay+dy*t)*111.32;
}
function bearing(a,b,c,d){const p=Math.PI/180,y=Math.sin((d-b)*p)*Math.cos(c*p),
  x=Math.cos(a*p)*Math.sin(c*p)-Math.sin(a*p)*Math.cos(c*p)*Math.cos((d-b)*p);
  return (Math.atan2(y,x)/p+360)%360;}
/* solar altitude in degrees — drives the darkness bands, no lookup tables */
function sunAlt(date,lat,lng){
  const rad=Math.PI/180, n=date.getTime()/86400000+2440587.5-2451545.0;
  const L=(280.460+0.9856474*n)%360, g=((357.528+0.9856003*n)%360)*rad;
  const lam=(L+1.915*Math.sin(g)+0.020*Math.sin(2*g))*rad, eps=(23.439-0.0000004*n)*rad;
  const dec=Math.asin(Math.sin(eps)*Math.sin(lam));
  const ra=Math.atan2(Math.cos(eps)*Math.sin(lam),Math.cos(lam));
  const gmst=(18.697374558+24.06570982441908*n)%24;
  const H=((gmst*15+lng)*rad)-ra;
  return Math.asin(Math.sin(lat*rad)*Math.sin(dec)+Math.cos(lat*rad)*Math.cos(dec)*Math.cos(H))/rad;
}

/* ---------- scenery: geographic, so any route passing near picks it up ---------- */
const SIGHTS=[
 {lat:39.10,lng:-120.90,r:18,dir:"S",n:"Cape Horn & American River Canyon",
  d:"The line clings to a cliff ~1,200 ft above the North Fork American River. Look down into the gorge as you round the point."},
 {lat:39.32,lng:-120.24,r:16,dir:"N",n:"Donner Lake & Donner Pass",
  d:"A bird's-eye drop to the lake from Schallenberger Ridge at 7,000 ft, past snowsheds and tunnels of the first transcontinental railroad."},
 {lat:39.42,lng:-120.02,r:16,dir:"BOTH",n:"Truckee River Canyon",
  d:"The tracks trace the Truckee River down toward Reno; watch for rafters and anglers in summer."},
 {lat:39.15,lng:-109.70,r:30,dir:"N",n:"Book Cliffs",
  d:"A ~200-mile wall of desert cliffs runs along the northern horizon between Green River and Grand Junction."},
 {lat:39.13,lng:-108.95,r:20,dir:"S",n:"Ruby Canyon",
  d:"A red-rock gorge on the Colorado River with no road access, reachable only by rail or raft. It straddles the Utah–Colorado line."},
 {lat:39.55,lng:-107.10,r:22,dir:"BOTH",n:"Glenwood Canyon",
  d:"The Colorado River threads a narrow limestone canyon beside I-70. River on the canyon side."},
 {lat:39.95,lng:-106.55,r:20,dir:"BOTH",n:"Gore Canyon",
  d:"Whitewater rapids and sheer walls with no road alongside, rail or raft only."},
 {lat:40.05,lng:-106.05,r:18,dir:"BOTH",n:"Byers & Fraser Canyons",
  d:"The Fraser River through remote canyons, climbing toward Winter Park ski country."},
 {lat:39.90,lng:-105.64,r:16,dir:"TUNNEL",n:"Moffat Tunnel",
  d:"6.2 miles in darkness beneath the Continental Divide at 9,239 ft, the highest point on the route."},
 {lat:39.80,lng:-105.35,r:18,dir:"E",n:"Front Range descent into Denver",
  d:"Coming off the foothills, the Great Plains and the Denver skyline open out below; the horseshoe curves show both sides."},
 {lat:40.81,lng:-91.11,r:12,dir:"BOTH",n:"Mississippi River at Burlington",
  d:"Cross the Mississippi on the long bridge at the Iowa–Illinois state line."},
 {lat:37.90,lng:-81.05,r:28,dir:"BOTH",n:"New River Gorge",
  d:"The line follows the New River through a deep Appalachian gorge for most of a morning, with no road on the far bank for long stretches."},
 {lat:41.25,lng:-122.28,r:32,dir:"E",n:"Mount Shasta",
  d:"A 14,179 ft volcano stands alone above the treeline as the track climbs the Sacramento River canyon toward Dunsmuir."},
 {lat:35.35,lng:-120.64,r:16,dir:"BOTH",n:"Cuesta Grade",
  d:"Horseshoe curves and tunnels lift the line out of San Luis Obispo; the train doubles back on itself, so both sides get the view."},
 {lat:45.70,lng:-121.50,r:32,dir:"S",n:"Columbia River Gorge",
  d:"The track runs the north bank of the Columbia beneath basalt cliffs, with waterfalls on the Oregon side across the water."},
 {lat:47.95,lng:-122.31,r:26,dir:"W",n:"Puget Sound shoreline",
  d:"North of Seattle the line runs at the water's edge below the bluffs, with the Olympics across the Sound."},
 {lat:39.325,lng:-77.73,r:9,dir:"BOTH",n:"Harpers Ferry",
  d:"The train crosses the Potomac on a bridge at the confluence with the Shenandoah, right through the old town."},
 {lat:29.70,lng:-91.30,r:26,dir:"BOTH",n:"Atchafalaya Basin",
  d:"Miles of elevated track across open swamp and cypress, the largest wetland in the country."},
 {lat:48.32,lng:-113.36,r:30,dir:"N",n:"Marias Pass & Glacier National Park",
  d:"The railroad crosses the Continental Divide at 5,213 ft along the southern edge of Glacier National Park."},
 {lat:47.75,lng:-120.95,r:12,dir:"TUNNEL",n:"Cascade Tunnel",
  d:"7.8 miles under Stevens Pass, the longest railroad tunnel in the United States."},
 {lat:34.55,lng:-120.50,r:30,dir:"W",n:"Gaviota & Vandenberg coast",
  d:"Miles of open Pacific shoreline with no road access, reachable only by this train."},
 {lat:43.11,lng:-79.06,r:8,dir:"N",n:"Niagara Gorge",
  d:"The train crosses the Niagara River on a bridge high above the gorge, downstream of the falls."},
 {lat:41.40,lng:-73.97,r:22,dir:"W",n:"Hudson River",
  d:"The line runs along the water's edge below the Hudson Highlands, with West Point across the river."},
 {lat:40.498,lng:-78.484,r:8,dir:"BOTH",n:"Horseshoe Curve",
  d:"The track bends through 220 degrees against the Allegheny hillside to gain height; you can see the rest of your own train."},
 {lat:36.99,lng:-104.48,r:20,dir:"BOTH",n:"Raton Pass",
  d:"A 7,588 ft crossing of the Colorado–New Mexico line, the steepest main-line grade Amtrak runs."},
 {lat:44.50,lng:-73.38,r:25,dir:"W",n:"Lake Champlain",
  d:"The train runs along the lake shore with the Adirondacks rising on the far side."},
 /* Added because the eastern and southern long-distance trains had nothing at
    all against them: the Crescent ran thirty-two hours with an empty window
    row. These five are the stretches those routes are actually known for. */
 {lat:33.16,lng:-117.40,r:35,dir:"W",n:"San Clemente to Del Mar coast",
  d:"For long stretches the track is laid at the tide line, surfers close enough to count, through San Clemente and San Onofre and out along the Del Mar bluffs above the Pacific."},
 {lat:44.05,lng:-91.67,r:40,dir:"E",n:"Upper Mississippi bluffs",
  d:"From La Crosse the line crosses to the Minnesota bank and follows the river north under 500-foot bluffs, past Winona and Red Wing. Eagles most of the year."},
 {lat:30.17,lng:-89.83,r:12,dir:"BOTH",n:"Lake Pontchartrain trestle",
  d:"Nearly six miles of track on piles across open water into New Orleans. No land on either side for most of the crossing."},
 {lat:29.72,lng:-101.35,r:12,dir:"BOTH",n:"Pecos River High Bridge",
  d:"The track crosses the Pecos gorge 320 feet up, the highest railroad bridge in Texas, just before the river meets the Rio Grande."},
 {lat:42.36,lng:-73.15,r:20,dir:"BOTH",n:"Berkshire Hills & Washington Summit",
  d:"The old Boston & Albany climbs to 1,459 feet through the Berkshires, the high point of the whole run west from Boston."},
];
const CARD={N:"north",NE:"northeast",E:"east",SE:"southeast",S:"south",SW:"southwest",W:"west",NW:"northwest"};
const DIRV={N:0,NE:45,E:90,SE:135,S:180,SW:225,W:270,NW:315};

/* ---------- state ---------- */
let theme=(window.matchMedia&&window.matchMedia("(prefers-color-scheme: light)").matches)?"light":"dark";
let carrier="verizon";
let IT=null, O=0, E=0, LEG=null, DELAY=0;

/* ---------- build the leg the user picked ---------- */
function buildLeg(){
  const stops=IT.s, o=O, e=E;
  /* GTFS stop_times are in the agency's zone (Eastern for Amtrak), not the stop's.
     Elapsed time is therefore the raw difference; only the displayed clock changes zone. */
  const depHM=IT.dep.split(":").map(Number), depMin=depHM[0]*60+depHM[1];
  const start=boardingRun(IT,o,$("depDate").value);
  const inst=start.inst;
  /* Each stop is resolved from its own wall-clock time on the run's start date.
     Adding raw minutes instead would be an hour out either way across a
     daylight-saving change, which every long-distance train crosses twice a year. */
  const at=i=>agencyInstant(start.date,depMin+stops[i][1]);
  /* The feed's time for a stop is its departure, and the third field is how long
     the train stands there. Some of those waits are hours: four at San Antonio
     on the Texas Eagle, where the cars are handed to the Sunset Limited, nearly
     as long at Philadelphia on the overnight Regional. Treating a stop as a
     single instant put the train hundreds of miles down the line while it was
     still on the platform, and took the coverage, the scenery and the darkness
     with it. So each stop carries an arrival and a departure, and travel happens
     between one departure and the next arrival. */
  /* The waits at both ends belong to the train's day, not to your leg: you board
     at the origin's departure and step off at the destination's arrival. This
     matters on any leg that is not the whole run — El Paso sits for 25 minutes
     mid-route, and those minutes were being added to an Alpine–El Paso trip. */
  const atArr=i=>agencyInstant(start.date,depMin+stops[i][1]-(i===o?0:(stops[i][2]||0)));
  const L={stops:[],poly:[],polyT:[],cov:[],dep:inst,TOTAL:0};
  for(let i=o;i<=e;i++){
    const c=stops[i][0], s=ST[c], ga=atArr(i), off=(i===e), gd=off?ga:at(i);
    L.stops.push({code:c,name:stationName(c),short:place(c),lat:s[1],lng:s[2],tz:TZ[s[3]],
                  dwell:(i===o||off)?0:(stops[i][2]||0),
                  t:(ga-inst)/3600000, td:(gd-inst)/3600000, inst:ga});
  }
  L.TOTAL=L.stops[L.stops.length-1].t;
  /* polyline, with the running time distributed along track distance. A stop
     lands in it twice, once at each end of its wait, so anything that reads a
     position by interpolating holds still while the train does. */
  for(let i=o;i<e;i++){
    const s0=IT.i[i], s1=IT.i[i+1], t0=L.stops[i-o].td, t1=L.stops[i-o+1].t;
    let cum=0; const dd=[0];
    for(let j=s0;j<s1;j++){cum+=hav(IT.p[j][0],IT.p[j][1],IT.p[j+1][0],IT.p[j+1][1]);dd.push(cum);}
    for(let j=s0;j<=s1;j++){
      L.poly.push([IT.p[j][0],IT.p[j][1]]);
      L.polyT.push(t0+(t1-t0)*(cum?dd[j-s0]/cum:(j-s0)/Math.max(1,s1-s0)));
    }
  }
  /* a stop with no wait needs only the one entry */
  for(let j=L.poly.length-1;j>0;j--)
    if(L.polyT[j]===L.polyT[j-1]&&L.poly[j][0]===L.poly[j-1][0]&&L.poly[j][1]===L.poly[j-1][1]){
      L.poly.splice(j,1); L.polyT.splice(j,1);
    }
  /* coverage sub-segments, each with a time span */
  const cv=IT.cv[carrier]; let base=0;
  for(let i=0;i<o;i++) base+=IT.sn[i];
  for(let i=o;i<e;i++){
    const n=IT.sn[i], t0=L.stops[i-o].td, t1=L.stops[i-o+1].t;
    let last="good";
    for(let k=0;k<n;k++){
      last=LONG[cv[base+k]];
      L.cov.push({t0:t0+(t1-t0)*k/n, t1:t0+(t1-t0)*(k+1)/n, st:last});
    }
    /* standing at the platform is the same place as the moment you pulled in */
    const nx=L.stops[i-o+1];
    if(nx.dwell) L.cov.push({t0:nx.t,t1:nx.td,st:last});
    base+=n;
  }
  if(!L.cov.length) L.cov.push({t0:0,t1:Math.max(L.TOTAL,0.01),st:"good"});
  wallBands(L);
  /* scenery on this leg, with the side computed from the direction of travel */
  L.sights=[];
  SIGHTS.forEach(s=>{
    let bi=-1,bd=1e9;
    for(let j=0;j<L.poly.length-1;j++){
      const d=distToSeg(s.lat,s.lng,L.poly[j][0],L.poly[j][1],L.poly[j+1][0],L.poly[j+1][1]);
      if(d<bd){bd=d;bi=j;}
    }
    if(L.poly.length===1){bd=hav(s.lat,s.lng,L.poly[0][0],L.poly[0][1]);bi=0;}
    if(bi<0||bd>s.r) return;
    const j2=Math.min(L.poly.length-1,bi+1), j1=Math.max(0,bi-1);
    const head=bearing(L.poly[j1][0],L.poly[j1][1],L.poly[j2][0],L.poly[j2][1]);
    let side="Both";
    if(s.dir==="TUNNEL") side="Tunnel";
    else if(s.dir!=="BOTH"&&DIRV[s.dir]!==undefined){
      const rel=((DIRV[s.dir]-head)%360+360)%360; side=rel<180?"Right":"Left";
    }
    L.sights.push(Object.assign({},s,{t:L.polyT[bi],side:side}));
  });
  L.sights.sort((x,y)=>x.t-y.t);
  L.km=0; for(let i=o;i<e;i++) L.km+=IT.kl[i];
  return L;
}
/* Hours in each coverage state on an arbitrary leg, without building the leg.
   The sub-segments between two stops share that hop's running time evenly, so
   the totals fall out of the timetable and the coverage string alone — cheap
   enough to run over every leg of every journey option while you pick one. */
/* Ride time between two stops of one train. You board at a departure and get
   off at an arrival, so the wait at the stop where you alight belongs to the
   train's day, not to your journey. */
const rideMins=(it,a,b)=>it.s[b][1]-(it.s[b][2]||0)-it.s[a][1];
/* "Denver 8:46a" is the wrong half of the answer at a stop the train sits at
   for an hour, so say both times and how long the wait is. */
const dwellText=m=>m>=90?fmtDur(m/60):(m+" min");   /* 239 min is four hours; say so */
/* Telling someone to watch for Mount Shasta at five in the morning is only
   useful if you also say the sun is not up yet. */
/* A hop no train could make means the feed's times for it are wrong, and the
   position, the coverage timing and the darkness through that stretch are wrong
   with them. The Mardi Gras Service is scheduled New Orleans to Bay St Louis in
   24 minutes one way and 151 the other, over the same 92 km; both cannot be
   right. Said out loud rather than drawn as fact. The fastest hop on the network
   that is actually credible runs at 185 km/h, on the Corridor. */
const MAX_KMH=200;
function impossibleHop(){
  let worst=null;
  for(let i=O;i<E;i++){
    const mins=IT.s[i+1][1]-(IT.s[i+1][2]||0)-IT.s[i][1];
    if(mins<=0) continue;
    const kmh=IT.kl[i]/(mins/60);
    if(kmh>MAX_KMH&&(!worst||kmh>worst.kmh))
      worst={kmh:kmh,mins:mins,a:place(IT.s[i][0]),b:place(IT.s[i+1][0])};
  }
  return worst;
}
const darkAt=t=>!!(LEG&&LEG.night&&LEG.night.some(n=>t>=n.a&&t<n.b));
function stopWhen(s){
  return clockAt(s.t).time+(s.dwell?("–"+clockAt(s.td).time+", "+dwellText(s.dwell)+" stop"):"");
}
function legHours(itIdx,o,e,car){
  const it=ITS[itIdx], cv=it.cv[car||carrier], out={good:0,spotty:0,dead:0};
  if(!cv) return out;
  let base=0; for(let i=0;i<o;i++) base+=it.sn[i];
  for(let i=o;i<e;i++){
    const dw=it.s[i+1][2]||0, n=it.sn[i], span=(it.s[i+1][1]-dw-it.s[i][1])/60;
    let last="good";
    for(let k=0;k<n;k++){ last=LONG[cv[base+k]]; out[last]+=span/n; }
    if(i+1<e) out[last]+=dw/60;    /* standing time counts, except where you get off */
    base+=n;
  }
  return out;
}
/* adjacent sub-segments of the same status, merged — the fine grid is for lookups,
   the runs are what gets drawn */
function covRuns(){
  const out=[];
  LEG.cov.forEach(s=>{
    const last=out[out.length-1];
    if(last&&last.st===s.st) last.t1=s.t1; else out.push({t0:s.t0,t1:s.t1,st:s.st});
  });
  return out;
}
/* Dining-car service windows, on the train's own clock. The one definition:
   the timetable printed under the dining section is generated from it. */
const MEALS=[[6.5,9.5,"Breakfast"],[11.5,14.5,"Lunch"],[17,21,"Dinner"]];
const LAST_CALL=0.25;                       /* hours before close */
function hhmm(h){
  let m=Math.round(h*60)%1440; if(m<0)m+=1440;
  let hr=Math.floor(m/60), mi=m%60;
  const ap=hr<12?"a":"p"; let h12=hr%12; if(!h12)h12=12;
  return {t:h12+":"+(mi<10?"0":"")+mi,ap:ap};
}
/* Darkness and meal service keep to the wall clock, so a late train meets them
   at earlier points on its route. Recomputed whenever the delay changes. */
function wallBands(L){
  L.night=[]; L.meals=[];
  /* meals happen in windows only where there is a dining car to serve them */
  L.dining=L.TOTAL>=10&&DINING_ROUTES.has(IT.n);
  const STEP=Math.max(2/60,L.TOTAL/900);

  let curN=null,curM=null;
  for(let t=0;t<=L.TOTAL+1e-9;t+=STEP){
    const pos=posAt(t,L), inst=new Date(L.dep.getTime()+(t+DELAY)*3600000);
    const dark=sunAlt(inst,pos.lat,pos.lng)<-6;
    if(dark&&!curN) curN={a:t}; else if(!dark&&curN){curN.b=t;L.night.push(curN);curN=null;}
    if(L.dining){
      const tz=nearestStop(t,L).tz, off=tzOffset(tz,inst);
      const loc=((inst.getTime()/60000+off)%1440+1440)%1440/60;
      const m=MEALS.find(M=>loc>=M[0]&&loc<M[1]);
      if(m&&(!curM||curM.name!==m[2])){ if(curM){curM.b=t;L.meals.push(curM);} curM={a:t,name:m[2]}; }
      else if(!m&&curM){curM.b=t;L.meals.push(curM);curM=null;}
    }
  }
  if(curN){curN.b=L.TOTAL;L.night.push(curN);}
  if(curM){curM.b=L.TOTAL;L.meals.push(curM);}
  L.night=L.night.filter(n=>n.b-n.a>0.2);
  /* a window the leg only clips the tail of is not a meal you can plan on */
  const FULL={Breakfast:3,Lunch:3,Dinner:4};
  L.meals=L.meals.filter(m=>(m.b-m.a)>=Math.min(1.5,FULL[m.name]*0.5));
}
/* Dead and spotty hours on this leg for a carrier other than the selected one,
   using the same sub-segment spans. */
/* The same sum legHours does, for the leg on screen. It used to have its own
   copy of the arithmetic, which stopped agreeing the moment waits at stations
   were modelled: the page said Verizon was dead for 1h 49m in one sentence and
   1h 45m in the next. One implementation now. */
function carrierTotals(car){ return legHours(ITS.indexOf(IT),O,E,car); }
function posAt(t,L){
  L=L||LEG; const P=L.poly,T=L.polyT;
  if(t<=T[0])return {lat:P[0][0],lng:P[0][1],i:0};
  for(let i=0;i<P.length-1;i++) if(t<=T[i+1]){
    const f=(t-T[i])/((T[i+1]-T[i])||1);
    return {lat:P[i][0]+(P[i+1][0]-P[i][0])*f,lng:P[i][1]+(P[i+1][1]-P[i][1])*f,i:i};
  }
  const n=P.length-1; return {lat:P[n][0],lng:P[n][1],i:n};
}
function nearestStop(t,L){L=L||LEG; let b=L.stops[0];
  for(const s of L.stops){ if(s.t<=t+1e-9) b=s; } return b;}
function stopIndexAt(t){let i=0; for(let k=0;k<LEG.stops.length;k++) if(LEG.stops[k].t<=t+1e-9) i=k; return i;}
function covAt(t){const c=LEG.cov; for(const s of c) if(t<s.t1) return s.st; return c[c.length-1].st;}
function covRun(t){const c=LEG.cov; let i=c.findIndex(s=>t<s.t1); if(i<0)i=c.length-1;
  const st=c[i].st; let a=i,b=i;
  while(a>0&&c[a-1].st===st)a--; while(b<c.length-1&&c[b+1].st===st)b++;
  return {st:st,t0:c[a].t0,t1:c[b].t1};}
function nextRunOf(t,want){const c=LEG.cov; let i=c.findIndex(s=>t<s.t1); if(i<0)return null;
  for(let j=i+1;j<c.length;j++) if(c[j].st===want&&c[j-1].st!==want){const r=covRun(c[j].t0+1e-6);return {t:c[j].t0,len:r.t1-r.t0,end:r.t1};}
  return null;}
