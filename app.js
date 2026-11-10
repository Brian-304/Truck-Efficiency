const STEPS=[
  {key:'unload',team:'rcv',name:'Unload pallets from truck',code:'RCV-UNL',noUph:true,note:'Shown for reference. Not counted in UPH.',rates:[['pallets','pallets']]},
  {key:'breakdown',team:'oms',name:'Break down pallets',code:'OMS-BRK',note:'Separate OMS orders, validation items, department totes and large units',rates:[['pallets','pallets'],['oms','OMS orders'],['mvu','validation units']]},
  {key:'validate',team:'man',name:'Validate manifest items (Zebra scan)',code:'MAN-VAL',rates:[['mvu','validation units']]},
  {key:'downstock',team:'dept',name:'Downstock totes and pallets',code:'DPT-DWN',rates:[['units','units']]},
];
const SBY=Object.fromEntries(STEPS.map(s=>[s.key,s]));
const DAY=864e5,DEFAULT_GOAL=90;
const S={manifests:[],goal:DEFAULT_GOAL,sample:false,range:'30d',editId:null,labor:null};
let db=null,userCap=null,myId=null,canEdit=false,dbState='connecting';

const $=s=>document.querySelector(s);
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const pad=n=>String(n).padStart(2,'0');
const ymd=d=>{d=new Date(d);return d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate())};
const fmtDate=s=>new Date(s+'T12:00').toLocaleDateString([],{weekday:'short',month:'short',day:'numeric'});
const num=n=>Math.round(n).toLocaleString();
const hrs1=h=>(Math.round(h*10)/10).toFixed(1);
const uphFmt=u=>u==null||!isFinite(u)?'—':u>=100?num(u):(Math.round(u*10)/10).toFixed(1);
const good=u=>u>=S.goal;
function uphPill(u){if(u==null||!isFinite(u))return '<span class="pill p-none">—</span>';return `<span class="pill ${good(u)?'p-good':'p-bad'}">${uphFmt(u)} UPH</span>`}
function teamChip(st){return `<span class="chip t-${st.team}"><span class="code">${st.code}</span></span>`}
function toast(msg){const t=$('#toast');t.textContent=msg;t.hidden=false;clearTimeout(toast.t);toast.t=setTimeout(()=>t.hidden=true,3200)}
const manifests=()=>S.sample?SAMPLE:S.manifests;
function minsBetween(a,b){if(!a||!b)return 0;const[h1,m1]=a.split(':').map(Number),[h2,m2]=b.split(':').map(Number);let d=(h2*60+m2)-(h1*60+m1);if(d<=0)d+=1440;return d}
const LUNCH={ftOver:300,ft:40,ptOver:120,pt:0};
const ftOf=r=>Math.max(0,Number(r.ft!=null&&r.ft!==''?r.ft:(r.pt!=null&&r.pt!==''?0:r.employees))||0),ptOf=r=>Math.max(0,Number(r.pt)||0);
const nm=r=>String(r.name||'').trim(),normName=n=>String(n||'').trim().toLowerCase();
function rowCalc(r){const min=minsBetween(r.start,r.end),heads=nm(r)?1:ftOf(r)+ptOf(r);return{min,hrs:heads*min/60}}
const rowHrs=r=>rowCalc(r).hrs;
function normTimes(rows){let iv=rows.map(r=>{const[hh,mm]=r.start.split(':').map(Number);return{r,s:hh*60+mm,min:minsBetween(r.start,r.end)}});
  if(iv.some(x=>x.s>=720)&&iv.some(x=>x.s<360))iv.forEach(x=>{if(x.s<360)x.s+=1440});iv.forEach(x=>x.e=x.s+x.min);return iv}
