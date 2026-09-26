const test=require('node:test'),assert=require('node:assert/strict'),H=require('./helpers.cjs'),A=require('../lib/azure-client.js'),C=H.C;
const cfg={tenantId:H.tenant,subscriptionIds:[H.sub]},prefix='/subscriptions/'+H.sub+'/resourceGroups/rg-test';
const rg={id:prefix,name:'rg-test'};
const sb={id:prefix+'/providers/Microsoft.ServiceBus/namespaces/bus',type:'Microsoft.ServiceBus/namespaces',name:'bus',sku:{tier:'Standard'}};
const app={id:prefix+'/providers/Microsoft.Web/sites/app',type:'Microsoft.Web/sites',name:'app',kind:'functionapp,linux'};
const sql={id:prefix+'/providers/Microsoft.Sql/servers/sql',type:'Microsoft.Sql/servers',name:'sql'};
const child=(parent,collection,name,extra={})=>({id:parent.id+'/'+collection+'/'+name,type:parent.type+'/'+collection,name,...extra});
const queue=child(sb,'queues','queue'),topic=child(sb,'topics','topic'),fn=child(app,'functions','run'),db=child(sql,'databases','db');
const initial=resources=>[H.ok(H.info),H.page([rg]),H.page(resources)];
function old(raw){const r=C.normalize(raw,H.info,H.tenant),op=C.plan([],H.snapshot([r]),{}).operations[0];return {id:'old-'+raw.name,type:op.base,name:op.name,properties:op.properties};}
const notFound=code=>({status:404,body:{error:{code}}});

