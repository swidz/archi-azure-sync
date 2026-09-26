const test=require('node:test'),assert=require('node:assert/strict'),H=require('./helpers.cjs'),C=H.C,A=require('../lib/azure-client.js'),D=require('../lib/connections.js');
const prefix='/subscriptions/'+H.sub+'/resourceGroups/rg-test';
const raw=(type,name)=>({id:prefix+'/providers/'+type.split('/')[0]+'/'+type.split('/')[1]+'/'+name,type,name});
const site=raw('Microsoft.Web/sites','app'),bus=raw('Microsoft.ServiceBus/namespaces','bus'),sql=raw('Microsoft.Sql/servers','sql-prod'),storage=raw('Microsoft.Storage/storageAccounts','storage123');
const child=(p,c,name)=>({id:p.id+'/'+c+'/'+name,type:p.type+'/'+c,name});
const queue=child(bus,'queues','orders'),topic=child(bus,'topics','orders-topic'),db=child(sql,'databases','Orders'),fn=child(site,'functions','handle');
const resources=[site,bus,queue,topic,sql,db,storage],token={...H.token,tenantId:H.tenant,resource:'arm'},denied={status:403,body:{error:{code:'SECRET',message:'SECRET'}}};
const setting=o=>H.ok({properties:JSON.parse(JSON.stringify(o))});
const sqlString='Server=tcp:sql-prod.database.windows.net,1433;Database=Orders;User ID=SECRET;Password="SECRET;a=b";Extra=SECRET';
const busString='Endpoint=sb://bus.servicebus.windows.net/;SharedAccessKeyName=SECRET;SharedAccessKey=SECRET';
function run(app={},strings={},items=resources,extra=[],responses){
 const io=H.io(responses || [setting(app),setting(strings),...extra]),logs=[],snapshot=H.snapshot(items.map(r=>C.normalize(r,H.info,H.tenant)));
 const result=D.create(io,token,A.create(io,token),s=>logs.push(s)).inventory(snapshot);snapshot.connections=result;
 return {snapshot,result,logs,io,plan:D.plan(snapshot,C.plan([],snapshot,{}))};
}
function functions(bindings,extra={}){return H.page([{...fn,properties:{config:{bindings},files:{'code.js':'SECRET'},invoke_url_template:'https://secret?code=SECRET',...extra}}]);}

