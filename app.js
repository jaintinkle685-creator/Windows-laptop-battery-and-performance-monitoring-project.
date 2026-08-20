
const $ = id => document.getElementById(id);
if (location.protocol === "file:") {
  window.addEventListener("load", () => {
    const banner = document.createElement("div");
    banner.style.cssText = "position:fixed;z-index:99999;left:20px;right:20px;top:20px;padding:14px 18px;border-radius:12px;background:#0d1428;color:#fff;border:1px solid #2196f3;font:600 14px system-ui;box-shadow:0 10px 30px rgba(0,0,0,.35)";
    banner.innerHTML = "Run <b>START.bat</b> from the project folder to enable live Windows laptop telemetry. Opening index.html directly only loads the interface.";
    document.body.appendChild(banner);
  });
}
const clamp = (v,a,b) => Math.max(a,Math.min(b,v));
const f = (v,d=1) => Number.isFinite(Number(v)) ? Number(v).toFixed(d) : "--";

const history = {battery:[],cpu:[],ram:[],gpu:[],temp:[],power:[],display:[],drainRate:[],efficiency:[]};
const MAX_SAMPLES = 7200;
let sample=0, sessionStart=Date.now(), graphWindow=900, latest=null, apiOnline=false;
let lastDisplayState={brightness:null,rate:null};
let displayChangeUntil=0;
let displayChangeText="Waiting for live display changes…";

function push(a,v){
  if(v==null || !Number.isFinite(Number(v))) return;
  if(a.length>=MAX_SAMPLES) a.shift();
  a.push(Number(v));
}

function formatDuration(minutes){
  if(!Number.isFinite(minutes)) return "--";
  if(minutes < 1) return "<1 min";
  const total=Math.round(minutes), h=Math.floor(total/60), min=total%60;
  if(total<60) return `${total} min`;
  return min ? `${h} h ${min} min` : `${h} h`;
}

function showPage(page){
  document.querySelectorAll(".page").forEach(p=>p.classList.remove("active"));
  $("page-"+page).classList.add("active");
  document.querySelectorAll(".nav-item").forEach(b=>b.classList.toggle("active",b.dataset.page===page));
  const titles={
    overview:["Laptop Battery Usage Optimizer","Real-time battery and system intelligence"],
    analytics:["Analytics Dashboard","Live multi-metric performance history"],
    optimizer:["Smart Optimizer","Safe recommendations and battery what-if modelling"],
    power:["Power Analysis","Live active Windows process analysis"],
    insights:["Energy Insights","Live battery efficiency and workload intelligence"],
    aoa:["AOA Project Details","Algorithms, complexity, architecture and project scope"]
  };
  $("pageTitle").textContent=titles[page][0];
  $("pageSubtitle").textContent=titles[page][1];
}
document.querySelectorAll(".nav-item").forEach(b=>b.onclick=()=>showPage(b.dataset.page));

function setMetric(id,value,suffix=""){
  $(id).textContent = value==null ? "--" : `${value}${suffix}`;
}

function score(m){
  const powerPenalty=clamp((m.power-8)*1.25,0,42);
  const cpuPenalty=clamp(m.cpu*.18,0,18);
  const ramPenalty=clamp(Math.max(0,m.ram-45)*.10,0,7);
  const thermalPenalty=Number.isFinite(m.temp)?clamp(Math.max(0,m.temp-50)*.45,0,15):0;
  const brightnessPenalty=Number.isFinite(m.bright) ? (m.bright>60?(m.bright-60)*.10:0) : 0;
  const refreshPenalty=Number.isFinite(m.rate) ? (m.rate>=144?6:m.rate>=120?4:m.rate>60?2:0) : 0;
  const displayPenalty=brightnessPenalty+refreshPenalty;
  return Math.round(clamp(100-powerPenalty-cpuPenalty-ramPenalty-thermalPenalty-displayPenalty,5,99));
}