function people(m){
  const iv=normTimes((m.labor||[]).filter(r=>nm(r)&&r.start&&r.end)),by={};
  iv.forEach(x=>{const k=normName(x.r.name);(by[k]=by[k]||{name:nm(x.r),types:new Set(),iv:[]});by[k].types.add(x.r.type==='pt'?'pt':'ft');by[k].iv.push(x)});
  return Object.values(by).map(p=>{const type=p.types.size>1?'mixed':[...p.types][0],min=p.iv.reduce((a,x)=>a+x.min,0);
    const ded=type==='ft'&&min>LUNCH.ftOver?LUNCH.ft:type==='pt'&&min>LUNCH.ptOver?LUNCH.pt:0;
    const so=[...p.iv].sort((a,b)=>a.s-b.s);let overlap=null;for(let i=1;i<so.length;i++)if(so[i].s<so[i-1].e){overlap=[so[i-1],so[i]];break}
    return{...p,type,min,ded,overlap,steps:STEPS.map(s=>s.key).filter(k=>p.iv.some(x=>x.r.stage===k))}}).sort((a,b)=>a.name.localeCompare(b.name));
}
function stats(m){
  const raw={},dedBy={},legRaw={};STEPS.forEach(s=>{raw[s.key]=0;dedBy[s.key]=0;legRaw[s.key]=0});
  (m.labor||[]).forEach(r=>{if(raw[r.stage]==null)return;const h=rowHrs(r);raw[r.stage]+=h;if(!nm(r))legRaw[r.stage]+=h});
  people(m).forEach(p=>{if(p.ded>0&&p.min>0)p.iv.forEach(x=>{dedBy[x.r.stage]+=p.ded*(x.min/p.min)/60})});
  const legAll=Object.values(legRaw).reduce((a,b)=>a+b,0),legDed=Math.min(legAll,((Number(m.lunchFt)||0)*LUNCH.ft+(Number(m.breakPt)||0)*LUNCH.pt)/60);
  if(legAll>0)STEPS.forEach(s=>dedBy[s.key]+=legDed*legRaw[s.key]/legAll);
  const by={};STEPS.forEach(s=>by[s.key]=Math.max(0,raw[s.key]-dedBy[s.key]));
  const ded=Object.values(dedBy).reduce((a,b)=>a+b,0),total=STEPS.filter(s=>!s.noUph).reduce((a,s)=>a+by[s.key],0),all=Object.values(by).reduce((a,b)=>a+b,0);
  return{by,raw,ded,total,all,uph:total>0&&m.units>0?m.units/total:null}}
const clock=m=>{const d=new Date(2000,0,1,0,m);return d.toLocaleTimeString([],{hour:'numeric',minute:'2-digit'})};
function personCheck(m,formRows){
  if(formRows){const inc=formRows.find(r=>(r.start||r.end||nm(r))&&!(nm(r)&&r.start&&r.end));
    if(inc)return{block:true,msg:'Every row needs a first name, a start time and an end time'+(nm(inc)?`. Check the row for ${nm(inc)}.`:'.')}}
  const ps=people(m);if(!ps.length)return null;
  const mx=ps.find(p=>p.type==='mixed');if(mx)return{block:true,msg:`${mx.name} is marked full-time in one row and part-time in another. Pick one.`};
  const ov=ps.find(p=>p.overlap);if(ov){const[a,b]=ov.overlap;
    return{block:true,msg:a.r.stage===b.r.stage?`${ov.name} has two rows in ${SBY[a.r.stage].name} that overlap at ${clock(b.s)}. Fix the times or remove one row.`:`${ov.name} is in ${SBY[a.r.stage].name} and ${SBY[b.r.stage].name} at the same time (${clock(b.s)}). Adjust the times so they don't overlap.`}}
  const ft=ps.filter(p=>p.type==='ft').length;
  return{block:false,msg:`No double counting. ${ft} full-time and ${ps.length-ft} part-time on this truck, each counted once at any moment.`}}
function peopleTable(ps){return ps.length?`<table><thead><tr><th>Name</th><th>Type</th><th>Steps</th><th class="n">Hours worked</th><th class="n">Taken out</th><th class="n">Labor hrs</th></tr></thead><tbody>${ps.map(p=>`<tr><td><b>${esc(p.name)}</b></td><td>${p.type==='ft'?'Full-time':p.type==='pt'?'Part-time':'<span style="color:var(--bad)">Both?</span>'}</td><td>${p.steps.map(k=>teamChip(SBY[k])).join(' ')}</td><td class="n">${hrs1(p.min/60)}</td><td class="n">${p.ded?p.ded+' min '+(p.type==='ft'?'lunch':'break'):'—'}</td><td class="n"><b>${hrs1((p.min-p.ded)/60)}</b></td></tr>`).join('')}</tbody></table>`:'<div class="empty">People appear here as you add rows.</div>'}
function rateText(step,tot,h){if(!(h>0))return '—';const p=step.rates.filter(([k])=>tot[k]>0).map(([k,l])=>uphFmt(tot[k]/h)+' '+l);return p.length?p.join(' · ')+' per labor hr':'—'}
function stepTable(rows,totalH,totalLine){
  return `<table><thead><tr><th>Step</th><th class="n">Labor hrs</th><th class="n">% of UPH labor</th><th>Rate</th></tr></thead><tbody>${rows.map(r=>`<tr><td class="stp">${teamChip(r.s)} ${esc(r.s.name)}</td><td class="n">${hrs1(r.h)}</td><td class="n">${r.s.noUph?'<span class="sub">Not in UPH</span>':totalH>0?Math.round(r.h/totalH*100)+'%':'—'}</td><td class="vol">${esc(rateText(r.s,r.tot,r.h))}</td></tr>`).join('')}${totalLine||''}</tbody></table>`;
}

