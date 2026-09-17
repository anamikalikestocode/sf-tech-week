// Probe Partiful's live API. Tallies guest rows by status; never stores or prints a row.
import fs from "node:fs";
const UA="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36";
async function call(name, body){ const r=await fetch(`https://api.partiful.com/${name}`,{method:"POST",headers:{"content-type":"application/json",origin:"https://partiful.com",referer:"https://partiful.com/","user-agent":UA},body:JSON.stringify({data:{...body,userId:null}})}); const t=await r.text(); try{return {status:r.status,json:JSON.parse(t)}}catch{return {status:r.status,text:t.slice(0,200)}} }
async function tally(id){
  const st={}, hist={}, transitions={}, perDay={}; let rows=0, plus=0, cursor=null, pages=0, shape=null;
  for(let i=0;i<40;i++){
    const {status,json,text}=await call("getGuests",{params:{eventId:id,includeInvitedGuests:true},paging:{cursor,maxResults:500}});
    if(!json){ console.log("  err",status,text); break; }
    const res=json.result; const d=res?.data; const arr=Array.isArray(d)?d:(d?.guests??d?.items??[]);
    if(i===0) shape={resultKeys:Object.keys(res||{}), dataType:Array.isArray(d)?"array":typeof d, dataKeys:Array.isArray(d)?null:Object.keys(d||{}), rowKeys:Object.keys(arr[0]||{})};
    for(const x of arr){ rows++; st[x.status]=(st[x.status]||0)+1; plus+=x.plusOneCount||0; const day=(x.rsvpDate||"").slice(0,10); if(day) perDay[day]=(perDay[day]||0)+1; const h=x.rsvpHistory||[]; const seen=new Set(); for(const s of h){ if(!seen.has(s.status)){seen.add(s.status); hist[s.status]=(hist[s.status]||0)+1;} } if(h.length>1){ const k=h.map(s=>s.status).join(">"); transitions[k]=(transitions[k]||0)+1; } }
    pages++;
    const nc=res?.nextCursor??d?.nextCursor??res?.paging?.cursor??null;
    if(!nc||arr.length===0) break; cursor=nc;
  }
  return {rows,pages,st,hist,transitions,plus,perDay,shape};
}
const events=JSON.parse(fs.readFileSync("data/sf-events.json","utf8")).events;
const find=(re)=>events.find(e=>re.test(e.name));
const targets=[["HIDDEN ur +1",find(/^ur \+1 is a stranger/)],["Camp AI (350 appr)",find(/^Camp AI: Production/)],["Hack Alcatraz",find(/^Hack Alcatraz/)],["Techonomy26 (hidden)",find(/^Techonomy26/)],["Vibe Coding Demo Night",find(/^Vibe Coding Demo Night/)]];
for(const [label,e] of targets){ if(!e){console.log(label,"not found");continue;} const id=(e.url.match(/\/e\/([^/?]+)/)||[])[1]; const p=e.partiful||{}; console.log(`\n== ${label} | reported: appr ${p.approvedCount} going ${p.goingCount} int ${p.interestedCount} wl ${p.waitlistCount} cap ${p.maxCapacity} hidden ${p.countsHidden}`); const t=await tally(id); console.log("  rows:",t.rows,"pages:",t.pages,"| by status:",JSON.stringify(t.st)); console.log("  ever-had status:",JSON.stringify(t.hist)); console.log("  transitions:",JSON.stringify(Object.entries(t.transitions).sort((a,b)=>b[1]-a[1]).slice(0,6))); console.log("  plusOnes:",t.plus,"| rsvps per day (last 5):",JSON.stringify(Object.entries(t.perDay).sort().slice(-5))); if(label.startsWith("HIDDEN")) console.log("  shape:",JSON.stringify(t.shape)); }