function buildGreedyActions(m){
  const candidates=[
    {name:"Refresh rate",saving:Number.isFinite(m.rate)&&m.rate>60?(m.rate>=144?3.2:2.0):0,
      text:Number.isFinite(m.rate)?`Live Windows setting is ${f(m.rate,0)} Hz. ${m.rate>60?"Use 60 Hz on battery when smoothness is not needed.":"60 Hz is already battery-friendly."}`:"Refresh rate is unavailable; keep monitoring.",
      apply:()=>{$("refreshRate").value=60;}},
    {name:"Brightness",saving:Number.isFinite(m.bright)&&m.bright>60?(m.bright-60)*.045:0,
      text:Number.isFinite(m.bright)?`Live Windows brightness is ${f(m.bright,0)}%. ${m.bright>60?"Reduce it toward 60% to cut display power.":"Brightness is already battery-friendly."}`:"Brightness is unavailable; keep monitoring.",
      apply:()=>{$("brightness").value=60;}},
    {name:"Background activity",saving:$("backgroundApps").checked?0:1.8,text:"Reduce high-power background activity while on battery.",apply:()=>{$("backgroundApps").checked=true;}},
    {name:"CPU workload",saving:m.cpu>35?(m.cpu-35)*.035:0,text:"Close or pause unnecessary CPU-heavy work.",apply:()=>{}}
  ];
  return candidates.filter(x=>x.saving>0.05).sort((a,b)=>b.saving-a.saving);
}

function updateOptimizer(m){
  const s=score(m);
  $("optimizerScore").textContent=s;
  const angle=(s/100)*360;
  $("optimizerScore").parentElement.style.background=`conic-gradient(var(--cyan) ${angle}deg,#182844 ${angle}deg)`;
  $("optimizerHeadline").textContent=s>=82?"Excellent live efficiency":s>=65?"Good live efficiency":"Optimization recommended";
  $("optimizerState").textContent=s>=82?"OPTIMIZED":"ACTION AVAILABLE";
  const actions=buildGreedyActions(m);
  const totalSaving=actions.reduce((sum,a)=>sum+a.saving,0);
  $("optimizerDraw").textContent=Number.isFinite(m.power)?f(m.power,1)+" W":"--";
  $("optimizerRuntime").textContent=formatDuration(m.runtimeMin);
  $("optimizerSaving").textContent=totalSaving>0?`~${f(totalSaving,1)} W`:"Minimal";
  $("optimizerActions").innerHTML=actions.length
    ? actions.slice(0,4).map((a,i)=>`<div class="action-row"><span class="action-rank">${i+1}</span><b>${a.name}</b><span>${a.text}<strong> ~${f(a.saving,1)} W</strong></span></div>`).join("")
    : `<div><b>All key settings</b><span>No major safe optimization is currently required.</span></div>`;
  $("recommendTitle").textContent=s<65?"High power usage detected":"Battery usage is under control";
  $("recommendText").textContent=actions.length
    ? `Greedy selection found ${actions.length} safe action${actions.length>1?"s":""}, ordered by estimated battery-power saving.`
    : "No major safe optimization is currently required. Monitoring will continue.";
  $("potentialSaving").textContent=totalSaving>0?`~${f(totalSaving,1)} W`:"<1 W";
}

function updateConsumers(m){
  const rows=(m.processes||[]).slice(0,5);
  if(!rows.length){
    $("consumerList").innerHTML=`<div class="notice">No active Windows processes detected right now.</div>`;
    return;
  }
  const max=Math.max(.1,...rows.map(x=>x.powerW||0));
  $("consumerList").innerHTML=rows.map(x=>{
    const w=Number(x.powerW)||0;
    return `<div class="consumer"><b>${x.name}</b><span class="powerbar"><i style="width:${clamp(w/max*100,0,100)}%"></i></span><b>${f(w,1)} W</b></div>`;
  }).join("");
}

