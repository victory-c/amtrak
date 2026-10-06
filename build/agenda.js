/* ================= now happening / up next ================= */
const agNowEl=$("agNow"),agNextEl=$("agNext"),agTipsEl=$("agTips"),agCarrierEl=$("agCarrier");
function nightAt(t){for(const n of LEG.night) if(t>=n.a&&t<n.b) return n; return null;}
function nextDark(t){for(const n of LEG.night) if(n.a>t) return n.a; return null;}
function mealAt(t){for(const m of LEG.meals) if(t>=m.a&&t<m.b) return m; return null;}
function nextMeal(t){for(const m of LEG.meals) if(m.a>t) return m; return null;}
function sightNow(t){const w=Math.max(0.18,LEG.TOTAL/160);
  for(const s of LEG.sights) if(Math.abs(s.t-t)<w) return s; return null;}
function nextSight(t){for(const s of LEG.sights) if(s.t>t) return s; return null;}
function nextStop(t){for(const s of LEG.stops) if(s.t>t+1e-9) return s; return null;}
function stopName(i){return LEG.stops[Math.max(0,Math.min(LEG.stops.length-1,i))].short;}

function agEvents(){
  const ev=[];
  LEG.stops.forEach((s,i)=>{
    if(i===0) return;
    ev.push({t:s.t,pri:2,title:s.short,
      sub:s.dwell>=8?("station stop · about "+dwellText(s.dwell)+" on the platform"):"station stop"});
  });
  LEG.sights.forEach(s=>ev.push({t:s.t,pri:1,title:s.n,sub:lookText(s)}));
  LEG.meals.forEach(m=>ev.push({t:m.a,pri:2,title:m.name+" opens",
    sub:"dining car · last call ~"+clockAt(Math.max(m.a,m.b-LAST_CALL)).time}));
  LEG.night.forEach(n=>{
    ev.push({t:n.a,pri:3,title:"Dark outside",
      sub:n.b>=LEG.TOTAL-1e-6?"and stays dark to the end of this leg":"nothing to see until dawn"});
    if(n.b<LEG.TOTAL-0.05) ev.push({t:n.b,pri:3,title:"Daylight returns",sub:"the window is worth watching again"});
  });
  const L={good:"Signal comes back",spotty:"Signal turns spotty",dead:"Signal drops out"},
        W={good:"usable",spotty:"patchy, gaps between towns",dead:"no service"};
  for(let i=1;i<LEG.cov.length;i++){
    if(LEG.cov[i].st===LEG.cov[i-1].st) continue;
    const r=covRun(LEG.cov[i].t0+1e-6);
    ev.push({t:LEG.cov[i].t0,pri:0,title:L[LEG.cov[i].st],sub:W[LEG.cov[i].st]+" for about "+fmtDur(r.t1-r.t0)});
  }
  return ev.sort((a,b)=>a.t-b.t||a.pri-b.pri);
}
/* Where the current leg sits in a multi-leg journey, if it is part of one */
function journeyLegContext(){
  const J=journey; if(!J||!J.list||!J.list[J.pick]) return null;
  const opt=J.list[J.pick], i=J.leg-1;
  if(i<0||i>=opt.legs.length-1) return null;          /* last leg hands off to nothing */
  const leg=opt.legs[i];
  if(ITS[leg.i]!==IT||leg.o!==O||leg.e!==E) return null;
  const next=opt.legs[i+1], wait=opt.waits[i];
  /* The connecting train leaves on its own schedule whatever your delay, so
     work from the booked arrival and measure the slack against the real one.
     Shown in the interchange's clock: Chicago reads 6:40p where the feed's
     Eastern timetable says 7:40p. */
  const schedArr=new Date(LEG.dep.getTime()+LEG.TOTAL*3600000);
  const dep=new Date(schedArr.getTime()+wait*60000);
  const realArr=new Date(LEG.dep.getTime()+(LEG.TOTAL+DELAY)*3600000);
  const slack=(dep-realArr)/60000;
  const tz=TZ[ST[opt.vias[i]][3]];
  return {via:opt.vias[i],wait:wait,slack:slack,nextName:ITS[next.i].n,
          nextDays:runDays(ITS[next.i],shiftDate(J.start||depDate.value,
            (opt.offsets&&opt.offsets[i+1])||0),next.o),depTime:fmtLocal(dep,tz).time};
}
function agTipList(t){
  const tips=[],CN=CARRIER_NAME[carrier],run=covRun(t),
        add=(ic,html,hot)=>tips.push({ic:ic,html:html,hot:!!hot});
  const sn=sightNow(t),ns=nextSight(t),mn=mealAt(t),nm=nextMeal(t),dark=nightAt(t),nd=nextDark(t),st=nextStop(t);
  if(run.st==="dead"){
    const left=run.t1-t, where=stopName(stopIndexAt(run.t1)+1);
    /* what it comes back to, since patchy is not the same promise as usable */
    const back=run.t1<LEG.TOTAL-1e-9?covAt(run.t1+1e-6):null, patchy=(back==="spotty");
    if(left<=0.5) add("↑",'<b>'+(patchy?'Patchy signal returns':'Signal back')+' in ~'+fmtDur(left)+
      '</b> near '+where+'. Queue your uploads and unsent messages now so they go the moment bars return.',true);
    else add("✈",'<b>No service for another ~'+fmtDur(left)+'.</b> Good stretch for the lounge car or a nap. '+
      (patchy?'Patchy bars from ~':'Next usable bars ~')+clockAt(run.t1).time+' near '+where+'.');
  }else{
    const d=nextRunOf(t,"dead"), horizon=Math.max(1.0,Math.min(2.0,LEG.TOTAL/26));
    if(d&&d.t-t<=horizon&&d.len>=0.5)
      add("⤓",'<b>Send it before ~'+clockAt(d.t).time+'.</b> '+CN+' drops out in ~'+fmtDur(d.t-t)+' and stays out about '+fmtDur(d.len)+'. Download maps and a few episodes now, and start any big upload while you still have bars.',true);
    else if(run.st==="spotty")
      add("◍",'<b>Spotty here.</b> Texts and calls mostly hold; video and big files will stall. Load anything heavy at the next town.');
    else if(d)
      add("✓",'<b>'+CN+' is usable</b> for about '+fmtDur(run.t1-t)+'. The next dead stretch starts ~'+clockAt(d.t).time+' and runs '+fmtDur(d.len)+'.');
    else{
      /* no dead stretch left is not the same as no trouble left */
      const sp=nextRunOf(t,"spotty");
      add("✓",sp
        ? ('<b>No dead stretches left</b> on '+CN+'. It goes patchy for '+fmtDur(sp.len)+
           ' from ~'+clockAt(sp.t).time+', which holds texts and calls but not much else.')
        : ('<b>'+CN+' is usable</b> and stays that way to '+stopName(LEG.stops.length-1)+'.'));
    }
  }
  if(sn) add("◉",'<b>'+sn.n+', right now.</b> '+lookText(sn)+(darkAt(sn.t)?', though it is dark out.':'.'),true);
  else if(ns&&ns.t-t<=Math.max(0.6,LEG.TOTAL/60))
    add("◉",darkAt(ns.t)
      ? ('<b>'+ns.n+' in ~'+fmtDur(ns.t-t)+'</b>, but it will be dark. Nothing to see unless there is a moon.')
      : ('<b>'+(hasSightseer()?'Head up to the Sightseer Lounge.':'Find a window on the right side of the train.')+
         '</b> '+ns.n+' in ~'+fmtDur(ns.t-t)+'. '+lookText(ns)+'.'),ns.t-t<=0.4);
  if(mn) add("▨",'<b>'+mn.name+' is being served.</b> Last call ~'+clockAt(Math.max(mn.a,mn.b-LAST_CALL)).time+'. Sleeper fares include it; coach can join if seats are free.');
  else if(nm&&nm.a-t<=1.2) add("▨",'<b>'+nm.name+' opens in ~'+fmtDur(nm.a-t)+'.</b>'+
    (nm.name==="Dinner"?' It is by reservation, so catch your car attendant now.'
                       :' Sleeper fares include it; coach can join if seats are free.'));
  else if(nm&&nm.name==="Dinner"&&nm.a-t<=4) add("▨",'<b>Reserve dinner</b> with your car attendant. Tonight\'s seating fills through the afternoon.');
  if(st&&st.t-t<=0.6&&st.dwell>=10)
    add("▮",'<b>'+st.short+' in ~'+fmtDur(st.t-t)+'.</b> About '+dwellText(st.dwell)+' on the platform: fresh air, and'+(covAt(st.t)==="good"?' the most reliable signal for a while.':' a chance to stretch.'));
  /* on a leg that hands you to another train, the change is the thing to know */
  const cx=(typeof journey!=="undefined"&&journey)?journeyLegContext():null;
  if(cx&&LEG.TOTAL-t<=Math.max(2,LEG.TOTAL/8)){
    const where=place(cx.via);
    if(cx.slack<=0)
      add("⇄",'<b>You would miss the change at '+where+'.</b> The '+cx.nextName+
        ' leaves at ~'+cx.depTime+', before this train gets in. '+
        (cx.nextDays.length>=7?'The next one is a day later.'
                              :'It only runs '+listDays(cx.nextDays)+'.'),true);
    else if(cx.slack<MIN_CONNECT)
      add("⇄",'<b>Tight change at '+where+'.</b> The '+cx.nextName+' leaves at ~'+cx.depTime+
        ', '+Math.round(cx.slack)+' minutes after you get in.',true);
    else
      add("⇄",'<b>Change at '+where+'.</b> The '+cx.nextName+' leaves at ~'+cx.depTime+
        ', '+fmtDur(cx.slack/60)+' after you get in.',cx.slack<=90);
  }
  if(dark){
    /* a band that runs to the end of the leg is the leg ending in the dark,
       not the sun coming up then */
    const endsDark=dark.b>=LEG.TOTAL-1e-6;
    add("☾",endsDark
      ? ('<b>Dark out</b> for the rest of this leg.'+(covRun(t).st==="dead"?' The dead stretch runs through it too.':''))
      : ('<b>Dark out.</b> Daylight ~'+clockAt(dark.b).time+'.'+(covRun(t).st==="dead"?' The dead stretch runs through it, so this is the part to sleep through.':'')));
  }
  else if(nd&&nd-t<=1.2) add("☾",'<b>Dark in ~'+fmtDur(nd-t)+'.</b> Charge at the seat outlet while there is nothing to look at.');
  return tips.slice(0,4);
}
/* The servicing stops are the part of the timetable nobody reads and everybody
   wants: fifty minutes on the platform at Albuquerque is lunch, a walk and a
   reliable upload. Every long stop on the network turns out to have signal —
   they are all in towns — so this is worth knowing before you board. */
