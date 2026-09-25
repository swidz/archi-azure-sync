const test=require('node:test'),assert=require('node:assert/strict');
const E=require('../lib/entra-applications.js'),H=require('./helpers.cjs'),C=H.C;
const base='https://graph.microsoft.com/v1.0/applications',select='?$select=id,appId,displayName';
const raw={id:'33333333-3333-3333-3333-333333333333',appId:H.clientId,displayName:'Registered app'};
const raw2={...raw,id:'44444444-4444-4444-4444-444444444444',displayName:'Another app'};
const token={...H.token,tenantId:H.tenant,resource:'graph'};
const page=(value,next)=>H.ok({value,...(next?{'@odata.nextLink':next}:{})});
const snap=(applications=[raw])=>({tenantId:H.tenant,completed:true,applications,confirmedMissing:[],collectedAt:H.snapshot().collectedAt});
function old(app=raw){const op=E.plan([],snap([app]),{}).operations[0];return {id:'archi-'+app.id,type:'node',properties:{...op.properties}};}
function collect(responses,existing=[]){const io=H.io(responses);return {snapshot:E.create(io,token).inventory(H.tenant,existing),io};}
test('Graph follows every application page with a separate audience and projects safe fields',()=>{
 const result=collect([page([{...raw,passwordCredentials:[{secretText:'SECRET'}],keyCredentials:['private'],web:{redirectUris:['secret']}}],base+select+'&$skiptoken=abc%2B123'),page([raw2])]);
 assert.deepEqual(result.snapshot.applications,[raw,raw2]);assert.equal(result.snapshot.completed,true);
 assert.equal(result.io.calls.length,2);assert.ok(result.io.calls.every(c=>c[0]==='GET'&&c[2].Authorization==='Bearer '+token.accessToken));
 assert.ok(!JSON.stringify(result.snapshot).includes('SECRET'));
});
test('Graph rejects cross-host, cross-collection, traversal and changed queries before sending tokens',()=>{
 for(const next of ['https://evil.test/v1.0/applications'+select,base+'/../users'+select,base+'@evil.test'+select,base+select+'#fragment',base+select+'&$filter=x',base+'?$select=passwordCredentials',base+select+'&$select=id',base+select+'&$expand=owners']){
  const io=H.io([page([raw],next)]);assert.throws(()=>E.create(io,token).inventory(H.tenant,[]),/pagination|query|selected fields/);assert.equal(io.calls.length,1);
 }
});
test('Graph rejects duplicate objects, repeated pages, malformed pages and unrecognized derived types',()=>{
 for(const responses of [[page([raw,raw])],[page([raw],base+select+'&$top=999')],[H.ok({items:[]})],[H.ok({value:[],'@odata.nextLink':42})],[page([{...raw,'@odata.type':'#unexpected'}])]])assert.throws(()=>collect(responses));
 assert.deepEqual(collect([page([{...raw,'@odata.type':'#microsoft.graph.agentIdentityBlueprint'}])]).snapshot.applications,[]);
});
test('Graph requires the tenant and Graph audience before issuing any request',()=>{
 for(const bad of [{...token,tenantId:H.clientId},{...token,resource:'arm'}]){const io=H.io([]);assert.throws(()=>E.create(io,bad).inventory(H.tenant,[]),/tenant\/audience/);assert.equal(io.calls.length,0);}
});
test('Graph retries throttling and transient errors, but permission failure stops safely',()=>{
 const result=collect([{status:429,headers:{'retry-after':'2'}},page([raw])]);assert.deepEqual(result.io.sleeps,[2000]);
 for(const status of [401,403,404])assert.throws(()=>collect([{status,body:{error:{code:'Authorization_RequestDenied',message:'SECRET'}}}]),e=>e.message.includes('HTTP '+status)&&!e.message.includes('SECRET'));
 const io=H.io([{status:503,headers:{'retry-after':'120'}}]);assert.throws(()=>E.create(io,{...token,expiresAt:io.now()+20000}).inventory(H.tenant,[]),/expired/);assert.equal(io.calls.length,1);
});
test('Missing app list entries are individually checked, recovered or confirmed absent',()=>{
 let r=collect([page([]),H.ok(raw)],[old()]);assert.deepEqual(r.snapshot.applications,[raw]);assert.deepEqual(r.snapshot.confirmedMissing,[]);
 assert.equal(r.io.calls[1][1],base+'/'+raw.id+select);
 r=collect([page([]),{status:404,body:{error:{code:'Request_ResourceNotFound'}}}],[old()]);assert.deepEqual(r.snapshot.confirmedMissing,[E.identity(H.tenant,raw.id)]);
 for(const response of [{status:404,body:{}},{status:403,body:{}},H.ok(raw2)])assert.throws(()=>collect([page([]),response],[old()]));
});
test('Entra Nodes store both IDs and empty subscription/group fields with repository timestamps',()=>{
 const p=E.plan([],snap(),{}),op=p.operations[0];assert.equal(op.base,'node');
 for(const key of C.PROPS)assert.ok(Object.hasOwn(op.properties,key),key);
 assert.equal(op.properties['Azure-ObjectId'],raw.id);assert.equal(op.properties['Azure-ApplicationId'],raw.appId);assert.equal(op.properties['Azure-ObjectType'],C.ENTRA_APPLICATION_TYPE);
 for(const key of ['Azure-SubscriptionId','Azure-SubscriptionName','Azure-ResourceGroupId','Azure-ResourceGroupName','Azure-ParentObjectId'])assert.equal(op.properties[key],'');
 assert.equal(op.properties.CreatedTime,'10:20:30Z');assert.equal(op.properties['Azure-URL'],base+'/'+raw.id);
});
test('Entra reconciliation preserves IDs on rename and soft deletion/restoration',()=>{
 const previous=old(),renamed=E.plan([previous],snap([{...raw,displayName:'Renamed'}]),{}).operations[0];assert.equal(renamed.elementId,previous.id);assert.equal(renamed.name,'Renamed');
 const missing={...snap([]),confirmedMissing:[E.identity(H.tenant,raw.id)],collectedAt:'2026-09-26T12:00:00Z'};
 const deleted=E.plan([previous],missing,{}).operations[0];assert.equal(deleted.properties.IsDeleted,'yes');
 const gone={...previous,properties:{...previous.properties,...deleted.properties}};
 assert.equal(E.plan([gone],{...missing,collectedAt:'2026-09-27T12:00:00Z'},{}).operations[0].properties.DeletedDate,'2026-09-26');
 const restored=E.plan([gone],snap(),{}).operations[0];assert.equal(restored.action,'restored');assert.equal(restored.elementId,previous.id);assert.equal(restored.properties.DeletedDate,'');assert.equal(restored.properties.CreatedDate,previous.properties.CreatedDate);
});
test('ARM and Entra identities/scopes are isolated; app scope does not depend on subscriptions',()=>{
 const previous=old();assert.deepEqual(C.plan([previous],H.snapshot([]),{}).operations,[]);
 assert.deepEqual(Object.keys(E.validateExisting([H.existing()],H.tenant)),[]);
 assert.deepEqual(E.plan([{...previous,properties:{...previous.properties,'Azure-TenantId':H.clientId}}],snap([]),{}).operations,[]);
 const p=C.plan([previous],H.snapshot(),H.mapping),e=E.plan([previous],snap(),{});E.merge(p,e);assert.equal(p.operations.length,2);assert.equal(p.relationships.pairs.length,0);assert.equal(p.entraTenantId,H.tenant);
 assert.throws(()=>E.merge(C.plan([],H.snapshot(),{}),{...e,tenantId:H.clientId}),/disagree/);
});
test('Entra rejects incomplete snapshots, unconfirmed deletion, duplicates, unmanaged collisions and wrong base type',()=>{
 assert.throws(()=>E.plan([], {...snap(),completed:false},{}),/Incomplete/);assert.throws(()=>E.plan([old()],snap([]),{}),/independently confirmed/);
 assert.throws(()=>E.plan([],snap([raw,raw]),{}),/Duplicate/);assert.throws(()=>E.plan([old(),old()],snap(),{}),/Duplicate/);
 assert.throws(()=>E.plan([{...old(),properties:{...old().properties,'Azure-SyncManagedBy':''}}],snap(),{}),/not owned/);
 assert.throws(()=>E.plan([{...old(),type:'application-component'}],snap(),{}),/Node/);
 assert.throws(()=>E.plan([],snap(),C.mappings([[C.ENTRA_APPLICATION_TYPE,'technology-function']])),/Node/);
});