function updatePowerTable(m){
  const rows=m.processes||[];
  $("powerTable").innerHTML=rows.length ? rows.map(r=>{
    const impact=r.impact||"LOW";
    return `<tr>
      <td><b>${escapeHtml(r.name)}</b></td>
      <td>${f(r.cpuPercent,1)}%</td>
      <td>${f(r.memoryPercent,1)}%</td>
      <td><span class="process-badge ${impact.toLowerCase()}">${impact}</span></td>
      <td>${r.powerW<.01?"<0.1 W":f(r.powerW,2)+" W"}</td>
      <td class="process-rec">${escapeHtml(r.recommendation||"Monitor this process if its resource use remains high.")}</td>
    </tr>`;
  }).join(""):`<tr><td colspan="6">No process telemetry available.</td></tr>`;

  $("processCount").textContent=rows.length;
  $("highProcessCount").textContent=rows.filter(r=>r.impact==="HIGH").length;
  $("mediumProcessCount").textContent=rows.filter(r=>r.impact==="MEDIUM").length;
  $("lowProcessCount").textContent=rows.filter(r=>r.impact==="LOW").length;
}

function calculateDrainRate(){
  const n=history.battery.length;
  if(n<2) return null;
  const look=Math.min(60,n-1);
  const a=history.battery[n-1-look], b=history.battery[n-1];
  const minutes=look/60;
  return minutes>0 ? Math.max(0,(a-b)/minutes) : null;
}

function calculateEfficiency(power,cpu,ram){
  if(!Number.isFinite(power)) return null;
  const load=clamp((cpu||0)*0.65+(ram||0)*0.35,0,100);
  const useful=Math.max(8,load);
  return clamp(100-(power/Math.max(1,useful))*35,0,100);
}

function updateInsights(m){
  const drain=calculateDrainRate();
  const efficiency=calculateEfficiency(m.powerW,m.cpuPercent,m.ramPercent);
  const load=clamp(((m.cpuPercent||0)*0.65)+((m.ramPercent||0)*0.35),0,100);
  if(drain!=null) push(history.drainRate,drain);
  if(efficiency!=null) push(history.efficiency,efficiency);
  $("insightEfficiency").textContent=efficiency!=null?f(efficiency,0)+"%":"--%";
  $("insightDrain").textContent=drain!=null?f(drain,2)+"%/min":"-- %/min";
  $("insightRuntime").textContent=m.runtimeMin!=null?formatDuration(m.runtimeMin):"--";
  $("insightLoad").textContent=f(load,0)+"%";
  const n=history.battery.length;
  const delta=n>30 ? history.battery[n-1]-history.battery[n-31] : 0;
  $("insightBatteryTrend").textContent=n<2?"Collecting samples…":delta<-0.05?`Falling ${f(Math.abs(delta),2)} percentage points / 30 s`:delta>0.05?`Rising ${f(delta,2)} percentage points / 30 s`:"Stable";
  const pn=history.power.length;
  const pd=pn>30 ? history.power[pn-1]-history.power[pn-31] : 0;
  $("insightPowerTrend").textContent=pn<2?"Collecting samples…":pd>0.5?`Increasing by ${f(pd,1)} W`:pd<-0.5?`Decreasing by ${f(Math.abs(pd),1)} W`:"Stable";
  $("insightWorkload").textContent=load<35?"Light workload":load<70?"Moderate workload":"Heavy workload";
  const rec=drain!=null&&drain>1?"Battery is draining quickly — inspect high-power workloads.":load>75?"System load is high — reduce unnecessary workloads.":efficiency!=null&&efficiency>75?"Energy use looks efficient right now.":"Continue monitoring the live trend.";
  $("insightRecommendation").textContent=rec;
}