/* two-step confirm buttons (the viewer has no confirm dialog) */
let armed=null;
function arm(btn,label,fn){
  if(armed===btn){armed=null;fn();return}
  if(armed){armed.classList.remove('armed');armed.textContent=armed.dataset.orig}
  armed=btn;btn.dataset.orig=btn.textContent;btn.textContent=label;btn.classList.add('armed');
  setTimeout(()=>{if(armed===btn){btn.classList.remove('armed');btn.textContent=btn.dataset.orig;armed=null}},4000);
}
function canWrite(){
  if(S.sample){toast('Sample preview is on. Turn it off to save real data.');return false}
  if(!db){toast('Open this page signed in to claude.ai to save.');return false}
  return true;
}
function writeErr(e){toast(e&&e.code==='not_granted'?'You have view-only access. Ask the owner for edit access.':'Could not save. Check your connection and try again.')}

/* routing */
const VIEWS=['entry','dashboard','plan','goals'];
function route(){let v=location.hash.slice(1);if(!VIEWS.includes(v))v='entry';
  document.querySelectorAll('[data-v]').forEach(s=>s.hidden=s.id!=='v-'+v);
  document.querySelectorAll('nav.tabs a').forEach(a=>{if(a.dataset.view===v)a.setAttribute('aria-current','page');else a.removeAttribute('aria-current')});}
addEventListener('hashchange',route);

function renderBanner(){
  const b=$('#banner'),m=$('#bannerMsg'),btn=$('#sampleBtn');b.classList.toggle('sample',S.sample);
  btn.textContent=S.sample?'Back to live data':'Preview with sample data';
  if(S.sample){m.textContent='Sample preview: made-up manifests so you can see how the dashboard fills in. Nothing here is saved.';return}
  m.textContent={connecting:'Connecting to the shared log…',live:'Live. Everyone with this link sees the same trucks.',
    nodb:'You can try the calculator, but saving needs you to open this page signed in to claude.ai.',slow:'The shared log is taking a while to answer. Trucks will appear when it connects.',
    error:'Could not load the shared log. Reload the page to try again.'}[dbState];
}
$('#sampleBtn').onclick=()=>{S.sample=!S.sample;renderAll()};

/* ---------- entry form ---------- */
const blankRow=()=>({name:'',type:'ft',start:'',end:''});
function blankLabor(){return Object.fromEntries(STEPS.map(s=>[s.key,[blankRow()]]))}
const formRows=()=>STEPS.flatMap(s=>S.labor[s.key].map(r=>({...r,stage:s.key})));
function renderLabor(){
  $('#laborRows').innerHTML=STEPS.map(s=>`<div class="steprow t-${s.team}">
    <div class="sh"><span><span class="code">${s.code}</span> <b>${esc(s.name)}</b>${s.note?`<br><small style="opacity:.85">${esc(s.note)}</small>`:''}</span>
      <span class="calc" id="sh-${s.key}"></span></div>
    ${S.labor[s.key].map((r,i)=>`<div class="crew">
      <label>First name<input id="lr-${s.key}-${i}-name" data-k="${s.key}" data-i="${i}" data-f="name" maxlength="30" list="nameList" autocomplete="off" value="${esc(r.name)}"></label>
      <label>Type<select id="lr-${s.key}-${i}-type" data-k="${s.key}" data-i="${i}" data-f="type"><option value="ft" ${r.type!=='pt'?'selected':''}>Full-time</option><option value="pt" ${r.type==='pt'?'selected':''}>Part-time</option></select></label>
      <label>Start<input id="lr-${s.key}-${i}-start" data-k="${s.key}" data-i="${i}" data-f="start" type="time" value="${esc(r.start)}"></label>
      <label>End<input id="lr-${s.key}-${i}-end" data-k="${s.key}" data-i="${i}" data-f="end" type="time" value="${esc(r.end)}"></label>
      <span class="lh" id="lh-${s.key}-${i}"></span>
      ${S.labor[s.key].length>1?`<button class="small rm" type="button" data-rm="${s.key}|${i}" aria-label="Remove this row" title="Remove this row">✕</button>`:'<span></span>'}
    </div>`).join('')}
    <div><button class="small" type="button" data-add="${s.key}">Add person</button></div>
  </div>`).join('');
  updateResult();
}
function onRowEdit(e){const t=e.target;if(!t.dataset||!t.dataset.k)return;const row=S.labor[t.dataset.k][+t.dataset.i];row[t.dataset.f]=t.value;
  if(t.dataset.f==='name'&&e.type==='change'){    const other=formRows().filter(x=>normName(x.name)===normName(row.name)&&!(x.stage===t.dataset.k&&x.start===row.start&&x.end===row.end&&x.type===row.type));
    if(nm(row)&&other.length){row.type=other[0].type||'ft';const sel=$(`#lr-${t.dataset.k}-${t.dataset.i}-type`);if(sel)sel.value=row.type}}
  updateResult()}