function longStopTip(){
  const big=LEG.stops.map(s=>({s:s,dw:s.dwell}))
    .filter(x=>x.dw>=15).sort((a,b)=>b.dw-a.dw).slice(0,2).sort((a,b)=>a.s.t-b.s.t);
  if(!big.length) return [];
  return [{ic:"▮",html:'<b>'+(big.length>1?'Long stops':'One long stop')+':</b> '+
    big.map(x=>x.s.short+' '+dwellText(x.dw)+' at '+clockAt(x.s.t).time).join(", ")+
    '. Long enough to get off, stretch, and send whatever has been waiting.'}];
}
function updateAgenda(t){
  if(t===undefined)t=computeTNow();
  const pal=covColors();
  agCarrierEl.textContent=CARRIER_NAME[carrier];
  agNextEl.innerHTML="";agTipsEl.innerHTML="";
  /* The dot carries the signal state in colour alone; say it out loud too. */
  const SAID={good:"signal usable",spotty:"signal spotty",dead:"no signal"};
  const dot=st=>'<span class="ag-dot" style="background:'+pal[st]+'"></span>'+
    '<span class="sr">'+SAID[st]+' · </span>';
  const paint=items=>items.forEach(e=>{
    const li=document.createElement("li");li.className="ag-item";
    li.innerHTML=dot(covAt(e.t))+
      '<span class="ag-when">'+clockAt(e.t).time+'</span>'+
      '<span class="ag-what"><b>'+e.title+'</b><span>'+e.sub+'</span></span>';
    agNextEl.appendChild(li);});
  const tipList=arr=>arr.forEach(o=>{const li=document.createElement("li");
    li.className="ag-tip"+(o.hot?" hot":"");
    li.innerHTML='<span class="ic">'+o.ic+'</span><span>'+o.html+'</span>';agTipsEl.appendChild(li);});
  if(t===null){
    agNowEl.innerHTML='<p class="ag-empty">Set a departure date above, or switch off <b>live now</b> and scrub the position by hand.</p>';
    paint(agEvents().slice(0,5));
    tipList([{ic:"⤓",html:'<b>Download before you board.</b> Offline maps, playlists, a few episodes. There is no onboard Wi-Fi on most Amtrak long-distance trains.'}]);
    return;
  }
  if(t<0){
    agNowEl.innerHTML='<div class="ag-hero"><p class="ag-where">Not departed: '+LEG.stops[0].short+'</p></div>'+
      '<p class="ag-stamp">leaves in '+fmtDur(-t)+' · '+clockAt(0).full+'</p>';
    paint(agEvents().filter(e=>e.t>=0).slice(0,5));
    const worst=LEG.cov.filter(c=>c.st==="dead").reduce((a,c)=>a+(c.t1-c.t0),0);
    tipList([
      {ic:"⤓",html:'<b>Download everything now.</b> '+(worst>0.5?('This leg has about '+fmtDur(worst)+' with no service at all on '+CARRIER_NAME[carrier]+'. '):'')+'Offline maps, playlists, a few episodes, whatever you plan to read.'},
      {ic:"▨",html:LEG.dining?('<b>'+(LEG.meals[0]?LEG.meals[0].name:"The first meal")+' is your first service.</b> In a sleeper, book dinner with your car attendant once you board.')
                            :'<b>Café car only</b> on a run this length. Bring your own food if you want more than snacks.'},
      {ic:"◉",html:LEG.sights.length?('<b>'+LEG.sights.length+' scenery highlight'+(LEG.sights.length>1?"s":"")+'</b> on this leg'+
          (LEG.sights.every(x=>darkAt(x.t))?', though all of them fall in the dark. '
           :(', starting with '+(LEG.sights.filter(x=>!darkAt(x.t))[0]||LEG.sights[0]).n+'. '))+
          (hasSightseer()?'The Sightseer Lounge sees both sides.':'This train has no Sightseer Lounge, so pick your side of the coach.'))
                                   :'<b>Grab a window seat.</b> '+(hasSightseer()?'The Sightseer Lounge sees both sides.':'This train is single-level, so pick your side of the coach.')}]
      .concat(longStopTip()));
    return;
  }
  if(t>=LEG.TOTAL){
    const last=LEG.stops[LEG.stops.length-1];
    agNowEl.innerHTML='<div class="ag-hero"><span class="chip" style="background:'+pal[covAt(LEG.TOTAL)]+';color:#0c1116">'+STAT[covAt(LEG.TOTAL)]+'</span><p class="ag-where">Arrived: '+last.short+'</p></div>'+
      '<p class="ag-stamp">'+fmtDur(LEG.TOTAL)+' · '+Math.round(legKm()).toLocaleString()+' mi</p>';
    agNextEl.innerHTML='<li class="ag-item">'+dot(covAt(LEG.TOTAL))+'<span class="ag-when">—</span><span class="ag-what"><b>End of the line</b><span>nothing further on this leg</span></span></li>';
    tipList([{ic:"✓",html:'<b>Back on the network.</b> Anything you queued through the dead stretches should be going out now.'}]);
    return;
  }
  const i=stopIndexAt(t), st=covAt(t), run=covRun(t), c=clockAt(t),
        here=LEG.stops[i], atStation=t<=here.td+0.12,
        /* still standing there: say how long is left, it is the whole question */
        platform=(here.dwell&&t<here.td)?(" · "+fmtDur(here.td-t)+" left on the platform"):"";
  agNowEl.innerHTML=
    '<div class="ag-hero"><span class="chip" style="background:'+pal[st]+';color:'+((theme==="light"&&st==="spotty")?"#fff":"#0c1116")+'">'+STAT[st]+'</span>'+
    '<p class="ag-where">'+(atStation?("At "+here.short+platform):(stopName(i)+" → "+stopName(i+1)))+'</p></div>'+
    '<p class="ag-stamp">'+c.full+' · '+fmtDur(t)+' in · '+fmtDur(LEG.TOTAL-t)+' to '+stopName(LEG.stops.length-1)+'</p>'+
    '<div class="ag-rows" id="agRows"></div>';
  const rows=[], nx=run.t1<LEG.TOTAL-1e-6?covAt(run.t1+1e-6):null;
  /* standing on the boundary of a run, "holds about 0m" says nothing; the
     honest reading is that it is changing under you right now */
  const left=run.t1-t, ending=left<1/60;
  rows.push(["Signal",st==="dead"
    ?(ending?('No service · <em>'+(nx?(STAT[nx].toLowerCase()+' from about now near '+stopName(stopIndexAt(run.t1)+1)):'ending about now')+'</em>')
            :('No service · <em>about '+fmtDur(left)+' left'+(nx?', '+STAT[nx].toLowerCase()+' again ~'+clockAt(run.t1).time+' near '+stopName(stopIndexAt(run.t1)+1):'')+'</em>'))
    :STAT[st]+' on '+CARRIER_NAME[carrier]+' · <em>'+
      (ending?(nx?(({good:"coming back",spotty:"turning spotty",dead:"dropping out"})[nx]+' about now'):'to the end of this leg')
             :('holds about '+fmtDur(left)+(nx?', then '+STAT[nx].toLowerCase()+' from ~'+clockAt(run.t1).time:'')))+'</em>']);
  const dk=nightAt(t),nd=nextDark(t);
  rows.push(["Outside",dk
    ?(dk.b>=LEG.TOTAL-1e-6 ? 'Dark · <em>and stays dark to the end of this leg</em>'
                           : 'Dark · <em>daylight ~'+clockAt(dk.b).time+'</em>')
    :('Daylight'+(nd?' · <em>dark from ~'+clockAt(nd).time+'</em>':''))]);
  const mn=mealAt(t),nm=nextMeal(t);
  rows.push(["Dining",!LEG.dining?'Café car only on this run'
    :(mn?(mn.name+' being served · <em>last call ~'+clockAt(Math.max(mn.a,mn.b-LAST_CALL)).time+'</em>')
       :(nm?(nm.name+' opens ~'+clockAt(nm.a).time+' · <em>in '+fmtDur(nm.a-t)+'</em>'):'Closed for the rest of this leg'))]);
  const sn=sightNow(t),ns=nextSight(t);
  rows.push(["Window",sn?('<b>'+sn.n+'</b> · <em>'+lookText(sn)+(darkAt(sn.t)?', though it is dark out':'')+'</em>')
    :(ns?(ns.n+' ~'+clockAt(ns.t).time+' · <em>in '+fmtDur(ns.t-t)+(darkAt(ns.t)?', and dark then':'')+'</em>'):'No marked highlights left on this leg')]);
  const host=$("agRows");
  rows.forEach(r=>{const d=document.createElement("div");d.className="ag-row";
    d.innerHTML='<span class="k">'+r[0]+'</span><span class="v">'+r[1]+'</span>';host.appendChild(d);});
  const up=agEvents().filter(e=>e.t>t+0.02).slice(0,5);
  if(up.length) paint(up);
  else agNextEl.innerHTML='<li class="ag-item">'+dot(st)+'<span class="ag-when">—</span><span class="ag-what"><b>'+stopName(LEG.stops.length-1)+'</b><span>nothing scheduled before arrival</span></span></li>';
  tipList(agTipList(t));
}
function legKm(){return LEG.km*0.621371;}