function updateUI(m){
  latest=m;
  const b=m.battery?.levelPercent;
  setMetric("batteryPercent",b==null?null:f(b,0));
  setMetric("topBattery",b==null?null:f(b,0),"%");
  $("batteryProgress").style.width=(b??0)+"%";
  $("batteryFill").style.height=(b??0)+"%";
  $("capacityWh").textContent=m.battery?.remainingMWh!=null ? f(m.battery.remainingMWh/1000,2) : "--";

  setMetric("cpu",m.cpuPercent==null?null:f(m.cpuPercent,0),"%");
  setMetric("ram",m.ramPercent==null?null:f(m.ramPercent,0),"%");
  $("gpu").textContent=m.gpu?.utilizationPercent!=null ? f(m.gpu.utilizationPercent,0)+"%" : (m.gpu?.model||"N/A");
  $("temperature").textContent=m.temperatureC!=null ? f(m.temperatureC,1)+"°C" : "N/A";
  $("power").textContent=m.powerW!=null ? f(m.powerW,1)+" W" : "N/A";
  $("displayRate").textContent=m.display?.refreshRateHz!=null ? f(m.display.refreshRateHz,0)+" Hz" : "N/A";

  setMetric("topCpu",m.cpuPercent==null?null:f(m.cpuPercent,0),"%");
  setMetric("topRam",m.ramPercent==null?null:f(m.ramPercent,0),"%");

  const rolling=history.power.slice(-60);
  const rollingPower=rolling.length ? rolling.reduce((a,b)=>a+b,0)/rolling.length : m.powerW;
  $("powerDraw").textContent=rollingPower!=null?f(rollingPower,1)+" W":"N/A";
  $("runtime").textContent=m.runtimeMin!=null?formatDuration(m.runtimeMin):"--";
  $("sampleCount").textContent=sample;
  $("sampleInfo").textContent=`1 sample / second • ${formatDuration(sample/60)} elapsed`;
  $("analyticsSamples").textContent=sample;
  $("sessionTime").textContent=Math.floor((Date.now()-sessionStart)/60000)+"m";
  $("averagePower").textContent=rollingPower!=null?f(rollingPower,1)+" W":"N/A";
  $("lowestBattery").textContent=history.battery.length?f(Math.min(...history.battery),0)+"%":"--%";

  const liveBright = Number.isFinite(Number(m.display?.brightnessPercent))
    ? Number(m.display.brightnessPercent) : null;
  const liveRate = Number.isFinite(Number(m.display?.refreshRateHz))
    ? Number(m.display.refreshRateHz) : null;
  $("optimizerBrightness").textContent = liveBright != null ? f(liveBright,0)+"%" : "N/A";
  $("optimizerRefreshRate").textContent = liveRate != null ? f(liveRate,0)+" Hz" : "N/A";

  // Detect real Windows display changes while the dashboard is running.
  // A change immediately affects the next efficiency score and recommendations.
  const brightnessChanged = liveBright != null && lastDisplayState.brightness != null && liveBright !== lastDisplayState.brightness;
  const refreshChanged = liveRate != null && lastDisplayState.rate != null && liveRate !== lastDisplayState.rate;
  if (brightnessChanged || refreshChanged) {
    const parts=[];
    if (brightnessChanged) parts.push(`brightness ${f(lastDisplayState.brightness,0)}% → ${f(liveBright,0)}%`);
    if (refreshChanged) parts.push(`refresh rate ${f(lastDisplayState.rate,0)} Hz → ${f(liveRate,0)} Hz`);
    displayChangeText = `Detected live Windows change: ${parts.join(" and ")}. Recalculating efficiency…`;
    displayChangeUntil = Date.now()+3500;
  }
  if (liveBright != null) lastDisplayState.brightness=liveBright;
  if (liveRate != null) lastDisplayState.rate=liveRate;
  const changeEl=$("displayChangeStatus");
  if(changeEl){
    changeEl.textContent=Date.now()<displayChangeUntil?displayChangeText:"Live monitoring active • changes are detected automatically";
    changeEl.classList.toggle("changed",Date.now()<displayChangeUntil);
  }

  updateOptimizer({
    battery:b??0,cpu:m.cpuPercent??0,ram:m.ramPercent??0,temp:m.temperatureC??50,
    power:rollingPower??m.powerW??0,runtimeMin:m.runtimeMin,
    bright:liveBright,rate:liveRate
  });
  updateConsumers(m);
  updatePowerTable(m);
  updateInsights(m);
  drawAll();
}

function escapeHtml(s){
  return String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
}

