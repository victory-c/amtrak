import csv,collections,json,math,sys,os
from coverage_geometry import hav, turnrate, distance_samples
HERE=os.path.dirname(os.path.abspath(__file__))
_params="cov_params.json" if os.path.exists("cov_params.json") else os.path.join(HERE,"cov_params.json")
P=json.load(open(_params)); geo=json.load(open("geo_raw.json"))
R=json.load(open("routes_raw.json"))
stops={s["stop_id"]:s for s in csv.DictReader(open("gtfs/stops.txt"))}
sh=collections.defaultdict(list)
for r in csv.DictReader(open("gtfs/shapes.txt")):
    sh[r["shape_id"]].append((int(r["shape_pt_sequence"]),float(r["shape_pt_lat"]),float(r["shape_pt_lon"])))
SHAPE={k:[(a,b) for _,a,b in sorted(v)] for k,v in sh.items()}
GRID={}
for lat,lng,pop,nm in geo["cities"]: GRID.setdefault((int(lat),int(lng)),[]).append((lat,lng,pop))
A,B,C,Dn,K,S,Tg,Ts=P["A"],P["B"],P["C"],P["D"],P["K"],P["S"],P["Tg"],P["Ts"]
F={"verizon":1.15,"att":1.00,"tmobile":0.50}          # keep three distinct carriers
def popstrength(lat,lng):
    """Nearest-town reach, plus a density floor so farmland with many small towns
    does not score the same as true wilderness."""
    best=0.0; dens=0.0
    for gi in range(int(lat)-3,int(lat)+4):
        for gj in range(int(lng)-3,int(lng)+4):
            for clat,clng,pop in GRID.get((gi,gj),()):
                d=hav(lat,lng,clat,clng)
                v=(A*(pop/5000.0)**B)/max(d,2.0)
                if v>best: best=v
                if d<=75: dens+=pop
    return best+C*max(0.0,math.log10(1+dens)-Dn)
def rdp(pts,eps):
    if len(pts)<3: return pts
    dmax=0.0; idx=0
    (x1,y1),(x2,y2)=pts[0],pts[-1]
    den=math.hypot(y2-y1,x2-x1)
    for i in range(1,len(pts)-1):
        x0,y0=pts[i]
        dd=abs((y2-y1)*x0-(x2-x1)*y0+x2*y1-y2*x1)/den if den>1e-12 else math.hypot(x0-x1,y0-y1)
        if dd>dmax: dmax,idx=dd,i
    if dmax>eps: return rdp(pts[:idx+1],eps)[:-1]+rdp(pts[idx:],eps)
    return [pts[0],pts[-1]]
# Long bores where no population/terrain proxy can see the blackout: [lat,lng,km,status]
OVERRIDE=[(39.902,-105.642,11,"d"),   # Moffat Tunnel, CO  (6.2 mi)
          (47.750,-120.950,11,"d"),   # Cascade Tunnel, WA (7.8 mi)
          (48.600,-115.050,9 ,"d")]   # Flathead Tunnel, MT (7.0 mi)
def override(lat,lng):
    for olat,olng,km,stt in OVERRIDE:
        if hav(lat,lng,olat,olng)<=km: return stt
    return None
EPS=0.018
sys.setrecursionlimit(20000)
tzs=[];tzi={}
def tz(name):
    if name not in tzi: tzi[name]=len(tzs); tzs.append(name)
    return tzi[name]
ABBR={"Alabama":"AL","Arizona":"AZ","Arkansas":"AR","California":"CA","Colorado":"CO","Connecticut":"CT",
"Delaware":"DE","District of Columbia":"DC","Florida":"FL","Georgia":"GA","Idaho":"ID","Illinois":"IL",
"Indiana":"IN","Iowa":"IA","Kansas":"KS","Kentucky":"KY","Louisiana":"LA","Maine":"ME","Maryland":"MD",
"Massachusetts":"MA","Michigan":"MI","Minnesota":"MN","Mississippi":"MS","Missouri":"MO","Montana":"MT",
"Nebraska":"NE","Nevada":"NV","New Hampshire":"NH","New Jersey":"NJ","New Mexico":"NM","New York":"NY",
"North Carolina":"NC","North Dakota":"ND","Ohio":"OH","Oklahoma":"OK","Oregon":"OR","Pennsylvania":"PA",
"Rhode Island":"RI","South Carolina":"SC","South Dakota":"SD","Tennessee":"TN","Texas":"TX","Utah":"UT",
"Vermont":"VT","Virginia":"VA","Washington":"WA","West Virginia":"WV","Wisconsin":"WI","Wyoming":"WY"}
def inring(lng,lat,ring):
    inside=False; n=len(ring)
    for i in range(n):
        x1,y1=ring[i]; x2,y2=ring[(i+1)%n]
        if (y1>lat)!=(y2>lat):
            xin=x1+(lat-y1)*(x2-x1)/((y2-y1) or 1e-12)
            if lng<xin: inside=not inside
    return inside
