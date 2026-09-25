const test=require('node:test'),assert=require('node:assert/strict'),H=require('./helpers.cjs'),C=H.C,A=require('../lib/azure-client.js'),E=require('../lib/entra-applications.js');
const cfg={tenantId:H.tenant,subscriptionIds:[H.sub,H.otherSub]},prefix='/subscriptions/'+H.sub+'/resourceGroups/rg-test',rg={id:prefix,name:'rg-test'};
const sb={id:prefix+'/providers/Microsoft.ServiceBus/namespaces/bus',type:'Microsoft.ServiceBus/namespaces',name:'bus',sku:{tier:'Standard'}};
const sql={id:prefix+'/providers/Microsoft.Sql/servers/sql',type:'Microsoft.Sql/servers',name:'sql'};
const app={id:prefix+'/providers/Microsoft.Web/sites/app',type:'Microsoft.Web/sites',name:'app',kind:'functionapp'};
const child=(p,c,n)=>({id:p.id+'/'+c+'/'+n,type:p.type+'/'+c,name:n}),queue=child(sb,'queues','one'),topic=child(sb,'topics','one'),db=child(sql,'databases','one'),fn=child(app,'functions','run');
const denied={status:403,body:{error:{code:'AuthorizationFailed',message:'SECRET'}}},missing={status:404,body:{error:{code:'ResourceNotFound'}}};
function collect(responses,existing=[],subs=[H.sub]){const io=H.io(responses),logs=[],s=A.create(io,H.token,l=>logs.push(l)).inventory({...cfg,subscriptionIds:subs},existing);return {s,io,logs};}
function old(raw){const op=C.plan([],H.snapshot([C.normalize(raw,H.info,H.tenant)]),{}).operations[0];return {id:'old-'+raw.id,type:op.base,properties:op.properties};}
const providers=H.page([{namespace:'Microsoft.Compute',resourceTypes:[{resourceType:'virtualMachines',apiVersions:['2025-01-01']}]}]);
test('Denied first subscription does not prevent inventory from a later selected subscription',()=>{
 const other={...H.info,subscriptionId:H.otherSub},resource={...H.raw,id:H.id.replace(H.sub,H.otherSub)},before=H.existing();
 const {s,logs}=collect([denied,H.ok(other),H.page([]),H.page([resource])],[before],[H.sub,H.otherSub]);
 assert.deepEqual(s.completedSubscriptions,[H.otherSub]);assert.equal(s.resources.length,2);
 const p=C.plan([before],s,{});assert.equal(p.counts.created,2);assert.equal(p.counts.deleted,0);assert.ok(!p.operations.some(o=>o.elementId===before.id));
 assert.ok(logs.some(l=>l.includes('[WARNING]')&&l.includes(H.sub)&&l.includes('403')));assert.ok(!JSON.stringify({s,logs}).includes('SECRET'));
});
test('Denied queues and Functions do not block topics or SQL databases; existing children remain untouched',()=>{
 const previous=[old(queue),old(fn)],responses=[H.ok(H.info),H.page([rg]),H.page([sb,app,sql]),denied,H.page([topic]),denied,H.page([db]),denied,denied];
 const {s,io}=collect(responses,previous);assert.equal(io.calls.length,responses.length);assert.equal(s.partial,true);
 assert.ok(s.resources.some(r=>r.id===topic.id));assert.ok(s.resources.some(r=>r.id===db.id));assert.deepEqual(s.confirmedMissing,[]);
 const p=C.plan(previous,s,{});assert.ok(!p.operations.some(o=>previous.some(e=>e.id===o.elementId)));assert.ok(p.relationships.pairs.some(r=>r.type==='serving-relationship'));
});
test('Child pagination retains earlier successful records if a later page is denied',()=>{
 const next='https://management.azure.com'+sb.id+'/queues?next=2';
 const {s}=collect([H.ok(H.info),H.page([rg]),H.page([sb]),H.page([queue],next),denied,H.page([topic])]);
 assert.ok(s.resources.some(r=>r.id===queue.id));assert.ok(s.resources.some(r=>r.id===topic.id));assert.equal(s.partial,true);
});
test('Denied subscription resource list falls back to readable resource groups',()=>{
 const {s,io}=collect([H.ok(H.info),H.page([rg]),denied,H.page([H.raw])]);
 assert.ok(s.resources.some(r=>r.id===H.id));assert.equal(s.partial,true);assert.ok(io.calls.at(-1)[1].includes(prefix+'/resources?'));
});
test('Resource-group fallback merges earlier pages but rejects duplicate or escaped records',()=>{
 const next='https://management.azure.com/subscriptions/'+H.sub+'/resources?next=2';
 const init=[H.ok(H.info),H.page([rg]),H.page([H.raw],next),denied];
 assert.equal(collect([...init,H.page([H.raw])]).s.resources.filter(r=>r.id===H.id).length,1);
 assert.throws(()=>collect([...init,H.page([H.raw,H.raw])]),/Duplicate/);
 assert.throws(()=>collect([...init,H.page([{...H.raw,id:H.id.replace('rg-test','other')}])]),/escaped/);
});
test('Denied group listing still permits resources and other subscriptions',()=>{
 const {s}=collect([H.ok(H.info),denied,H.page([H.raw])]);assert.equal(s.resources.length,2);assert.equal(s.partial,true);
});
test('Unavailable Service Bus parent details still permit its readable child endpoints',()=>{
 const {s}=collect([H.ok(H.info),H.page([rg]),H.page([{...sb,sku:undefined}]),denied,H.page([queue]),H.page([topic])]);
 assert.ok(s.resources.some(r=>r.id===queue.id));assert.ok(s.resources.some(r=>r.id===topic.id));assert.equal(s.partial,true);
});
test('One failed existence check suppresses deletions across that subscription, including previously confirmed 404s',()=>{
 const one=H.existing(),two=old({...H.raw,id:H.id+'-2',name:'vm-2'});
 const {s}=collect([H.ok(H.info),H.page([]),H.page([]),providers,missing,denied],[one,two]);
 assert.deepEqual(s.confirmedMissing,[]);const p=C.plan([one,two],s,{});assert.equal(p.counts.deleted,0);assert.ok(!p.operations.some(o=>o.elementId));
});
test('A complete subscription still reconciles confirmed deletion when a different subscription fails',()=>{
 const previous=H.existing(),{s}=collect([H.ok(H.info),H.page([]),H.page([]),providers,missing,denied],[previous],[H.sub,H.otherSub]);
 assert.deepEqual(s.confirmedMissing,[C.identity(H.tenant,H.id)]);assert.equal(C.plan([previous],s,{}).counts.deleted,1);
});
test('Retry exhaustion and sanitized network failures preserve inventory already read',()=>{
 const responses=[H.ok(H.info),H.page([]),...Array.from({length:5},()=>({status:503,body:{}}))];
 const r=collect(responses);assert.equal(r.s.resources.length,1);assert.equal(r.s.partial,true);assert.equal(r.io.sleeps.length,4);assert.match(r.s.warnings[0].message,/503/);
 const io=H.io([H.ok(H.info),H.page([])]),s=A.create(io,H.token).inventory({...cfg,subscriptionIds:[H.sub]},[]);assert.equal(s.partial,true);assert.match(s.warnings[0].message,/network/);assert.ok(!JSON.stringify(s).includes('Unexpected HTTP'));
});
test('Graph partial pages retain available apps but never delete omitted apps',()=>{
 const raw={id:'33333333-3333-3333-3333-333333333333',appId:H.clientId,displayName:'Visible'},other={...raw,id:'44444444-4444-4444-4444-444444444444',displayName:'Hidden'};
 const complete={tenantId:H.tenant,completed:true,applications:[other],confirmedMissing:[],collectedAt:H.snapshot().collectedAt},op=E.plan([],complete,{}).operations[0],before={id:'old-app',type:'node',properties:op.properties};
 const base='https://graph.microsoft.com/v1.0/applications',next=base+'?$select=id,appId,displayName&$skiptoken=two',logs=[];
 const io=H.io([H.ok({value:[raw],'@odata.nextLink':next}),denied,missing]);
 const s=E.create(io,{...H.token,tenantId:H.tenant,resource:'graph'},l=>logs.push(l)).inventory(H.tenant,[before]);
 assert.equal(s.applications.length,1);assert.equal(s.completed,false);assert.deepEqual(s.confirmedMissing,[]);assert.equal(E.plan([before],s,{}).operations.length,1);assert.ok(logs[1].includes('page 2'));
});
test('Denied Graph list can still recover individually readable previously synced apps',()=>{
 const raw={id:'33333333-3333-3333-3333-333333333333',appId:H.clientId,displayName:'Visible'},snap={tenantId:H.tenant,completed:true,applications:[raw],confirmedMissing:[],collectedAt:H.snapshot().collectedAt};
 const before={id:'app-id',type:'node',properties:E.plan([],snap,{}).operations[0].properties},io=H.io([denied,H.ok(raw)]);
 const s=E.create(io,{...H.token,tenantId:H.tenant,resource:'graph'}).inventory(H.tenant,[before]);
 const p=E.plan([before],s,{});assert.equal(p.operations[0].elementId,'app-id');assert.equal(p.counts.updated,1);assert.equal(p.partial,true);
});
test('Partial discovery continues other subscriptions and reports omissions',()=>{
 const warnings=[],io=H.io([denied,providers]),types=A.create(io,H.token).discover([H.sub,H.otherSub],warnings);
 assert.ok(types.includes('Microsoft.Compute/virtualMachines'));assert.equal(warnings.length,1);assert.ok(warnings[0].scope.includes(H.sub));
});
test('Permission failures are recoverable but unknown exceptions are never silently swallowed',()=>{
 const warnings=[],logs=[];assert.equal(C.attempt(warnings,'scope',l=>logs.push(l),()=>{throw C.readError('HTTP 403');}).ok,false);assert.equal(warnings.length,1);assert.match(logs[0],/Continuing/);
 assert.throws(()=>C.attempt(warnings,'scope',null,()=>{throw Error('Bug or invalid scope');}),/Bug/);assert.equal(warnings.length,1);
});

test('Discovery retains types from earlier successful pages after a later page fails',()=>{
 const warnings=[],next='https://management.azure.com/subscriptions/'+H.sub+'/providers?next=2',first=JSON.parse(JSON.stringify(providers));first.body.nextLink=next;
 const io=H.io([first,denied]),types=A.create(io,H.token).discover([H.sub],warnings);
 assert.ok(types.includes('Microsoft.Compute/virtualMachines'));assert.equal(warnings.length,1);assert.equal(io.calls.length,2);
});