test('dedicated collectors paginate, merge overlapping generic children and retain identity metadata only',()=>{
 const plain={...app,id:app.id+'-web',kind:'app'};
 const next='https://management.azure.com'+sb.id+'/queues?api-version=2024-01-01&next=2';
 const io=H.io([...initial([sb,app,plain,sql,{...db,id:db.id.toUpperCase()}]),H.page([queue],next),H.page([child(sb,'queues','two')]),H.page([topic]),H.page([{...fn,type:undefined,properties:{files:{'index.js':'SECRET'},config:{key:'SECRET'},invoke_url_template:'SECRET'}},child(app,'functions','other')]),H.page([db,child(sql,'databases','master')])]);
 const s=A.create(io,H.token).inventory(cfg,[]);
 assert.equal(s.resources.length,13);assert.equal(s.resources.filter(r=>C.lower(r.id)===C.lower(db.id)).length,1);
 assert.ok(!JSON.stringify(s).includes('SECRET'));assert.deepEqual(s.completedSubscriptions,[H.sub]);
 assert.equal(s.resources.find(r=>r.id===fn.id).parentResourceId,app.id);
 assert.ok(io.calls.every(c=>c[0]==='GET'&&!/keys|listsecrets|config|invoke|\.scm\./i.test(c[1])));
 assert.ok(io.calls.some(c=>c[1].endsWith('/functions?api-version=2025-03-01')));
 assert.ok(io.calls.some(c=>c[1].endsWith('/databases?api-version=2023-08-01')));
});
test('duplicate children on the same endpoint pages abort even when present in generic inventory',()=>{
 const io=H.io([...initial([sb,queue]),H.page([queue,queue])]);assert.throws(()=>A.create(io,H.token).inventory(cfg,[]),/Duplicate resource/);
});
test('failed child collection never becomes an empty successful subscription',()=>{
 for(const response of [{status:403,body:{error:{code:'AuthorizationFailed'}}},notFound('ResourceNotFound'),H.ok({})]){
  const io=H.io([...initial([app]),response,notFound('ResourceNotFound')]);
  const s=A.create(io,H.token).inventory(cfg,[old(fn)]);assert.equal(s.partial,true);assert.deepEqual(s.confirmedMissing,[]);
  assert.ok(!C.plan([old(fn)],s,{}).operations.some(o=>o.elementId===old(fn).id));
 }
});
test('child pagination cannot move to a different collection under the same subscription',()=>{
 const io=H.io([...initial([sb]),H.page([],'https://management.azure.com'+sb.id+'/topics?next=1')]);
 assert.throws(()=>A.create(io,H.token).inventory(cfg,[]),/escaped its child collection/);assert.equal(io.calls.length,4);
});
test('child responses cannot escape the parent or substitute resource type',()=>{
 for(const raw of [{...queue,id:queue.id.replace('/bus/','/foreign/')},{...queue,type:topic.type},{...queue,id:queue.id.replace(H.sub,H.otherSub)}]){
  const io=H.io([...initial([sb]),H.page([raw])]);assert.throws(()=>A.create(io,H.token).inventory(cfg,[]),/escaped its parent|Unexpected child|disagrees/);
 }
});
test('Basic Service Bus collects queues without unsupported topics',()=>{
 const io=H.io([...initial([{...sb,sku:{tier:'Basic'}}]),H.page([queue])]);
 assert.ok(A.create(io,H.token).inventory(cfg,[]).resources.some(r=>r.id===queue.id));assert.equal(io.calls.length,4);
});
test('missing kind or SKU is resolved with parent metadata before child discovery',()=>{
 const io=H.io([...initial([{...app,kind:undefined},{...sb,sku:undefined}]),H.ok(app),H.page([fn]),H.ok({...sb,sku:{tier:'Basic'}}),H.page([queue])]);
 const s=A.create(io,H.token).inventory(cfg,[]);assert.ok(s.resources.some(r=>r.id===fn.id));assert.ok(s.resources.some(r=>r.id===queue.id));
});
test('unclassifiable metadata skips expansion but identity mismatch still aborts',()=>{
 for(const raw of [{...app,kind:undefined},{...app,id:app.id+'other'}]){
  const io=H.io([...initial([{...app,kind:undefined}]),H.ok(raw)]);
  if(raw.id!==app.id)assert.throws(()=>A.create(io,H.token).inventory(cfg,[]),/different resource/);
  else assert.match(A.create(io,H.token).inventory(cfg,[]).warnings[0].message,/kind is missing/);
 }
});
test('a parent recovered by individual GET is expanded before checking child absence',()=>{
 const provider=H.page([{namespace:'Microsoft.Web',resourceTypes:[{resourceType:'sites',apiVersions:['2025-03-01']}]}]);
 const io=H.io([...initial([]),provider,H.ok(app),H.page([fn])]);
 const s=A.create(io,H.token).inventory(cfg,[old(app),old(fn)]);assert.ok(s.resources.some(r=>r.id===fn.id));assert.equal(s.confirmedMissing.length,0);
});
test('missing child checks use its known API and can recover an existing Function without provider metadata',()=>{
 const io=H.io([...initial([app]),H.page([]),H.ok({...fn,properties:{config:'SECRET'}})]);
 const s=A.create(io,H.token).inventory(cfg,[old(fn)]);assert.equal(s.confirmedMissing.length,0);assert.ok(s.resources.some(r=>r.id===fn.id));
 assert.match(io.calls.at(-1)[1],/functions\/run\?api-version=2025-03-01$/);assert.ok(!JSON.stringify(s).includes('SECRET'));
});
test('known child not-found codes require completed parent collection coverage',()=>{
 for(const [parent,item,code,responses] of [[app,fn,'NotFound',[H.page([])]],[sb,queue,'MessagingEntityNotFound',[H.page([]),H.page([])]]]){
  const io=H.io([...initial([parent]),...responses,notFound(code)]);const s=A.create(io,H.token).inventory(cfg,[old(item)]);
  assert.deepEqual(s.confirmedMissing,[C.identity(H.tenant,item.id)]);
  const absent=H.io([...initial([]),notFound(code)]),partial=A.create(absent,H.token).inventory(cfg,[old(item)]);
  assert.equal(partial.partial,true);assert.deepEqual(partial.confirmedMissing,[]);assert.match(partial.warnings[0].message,/Ambiguous/);
 }
});
test('ambiguous child 404 or access loss does not permit soft deletion',()=>{
 for(const r of [notFound('NoRegisteredProviderFound'),{status:403,body:{}},notFound('UnknownError')]){
  const io=H.io([...initial([app]),H.page([]),r]),s=A.create(io,H.token).inventory(cfg,[old(fn)]);
  assert.equal(s.partial,true);assert.deepEqual(s.confirmedMissing,[]);assert.match(s.warnings[0].message,/Ambiguous|403/);
 }
});
test('service relations add namespace composition, Function serving and SQL server serving',()=>{
 const resources=[{id:'/subscriptions/'+H.sub,type:'Microsoft.Resources/subscriptions',name:'sub'},{...rg,type:'Microsoft.Resources/resourceGroups'},sb,queue,topic,app,fn,sql,db].map(r=>C.normalize(r,H.info,H.tenant));
 const mapping=C.mappings([[fn.type,'technology-function']]),plan=C.plan([],H.snapshot(resources),mapping),k=r=>C.identity(H.tenant,r.id);
 const find=(a,b)=>plan.relationships.pairs.filter(r=>r.source===k(a)&&r.target===k(b));
 assert.equal(plan.operations.find(o=>o.properties['Azure-ObjectId']===fn.id).base,'technology-function');
 assert.equal(plan.operations.find(o=>o.properties['Azure-ObjectId']===fn.id).properties['Azure-ParentObjectId'],app.id);
 assert.equal(find(sb,queue)[0].type,'composition-relationship');assert.equal(find(sb,topic)[0].type,'composition-relationship');
 assert.equal(find(app,fn)[0].type,'serving-relationship');assert.equal(find(sql,db)[0].type,'serving-relationship');
 assert.equal(find(rg,fn).length,0);assert.equal(find(rg,db)[0].type,'composition-relationship');assert.equal(plan.relationships.pairs.length,11);
 assert.ok(plan.relationships.pairs.every(r=>r.name===''));
});
test('Node mapping can use Function composition while a missing parent never gets fabricated',()=>{
 const resources=[app,fn].map(r=>C.normalize(r,H.info,H.tenant)),plan=C.plan([],H.snapshot(resources),{});
 assert.equal(plan.relationships.pairs.at(-1).type,'composition-relationship');
 assert.equal(C.serviceRelationships([resources[1]]).missingParents,1);
 assert.throws(()=>C.childParent(fn.type,fn.id.replace('/functions/','/keys/')),/disagrees/);
});