$('#laborRows').addEventListener('input',onRowEdit);$('#laborRows').addEventListener('change',onRowEdit);
$('#laborRows').addEventListener('click',e=>{const b=e.target.closest('button');if(!b)return;
  if(b.dataset.add){S.labor[b.dataset.add].push(blankRow());renderLabor();const n=S.labor[b.dataset.add].length-1;$(`#lr-${b.dataset.add}-${n}-name`).focus()}
  if(b.dataset.rm){const[k,i]=b.dataset.rm.split('|');S.labor[k].splice(+i,1);renderLabor()}});
['tUnits','tPallets','tOms','tMvu'].forEach(id=>$('#'+id).addEventListener('input',updateResult));
function formManifest(){const n=id=>Math.max(0,Math.round(Number($(id).value)||0));
  const labor=formRows().filter(r=>nm(r)&&r.start&&r.end).map(r=>({stage:r.stage,name:nm(r),type:r.type==='pt'?'pt':'ft',start:r.start,end:r.end,minutes:minsBetween(r.start,r.end)}));
  return{ref:$('#tRef').value.trim(),date:$('#tDate').value,units:n('#tUnits'),pallets:n('#tPallets'),oms:n('#tOms'),mvu:n('#tMvu'),labor}}
function updateResult(){
  const m=formManifest(),st=stats(m),ps=people(m);
  STEPS.forEach(s=>{S.labor[s.key].forEach((r,i)=>{const el=$(`#lh-${s.key}-${i}`);if(el){const c=rowCalc(r);el.textContent=c.hrs>0?`= ${hrs1(c.hrs)} hrs`:''}});const sh=$('#sh-'+s.key);if(sh)sh.textContent=st.raw[s.key]>0?`${hrs1(st.raw[s.key])} hrs before lunches`:''});
  $('#nameList').innerHTML=ps.map(p=>`<option value="${esc(p.name)}">`).join('');
  const ck=personCheck(m,formRows()),cb=$('#crewCheck');cb.hidden=!ck;if(ck){cb.textContent=ck.msg;cb.className='banner '+(ck.block?'bad':'ok')}
  $('#peopleTable').innerHTML=peopleTable(ps);
  const u=st.uph;$('#rUph').textContent=uphFmt(u);$('#rUph').className='uph-big'+(u==null?'':good(u)?' uph-good':' uph-bad');
  $('#rUphNote').textContent=u==null?'Enter total units and at least one person.':(good(u)?`At or above the goal of ${uphFmt(S.goal)}`:`Below the goal of ${uphFmt(S.goal)}`);
  $('#rCalc').innerHTML=st.total>0?`${num(m.units)} units ÷ <b>${hrs1(st.total)} downstocking labor hrs</b> = <b>${uphFmt(u)} UPH</b>${st.ded>0?`<br>${hrs1(st.ded)} hrs of unpaid lunches taken out`:''}`:'';
  $('#rSteps').innerHTML=st.all>0?stepTable(STEPS.map(s=>({s,h:st.by[s.key],tot:m})),st.total,`<tr><td><b>Downstocking labor (UPH)</b></td><td class="n"><b>${hrs1(st.total)}</b></td><td class="n">100%</td><td class="vol"><b>${uphFmt(st.uph)} UPH</b></td></tr>`):'';
}
function resetForm(){S.editId=null;S.labor=blankLabor();['#tRef','#tUnits','#tPallets','#tOms','#tMvu'].forEach(i=>$(i).value='');$('#tDate').value=ymd(Date.now());
  $('#formTitle').textContent='Enter a received truck';$('#saveBtn').textContent='Save truck';renderLabor()}