function chartTheme(id){
  const map={
    batteryChart:{line:'#22c55e',fill:'#22c55e'},
    analyticsBattery:{line:'#22c55e',fill:'#22c55e'},
    analyticsPower:{line:'#2196f3',fill:'#2196f3'},
    analyticsCpu:{line:'#a855f7',fill:'#a855f7'},
    analyticsRam:{line:'#f59e0b',fill:'#f59e0b'},
    analyticsTemp:{line:'#ef4444',fill:'#ef4444'},
    miniCpu:{line:'#a855f7',fill:'#a855f7'},
    miniRam:{line:'#f59e0b',fill:'#f59e0b'},
    miniGpu:{line:'#06b6d4',fill:'#06b6d4'},
    miniTemp:{line:'#ef4444',fill:'#ef4444'},
    miniPower:{line:'#2196f3',fill:'#2196f3'},
    insightDrainChart:{line:'#ef4444',fill:'#ef4444'},
    insightEfficiencyChart:{line:'#22c55e',fill:'#22c55e'},
    insightCpuChart:{line:'#a855f7',fill:'#a855f7'},
    insightRamChart:{line:'#f59e0b',fill:'#f59e0b'}
  };
  return map[id]||{line:'#2196f3',fill:'#2196f3'};
}
function chartTimeLabel(index,total){
  if(total<2) return 'Now';
  const elapsed=Math.max(0,total-1-index);
  if(elapsed===0) return 'Now';
  if(elapsed<60) return `-${elapsed}s`;
  const m=Math.floor(elapsed/60), sec=elapsed%60;
  return sec ? `-${m}m ${sec}s` : `-${m}m`;
}
function draw(id,data,min,max,unit="",decimals=0){
  const c=$(id); if(!c)return;
  const r=c.getBoundingClientRect(),dpr=devicePixelRatio||1,w=Math.max(300,r.width),h=Math.max(190,r.height);
  c.width=w*dpr;c.height=h*dpr;
  const ctx=c.getContext("2d");ctx.setTransform(dpr,0,0,dpr,0,0);
  ctx.clearRect(0,0,w,h);
  const theme=chartTheme(id);
  const bg=ctx.createLinearGradient(0,0,0,h); bg.addColorStop(0,'#0c1730'); bg.addColorStop(1,'#07101f');
  ctx.fillStyle=bg;ctx.fillRect(0,0,w,h);
  const pad={l:90,r:24,t:20,b:44}; const pw=w-pad.l-pad.r, ph=h-pad.t-pad.b;
  const arr=data.slice(-Math.max(2,Math.min(data.length,graphWindow)));
  let lo=Number.isFinite(min)?min:(arr.length?Math.min(...arr):0);
  let hi=Number.isFinite(max)?max:(arr.length?Math.max(...arr):100);
  if(!Number.isFinite(lo)) lo=0; if(!Number.isFinite(hi)) hi=100;
  if(hi-lo<.001){ const padValue=Math.max(1,Math.abs(hi)*.08); lo=Math.max(0,lo-padValue); hi=hi+padValue; }
  const span=Math.max(.001,hi-lo);
  ctx.font="11px Segoe UI,system-ui,sans-serif"; ctx.textBaseline="middle"; ctx.textAlign="right"; ctx.fillStyle="#9bb0c7";
  for(let i=0;i<=4;i++){
    const value=hi-(span*i/4), y=pad.t+ph*i/4;
    ctx.strokeStyle=i===4?'#29415d':'#172c45';ctx.lineWidth=1;
    ctx.beginPath();ctx.moveTo(pad.l,y);ctx.lineTo(w-pad.r,y);ctx.stroke();
    ctx.fillText(value.toFixed(decimals)+(unit.trim()?` ${unit.trim()}`:""),pad.l-12,y);
  }
  // Y-axis unit label
  ctx.save();ctx.translate(18,pad.t+ph/2);ctx.rotate(-Math.PI/2);ctx.textAlign='center';ctx.fillStyle='#6f879f';ctx.font='10px Segoe UI,system-ui,sans-serif';ctx.fillText(unit.trim()||'Value',0,0);ctx.restore();
  // X-axis labels use real elapsed time relative to the current sample.
  ctx.textAlign="center";ctx.textBaseline="top";ctx.fillStyle="#7f96ad";
  [0,0.25,0.5,0.75,1].forEach((ratio)=>{
    const idx=Math.min(arr.length-1,Math.round(ratio*(arr.length-1)));
    ctx.fillText(chartTimeLabel(idx,arr.length),pad.l+pw*ratio,h-pad.b+10);
  });
  ctx.fillStyle="#607991";ctx.font='10px Segoe UI,system-ui,sans-serif';ctx.fillText('Time',pad.l+pw/2,h-11);
  if(!arr.length) return;
  if(arr.length>=2){
    const points=arr.map((v,i)=>({x:pad.l+i*pw/(arr.length-1),y:pad.t+ph-((v-lo)/span)*ph}));
    // Area fill makes the trend easier to read at a glance.
    const area=ctx.createLinearGradient(0,pad.t,0,pad.t+ph);
    area.addColorStop(0,theme.fill+'55'); area.addColorStop(1,theme.fill+'03');
    ctx.beginPath();points.forEach((p,i)=>i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y));
    ctx.lineTo(points.at(-1).x,pad.t+ph);ctx.lineTo(points[0].x,pad.t+ph);ctx.closePath();ctx.fillStyle=area;ctx.fill();
    // Soft glow followed by crisp line.
    ctx.beginPath();points.forEach((p,i)=>i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y));
    ctx.strokeStyle=theme.line+'55';ctx.lineWidth=7;ctx.shadowBlur=12;ctx.shadowColor=theme.line;ctx.stroke();ctx.shadowBlur=0;
    ctx.beginPath();points.forEach((p,i)=>i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y));
    ctx.strokeStyle=theme.line;ctx.lineWidth=2.5;ctx.stroke();
    const last=arr[arr.length-1],x=points.at(-1).x,y=points.at(-1).y;
    ctx.fillStyle=theme.line;ctx.beginPath();ctx.arc(x,y,4,0,Math.PI*2);ctx.fill();
    ctx.strokeStyle='#ffffff';ctx.lineWidth=1.5;ctx.beginPath();ctx.arc(x,y,6.5,0,Math.PI*2);ctx.stroke();
    ctx.font='700 11px Segoe UI,system-ui,sans-serif';ctx.textAlign='right';ctx.textBaseline='bottom';ctx.fillStyle='#eef7ff';
    ctx.fillText(`${Number(last).toFixed(decimals)}${unit}`,x-8,Math.max(pad.t+12,y-9));
  }
}
function drawAll(){
  draw("batteryChart",history.battery,0,100,"%",0);
  draw("analyticsBattery",history.battery,0,100,"%",0);
  draw("analyticsPower",history.power,0,Math.max(20,Math.ceil((Math.max(...history.power,20)+5)/5)*5)," W",0);
  draw("analyticsCpu",history.cpu,0,100,"%",0);
  draw("analyticsRam",history.ram,0,100,"%",0);
  draw("analyticsTemp",history.temp,0,100,"°C",0);
  draw("miniCpu",history.cpu,0,100,"%",0);
  draw("miniRam",history.ram,0,100,"%",0);
  draw("miniGpu",history.gpu,0,100,"%",0);
  draw("miniTemp",history.temp,0,100,"°C",0);
  draw("miniPower",history.power,0,Math.max(20,Math.ceil((Math.max(...history.power,20)+5)/5)*5)," W",0);
  draw("insightDrainChart",history.drainRate,0,Math.max(2,Math.ceil((Math.max(...history.drainRate,2)+.5)*2)/2),"%/min",2);
  draw("insightEfficiencyChart",history.efficiency,0,100,"%",0);
  draw("insightCpuChart",history.cpu,0,100,"%",0);
  draw("insightRamChart",history.ram,0,100,"%",0);
}