def stateOf(lat,lng):
    for st in geo["states"]:
        for ring in st["r"]:
            xs=[p[0] for p in ring]; ys=[p[1] for p in ring]
            if lng<min(xs) or lng>max(xs) or lat<min(ys) or lat>max(ys): continue
            if inring(lng,lat,ring): return ABBR.get(st["n"],"")
    return ""
ST={}
for c in R["used"]:
    s=stops[c]; la=round(float(s["stop_lat"]),4); ln=round(float(s["stop_lon"]),4)
    ST[c]=[s["stop_name"],la,ln,tz(s["stop_timezone"]),stateOf(la,ln)]
its=[];totpts=0
for p in R["patterns"]:
    full=SHAPE.get(p["shape"])
    codes=[x[0] for x in p["stops"]]
    if full:
        # some shapes are stored running the other way down the line; snapping stalls unless we flip
        f0,fl=ST[codes[0]][1],ST[codes[0]][2]
        if hav(f0,fl,full[-1][0],full[-1][1])<hav(f0,fl,full[0][0],full[0][1]): full=full[::-1]
        anchors=[]
        lo=0
        for c in codes:
            lat,lng=ST[c][1],ST[c][2]
            j=min(range(lo,len(full)),key=lambda i:hav(lat,lng,full[i][0],full[i][1]))
            anchors.append(j); lo=max(lo,j)
        if any(anchors[i]>anchors[i+1] for i in range(len(anchors)-1)): full=None
    poly=[];idx=[];cov={k:[] for k in F};segn=[];seglen=[]
    if full:
        poly=[[ST[codes[0]][1],ST[codes[0]][2]]]; idx=[0]
        for i in range(len(codes)-1):
            raw=full[anchors[i]:anchors[i+1]+1]
            if len(raw)<2: raw=[(ST[codes[i]][1],ST[codes[i]][2]),(ST[codes[i+1]][1],ST[codes[i+1]][2])]
            simp=rdp(raw,EPS)
            simp[0]=(ST[codes[i]][1],ST[codes[i]][2]); simp[-1]=(ST[codes[i+1]][1],ST[codes[i+1]][2])
            poly.extend([[round(a,4),round(b,4)] for a,b in simp[1:]]); idx.append(len(poly)-1)
            _,km=turnrate(raw); seglen.append(round(km,1))
            n=max(1,min(60,int(round(km/25.0))))   # long nonstop legs deserve real resolution
            segn.append(n)
            # Equal running-time shares in core.js correspond to equal track
            # distances, not equal numbers of GTFS vertices. Sample on the track
            # itself and measure terrain within the same distance window.
            for (mlat,mlng),sub in distance_samples(raw,n):
                str_,_=turnrate(sub)
                base=popstrength(mlat,mlng)/(1+max(0.0,str_-K)/S)
                ov=override(mlat,mlng)
                for c2,f in F.items():
                    v=base*f
                    cov[c2].append(ov or ("g" if v>=Tg else ("s" if v>=Ts else "d")))
    else:
        poly=[[ST[c][1],ST[c][2]] for c in codes]; idx=list(range(len(codes)))
        for i in range(len(codes)-1):
            a=ST[codes[i]]; b=ST[codes[i+1]]
            km=hav(a[1],a[2],b[1],b[2]); seglen.append(round(km,1))
            n=max(1,min(60,int(round(km/25.0)))); segn.append(n)
            for k in range(n):
                f0=(k+0.5)/n
                mlat=a[1]+(b[1]-a[1])*f0; mlng=a[2]+(b[2]-a[2])*f0
                base=popstrength(mlat,mlng)
                for c2,f in F.items():
                    v=base*f
                    cov[c2].append("g" if v>=Tg else ("s" if v>=Ts else "d"))
    totpts+=len(poly)
    its.append({"n":p["name"],"tr":p["train"],"dep":p["dep"],"dy":p.get("days","1111111"),
                "s":[[x[0],x[1],x[2]] for x in p["stops"]],"p":poly,"i":idx,"sn":segn,"kl":seglen,
                "cv":{k:"".join(v) for k,v in cov.items()}})
print("itineraries:",len(its),"polyline points:",totpts,"stops:",len(ST),"tz:",tzs)
json.dump({"tz":tzs,"stops":ST,"its":its,"states":geo["states"],"labels":geo["labels"],
           "cities":[[c[0],c[1],c[2],c[3]] for c in geo["cities"][:260]]},
          open("data.json","w"),separators=(",",":"))
import os;print("data.json size: %.0f KB"%(os.path.getsize("data.json")/1024))