function loadForm(m){S.editId=S.sample?null:m.id;$('#tRef').value=m.ref||'';$('#tDate').value=m.date||'';
  [['#tUnits','units'],['#tPallets','pallets'],['#tOms','oms'],['#tMvu','mvu']].forEach(([i,k])=>$(i).value=m[k]||'');
  S.labor=Object.fromEntries(STEPS.map(s=>{const rows=[];(m.labor||[]).filter(r=>r.stage===s.key).forEach(r=>{
    if(nm(r))rows.push({name:nm(r),type:r.type==='pt'?'pt':'ft',start:r.start,end:r.end});
    else{const f=ftOf(r),q=ptOf(r);for(let i=0;i<f+q;i++)rows.push({name:'',type:i<f?'ft':'pt',start:r.start,end:r.end})}});
    return[s.key,rows.length?rows:[blankRow()]]}));
  $('#formTitle').textContent=S.editId?`Editing manifest ${m.ref}`:`Viewing sample ${m.ref}`;$('#saveBtn').textContent=S.editId?'Save changes':'Save truck';renderLabor();location.hash='entry';scrollTo(0,0)}
$('#clearForm').addEventListener('click',()=>{resetForm();toast('Form cleared')});
$('#truckForm').addEventListener('submit',async e=>{
  e.preventDefault();if(!canWrite())return;const m=formManifest();
  if(!m.ref||!m.date)return;if(!(m.units>0)){toast('Enter the total units from the manifest.');return}
  if(!m.labor.length){toast('Add at least one person with a start and end time.');return}
  const ck=personCheck(m,formRows());if(ck&&ck.block){toast(ck.msg);$('#crewCheck').scrollIntoView({block:'center'});return}
  const st=stats(m);
  try{
    if(S.editId){await db.doc('manifests/'+S.editId).update({...m,updatedAt:Date.now(),updatedBy:myId||null});toast(`Manifest ${m.ref} updated: ${uphFmt(st.uph)} UPH`)}
    else{const ref=await db.collection('manifests').add({...m,createdAt:Date.now(),createdBy:myId||null});S.editId=ref.id;$('#formTitle').textContent=`Editing manifest ${m.ref}`;$('#saveBtn').textContent='Save changes';toast(`Manifest ${m.ref} saved: ${uphFmt(st.uph)} UPH`)}
  }catch(err){writeErr(err)}
});

/* ---------- dashboard ---------- */
function inRange(){return manifests()}
function renderDashboard(){
  const rec=inRange().map(m=>({m,st:stats(m)})).sort((a,b)=>(b.m.date||'').localeCompare(a.m.date||'')||(b.m.createdAt||0)-(a.m.createdAt||0));
  renderChart(rec);
  $('#truckTable').innerHTML=rec.length?`<table><thead><tr><th>Manifest #</th><th>Received</th><th class="n">Units</th>${STEPS.map(s=>`<th class="n">${esc(s.code)}</th>`).join('')}<th class="n">UPH labor hrs</th><th class="n">UPH</th><th></th></tr></thead><tbody>${rec.map(({m,st})=>`<tr><td><b>${esc(m.ref)}</b></td><td style="white-space:nowrap">${m.date?fmtDate(m.date):'—'}</td><td class="n">${m.units?num(m.units):'—'}</td>${STEPS.map(s=>`<td class="n">${hrs1(st.by[s.key])}</td>`).join('')}<td class="n"><b>${hrs1(st.total)}</b></td><td class="n">${uphPill(st.uph)}</td>
    <td style="white-space:nowrap"><button class="small" type="button" data-open="${m.id}">Open</button> ${!S.sample&&db&&(canEdit||(myId&&m.createdBy===myId))?`<button class="small danger" type="button" data-del="${m.id}">Delete</button>`:''}</td></tr>`).join('')}</tbody></table>`:emptyDash();
}
document.addEventListener('click',e=>{const b=e.target.closest('button');if(!b)return;
  if(b.dataset.open){const m=manifests().find(x=>x.id===b.dataset.open);if(m)loadForm(m)}
  else if(b.dataset.del){const id=b.dataset.del;arm(b,'Confirm delete',async()=>{if(!canWrite())return;try{await db.doc('manifests/'+id).delete();if(S.editId===id)resetForm();toast('Truck deleted')}catch(err){writeErr(err)}})}});