// Instant battery layer: use the browser's Battery Status API as the first source.
// This reflects the battery state already exposed by Windows to Chrome/Edge, so the
// battery percentage is shown immediately while the rest of Windows telemetry loads.
let instantBattery = null;
let instantBatteryObject = null;
function applyInstantBattery(level, charging){
  if(!Number.isFinite(level)) return;
  instantBattery = Math.max(0, Math.min(100, level));
  if($('batteryPercent')) $('batteryPercent').textContent = f(instantBattery,0);
  if($('topBattery')) $('topBattery').textContent = f(instantBattery,0)+'%';
  if($('batteryProgress')) $('batteryProgress').style.width = instantBattery+'%';
  if($('batteryFill')) $('batteryFill').style.height = instantBattery+'%';
  if($('chargeStatus')) $('chargeStatus').textContent = charging ? 'Charging' : 'On Battery';
}
async function startInstantBattery(){
  if(!('getBattery' in navigator)) return;
  try{
    instantBatteryObject = await navigator.getBattery();
    const sync = ()=>applyInstantBattery(instantBatteryObject.level*100, instantBatteryObject.charging);
    sync();
    instantBatteryObject.addEventListener('levelchange',sync);
    instantBatteryObject.addEventListener('chargingchange',sync);
  }catch(e){ /* server telemetry remains the fallback */ }
}
startInstantBattery();

