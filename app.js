/* Actions YAML Builder
   Schema-driven checkbox tree -> GitHub Actions workflow YAML. */
(function(){
'use strict';

/* ---------- schema helpers ---------- */
const S=(key,desc,o={})=>({key,type:'str',desc,...o});
const T=(key,desc,o={})=>({key,type:'text',desc,...o});
const N=(key,desc,o={})=>({key,type:'num',desc,...o});
const B=(key,desc,o={})=>({key,type:'bool',desc,...o});
const E=(key,desc,options,o={})=>({key,type:'enum',desc,options,...o});
const M=(key,desc,options,o={})=>({key,type:'multi',desc,options,...o});
const L=(key,desc,o={})=>({key,type:'list',desc,...o});
const KV=(key,desc,o={})=>({key,type:'kv',desc,...o});
const KVL=(key,desc,o={})=>({key,type:'kvl',desc,...o});
const O=(key,desc,children,o={})=>({key,type:'obj',desc,children,...o});
const MAP=(key,desc,item,o={})=>({key,type:'map',desc,item,...o});
const ARR=(key,desc,item,o={})=>({key,type:'arr',desc,item,...o});

const lines=v=>String(v||'').split('\n').map(x=>x.trim()).filter(Boolean);
const filled=s=>s&&s.on&&String(s.v==null?'':s.v).trim()!=='';

const filterCheck=(st,get)=>{
  const bad=[['branches','branches-ignore'],['tags','tags-ignore'],['paths','paths-ignore']]
    .filter(([a,b])=>get(a).on&&get(b).on).map(([a,b])=>`${a} and ${b}`);
  return bad.length?`can't use ${bad.join(', or ')} together`:null;
};
const filters=(tags)=>[
  L('branches','Run only for these branches. Wildcards work, e.g. release/**. Don\'t use together with branches-ignore.',{ph:'main'}),
  L('branches-ignore','Run for every branch except these.',{ph:'dependabot/**'}),
  ...(tags?[L('tags','Run only when these tags are pushed, e.g. v*. Don\'t use together with tags-ignore.',{ph:'v*'}),L('tags-ignore','Run for every tag except these.')]:[]),
  L('paths','Run only if files in these paths changed, e.g. src/**. Don\'t use together with paths-ignore.',{ph:'src/**'}),
  L('paths-ignore','Skip the run if only these files changed, e.g. docs/**.',{ph:'docs/**'})
];
const PR_TYPES=['opened','synchronize','reopened','closed','edited','ready_for_review','converted_to_draft','labeled','unlabeled','assigned','unassigned','review_requested','review_request_removed','locked','unlocked','auto_merge_enabled','auto_merge_disabled','milestoned','demilestoned','enqueued','dequeued'];
const ISSUE_TYPES=['opened','edited','deleted','closed','reopened','assigned','unassigned','labeled','unlabeled','pinned','unpinned','locked','unlocked','transferred','milestoned','demilestoned','typed','untyped'];
const SCOPES=[['actions','Workflow runs and artifacts.'],['attestations','Artifact attestations.'],['checks','Check runs and suites.'],['contents','Repo files, commits, releases. Needed to push code.'],['deployments','Deployments.'],['discussions','Discussions.'],['id-token','OIDC token for logging in to clouds (AWS, GCP, Azure).',['write','none']],['issues','Issues and their comments.'],['models','GitHub Models.',['read','none']],['packages','GitHub Packages (e.g. ghcr.io).'],['pages','GitHub Pages builds.'],['pull-requests','Pull requests.'],['security-events','Code scanning alerts.'],['statuses','Commit statuses.']];
const perms=(where)=>O('permissions',`What the GITHUB_TOKEN may do ${where}. Pick a shortcut, or set each scope. Ticked with no scopes inside means no access at all.`,
  SCOPES.map(([k,d,opt])=>E(k,d,opt||['read','write','none'])),{emptyAs:'{}',shortcut:['read-all','write-all']});
const SHELLS=['bash','pwsh','python','sh','cmd','powershell'];
const defaults=(where)=>O('defaults',`Default settings for run steps ${where}.`,[O('run','Defaults for every run step.',[E('shell','Which shell runs your commands.',SHELLS,{free:true}),S('working-directory','Folder to run commands in, e.g. ./app.')])]);
const concurrency=()=>O('concurrency','Stop runs from piling up. Runs with the same group name wait for each other, or the old one is cancelled.',[
  S('group','Group name. Common choice: workflow name + branch.',{required:true,ph:'${{ github.workflow }}-${{ github.ref }}'}),
  B('cancel-in-progress','Cancel the older run when a newer one starts.')]);

const RUNNERS=['ubuntu-latest','ubuntu-24.04','ubuntu-22.04','ubuntu-24.04-arm','windows-latest','windows-2025','macos-latest','macos-15','self-hosted'];
const ACTIONS=['actions/checkout@v7','actions/setup-node@v7','actions/setup-python@v7','actions/setup-java@v6','actions/setup-go@v7','actions/cache@v6','actions/upload-artifact@v7','actions/download-artifact@v8','actions/github-script@v9','docker/build-push-action@v7'];

const STEP=[
  S('id','A short name so later steps can read this step\'s outputs, e.g. steps.build.outputs.x. Must be unique in the job.',{ph:'build'}),
  S('if','Only run this step when this is true.',{ph:"github.event_name == 'push'"}),
  S('name','Label shown in the run log.',{ph:'Install dependencies'}),
  S('uses','A ready-made action to run: owner/repo@version, a local ./path, or docker://image.',{suggest:ACTIONS,ph:'actions/checkout@v7'}),
  T('run','Shell commands to run. Several lines are fine; each line runs in order.',{ph:'npm ci\nnpm test'}),
  S('working-directory','Folder to run the commands in.',{ph:'./app'}),
  E('shell','Which shell runs the commands.',SHELLS,{free:true}),
  KV('with','Inputs for the action in uses. Check the action\'s README for names.'),
  KV('env','Environment variables for this step only.'),
  B('continue-on-error','Keep going even if this step fails.'),
  N('timeout-minutes','Stop this step after this many minutes.')
];
const stepCheck=(st,get)=>{
  const u=get('uses'),r=get('run');
  if(!u.on&&!r.on) return 'needs either uses or run';
  if(u.on&&r.on) return 'can\'t have both uses and run';
  return null;
};
const stepsCheck=(st)=>{
  const ids=st.v.map(s=>s.f&&filled(s.f.id)?s.f.id.v.trim():'').filter(Boolean);
  const dup=[...new Set(ids.filter((x,i)=>ids.indexOf(x)!==i))];
  return dup.length?`step id ${dup.map(x=>'“'+x+'”').join(', ')} is used more than once`:null;
};
let JOB_IDS=[];
const jobCheck=(st,get,item)=>{
  const ro=get('runs-on'),u=get('uses'),s=get('steps'),n=get('needs');
  const out=[];
  if(!ro.on&&!u.on) out.push('needs runs-on (or uses, to call a reusable workflow)');
  if(u.on&&ro.on) out.push('can\'t have both uses and runs-on');
  if(u.on&&s.on) out.push('can\'t have both uses and steps');
  if(n.on){
    const me=item?item.id.trim():'';
    lines(n.v).forEach(x=>{
      if(x===me) out.push('can\'t need itself');
      else if(!JOB_IDS.includes(x)) out.push(`needs “${x}”, but there is no job with that id`);
    });
  }
  return out.length?out.join('; '):null;
};
const JOB=[
  S('name','Name shown in the GitHub UI.',{ph:'Test'}),
  perms('for this job'),
  L('needs','Jobs that must finish first. This job waits for them. Use their job ids.',{ph:'build'}),
  S('if','Only run this job when this is true.',{ph:"github.ref == 'refs/heads/main'"}),
  S('runs-on','Which machine runs the job. Leave off when the job calls a reusable workflow with uses.',{preset:true,suggest:RUNNERS,ph:'ubuntu-latest'}),
  O('environment','Deployment environment. Turns on its protection rules and secrets.',[
    S('name','Environment name.',{required:true,ph:'production'}),
    S('url','Link shown on the deployment, e.g. your live site.',{ph:'https://example.com'})],{inline:'name'}),
  concurrency(),
  KV('outputs','Values other jobs can read with needs.<job>.outputs.<name>.'),
  KV('env','Environment variables for every step in this job.'),
  defaults('in this job'),
  ARR('steps','The commands and actions this job runs, top to bottom.',{noun:'step',startOne:true,children:STEP,check:stepCheck},{preset:true,check:stepsCheck}),
  N('timeout-minutes','Stop the job after this many minutes. Default is 360.'),
  O('strategy','Run this job many times with different settings (a matrix).',[
    O('matrix','The settings to combine. Every combination of the variables becomes its own job.',[
      KV('variables','Each row is a variable and its values, split by commas. Example: node → 20, 22. Put quotes around a value to keep it as text, e.g. \'3.10\'. Read it with ${{ matrix.node }}.',{inline:true,matrix:true,preset:true}),
      KVL('include','Extra combinations to add, or extra values for a matching combination.'),
      KVL('exclude','Combinations to skip.')
    ],{required:true,check:(st,get)=>{
      const v=get('variables'),inc=get('include');
      const hasV=v.on&&v.v.some(r=>r.k.trim()), hasI=inc.on&&inc.v.length;
      return hasV||hasI?null:'needs variables or include';
    }}),
    B('fail-fast','Cancel the other matrix jobs when one fails. Default true.'),
    N('max-parallel','How many matrix jobs may run at the same time.')]),
  B('continue-on-error','Let the workflow pass even if this job fails.'),
  O('container','Run the steps inside a Docker container.',[
    S('image','Docker image to use.',{required:true,ph:'node:22'}),
    O('credentials','Login for a private registry.',[S('username','Registry username.'),S('password','Registry password. Use a secret: ${{ secrets.X }}.')]),
    KV('env','Environment variables inside the container.'),
    L('ports','Ports to open, one per line.',{ph:'8080'}),
    L('volumes','Volumes to mount, one per line.',{ph:'my_docker_volume:/volume_mount'}),
    S('options','Extra docker create options.',{ph:'--cpus 1'})]),
  MAP('services','Extra containers that run beside the job, like a database.',{noun:'service',idPh:'postgres',children:[
    S('image','Docker image to use.',{required:true,ph:'postgres:16'}),
    L('ports','Ports to open, one per line.',{ph:'5432:5432'}),
    KV('env','Environment variables for the service.'),
    S('options','Extra docker create options, e.g. health checks.',{ph:'--health-cmd pg_isready'})]}),
  S('uses','Call a reusable workflow instead of writing steps. Remove runs-on and steps if you use this.',{ph:'./.github/workflows/build.yml'}),
  KV('with','Inputs for the reusable workflow in uses.'),
  S('secrets','Secrets for the reusable workflow. Type inherit to pass all of them.',{ph:'inherit'})
];
const EVENTS=[
  O('push','Runs when someone pushes commits or tags.',filters(true),{check:filterCheck}),
  O('pull_request','Runs when a pull request is opened or updated.',[M('types','Which pull request activities count. If not set: opened, synchronize, reopened.',PR_TYPES),...filters(false)],{check:filterCheck}),
  O('pull_request_target','Like pull_request, but runs with your repo\'s secrets and write access. Be careful with code from forks.',[M('types','Which pull request activities count.',PR_TYPES),...filters(false)],{check:filterCheck}),
  O('pull_request_review','Runs when a pull request review happens.',[M('types','Which review activities count.',['submitted','edited','dismissed'])]),
  O('workflow_dispatch','Adds a "Run workflow" button in the Actions tab.',[
    MAP('inputs','Fields the person fills in before running.',{noun:'input',idPh:'environment',children:[
      S('description','Text shown next to the field.'),
      B('required','Must the person fill it in?'),
      S('default','Value used if left empty.'),
      E('type','Kind of field.',['string','boolean','choice','number','environment']),
      L('options','The choices, one per line. Only for type: choice.')],
      check:(st,get)=>get('type').on&&get('type').v==='choice'&&!(get('options').on&&lines(get('options').v).length)?'is type choice but has no options':null})]),
  O('workflow_call','Lets other workflows call this one (makes it a reusable workflow).',[
    MAP('inputs','Values the caller passes in.',{noun:'input',idPh:'node-version',children:[
      S('description','What this input is for.'),
      B('required','Must the caller pass it?'),
      E('type','Kind of value.',['string','boolean','number'],{required:true}),
      S('default','Value used if not passed.')]}),
    MAP('outputs','Values this workflow gives back to the caller.',{noun:'output',idPh:'version',children:[
      S('description','What this output is.'),
      S('value','Where the value comes from.',{required:true,ph:'${{ jobs.build.outputs.version }}'})]}),
    MAP('secrets','Secrets the caller can pass in.',{noun:'secret',idPh:'NPM_TOKEN',children:[
      S('description','What this secret is for.'),
      B('required','Must the caller pass it?')]})]),
  L('schedule','Runs on a timer. One cron line per row. Cron times are in UTC; the box shows them in your time zone too.',{cron:true,ph:'0 3 * * 1'}),
  O('workflow_run','Runs after another workflow in this repo runs.',[
    L('workflows','Names of the workflows to watch (their name: field).',{required:true,ph:'CI'}),
    M('types','Which activities count.',['completed','requested','in_progress']),
    L('branches','Only when the other workflow ran on these branches.'),
    L('branches-ignore','Skip when the other workflow ran on these branches.')],{check:filterCheck}),
  O('repository_dispatch','Runs when you send a custom event through the GitHub API.',[L('types','Your custom event names, one per line.',{flow:true,ph:'deploy'})]),
  O('release','Runs on release activity.',[M('types','Which release activities count.',['published','unpublished','created','edited','deleted','prereleased','released'])]),
  O('issues','Runs on issue activity.',[M('types','Which issue activities count.',ISSUE_TYPES)]),
  O('issue_comment','Runs when someone comments on an issue or pull request.',[M('types','Which comment activities count.',['created','edited','deleted'])]),
  O('merge_group','Runs when a pull request is added to a merge queue.',[M('types','Which activities count.',['checks_requested'])]),
  O('create','Runs when a branch or tag is created.',[]),
  O('delete','Runs when a branch or tag is deleted.',[])
];
const ROOT=O('','',[
  S('name','Workflow name shown in the Actions tab.',{ph:'CI'}),
  S('run-name','Name for each run. Can use expressions.',{ph:'Deploy by @${{ github.actor }}'}),
  O('on','What starts this workflow. Tick at least one event inside.',EVENTS,{required:true,check:(st,get)=>EVENTS.some(e=>get(e.key).on)?null:'pick at least one event'}),
  perms('for every job'),
  KV('env','Environment variables for all jobs and steps.'),
  defaults('for every job'),
  concurrency(),
  MAP('jobs','The work to do. Jobs run at the same time unless you link them with needs.',{noun:'job',idPh:'build',idRule:true,children:JOB,check:jobCheck},{required:true})
]);

/* ---------- state ---------- */
function mk(n){
  const s={on:!!(n.required||n.preset)};
  switch(n.type){
    case 'obj': s.f={}; break;
    case 'kv': s.v=[{k:'',v:''}]; break;
    case 'kvl': s.v=[[{k:'',v:''}]]; break;
    case 'map': s.v=[]; break;
    case 'arr': s.v=n.item&&n.item.startOne?[{on:true,f:{}}]:[]; break;
    case 'multi': s.v=[]; break;
    case 'bool': s.v=true; break;
    default: s.v='';
  }
  return s;
}
const ch=(st,n)=>{st.f=st.f||{};let s=st.f[n.key];
  if(!s||typeof s!=='object'){s=st.f[n.key]=mk(n);}
  // repair state saved by an older version of the page
  if(n.type==='obj'&&!s.f) s.f={};
  if(['kv','kvl','map','arr','multi'].includes(n.type)&&!Array.isArray(s.v)) s.v=mk(n).v;
  if(n.required) s.on=true;
  return s;};
const getter=(st,children)=>k=>{const c=children.find(x=>x.key===k);return c?ch(st,c):{on:false,v:''};};

function example(){
  const s={on:true,f:{},file:'ci.yml'};
  const F=(st,children,key)=>{const n=children.find(x=>x.key===key);const c=ch(st,n);return {s:c,n};};
  const set=(st,children,key,v)=>{const x=F(st,children,key);x.s.on=true;if(v!==undefined)x.s.v=v;return x;};
  set(s,ROOT.children,'name','CI');
  const on=F(s,ROOT.children,'on');
  const push=set(on.s,EVENTS,'push'); set(push.s,push.n.children,'branches','main');
  const pr=set(on.s,EVENTS,'pull_request'); set(pr.s,pr.n.children,'branches','main');
  set(on.s,EVENTS,'workflow_dispatch');
  const jobs=F(s,ROOT.children,'jobs');
  const job={id:'test',st:{on:true,f:{}}};
  jobs.s.v=[job];
  set(job.st,JOB,'name','Test');
  set(job.st,JOB,'runs-on','ubuntu-latest');
  const stg=set(job.st,JOB,'strategy');
  const mx=F(stg.s,stg.n.children,'matrix');
  set(mx.s,mx.n.children,'variables',[{k:'node',v:'20, 22'}]);
  const step=o=>{const st={on:true,f:{}};for(const k in o)set(st,STEP,k,o[k]);return st;};
  F(job.st,JOB,'steps').s.v=[
    step({uses:'actions/checkout@v7'}),
    step({name:'Set up Node',uses:'actions/setup-node@v7',with:[{k:'node-version',v:'${{ matrix.node }}'},{k:'cache',v:'npm'}]}),
    step({name:'Install',run:'npm ci'}),
    step({name:'Run tests',run:'npm test'})
  ];
  return s;
}
function blank(){const s=mk(ROOT);s.on=true;s.file='ci.yml';return s;}

const KEY='gha-builder-v1';
let state;
try{const raw=localStorage.getItem(KEY);state=raw?JSON.parse(raw):null;}catch(e){state=null;}
if(!state||typeof state!=='object'||!state.f) state=example();
state.on=true; if(!state.file) state.file='ci.yml';
let saveT;
function save(){clearTimeout(saveT);saveT=setTimeout(()=>{try{localStorage.setItem(KEY,JSON.stringify(state));}catch(e){}},300);}

/* ---------- DOM helpers ---------- */
const $=id=>document.getElementById(id);
function el(tag,cls,txt){const e=document.createElement(tag);if(cls)e.className=cls;if(txt!=null)e.textContent=txt;return e;}
const fid=ids=>'f-'+ids.join('_').replace(/[^A-Za-z0-9_-]/g,'_');
const crumb=lbl=>lbl.filter(Boolean).join(' › ');
const TAGS={str:'text',text:'script',num:'number',bool:'yes / no',enum:'choice',multi:'pick',list:'list',kv:'key: value',kvl:'list of combos',obj:'group',map:'named items',arr:'items'};
const isEmpty=(n,st)=>{
  if(['str','text','num','enum'].includes(n.type)) return String(st.v).trim()==='';
  if(n.type==='list') return !lines(st.v).length;
  if(n.type==='multi') return !st.v.length;
  if(n.type==='kv') return !st.v.some(r=>r.k.trim());
  if(n.type==='kvl'||n.type==='map'||n.type==='arr') return !st.v.length;
  return false;
};
function btn(cls,txt,label,fn){const b=el('button',cls,txt);b.type='button';if(label)b.setAttribute('aria-label',label);b.addEventListener('click',fn);return b;}

/* ---------- cron preview ---------- */
const tz=(()=>{try{return Intl.DateTimeFormat().resolvedOptions().timeZone||'';}catch(e){return '';}})();
const pad2=n=>String(n).padStart(2,'0');
function cronLocal(line){
  const p=line.trim().split(/\s+/);
  if(p.length!==5) return `${line} → needs 5 parts: minute hour day month weekday`;
  const [mi,hr]=p;
  if(!/^\d+$/.test(mi)||!/^\d+$/.test(hr)) return `${line} → runs on a repeating pattern (UTC)`;
  const m=+mi,h=+hr;
  if(m>59||h>23) return `${line} → minute must be 0–59 and hour 0–23`;
  const now=new Date();
  const d=new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),now.getUTCDate(),h,m));
  const local=`${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  const dayDiff=Math.round((Date.UTC(d.getFullYear(),d.getMonth(),d.getDate())-Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),d.getUTCDate()))/864e5);
  const shift=dayDiff>0?' (next day)':dayDiff<0?' (day before)':'';
  return `${line} → ${pad2(h)}:${pad2(m)} UTC = ${local} your time${tz?' ('+tz+')':''}${shift}`;
}

/* ---------- render ---------- */
function renderLayer(children,st,lbl,ids,caption){
  const box=el('div','layer');
  if(caption){const c=el('div','cap');c.append('Fields inside ');c.append(el('b',null,caption));box.append(c);}
  children.forEach(c=>box.append(renderRow(c,ch(st,c),[...lbl,c.key],[...ids,c.key])));
  return box;
}
function renderRow(n,st,lbl,ids){
  const row=el('div','row'+(st.on?' on':''));
  row.id='row-'+fid(ids);
  const head=el('label','head');
  const cb=el('input');cb.type='checkbox';cb.checked=st.on;cb.disabled=!!n.required;cb.id='cb-'+fid(ids);
  cb.addEventListener('change',()=>{st.on=cb.checked;render(cb.id,cb.id);});
  const k=el('div','k');k.append(el('code',null,n.key));
  if(n.required)k.append(el('span','tag req','required'));
  k.append(el('span','tag',TAGS[n.type]));
  if(n.inline===true)k.append(el('span','tag','no key in YAML'));
  head.append(cb,k,el('div','d',n.desc));
  row.append(head);
  if(st.on){const c=renderCtl(n,st,lbl,ids);if(c)row.append(c);}
  return row;
}
function textInput(st,n,ids,key='v'){
  const i=el('input');i.type='text';i.id=fid(ids);i.value=st[key];i.placeholder=n.ph||'';i.spellcheck=false;i.autocomplete='off';
  const opts=n.suggest||(n.free?n.options:null);
  if(opts){const dl=el('datalist');dl.id='dl-'+i.id;opts.forEach(o=>{const op=el('option');op.value=o;dl.append(op);});i.setAttribute('list',dl.id);i._dl=dl;}
  i.classList.toggle('bad',String(st[key]).trim()==='');
  i.addEventListener('input',()=>{st[key]=i.value;i.classList.toggle('bad',i.value.trim()==='');refresh();});
  return i;
}
function kvRows(rows,c,ids,matrix,onEmptyId){
  rows.forEach((r,i)=>{const line=el('div','kv');
    const ki=el('input');ki.type='text';ki.placeholder=matrix?'node':'NAME';ki.value=r.k;ki.spellcheck=false;ki.id=fid([...ids,i,'k']);ki.setAttribute('aria-label','Key');
    // values with line breaks (like a github-script body) get a text box that keeps them
    const multi=String(r.v).includes('\n');
    const vi=el(multi?'textarea':'input');if(!multi)vi.type='text';else vi.rows=Math.min(10,String(r.v).split('\n').length+1);
    vi.placeholder=matrix?'20, 22':'value';vi.value=r.v;vi.spellcheck=false;vi.setAttribute('aria-label','Value');
    ki.addEventListener('input',()=>{r.k=ki.value;refresh();});vi.addEventListener('input',()=>{r.v=vi.value;refresh();});
    line.append(ki,vi,btn('x','×','Remove row',()=>{rows.splice(i,1);render();}));c.append(line);});
  c.append(btn('add','+ Add row',null,()=>{rows.push({k:'',v:''});render(fid([...ids,rows.length-1,'k']));}));
}
function renderCtl(n,st,lbl,ids){
  const c=el('div','ctl');
  switch(n.type){
    case 'str':{const i=textInput(st,n,ids);c.append(i);if(i._dl)c.append(i._dl);break;}
    case 'enum':{
      if(n.free){const i=textInput(st,n,ids);c.append(i,i._dl);break;}
      const s=el('select');s.id=fid(ids);
      const o0=el('option',null,'Choose…');o0.value='';s.append(o0);
      n.options.forEach(o=>{const op=el('option',null,o);op.value=o;s.append(op);});
      s.value=n.options.includes(st.v)?st.v:'';s.classList.toggle('bad',!s.value);
      s.addEventListener('change',()=>{st.v=s.value;s.classList.toggle('bad',!s.value);refresh();});
      c.append(s);break;}
    case 'num':{const i=el('input');i.type='number';i.min='0';i.id=fid(ids);i.value=st.v;i.placeholder=n.ph||'30';
      i.classList.toggle('bad',st.v==='');
      i.addEventListener('input',()=>{st.v=i.value;i.classList.toggle('bad',i.value==='');refresh();});c.append(i);break;}
    case 'text':{const t=el('textarea');t.id=fid(ids);t.value=st.v;t.placeholder=n.ph||'';t.spellcheck=false;t.rows=Math.max(3,String(st.v).split('\n').length+1);
      t.classList.toggle('bad',!String(st.v).trim());
      t.addEventListener('input',()=>{st.v=t.value;t.classList.toggle('bad',!t.value.trim());refresh();});c.append(t);break;}
    case 'list':{const t=el('textarea');t.id=fid(ids);t.value=st.v;t.placeholder=n.ph||'';t.spellcheck=false;t.rows=Math.max(2,lines(st.v).length+1);
      t.classList.toggle('bad',!lines(st.v).length);
      const hint=el('div','hint');
      const upd=()=>{hint.textContent=n.cron&&lines(st.v).length?lines(st.v).map(cronLocal).join('\n'):'One per line.';};
      upd();if(n.cron)hint.classList.add('cron');
      t.addEventListener('input',()=>{st.v=t.value;t.classList.toggle('bad',!lines(t.value).length);upd();refresh();});
      c.append(t,hint);break;}
    case 'bool':{const g=el('div','seg');g.setAttribute('role','group');g.setAttribute('aria-label',n.key);
      [true,false].forEach(v=>{const b=btn(null,String(v),null,()=>{st.v=v;g.querySelectorAll('button').forEach(x=>x.setAttribute('aria-pressed',x===b));refresh();});
        b.setAttribute('aria-pressed',st.v===v);g.append(b);});
      c.append(g);break;}
    case 'multi':{const w=el('div','chips');w.id=fid(ids);w.classList.toggle('bad',!st.v.length);
      n.options.forEach(o=>{const b=btn('chip',o,null,()=>{const i=st.v.indexOf(o);if(i>=0)st.v.splice(i,1);else st.v.push(o);
          st.v.sort((a,b2)=>n.options.indexOf(a)-n.options.indexOf(b2));b.setAttribute('aria-pressed',st.v.includes(o));w.classList.toggle('bad',!st.v.length);refresh();});
        b.setAttribute('aria-pressed',st.v.includes(o));w.append(b);});
      c.append(w);break;}
    case 'kv':{
      if(!st.v.some(r=>r.k.trim()))c.id=fid(ids);
      kvRows(st.v,c,ids,n.matrix);break;}
    case 'kvl':{
      st.v.forEach((rows,i)=>{const card=el('div','item');const h=el('div','item-h');
        h.append(el('span','lbl',`${n.key} ${i+1}`),el('span','sp'),btn('x','×','Remove',()=>{st.v.splice(i,1);render();}));
        card.append(h);const inner=el('div','ctl flat');kvRows(rows,inner,[...ids,i],false);card.append(inner);c.append(card);});
      if(!st.v.length)c.id=fid(ids);
      c.append(btn('add','+ Add combination',null,()=>{st.v.push([{k:'',v:''}]);render(fid([...ids,st.v.length-1,0,'k']));}));
      break;}
    case 'obj':{
      if(n.shortcut){
        const g=el('div','seg');g.setAttribute('role','group');g.setAttribute('aria-label',n.key+' mode');
        [['','Per scope'],...n.shortcut.map(x=>[x,x])].forEach(([v,t])=>{const b=btn(null,t,null,()=>{st.mode=v;render();});b.setAttribute('aria-pressed',(st.mode||'')===v);g.append(b);});
        c.append(g);
        if(st.mode){c.append(el('div','hint',st.mode==='read-all'?'Read access to every scope.':'Write access to every scope. Only use this if you really need it.'));break;}
      }
      if(!n.children.length){c.append(el('div','hint','Nothing else to set. This event just needs to be listed.'));break;}
      c.append(renderLayer(n.children,st,lbl,ids,crumb(lbl)));
      break;}
    case 'map':{
      const it=n.item;
      st.v.forEach((m,i)=>{
        const card=el('div','item');const h=el('div','item-h');
        h.append(el('span','lbl',it.noun+' id'));
        const idI=el('input');idI.type='text';idI.value=m.id;idI.placeholder=it.idPh||'name';idI.spellcheck=false;idI.id=fid([...ids,i,'id']);
        idI.setAttribute('aria-label',it.noun+' id');idI.classList.toggle('bad',!m.id.trim());
        idI.addEventListener('input',()=>{m.id=idI.value;idI.classList.toggle('bad',!idI.value.trim());refresh();});
        h.append(idI,btn('x','×','Remove '+it.noun,()=>{st.v.splice(i,1);render();}));card.append(h);
        const name=m.id||`${it.noun} ${i+1}`;
        card.append(renderLayer(it.children,m.st,[...lbl,name],[...ids,i],crumb([...lbl,name])));
        c.append(card);});
      if(!st.v.length)c.id=fid(ids);
      c.append(btn('add','+ Add '+it.noun,null,()=>{const nm={id:'',st:{on:true,f:{}}};it.children.forEach(cn=>ch(nm.st,cn));st.v.push(nm);render(fid([...ids,st.v.length-1,'id']));}));
      break;}
    case 'arr':{
      const it=n.item;
      st.v.forEach((s,i)=>{
        const card=el('div','item');const h=el('div','item-h');
        h.append(el('span','lbl',`${it.noun} ${i+1}`),el('span','sp'));
        const mv=el('div','mv');
        const up=btn('x','↑','Move up',()=>{[st.v[i-1],st.v[i]]=[st.v[i],st.v[i-1]];render();});up.disabled=i===0;
        const dn=btn('x','↓','Move down',()=>{[st.v[i+1],st.v[i]]=[st.v[i],st.v[i+1]];render();});dn.disabled=i===st.v.length-1;
        mv.append(up,dn,btn('x','×','Remove '+it.noun,()=>{st.v.splice(i,1);render();}));h.append(mv);card.append(h);
        const lb=[...lbl,`${it.noun} ${i+1}`];
        card.append(renderLayer(it.children,s,lb,[...ids,i],crumb(lb)));
        c.append(card);});
      if(!st.v.length)c.id=fid(ids);
      c.append(btn('add','+ Add '+it.noun,null,()=>{st.v.push({on:true,f:{}});render();}));
      break;}
  }
  return c;
}

/* ---------- validation ---------- */
function walk(n,st,lbl,ids,out){
  if(!st.on) return;
  const where=crumb(lbl);
  if(['str','text','num'].includes(n.type)&&isEmpty(n,st)) out.push({id:fid(ids),msg:`${where} needs a value`});
  if(n.type==='enum'){
    if(isEmpty(n,st)) out.push({id:fid(ids),msg:`${where} needs a value`});
    else if(!n.free&&!n.options.includes(st.v)) out.push({id:fid(ids),msg:`${where}: “${st.v}” isn't allowed here`});
  }
  if(n.type==='list'&&isEmpty(n,st)) out.push({id:fid(ids),msg:`${where} needs at least one line`});
  if(n.type==='list'&&n.cron) lines(st.v).forEach(x=>{if(/needs 5 parts|must be/.test(cronLocal(x)))out.push({id:fid(ids),msg:`${where}: “${x}” isn't a valid cron line`});});
  if(n.type==='multi'&&isEmpty(n,st)) out.push({id:fid(ids),msg:`${where}: pick at least one`});
  if(n.type==='kv'&&isEmpty(n,st)) out.push({id:fid([...ids,0,'k']),msg:`${where} needs at least one row`});
  if(n.type==='kvl'){
    if(!st.v.length) out.push({id:fid(ids),msg:`${where}: add at least one combination`});
    st.v.forEach((rows,i)=>{if(!rows.some(r=>r.k.trim()))out.push({id:fid([...ids,i,0,'k']),msg:`${where} ${i+1} needs at least one row`});});
  }
  if(n.type==='obj'){
    if(!(n.shortcut&&st.mode)) n.children.forEach(c=>walk(c,ch(st,c),[...lbl,c.key],[...ids,c.key],out));
    if(n.check){const m=n.check(st,getter(st,n.children));if(m)out.push({id:'cb-'+fid(ids),msg:`${where}: ${m}`});}
  }
  if(n.type==='map'){
    if(!st.v.length) out.push({id:fid(ids),msg:`${where}: add at least one ${n.item.noun}`});
    const seen={};
    st.v.forEach((m,i)=>{
      const id=m.id.trim(), name=id||`${n.item.noun} ${i+1}`, iid=fid([...ids,i,'id']);
      if(!id) out.push({id:iid,msg:`${where} › ${name} needs an id`});
      else if(n.item.idRule&&!/^[A-Za-z_][A-Za-z0-9_-]*$/.test(id)) out.push({id:iid,msg:`${where} › “${id}”: use letters, numbers, - or _, starting with a letter or _`});
      if(id&&seen[id]) out.push({id:iid,msg:`${where}: “${id}” is used twice`});
      seen[id]=1;
      n.item.children.forEach(c=>walk(c,ch(m.st,c),[...lbl,name,c.key],[...ids,i,c.key],out));
      if(n.item.check){const msg=n.item.check(m.st,getter(m.st,n.item.children),m);if(msg)out.push({id:iid,msg:`${where} › ${name} ${msg}`});}
    });
  }
  if(n.type==='arr'){
    if(!st.v.length) out.push({id:fid(ids),msg:`${where}: add at least one ${n.item.noun}`});
    st.v.forEach((s,i)=>{
      const name=`${n.item.noun} ${i+1}`;
      n.item.children.forEach(c=>walk(c,ch(s,c),[...lbl,name,c.key],[...ids,i,c.key],out));
      if(n.item.check){const msg=n.item.check(s,getter(s,n.item.children));if(msg)out.push({id:'cb-'+fid([...ids,i,'uses']),msg:`${where} › ${name} ${msg}`});}
    });
    if(n.check){const m=n.check(st);if(m)out.push({id:'cb-'+fid(ids),msg:`${where}: ${m}`});}
  }
}