function emptyDash(){return `<div class="empty">No trucks yet. Enter a received truck on the Enter truck tab${S.sample?'':', or preview with sample data'}.</div>`}
function renderChart(rec){
  const all=rec.filter(r=>r.st.uph!=null).sort((x,y)=>(x.m.date||'').localeCompare(y.m.date||'')||(x.m.createdAt||0)-(y.m.createdAt||0));
  const pts=all.slice(-30);
  $('#chartTitle').textContent='UPH by truck';
  $('#chartNote').textContent=`One point per truck, oldest to newest${all.length>30?' (latest 30)':''}. Dashed line = goal of ${uphFmt(S.goal)} UPH.`;
  if(!pts.length){$('#chart').innerHTML=emptyDash();return}
  const W=900,H=300,L=44,R=24,T=30,B=46,MAX=120,y=v=>T+(H-T-B)*(1-Math.min(v,MAX)/MAX);
  const n=pts.length,x=i=>n===1?(L+W-R)/2:L+12+i*((W-R-L-24)/(n-1)),every=Math.ceil(n/12),labelAll=n<=15;
  let s=`<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="UPH by truck, ${n} trucks">`;
  for(let v=0;v<=MAX;v+=20)s+=`<line x1="${L}" x2="${W-R}" y1="${y(v)}" y2="${y(v)}" stroke="var(--line)" stroke-width="1"/><text x="${L-8}" y="${y(v)+4}" text-anchor="end" font-size="12" fill="var(--muted)">${v}</text>`;
  s+=`<line x1="${L}" x2="${W-R}" y1="${y(S.goal)}" y2="${y(S.goal)}" stroke="var(--ink)" stroke-width="1.5" stroke-dasharray="6 4"/>`;
  if(n>1)s+=`<polyline fill="none" stroke="var(--series)" stroke-width="2" stroke-linejoin="round" points="${pts.map((p,i)=>x(i)+','+y(p.st.uph)).join(' ')}"/>`;
  pts.forEach((p,i)=>{const u=p.st.uph,cx=x(i),cy=y(u),ok=good(u),over=u>MAX;
    s+=`<circle cx="${cx}" cy="${cy}" r="6" fill="${ok?'var(--good)':'var(--bad)'}" stroke="var(--surface)" stroke-width="2"/>`;
    if(over)s+=`<path d="M${cx-5} ${cy-11} L${cx+5} ${cy-11} L${cx} ${cy-18} Z" fill="var(--ink)"/>`;
    if(labelAll||i===n-1)s+=`<text x="${cx}" y="${cy-(over?22:12)}" text-anchor="middle" font-size="12" font-weight="600" fill="var(--ink)" stroke="var(--surface)" stroke-width="4" stroke-linejoin="round" paint-order="stroke">${uphFmt(u)}</text>`;
    if(i%every===0||i===n-1)s+=`<text x="${cx}" y="${H-B+18}" text-anchor="middle" font-size="11.5" fill="var(--muted)">${esc(p.m.ref)}</text>${p.m.date?`<text x="${cx}" y="${H-B+32}" text-anchor="middle" font-size="10.5" fill="var(--muted)">${new Date(p.m.date+'T12:00').toLocaleDateString([],{month:'short',day:'numeric'})}</text>`:''}`;
    s+=`<circle cx="${cx}" cy="${cy}" r="16" fill="transparent"><title>${esc(p.m.ref)}${p.m.date?' · '+fmtDate(p.m.date):''}: ${uphFmt(u)} UPH (${num(p.m.units||0)} units ÷ ${hrs1(p.st.total)} labor hrs) · ${ok?'at or above':'below'} goal</title></circle>`});
  $('#chart').innerHTML=s+'</svg>';
}

/* ---------- goal ---------- */
function renderGoals(){const ro=!canEdit||S.sample;$('#saveGoal').hidden=ro;$('#gUph').disabled=ro;
  $('#goalNote').textContent='UPH at or above the goal shows green. UPH below the goal shows red.'+(ro?' Only people with edit access to this page can change it.':'');
  if(document.activeElement!==$('#gUph'))$('#gUph').value=S.goal}
$('#goalForm').addEventListener('submit',async e=>{e.preventDefault();if(!canWrite())return;const v=Number($('#gUph').value);
  if(!(v>0)){toast('Enter a UPH goal above 0.');return}
  try{await db.doc('settings/goals').set({uph:v,updatedAt:Date.now(),updatedBy:myId||null});toast('UPH goal saved')}catch(err){writeErr(err)}});