test('SQL parser reconstructs only allowlisted connection details across quoted and braced credentials',()=>{
 for(const secret of ['"SECRET;a=b"',"'SECRET;it''s=a'",'{SECRET;escaped}}brace}']){
  const d=D.descriptor('Data Source=tcp:sql-prod.database.windows.net,1433;Initial Catalog=Orders;Password='+secret+';User ID=SECRET');
  assert.equal(d.kind,'sql');assert.equal(d.database,'Orders');assert.equal(d.sanitized,'Server=sql-prod.database.windows.net;Database=Orders;Credentials=[REDACTED]');assert.ok(!JSON.stringify(d).includes('SECRET'));
 }
});
test('Parser strips URL credentials, SAS query and fragments; rejects malformed or conflicting fields',()=>{
 for(const text of ['https://user:SECRET@storage123.blob.core.windows.net/container?sig=SECRET#SECRET','Endpoint=sb://u:SECRET@bus.servicebus.windows.net/?sig=SECRET;EntityPath=orders']){
  const d=D.descriptor(text);assert.ok(d);assert.ok(!JSON.stringify(d).includes('SECRET'));assert.ok(!d.endpoint.includes('@'));
 }
 for(const text of ['Server=sql-prod.database.windows.net;Password="SECRET','Server=sql-prod.database.windows.net;Server=other.database.windows.net'])assert.equal(D.descriptor(text),null);
 assert.ok(D.descriptor('Server=sql-prod.database.windows.net;Data Source=other.database.windows.net').unresolved);
 assert.ok(D.descriptor('AccountName=storage123;BlobEndpoint=https://other.blob.core.windows.net').unresolved);
 assert.equal(D.descriptor('Server=custom.example;Password=SECRET'),null);
});
test('SQL, Service Bus and Storage settings resolve to provider-to-app Serving links with safe evidence',()=>{
 const r=run({Bus:busString,Storage:'AccountName=storage123;AccountKey=SECRET;EndpointSuffix=core.windows.net'}, {Orders:{type:'SQLAzure',value:sqlString}});
 assert.equal(r.result.records.length,3);assert.equal(r.result.partial,false);assert.equal(r.plan.pairs.length,3);
 assert.ok(r.result.records.every(p=>p.type==='serving-relationship'&&p.target===C.identity(H.tenant,site.id)));
 assert.ok(r.result.records.some(p=>p.source===C.identity(H.tenant,db.id)));assert.ok(!JSON.stringify(r.result).includes('SECRET'));assert.equal(r.io.calls.length,2);
 assert.ok(r.io.calls.every(c=>c[0]==='POST'&&c[1].startsWith('https://management.azure.com'+site.id+'/config/')&&c[3]==='{}'));
});
test('Service Bus entity path matches a queue; missing database never falls back to its server',()=>{
 const r=run({Bus:busString+';EntityPath=orders'},{});assert.equal(r.result.records[0].source,C.identity(H.tenant,queue.id));
 const missing=run({}, {Db:{value:sqlString}},resources.filter(r=>r!==db));assert.equal(missing.result.records.length,0);assert.equal(missing.result.partial,true);assert.match(missing.logs[0],/0 matching/);
});
test('Ambiguous targets and custom endpoints are reported without exposing connection values',()=>{
 const other={...db,id:db.id.replace('rg-test','other')},r=run({}, {Db:{value:sqlString},Unknown:{value:'Server=private.example;Password=SECRET'}},resources.concat(other));
 assert.equal(r.result.records.length,0);assert.equal(r.result.warnings.length,2);assert.ok(!JSON.stringify(r.result).includes('SECRET'));assert.ok(!r.logs.join('').includes('private.example'));
});
test('Key Vault/App Configuration references remain unresolved without secret fetches',()=>{
 const r=run({Bus:'@Microsoft.KeyVault(SecretUri=https://vault.vault.azure.net/secrets/SECRET)'},{Other:{value:'@Microsoft.AppConfiguration(Endpoint=SECRET)'}});
 assert.equal(r.io.calls.length,2);assert.equal(r.result.records.length,0);assert.equal(r.result.partial,true);assert.ok(!JSON.stringify({r:r.result,logs:r.logs}).includes('SECRET'));
});
test('Function triggers and outputs determine relationship direction and consume the shared app setting',()=>{
 const bindings=[{type:'serviceBusTrigger',name:'input',connection:'Bus',queueName:'%QueueName%'},{type:'serviceBus',name:'output',direction:'out',connection:'Bus',topicName:'orders-topic'}];
 const r=run({Bus:busString,QueueName:'orders'}, {},resources.concat(fn),[functions(bindings)]);
 assert.equal(r.result.records.length,2);const trigger=r.result.records.find(p=>p.type==='triggering-relationship'),flow=r.result.records.find(p=>p.type==='flow-relationship');
 assert.equal(trigger.source,C.identity(H.tenant,queue.id));assert.equal(trigger.target,C.identity(H.tenant,fn.id));assert.equal(flow.source,C.identity(H.tenant,fn.id));assert.equal(flow.target,C.identity(H.tenant,topic.id));
 assert.ok(!JSON.stringify(r.result).includes('SECRET'));assert.equal(r.result.partial,false);
});
test('Managed identity and AzureWebJobs aliases resolve without requesting service keys',()=>{
 const r=run({'AzureWebJobsBus__fullyQualifiedNamespace':'bus.servicebus.windows.net'}, {},resources.concat(fn),[functions([{type:'serviceBusTrigger',name:'input',connection:'Bus',queueName:'orders'}])]);
 assert.equal(r.result.records.length,1);assert.match(r.result.records[0].evidence.connectionString,/Authentication=ManagedIdentity/);assert.ok(r.io.calls.every(c=>!/listkeys|vault.azure|scm.azure/i.test(c[1])));
});
test('Exact connection values take precedence over managed-identity prefixes regardless of setting order',()=>{
 for(const app of [{Bus:busString,'Bus__fullyQualifiedNamespace':'other.servicebus.windows.net'},{'Bus__fullyQualifiedNamespace':'other.servicebus.windows.net',Bus:busString}]){
  const r=run(app,{},resources.concat(fn),[functions([{type:'serviceBusTrigger',name:'input',connection:'Bus',queueName:'orders'}])]);assert.equal(r.result.records.length,1);assert.equal(r.result.partial,false);assert.match(r.result.records[0].evidence.connectionString,/Credentials=/);
 }
});
test('Storage queue/blob bindings retain entity metadata but link only the known storage account',()=>{
 const r=run({AzureWebJobsStorage:'AccountName=storage123;AccountKey=SECRET'}, {},resources.concat(fn),[functions([{type:'queueTrigger',name:'q',queueName:'jobs'},{type:'blob',name:'out',direction:'out',path:'container/{name}'}],{isDisabled:true})]);
 assert.equal(r.result.records.length,2);assert.ok(r.result.records.every(p=>p.evidence.bindingDisabled));assert.equal(r.result.records[0].source,C.identity(H.tenant,storage.id));assert.equal(r.result.records[1].evidence.entity,'container/{name}');
});
test('Missing binding configuration, unresolved entities and service mismatch protect existing links',()=>{
 for(const page of [functions(undefined),functions([{type:'serviceBusTrigger',name:'b',connection:'Bus',queueName:'%Missing%'}]),functions([{type:'queueTrigger',name:'b',connection:'Bus',queueName:'q'}])]){
  const r=run({Bus:busString},{},resources.concat(fn),[page]);assert.equal(r.result.partial,true);assert.deepEqual(r.result.completedOwners,[]);assert.ok(!r.result.records.some(p=>p.type==='triggering-relationship'));
 }
});
test('Denied settings do not block readable dedicated strings and sanitize server errors',()=>{
 const r=run({}, {},resources,[],[denied,setting({Db:{value:sqlString}})]);
 assert.equal(r.result.records.length,1);assert.equal(r.result.partial,true);assert.deepEqual(r.result.completedOwners,[]);assert.ok(!JSON.stringify({r:r.result,logs:r.logs}).includes('SECRET'));
});
test('Failures in one app continue another app, and raw settings are discarded before return',()=>{
 const other={...site,id:site.id+'2',name:'app2'},a=setting({Bus:busString}),b=setting({Db:{value:sqlString}});
 const r=run({}, {},resources.concat(other),[],[denied,denied,a,b]);
 assert.equal(r.result.records.length,2);assert.deepEqual(r.result.completedOwners,[C.identity(H.tenant,other.id)]);assert.equal(a.body.properties.Bus,null);assert.equal(b.body.properties.Db,null);
});
test('Connection transport enforces ARM audience, tenant, expiry and fixed site paths',()=>{
 const snap=H.snapshot(resources.map(r=>C.normalize(r,H.info,H.tenant)));
 for(const bad of [{...token,resource:'graph'},{...token,tenantId:H.clientId}])assert.throws(()=>D.create(H.io([]),bad,{}).inventory(snap),/ARM token|tenant mismatch/);
 const io=H.io([]),r=D.create(io,{...token,expiresAt:0},{}).inventory(snap);assert.equal(io.calls.length,0);assert.equal(r.warnings.length,2);
 const invalid={...snap,resources:[{...snap.resources[0],id:site.id+'/../config'}]};assert.throws(()=>D.create(H.io([]),token,{}).inventory(invalid),/Invalid resource/);
});
test('Function pagination blocks foreign links and validates every function parent',()=>{
 const first=functions([]);first.body.nextLink='https://evil.test?SECRET';assert.throws(()=>run({}, {},resources.concat(fn),[first]),/escaped/);
 const bad=functions([]);bad.body.value[0].id=fn.id.replace('/app/','/other/');assert.throws(()=>run({}, {},resources.concat(fn),[bad]),/escaped its app/);
 const duplicate=functions([]);duplicate.body.value.push(duplicate.body.value[0]);assert.throws(()=>run({}, {},resources.concat(fn),[duplicate]),/Duplicate function/);
});
test('Binding page failure retains prior evidence and prevents connection retirement',()=>{
 const page=functions([{type:'serviceBusTrigger',name:'input',connection:'Bus',queueName:'orders'}]);page.body.nextLink='https://management.azure.com'+site.id+'/functions?api-version=2025-03-01&next=2';
 const r=run({Bus:busString},{},resources.concat(fn),[page,denied]);assert.equal(r.result.records.length,1);assert.equal(r.result.partial,true);assert.deepEqual(r.result.completedOwners,[]);
});
test('Multiple named settings aggregate evidence into one relationship; Graph nodes do not enter ARM identity logic',()=>{
 const r=run({One:busString,Two:busString},{});assert.equal(r.plan.pairs.length,1);assert.equal(r.plan.pairs[0].evidence.length,2);
 const p=C.plan([],r.snapshot,{});p.operations.push({base:'node',properties:{'Azure-ObjectType':C.ENTRA_APPLICATION_TYPE,'Azure-ObjectId':H.clientId}});assert.doesNotThrow(()=>D.plan(r.snapshot,p));
});
test('An invalid Archi element combination warns before model application and blocks retirement',()=>{
 const r=run({Bus:busString},{}),p=C.plan([],r.snapshot,{}),logs=[];D.plan(r.snapshot,p,()=>false,s=>logs.push(s));
 assert.equal(p.connections.pairs.length,0);assert.equal(p.partial,true);assert.deepEqual(p.connections.completedOwners,[]);assert.ok(logs[0].includes('Archi does not permit'));
});
test('Same-tenant cross-subscription targets require both subscriptions in current inventory',()=>{
 const other={...H.info,subscriptionId:H.otherSub},s=H.snapshot([C.normalize(site,H.info,H.tenant),C.normalize({...db,id:db.id.replace(H.sub,H.otherSub)},other,H.tenant)]);s.subscriptionIds.push(H.otherSub);
 const io=H.io([setting({}),setting({Db:{value:sqlString}})]),r=D.create(io,token,A.create(io,token)).inventory(s);assert.equal(r.records.length,1);assert.ok(r.records[0].source.includes(H.otherSub));
 assert.throws(()=>D.create(H.io([]),token,{}).inventory({...s,subscriptionIds:[H.sub]}),/scope mismatch/);
});
test('Configuration transient failures retry, and no arbitrary requests are issued',()=>{
 const r=run({}, {},resources,[],[{status:429,headers:{'retry-after':'1'}},setting({Bus:busString}),setting({})]);assert.deepEqual(r.io.sleeps,[1000]);assert.equal(r.result.partial,false);
 const malformed=run({}, {},resources,[],[H.ok({}),setting({Db:{value:sqlString}})]);assert.equal(malformed.result.partial,true);assert.equal(malformed.result.records.length,1);
});
module.exports={site,bus,queue,topic,sql,db,storage,fn,resources,sqlString,busString};

test('Conflicting trigger direction and conflicting identity endpoints do not create speculative triggers',()=>{
 const r=run({Bus:busString},{},resources.concat(fn),[functions([{type:'serviceBusTrigger',name:'b',connection:'Bus',queueName:'orders',direction:'out'}])]);assert.equal(r.result.partial,true);assert.ok(!r.result.records.some(p=>p.type==='triggering-relationship'));
 const conflicting=run({'S__blobServiceUri':'https://storage123.blob.core.windows.net','S__queueServiceUri':'https://other.queue.core.windows.net'},{},resources.concat(fn),[functions([{type:'queueTrigger',name:'b',connection:'S',queueName:'jobs'}])]);assert.equal(conflicting.result.partial,true);assert.equal(conflicting.result.records.length,0);
});