async function fetchTelemetry(){
  try{
    const r=await fetch("/api/telemetry?ts="+Date.now(),{cache:"no-store",keepalive:false});
    if(!r.ok)throw new Error("API "+r.status);
    const m=await r.json();
    apiOnline=true;
    // Prefer the instant browser battery reading when available. The local Windows
    // helper remains the authoritative source for power, runtime and all other telemetry.
    if(instantBattery!=null){
      m.battery = Object.assign({}, m.battery || {}, {levelPercent: instantBattery});
    }
    $("chargeStatus").textContent=m.battery?.charging?"Charging":"On Battery";
    document.querySelector(".online").innerHTML="<i></i> LIVE • LOCAL";
    push(history.battery,m.battery?.levelPercent);
    push(history.cpu,m.cpuPercent);
    push(history.ram,m.ramPercent);
    push(history.gpu,m.gpu?.utilizationPercent);
    push(history.temp,m.temperatureC);
    push(history.power,m.powerW);
    push(history.display,m.display?.refreshRateHz);
    sample++;
    updateUI(m);
  }catch(e){
    apiOnline=false;
    document.querySelector(".online").innerHTML="<i></i> CONNECTING…";
    $("chargeStatus").textContent="Loading local Windows telemetry…";
    setTimeout(fetchTelemetry,250);
  }
}

function whatIf(){
  const b=+$("brightness").value,r=+$("refreshRate").value,apps=$("backgroundApps").checked;
  $("brightnessValue").textContent=b+"%";
  const baseline=latest?.powerW||15;
  const saving=Math.max(0,(70-b)*.045)+(r===60?1.5:0)+(apps?1.8:0);
  const improvement=clamp(saving/Math.max(1,baseline)*100,0,90);
  $("whatIfResult").textContent="+"+f(improvement,0)+"%";
  $("screenPreview").style.filter=`brightness(${.4+b/100})`;
  $("screenPreview").style.boxShadow=`inset 0 0 ${r===144?24:0}px rgba(33,150,243,.5)`;
  $("previewText").textContent=`Preview: ${b}% brightness • ${r} Hz • ${apps?"background activity reduced":"normal background activity"} • estimated saving ${f(saving,1)} W`;
}

["brightness","refreshRate","backgroundApps"].forEach(id=>$(id).addEventListener("input",whatIf));
document.querySelectorAll("#overviewRange button").forEach(b=>b.onclick=()=>{
  document.querySelectorAll("#overviewRange button").forEach(x=>x.classList.remove("selected"));
  b.classList.add("selected");graphWindow=+b.dataset.window;drawAll();
});
$("optimizeButton").onclick=()=>{
  if(!latest) return;
  const m={battery:latest.battery?.levelPercent??0,
    bright:Number.isFinite(Number(latest.display?.brightnessPercent))?Number(latest.display.brightnessPercent):null,
    rate:Number.isFinite(Number(latest.display?.refreshRateHz))?Number(latest.display.refreshRateHz):null,
    power:latest.powerW??15,cpu:latest.cpuPercent??0,ram:latest.ramPercent??0,
    temp:latest.temperatureC??50,runtimeMin:latest.runtimeMin};
  updateOptimizer(m);
  $("optimizerState").textContent="LIVE ANALYSIS COMPLETE";
  setTimeout(()=>$("optimizerState").textContent="READY",1600);
};
$("applyRecommendation").onclick=()=>{
  $("brightness").value=65;$("refreshRate").value=60;$("backgroundApps").checked=true;
  whatIf();showPage("optimizer");
};

window.addEventListener("resize",drawAll);
whatIf();
drawAll();
fetchTelemetry();
setInterval(fetchTelemetry,500);
requestAnimationFrame(function render(){drawAll();requestAnimationFrame(render);});