/* ---------- YAML output ---------- */
const NUMRE=/^[-+]?(\d[\d_]*(\.\d*)?|\.\d+)([eE][-+]?\d+)?$/;
function q(s){
  s=String(s);
  if(s==='') return "''";
  if(/[\n\t\r]/.test(s)) return JSON.stringify(s);
  const needs=/^\s|\s$/.test(s)||/:\s|:$|\s#/.test(s)||/^[-?:,\[\]{}#&*!|>'"%@`]/.test(s)||/^(true|false|yes|no|on|off|null|y|n|~)$/i.test(s)||NUMRE.test(s)||/^0[xo]/i.test(s);
  return needs?"'"+s.replace(/'/g,"''")+"'":s;
}
// Plain numbers stay unquoted, but not 0755 (octal in some parsers) or 3.10 (would become 3.1)
const plainNum=s=>/^-?(0|[1-9]\d*)(\.\d*[1-9])?$/.test(s);
// A value typed with quotes, like '3.12', is kept as a string exactly as typed
const QUOTED=/^('(?:[^']|'')*'|"(?:[^"\\]|\\.)*")$/;
const qa=s=>{s=String(s);if(/\n/.test(s))return q(s);s=s.trim();if(QUOTED.test(s))return s;return (plainNum(s)||/^(true|false)$/.test(s))?s:q(s);};
const qf=s=>{s=s.trim();if(QUOTED.test(s))return s;if(plainNum(s)||/^(true|false)$/.test(s))return s;const v=q(s);return /[,\[\]{}]/.test(v)&&v[0]!=="'"&&v[0]!=='"'?"'"+v.replace(/'/g,"''")+"'":v;};
const qk=k=>(/^[A-Za-z0-9_.\-]+$/.test(k)&&!/^(true|false|yes|no|off|null|y|n)$/i.test(k))?k:q(k);
const NEED=' # needs a value';
// Literal block (|) for multi-line values. Keeps a final line break only if the value had one.
function blockLines(key,v,base){
  const body=v.replace(/\n+$/,''),keep=/\n$/.test(v);
  const out=[key+' |'+(/^[ \t]/.test(body)?'2':'')+(keep?'':'-')];
  body.split('\n').forEach(l=>out.push(l.trim()?base+'  '+l:''));
  return out;
}
const flowList=v=>'['+String(v).split(',').map(x=>x.trim()).filter(Boolean).map(qf).join(', ')+']';

function em(n,st,ind,out){
  if(!st.on) return;
  const p=' '.repeat(ind),k=p+n.key+':';
  switch(n.type){
    case 'str':case 'enum': out.push(String(st.v).trim()===''?k+NEED:k+' '+q(String(st.v).trim())); break;
    case 'num': out.push(st.v===''?k+NEED:k+' '+st.v); break;
    case 'bool': out.push(k+' '+st.v); break;
    case 'text':{const v=String(st.v).replace(/\s+$/,'').replace(/^(\s*\n)+/,'');
      if(!v.trim()){out.push(k+NEED);break;}
      if(v.includes('\n')){
        // an explicit indent marker is needed when the first line starts with spaces
        out.push(k+' |'+(/^[ \t]/.test(v)?'2':''));
        v.split('\n').forEach(l=>out.push(l.trim()?p+'  '+l:''));
      } else out.push(k+' '+q(v.trim()));
      break;}
    case 'list':{const it=lines(st.v);
      if(!it.length){out.push(k+' # needs at least one');break;}
      if(n.cron){out.push(k);it.forEach(x=>out.push(p+'  - cron: '+q(x)));}
      else if(n.flow) out.push(k+' ['+it.map(qf).join(', ')+']');
      else {out.push(k);it.forEach(x=>out.push(p+'  - '+q(x)));}
      break;}
    case 'multi': out.push(st.v.length?k+' ['+st.v.join(', ')+']':k+' # pick at least one'); break;
    case 'kv':{const rows=st.v.filter(r=>r.k.trim());
      const base=n.inline?p:p+'  ';
      if(!rows.length){if(!n.inline)out.push(k+' {}');break;}
      if(!n.inline)out.push(k);
      rows.forEach(r=>{
        const key=base+qk(r.k.trim())+':',v=String(r.v);
        if(!n.matrix&&v.replace(/\n+$/,'').includes('\n')){out.push(...blockLines(key,v,base));return;}
        out.push(key+' '+(n.matrix?flowList(v):(v.trim()===''?"''":qa(v))));});
      break;}
    case 'kvl':{
      const entries=st.v.map(rows=>rows.filter(r=>r.k.trim())).filter(r=>r.length);
      if(!entries.length){out.push(k+' [] # add at least one');break;}
      out.push(k);
      entries.forEach(rows=>rows.forEach((r,i)=>out.push(p+(i?'    ':'  - ')+qk(r.k.trim())+': '+(String(r.v).trim()===''?"''":qa(r.v)))));
      break;}
    case 'obj':{
      if(n.shortcut&&st.mode){out.push(k+' '+st.mode);break;}
      if(n.inline){
        const onKeys=n.children.filter(c=>ch(st,c).on).map(c=>c.key);
        if(onKeys.length===1&&onKeys[0]===n.inline){
          const v=String(ch(st,n.children.find(c=>c.key===n.inline)).v).trim();
          out.push(v?k+' '+q(v):k+NEED);break;
        }
      }
      const sub=[];n.children.forEach(c=>em(c,ch(st,c),ind+2,sub));
      out.push(sub.length?k:k+(n.emptyAs?' '+n.emptyAs:''));out.push(...sub);break;}
    case 'map':{
      if(!st.v.length){out.push(k+' {} # add at least one');break;}
      out.push(k);
      st.v.forEach((m,i)=>{const sub=[];n.item.children.forEach(c=>em(c,ch(m.st,c),ind+4,sub));
        if(i>0&&n.key==='jobs')out.push('');
        out.push(p+'  '+(m.id.trim()?qk(m.id.trim()):"''")+':'+(sub.length?'':' {}'));out.push(...sub);});
      break;}
    case 'arr':{
      if(!st.v.length){out.push(k+' [] # add at least one');break;}
      out.push(k);
      st.v.forEach(s=>{const sub=[];n.item.children.forEach(c=>em(c,ch(s,c),ind+4,sub));
        if(!sub.length){out.push(p+'  - {}');return;}
        sub[0]=p+'  - '+sub[0].slice(ind+4);out.push(...sub);});
      break;}
  }
}
function buildYaml(st){
  st=st||state;
  const out=[];
  ROOT.children.forEach(c=>{const s=ch(st,c);if(!s.on)return;
    if(out.length&&['on','jobs','permissions','env','defaults','concurrency'].includes(c.key))out.push('');
    em(c,s,0,out);});
  return out.join('\n')+'\n';
}
const esc=s=>s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
function colorVal(v){
  if(!v) return '';
  let cm='';const ci=v.search(/ # (needs|pick|add)/);
  if(ci>=0){cm=`<span class="hc">${esc(v.slice(ci))}</span>`;v=v.slice(0,ci);}
  const t=v.trim();let h;
  if(/^\|2?-?$/.test(t)||t==='{}'||t==='[]') h=`<span class="hd">${esc(v)}</span>`;
  else if(/^(true|false)$/.test(t)||/^-?\d+(\.\d+)?$/.test(t)) h=`<span class="hn">${esc(v)}</span>`;
  else h=`<span class="hs">${esc(v)}</span>`;
  return h+cm;
}
function highlight(src){
  let block=-1;
  return src.split('\n').map(line=>{
    const ind=line.match(/^ */)[0].length;
    if(block>=0){if(line.trim()===''||ind>block)return `<span class="hs">${esc(line)}</span>`;block=-1;}
    const m=line.match(/^(\s*)(- )?([^\s'"][^:]*?|'(?:[^']|'')*'):( |$)(.*)$/);
    if(m){
      if(/^\|2?-?$/.test(m[5].trim()))block=m[1].length+(m[2]?2:0);
      return esc(m[1])+(m[2]?'<span class="hd">- </span>':'')+`<span class="hk">${esc(m[3])}</span><span class="hd">:</span>`+m[4]+colorVal(m[5]);
    }
    const li=line.match(/^(\s*)- (.*)$/);
    if(li) return esc(li[1])+'<span class="hd">- </span>'+colorVal(li[2]);
    return esc(line);
  }).join('\n');
}

/* ---------- import ---------- */
const asArr=v=>v==null?[]:Array.isArray(v)?v:[v];
// strings that would read back as numbers or booleans keep their quotes
const scal=v=>v==null?'':typeof v==='object'?JSON.stringify(v):(typeof v==='string'&&!v.includes('\n')&&(NUMRE.test(v.trim())||/^(true|false|yes|no|on|off|null|y|n|~)$/i.test(v.trim())||/^0[xo]/i.test(v.trim()))?"'"+v.replace(/'/g,"''")+"'":String(v));
function imp(n,val,W,lbl){
  const s=mk(n);s.on=true;
  const where=crumb(lbl);
  const isObj=v=>v&&typeof v==='object'&&!Array.isArray(v);
  switch(n.type){
    case 'str':case 'enum':case 'num':case 'text':
      if(isObj(val)||Array.isArray(val)){W.push(`${where}: this form isn't supported yet, skipped`);s.on=false;break;}
      s.v=val==null?'':String(val);
      if(n.type==='enum'&&!n.free&&s.v&&!n.options.includes(s.v))W.push(`${where}: “${s.v}” isn't a known choice`);
      break;
    case 'bool': s.v=val===true||val==='true'; break;
    case 'list':
      s.v=n.cron?asArr(val).map(x=>x&&x.cron?String(x.cron):'').filter(Boolean).join('\n'):asArr(val).map(scal).join('\n');
      break;
    case 'multi':{const a=asArr(val).map(String);s.v=a.filter(x=>n.options.includes(x));
      const bad=a.filter(x=>!n.options.includes(x));if(bad.length)W.push(`${where}: skipped unknown ${bad.join(', ')}`);break;}
    case 'kv':
      if(!isObj(val)){if(val!=null)W.push(`${where}: expected key: value pairs, skipped`);break;}
      s.v=Object.entries(val).map(([k,v])=>({k,v:n.matrix&&Array.isArray(v)?v.map(scal).join(', '):scal(v)}));
      if(!s.v.length)s.v=[{k:'',v:''}];
      break;
    case 'kvl':
      s.v=asArr(val).filter(isObj).map(o=>Object.entries(o).map(([k,v])=>({k,v:scal(v)})));
      break;
    case 'obj':{
      if(val==null) break;
      if(typeof val==='string'&&n.shortcut&&n.shortcut.includes(val)){s.mode=val;break;}
      if(typeof val==='string'&&n.inline){const c=n.children.find(x=>x.key===n.inline);s.f[c.key]=imp(c,val,W,[...lbl,c.key]);break;}
      if(n.key==='on'&&(typeof val==='string'||Array.isArray(val))){
        asArr(val).forEach(ev=>{const c=n.children.find(x=>x.key===ev);if(c){s.f[ev]=mk(c);s.f[ev].on=true;}else W.push(`${where}: event “${ev}” isn't supported yet, skipped`);});
        break;}
      if(!isObj(val)){W.push(`${where}: this form isn't supported yet, skipped`);break;}
      const inl=n.children.find(c=>c.inline===true);const rows=[];
      for(const [k,v] of Object.entries(val)){
        const c=n.children.find(x=>x.key===k&&x.inline!==true);
        if(c) s.f[k]=imp(c,v,W,[...lbl,k]);
        else if(inl) rows.push({k,v:Array.isArray(v)?v.map(scal).join(', '):scal(v)});
        else W.push(`${crumb([...lbl,k])} isn't supported yet, skipped`);
      }
      if(inl){s.f[inl.key]={on:rows.length>0,v:rows.length?rows:[{k:'',v:''}]};}
      n.children.forEach(c=>{if(!s.f[c.key]){const x=mk(c);x.on=!!c.required;s.f[c.key]=x;}});
      break;}
    case 'map':
      if(!isObj(val)){if(val!=null)W.push(`${where}: expected named items, skipped`);break;}
      s.v=Object.entries(val).map(([k,v])=>({id:k,st:imp({type:'obj',key:k,children:n.item.children},v,W,[...lbl,k])}));
      break;
    case 'arr':
      s.v=asArr(val).map((v,i)=>imp({type:'obj',key:'',children:n.item.children},v,W,[...lbl,`${n.item.noun} ${i+1}`]));
      break;
  }
  return s;
}
function importYaml(text){
  const doc=window.jsyaml.load(text);
  if(!doc||typeof doc!=='object'||Array.isArray(doc)) throw new Error('This doesn\'t look like a workflow file. The top level should have keys like on: and jobs:.');
  const W=[];
  const s=imp(ROOT,doc,W,[]);
  s.on=true;s.file=state.file||'ci.yml';
  return {s,W};
}

/* ---------- share links ---------- */
const b64u={
  enc:u8=>{let s='';for(let i=0;i<u8.length;i+=0x8000)s+=String.fromCharCode.apply(null,u8.subarray(i,i+0x8000));return btoa(s).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');},
  dec:str=>{const s=atob(str.replace(/-/g,'+').replace(/_/g,'/'));const u=new Uint8Array(s.length);for(let i=0;i<s.length;i++)u[i]=s.charCodeAt(i);return u;}
};
async function pipe(u8,stream){return new Uint8Array(await new Response(new Blob([u8]).stream().pipeThrough(stream)).arrayBuffer());}
async function encodeState(){
  const raw=new TextEncoder().encode(JSON.stringify(state));
  if(window.CompressionStream){try{return 'z'+b64u.enc(await pipe(raw,new CompressionStream('deflate-raw')));}catch(e){}}
  return 'j'+b64u.enc(raw);
}
async function decodeState(str){
  const kind=str[0],data=b64u.dec(str.slice(1));
  const bytes=kind==='z'?await pipe(data,new DecompressionStream('deflate-raw')):data;
  const s=JSON.parse(new TextDecoder().decode(bytes));
  if(!s||!s.f) throw new Error('bad link');
  return s;
}

/* ---------- search ---------- */
function searchFields(qs){
  qs=qs.toLowerCase().trim();if(!qs) return [];
  const out=[];
  const visit=(children,getP,peekP,lbl,ids,chain)=>{
    for(const c of children){
      const getC=()=>ch(getP(),c);
      const peekC=()=>{const p=peekP();return p&&p.f&&p.f[c.key]||null;};
      const cs=peekC();
      const L=[...lbl,c.key],I=[...ids,c.key];
      const km=c.key.toLowerCase().includes(qs), dm=c.desc.toLowerCase().includes(qs);
      if(km||dm) out.push({lbl:L,ids:I,desc:c.desc,score:(km?0:1)+(c.key.toLowerCase()===qs?-1:0)+L.length*0.01,apply:()=>{chain.forEach(f=>f());getC().on=true;}});
      const on=()=>{getC().on=true;};
      if(c.type==='obj'&&c.children.length&&!(cs&&cs.mode)) visit(c.children,getC,peekC,L,I,[...chain,on]);
      if(c.type==='map'&&cs) cs.v.forEach((m,i)=>visit(c.item.children,()=>m.st,()=>m.st,[...L,m.id||`${c.item.noun} ${i+1}`],[...I,i],[...chain,on]));
      if(c.type==='arr'&&cs) cs.v.forEach((s,i)=>visit(c.item.children,()=>s,()=>s,[...L,`${c.item.noun} ${i+1}`],[...I,i],[...chain,on]));
    }
  };
  visit(ROOT.children,()=>state,()=>state,[],[],[]);
  return out.sort((a,b)=>a.score-b.score).slice(0,12);
}
function showResults(){
  const qs=$('q').value,box=$('results');box.innerHTML='';
  if(!qs.trim()){box.hidden=true;return;}
  const res=searchFields(qs);box.hidden=false;
  if(!res.length){box.append(el('li','none','No field matches. Try another word, like timeout or branch.'));return;}
  res.forEach(r=>{const li=el('li');const b=el('button');b.type='button';
    b.append(el('code',null,crumb(r.lbl)),el('span',null,r.desc));
    b.addEventListener('click',()=>goTo(r));li.append(b);box.append(li);});
}
function goTo(r){
  r.apply();$('q').value='';$('results').hidden=true;render();
  const cb=$('cb-'+fid(r.ids));if(!cb)return;
  const row=cb.closest('.row');
  row.scrollIntoView({block:'center',behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'});
  row.classList.remove('flash');void row.offsetWidth;row.classList.add('flash');
  const target=row.querySelector('.ctl input, .ctl textarea, .ctl select')||cb;
  target.focus({preventScroll:true});
}

/* ---------- refresh & render ---------- */
let yamlText='',lastCount=-1,liveT;
function refresh(){
  const jobsSt=ch(state,ROOT.children.find(c=>c.key==='jobs'));
  JOB_IDS=jobsSt.v.map(m=>m.id.trim()).filter(Boolean);
  yamlText=buildYaml();
  $('yaml').innerHTML=highlight(yamlText);
  const iss=[];walk(ROOT,state,[],[],iss);
  const box=$('issues');box.innerHTML='';
  if(!iss.length){box.className='issues ok';box.textContent='All ticked fields have values. Ready to copy.';}
  else{
    box.className='issues';
    box.append(el('strong',null,`${iss.length} ${iss.length===1?'thing needs':'things need'} your input`));
    const ul=el('ul');
    iss.forEach(x=>{const li=el('li');
      li.append(btn(null,x.msg,null,()=>{const t=$(x.id);if(t){t.scrollIntoView({block:'center',behavior:'smooth'});(t.matches('input,textarea,select,button')?t:t.querySelector('input,textarea,select,button')||t).focus({preventScroll:true});}}));
      ul.append(li);});
    box.append(ul);
  }
  $('mbar-t').textContent=iss.length?`${iss.length} to fix`:'Ready to copy';
  $('mbar').classList.toggle('ok',!iss.length);
  // announce only when the count changes, after typing settles
  clearTimeout(liveT);
  liveT=setTimeout(()=>{if(iss.length!==lastCount){lastCount=iss.length;$('live').textContent=iss.length?`${iss.length} ${iss.length===1?'field needs':'fields need'} your input`:'All fields filled in';}},1500);
  save();
}
function render(focusId,anchorId){
  const active=document.activeElement&&document.activeElement.id;
  const prev=focusId||active;
  const anchor=anchorId||active;
  const tree=$('tree');
  const anchorEl=anchor&&$(anchor);
  const anchorTop=anchorEl?anchorEl.getBoundingClientRect().top:null;
  const sx=window.scrollX,sy=window.scrollY;
  tree.style.minHeight=tree.offsetHeight+'px';
  tree.innerHTML='';
  tree.append(renderLayer(ROOT.children,state,[],[],'the workflow file (top level)'));
  tree.style.minHeight='';
  window.scrollTo(sx,sy);
  if(anchorTop!==null){const a=$(anchor);if(a){const d=a.getBoundingClientRect().top-anchorTop;if(d)window.scrollBy(0,d);}}
  if(prev){const t=$(prev);if(t)t.focus({preventScroll:true});}
  $('fname').value=state.file||'ci.yml';
  refresh();
}

/* ---------- notes ---------- */
function note(content,kind){
  const n=$('note');n.innerHTML='';n.className='note'+(kind?' '+kind:'');
  const body=el('div','note-b');
  if(typeof content==='string')body.textContent=content;else body.append(content);
  n.append(body,btn('x','×','Dismiss',()=>{n.hidden=true;}));
  n.hidden=false;
}

/* ---------- toolbar ---------- */
function confirmBtn(b,label,ask,fn,needsAsk){
  let armed=null;
  b.addEventListener('click',()=>{
    if(needsAsk&&!needsAsk()){fn();return;}
    if(!armed){b.textContent=ask;b.classList.add('danger');armed=setTimeout(()=>{armed=null;b.textContent=label;b.classList.remove('danger');},3000);return;}
    clearTimeout(armed);armed=null;b.textContent=label;b.classList.remove('danger');fn();
  });
}
const exampleYaml=buildYaml(example());
confirmBtn($('btn-example'),'Load example','Click again to replace your work',()=>{state=example();render();},()=>buildYaml()!==exampleYaml);
confirmBtn($('btn-clear'),'Start blank','Click again to clear',()=>{const f=state.file;state=blank();state.file=f||'ci.yml';render();});

function copyText(text,okBtn,okLabel,restore){
  const done=()=>{okBtn.textContent=okLabel;setTimeout(()=>okBtn.textContent=restore,1600);};
  try{return navigator.clipboard.writeText(text).then(()=>{done();return true;},()=>false);}catch(e){return Promise.resolve(false);}
}
$('btn-copy').addEventListener('click',async()=>{
  const ok=await copyText(yamlText,$('btn-copy'),'Copied','Copy');
  if(!ok){const r=document.createRange();r.selectNodeContents($('yaml'));const s=getSelection();s.removeAllRanges();s.addRange(r);$('btn-copy').textContent='Selected, press Ctrl+C';setTimeout(()=>$('btn-copy').textContent='Copy',2500);}
});
$('fname').addEventListener('input',e=>{state.file=e.target.value;save();});
$('btn-dl').addEventListener('click',()=>{
  let name=(state.file||'ci.yml').trim().replace(/[\\/:*?"<>|]+/g,'-')||'ci.yml';
  if(!/\.ya?ml$/i.test(name))name+='.yml';
  const url=URL.createObjectURL(new Blob([yamlText],{type:'text/yaml'}));
  const a=el('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
});
$('btn-share').addEventListener('click',async()=>{
  const b=$('btn-share');
  const url=location.origin+location.pathname+'#s='+await encodeState();
  const ok=await copyText(url,b,'Link copied','Share link');
  if(!ok){const wrap=el('div');wrap.append(el('div',null,'Copy this link to share your workflow:'));
    const i=el('input');i.type='text';i.readOnly=true;i.value=url;i.addEventListener('focus',()=>i.select());wrap.append(i);note(wrap);i.focus();}
  else if(url.length>8000) note('Link copied. It\'s long, so some chat apps may cut it off. Downloading the .yml file is safer for big workflows.');
});

/* import dialog */
const dlg=$('imp');
let yamlLib=null;
function loadYamlLib(){
  if(window.jsyaml) return Promise.resolve();
  if(!yamlLib) yamlLib=new Promise((res,rej)=>{const s=el('script');s.src='https://cdnjs.cloudflare.com/ajax/libs/js-yaml/4.1.0/js-yaml.min.js';s.onload=res;s.onerror=()=>{yamlLib=null;rej(new Error('Couldn\'t load the YAML reader. Check your connection and try again.'));};document.head.append(s);});
  return yamlLib;
}
$('btn-import').addEventListener('click',()=>{$('imp-err').hidden=true;loadYamlLib().catch(()=>{});
  if(dlg.showModal)dlg.showModal();else dlg.setAttribute('open','');$('imp-text').focus();});
$('imp-cancel').addEventListener('click',()=>dlg.close?dlg.close():dlg.removeAttribute('open'));
$('imp-go').addEventListener('click',async()=>{
  const err=$('imp-err');err.hidden=true;
  const text=$('imp-text').value;
  if(!text.trim()){err.textContent='Paste a workflow first.';err.hidden=false;return;}
  try{
    await loadYamlLib();
    const {s,W}=importYaml(text);
    state=s;render();
    dlg.close?dlg.close():dlg.removeAttribute('open');
    $('imp-text').value='';
    if(W.length){const wrap=el('div');wrap.append(el('strong',null,`Imported. ${W.length} ${W.length===1?'part was':'parts were'} skipped:`));
      const ul=el('ul');W.slice(0,20).forEach(w=>ul.append(el('li',null,w)));if(W.length>20)ul.append(el('li',null,`…and ${W.length-20} more`));wrap.append(ul);note(wrap,'warn');}
    else note('Imported. Everything in the file was understood.');
  }catch(e){
    const m=e&&e.mark?`Line ${e.mark.line+1}: ${e.reason||e.message}`:(e.message||String(e));
    err.textContent='Couldn\'t read that YAML. '+m;err.hidden=false;
  }
});

/* search */
$('q').addEventListener('input',showResults);
$('q').addEventListener('keydown',e=>{
  if(e.key==='Escape'){$('q').value='';showResults();}
  if(e.key==='Enter'){e.preventDefault();const r=searchFields($('q').value)[0];if(r)goTo(r);}
  if(e.key==='ArrowDown'){const f=$('results').querySelector('button');if(f){e.preventDefault();f.focus();}}
});
$('results').addEventListener('keydown',e=>{
  const bs=[...$('results').querySelectorAll('button')],i=bs.indexOf(document.activeElement);
  if(e.key==='ArrowDown'&&i<bs.length-1){e.preventDefault();bs[i+1].focus();}
  if(e.key==='ArrowUp'){e.preventDefault();(i>0?bs[i-1]:$('q')).focus();}
  if(e.key==='Escape'){$('q').value='';showResults();$('q').focus();}
});

/* mobile bar */
$('mbar-go').addEventListener('click',()=>$('out').scrollIntoView({behavior:'smooth',block:'start'}));
if('IntersectionObserver' in window){
  new IntersectionObserver(es=>es.forEach(e=>$('mbar').classList.toggle('away',e.isIntersecting)),{threshold:0.15}).observe($('out'));
}

/* ---------- start ---------- */
async function start(){
  const h=location.hash;
  if(h.startsWith('#s=')){
    try{state=await decodeState(h.slice(3));state.on=true;if(!state.file)state.file='ci.yml';note('Opened a shared workflow. Your previous work in this browser was replaced.');}
    catch(e){note('That share link looks broken, so your saved work was kept.','warn');}
    history.replaceState(null,'',location.pathname+location.search);
  }
  render();
}
start();

/* expose for tests */
window.__ab={buildYaml,importYaml,walk,ROOT,example,q,cronLocal,setState:s=>{state=s;},getState:()=>state};
})();