/* ---------- sample data (preview only, never saved) ---------- */
const SAMPLE=(()=>{
  let seed=21;const r=()=>(seed=(seed*16807)%2147483647)/2147483647,ri=(a,b)=>a+Math.floor(r()*(b-a+1));
  const t0=new Date();t0.setHours(0,0,0,0);const out=[];let n=0;
  const tm=m=>pad(Math.floor(m/60)%24)+':'+pad(m%60),POOL=['Alex','Sam','Jordan','Taylor','Casey','Riley','Morgan','Jamie','Drew','Avery'];
  for(let d=20;d>=1;d--){if(r()<.25)continue;const k=ri(1,2);for(let j=0;j<k;j++){const base=360+j*240,P=[...POOL].sort(()=>r()-.5),L=[];
    const add=(stage,i,type,s,e)=>L.push({stage,name:P[i],type,start:tm(s),end:tm(e),minutes:e-s});
    const u=base+ri(45,75),b=u+ri(150,210);
    add('unload',0,'ft',base,u);add('unload',1,'ft',base,u);
    add('breakdown',0,'ft',u,b);add('breakdown',1,'ft',u,b);add('breakdown',2,'pt',u,u+ri(100,150));
    add('validate',3,'ft',u+30,u+30+ri(120,180));
    add('downstock',0,'ft',b,b+ri(120,180));add('downstock',1,'ft',b,b+ri(120,180));
    add('downstock',4,'pt',u+60,u+60+ri(180,240));add('downstock',5,'ft',u+60,u+60+ri(240,330));if(r()<.6)add('downstock',6,'pt',u+90,u+90+ri(150,220));
    out.push({id:'s'+(++n),ref:'SAMPLE '+(600+n),date:ymd(t0.getTime()-d*DAY),units:ri(1500,2700),pallets:ri(16,28),oms:ri(150,400),mvu:ri(100,300),labor:L,createdAt:n})}}
  return out;
})();

/* ---------- wiring ---------- */
/* ---------- plan ---------- */
function renderPlanInputs(){updatePlan()}
function updatePlan(){
  const v=id=>Math.max(0,Number($(id).value)||0),units=v('#pUnits'),uph=v('#pUph'),ft=Math.round(v('#pFt')),fth=v('#pFtH'),pt=Math.round(v('#pPt')),pth=v('#pPtH');
  const lunch=fth>LUNCH.ftOver/60?LUNCH.ft/60:0,ftNet=Math.max(0,fth-lunch),sched=ft*fth+pt*pth,truckH=ft*ftNet+pt*pth;
  const vb=$('#planVerdict'),out=(c,t,a)=>{$('#planCalc').innerHTML=c;$('#planTable').innerHTML=t;$('#planAnalysis').innerHTML=a};
  if(!(units>0)||!(uph>0)||!(truckH>0)){vb.hidden=true;out('Enter the manifest units, the UPH plan, and at least one full-time or part-time group with hours.','','');return}
  const cap=truckH*uph,need=units/uph,gap=truckH-need,pace=units/truckH,ok=gap>=-0.005;
  vb.hidden=false;vb.className='banner '+(ok?'ok':'bad');
  vb.textContent=ok?`Yes. At ${uphFmt(uph)} UPH this crew covers ${num(cap)} of ${num(units)} units, with ${hrs1(gap)} labor hrs to spare.`
    :`No. At ${uphFmt(uph)} UPH this crew covers ${num(cap)} of ${num(units)} units, about ${num(units-cap)} short. It needs ${hrs1(-gap)} more labor hrs.`;
  out(`${ft} full-time × ${fth} hrs + ${pt} part-time × ${pth} hrs = ${hrs1(sched)} scheduled hrs`+(ft&&lunch?`<br>− ${hrs1(ft*lunch)} hrs unpaid lunches (${ft} × 40 min)`:'')+`<br>= <b>${hrs1(truckH)} labor hrs on the truck</b><br>${hrs1(truckH)} hrs × ${uphFmt(uph)} UPH = <b>${num(cap)} units</b>`,
    `<table><thead><tr><th></th><th class="n">Each person</th><th class="n">Hours on truck</th><th class="n">Units at ${uphFmt(uph)} UPH</th></tr></thead><tbody>
      ${ft?`<tr><td>Full-time</td><td class="n">${ft} ×</td><td class="n">${hrs1(ftNet)}</td><td class="n">${num(ftNet*uph)} each</td></tr>`:''}
      ${pt?`<tr><td>Part-time</td><td class="n">${pt} ×</td><td class="n">${hrs1(pth)}</td><td class="n">${num(pth*uph)} each</td></tr>`:''}
      <tr><td><b>Crew total</b></td><td class="n">${ft+pt}</td><td class="n"><b>${hrs1(truckH)}</b></td><td class="n"><b>${num(cap)}</b></td></tr>
      <tr><td>Manifest</td><td></td><td class="n">${hrs1(need)} needed</td><td class="n">${num(units)}</td></tr></tbody></table>`,
    planAnalysis({units,uph,ft,fth,ftNet,pt,pth,truckH,need,gap,pace,ok}));
}
function planAnalysis(p){
  const pts=[],short=-p.gap;
  pts.push(`<li><b>Pace needed:</b> ${num(p.units)} units ÷ ${hrs1(p.truckH)} labor hrs = <b>${uphFmt(p.pace)} UPH</b>. ${p.pace<=p.uph?`That's at or under the ${uphFmt(p.uph)} plan, so the crew has room.`:`That's ${uphFmt(p.pace-p.uph)} UPH faster than the ${uphFmt(p.uph)} plan.`}</li>`);
  if(p.ok){
    const spare=p.gap*p.uph;
    pts.push(`<li><b>Spare capacity:</b> about ${num(spare)} more units, or ${hrs1(p.gap)} labor hrs, if the crew holds ${uphFmt(p.uph)} UPH.</li>`);
    if(p.pth>0&&p.gap>=p.pth)pts.push(`<li><b>Room to trim:</b> the truck could still finish with about ${Math.floor(p.gap/p.pth)} fewer part-time (${p.pth} hrs each) at ${uphFmt(p.uph)} UPH. Only trim if the crew really runs at that pace.</li>`);
    else if(p.ftNet>0&&p.gap>=p.ftNet)pts.push(`<li><b>Room to trim:</b> the truck could still finish with about ${Math.floor(p.gap/p.ftNet)} fewer full-time at ${uphFmt(p.uph)} UPH. Only trim if the crew really runs at that pace.</li>`);
    pts.push(`<li><b>Risk:</b> if the crew runs slower than ${uphFmt(p.uph)} UPH, this plan only works down to ${uphFmt(p.pace)} UPH. Below that, units are left over.</li>`);
  }else{
    const opts=[];
    if(p.pth>0){const n=Math.ceil(short/p.pth-1e-9);opts.push(`add <b>${n} part-time</b> at ${p.pth} hrs (${hrs1(n*p.pth)} hrs)`)}
    if(p.ftNet>0){const n=Math.ceil(short/p.ftNet-1e-9);opts.push(`add <b>${n} full-time</b> at ${p.fth} hrs (${hrs1(n*p.ftNet)} hrs after lunch)`)}
    const heads=p.ft+p.pt;if(heads>0)opts.push(`keep everyone about <b>${Math.ceil(short/heads*60)} min longer</b>`);
    opts.push(`raise the pace to <b>${uphFmt(p.pace)} UPH</b>`);
    pts.push(`<li><b>To finish the truck,</b> any one of: ${opts.join('; ')}.</li>`);
    pts.push(`<li><b>Without changes,</b> about ${num(p.units-p.truckH*p.uph)} units would be left at the end of the shift.</li>`);
  }
  if(p.ft&&p.fth>5&&p.fth<=5.67)pts.push(`<li><b>Lunch:</b> full-time shifts of ${p.fth} hrs trigger the 40 min unpaid lunch. A shift of 5 hrs or less has no lunch.</li>`);
  return `<h3 style="margin-top:4px">Analysis</h3><ul style="margin:6px 0 0;padding-left:18px;display:flex;flex-direction:column;gap:6px;font-size:14px">${pts.join('')}</ul>`;
}
['pUnits','pUph','pFt','pFtH','pPt','pPtH'].forEach(i=>$('#'+i).addEventListener('input',updatePlan));
$('#planForm').addEventListener('submit',e=>e.preventDefault());

function renderAll(){renderBanner();renderDashboard();renderGoals();updateResult();renderPlanInputs()}
resetForm();route();renderAll();

(async()=>{
  const slow=setTimeout(()=>{if(dbState==='connecting'){dbState='slow';renderBanner()}},10000);
  const use=window.claude&&window.claude.use?n=>window.claude.use(n):async()=>null;
  [db,userCap]=await Promise.all([use('db'),use('user')]);
  if(userCap){try{canEdit=await userCap.canEdit();myId=await userCap.id()}catch(_){}}
  if(!db){clearTimeout(slow);dbState='nodb';renderAll();return}
  const ok=()=>{clearTimeout(slow);dbState='live'},fail=()=>{clearTimeout(slow);dbState='error';renderBanner()};
  db.collection('manifests').orderBy('date','desc').limit(1000).onSnapshot(s=>{ok();S.manifests=s.docs.map(d=>({id:d.id,...d.data()}));renderAll()},fail);
  db.doc('settings/goals').onSnapshot(s=>{ok();const g=s.exists&&Number(s.data().uph);S.goal=g>0?g:DEFAULT_GOAL;renderAll()},fail);
})();
