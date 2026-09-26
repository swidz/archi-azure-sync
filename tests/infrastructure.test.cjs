const test=require('node:test'),assert=require('node:assert/strict');
const H=require('./helpers.cjs'),C=H.C,A=require('../lib/azure-client.js'),I=require('../lib/infrastructure.js');
const options={enrichInfrastructure:true},prefix='/subscriptions/'+H.sub+'/resourceGroups/rg-test/providers/';
const raw=(type,name,properties={},extras={})=>({id:prefix+type+'/'+name,type,name,properties,...extras});
const vnet=raw('Microsoft.Network/virtualNetworks','vnet',{addressSpace:{addressPrefixes:['10.0.0.0/16']}});
const subnet={id:vnet.id+'/subnets/app',name:'app',type:'Microsoft.Network/virtualNetworks/subnets',properties:{addressPrefix:'10.0.1.0/24',networkSecurityGroup:{id:prefix+'Microsoft.Network/networkSecurityGroups/nsg'}}};
const nsg=raw('Microsoft.Network/networkSecurityGroups','nsg'),vm=raw('Microsoft.Compute/virtualMachines','vm',{hardwareProfile:{vmSize:'Standard_D2s_v5'},storageProfile:{osDisk:{osType:'Linux'}},osProfile:{adminPassword:'SECRET'}});
const pip=raw('Microsoft.Network/publicIPAddresses','pip',{ipAddress:'203.0.113.1'});
const nic=raw('Microsoft.Network/networkInterfaces','nic',{virtualMachine:{id:vm.id},networkSecurityGroup:{id:nsg.id},ipConfigurations:[{properties:{subnet:{id:subnet.id},publicIPAddress:{id:pip.id},privateIPAddress:'10.0.1.4'}}]});
const store=raw('Microsoft.Storage/storageAccounts','store',{minimumTlsVersion:'TLS1_2',allowBlobPublicAccess:false,keys:'SECRET'});
const pe=raw('Microsoft.Network/privateEndpoints','pe',{subnet:{id:subnet.id},networkInterfaces:[{id:nic.id}],privateLinkServiceConnections:[{properties:{privateLinkServiceId:store.id,privateLinkServiceConnectionState:{status:'Approved'}}}]});
const all=[vnet,subnet,nsg,vm,pip,nic,store,pe];
function snapshot(rows=all){return {...H.snapshot(rows.map(r=>({...C.normalize(r,H.info,H.tenant),metadata:I.project(r,options,false,false)}))),schemaVersion:3,partial:false,warnings:[]};}
function stub(rows=all,changes={}){
 const calls=[];return {calls,queryGraph:q=>{calls.push(['graph',q]);return changes.graph?changes.graph(q):{data:rows.filter(r=>r.type!==subnet.type),resultTruncated:'false'};},details:r=>{calls.push(['details',r.id]);return changes.details?changes.details(r):rows.find(x=>x.id===r.id);}};
}
function build(rows=all,changes={}){const s=snapshot(rows),client=stub(rows,changes);s.infrastructure=I.create(client,undefined,options).inventory(s);const p=C.plan([],s,{},options);I.plan(s,p,()=>true);return {s,p,client};}
function old(r){const op=C.plan([],snapshot([r]),{},options).operations[0];return {id:'old-'+r.name,type:op.base,name:op.name,properties:op.properties};}
const missing={status:404,body:{error:{code:'ResourceNotFound'}}};
function start(rows){return [H.ok(H.info),H.page([]),H.page(rows)];}

test('metadata and tag allowlists exclude credentials, arbitrary fields and unselected tags',()=>{
 const p=I.project({...vm,location:'westeurope',kind:'vm',sku:{name:'D2',tier:'Standard',capacity:2},zones:['2','1','1'],tags:{environment:'Dev',Owner:'Ops',Password:'SECRET',Arbitrary:'SECRET'}},options,true,true);
 assert.equal(p.properties['Azure-Location'],'westeurope');assert.equal(p.properties['Azure-VMSize'],'Standard_D2s_v5');assert.equal(p.properties['Azure-OSType'],'Linux');assert.equal(p.properties['Azure-Tag-Environment'],'Dev');assert.equal(p.properties['Azure-Tag-Owner'],'Ops');assert.equal(p.properties['Azure-Tag-Application'],'');assert.equal(p.properties['Azure-AvailabilityZones'],'["1","2"]');assert.equal(p.properties['Azure-SkuCapacity'],'2');assert.ok(!JSON.stringify(p).includes('SECRET'));
 const custom=I.project({...vm,tags:{Project:'X'}},{...options,tagKeys:['Project']},false,false);assert.equal(custom.properties['Azure-Tag-Project'],'X');assert.ok(!('Azure-Tag-Owner' in custom.properties));
});
test('missing fields are preserved, explicit null and absent selected tags can clear old values',()=>{
 assert.deepEqual(I.project(vm,options,false,false).properties,{});
 const p=I.project({...vm,location:null,tags:{}},options,false,false);assert.equal(p.properties['Azure-Location'],'');assert.equal(p.properties['Azure-Tag-Environment'],'');
 const ambiguous=I.project({...vm,tags:{Owner:'A',owner:'B'}},options,false,false);assert.ok(!('Azure-Tag-Owner' in ambiguous.properties));assert.equal(ambiguous.warnings.length,1);
});
test('settings reject duplicate or sensitive tag keys and invalid switches',()=>{
 for(const tagKeys of [['Secret'],['AccessKey'],['Owner','owner'],['a/b'],new Array(33).fill('a'),'Owner'])assert.throws(()=>C.settings({tagKeys}));
 assert.throws(()=>C.settings({enrichInfrastructure:'true'}));assert.equal(C.settings().enrichInfrastructure,false);assert.deepEqual(C.settings({tagKeys:[]}).tagKeys,[]);
});
test('service properties are selected by type and malformed values never leak raw blobs',()=>{
 const app=raw('Microsoft.Web/sites','app',{siteConfig:{linuxFxVersion:'DOTNET|8.0',minTlsVersion:'1.2',appSettings:'SECRET'},httpsOnly:true});
 assert.equal(I.project(app,options,true,true).properties['Azure-Runtime'],'DOTNET|8.0');
 assert.equal(I.project(store,options,true,true).properties['Azure-AllowBlobPublicAccess'],'false');
 const bad=I.project({...vm,location:{secret:'SECRET'},zones:['bad\nSECRET']},options,true,true);assert.equal(bad.warnings.length,2);assert.ok(!JSON.stringify(bad).includes('SECRET'));
 const sql=raw('Microsoft.Sql/servers','sql',{version:'12.0',administratorLoginPassword:'SECRET',minimalTlsVersion:'1.2'});
 assert.equal(I.project(sql,options,true,true).properties['Azure-MinimumTlsVersion'],'1.2');assert.ok(!JSON.stringify(I.project(sql,options,true,true)).includes('SECRET'));
});
test('NIC, subnet and private endpoint references preserve full ARM IDs and explicit direction',()=>{
 const refs=I.project(nic,options,true,true).references;
 assert.ok(refs.some(r=>r.source===vm.id&&r.target===nic.id));assert.ok(refs.some(r=>r.source===nic.id&&r.target===subnet.id));assert.ok(refs.some(r=>r.target===pip.id));assert.ok(refs.some(r=>r.target===nsg.id));
 assert.equal(I.project(subnet,options,true,true).references[0].target,nsg.id);assert.ok(I.project(pe,options,true,true).references.some(r=>r.target===store.id));assert.equal(I.project(pe,options,true,true).properties['Azure-PrivateLinkStatuses'],'["Approved"]');
});
test('malformed or unavailable network structures never count as complete reads',()=>{
 for(const r of [{...nic,properties:{}},{...subnet,properties:null},{...pe,properties:{subnet:{id:subnet.id}}},{...nic,properties:{ipConfigurations:[{}]}}])assert.equal(I.project(r,options,true,true).complete,false);
 const bad={...nic,properties:{ipConfigurations:[{properties:{subnet:{id:'https://foreign/SECRET'}}}]}};
 const p=I.project(bad,options,true,true);assert.equal(p.complete,false);assert.ok(!JSON.stringify(p).includes('SECRET'));assert.equal(p.references.length,0);
});
test('normal enrichment uses bulk properties but verifies network owners through ARM',()=>{
 const {s,p,client}=build();assert.equal(s.infrastructure.stats.graphPages,1);assert.equal(s.infrastructure.stats.detailReads,3);assert.equal(s.infrastructure.stats.subnets,1);
 assert.equal(p.infrastructure.pairs.length,8);assert.ok(p.infrastructure.pairs.every(r=>r.type==='association-relationship'));
 assert.equal(s.infrastructure.completedOwners.length,3);assert.equal(p.partial,false);
 assert.ok(p.relationships.pairs.some(r=>r.source===C.identity(H.tenant,vnet.id)&&r.target===C.identity(H.tenant,subnet.id)&&r.type==='composition-relationship'));
 assert.ok(client.calls.every(c=>c[0]==='graph'||[nic.id,subnet.id,pe.id].includes(c[1])));assert.ok(!JSON.stringify(s).includes('SECRET'));
});
test('current ARM common metadata overrides an older Resource Graph location or tag',()=>{
 const current={...vm,location:'new-region',tags:{Owner:'New'}};
 const {p}=build([current],{graph:()=>({data:[{...vm,location:'old-region',tags:{Owner:'Old'}}]})});
 assert.equal(p.operations[0].properties['Azure-Location'],'new-region');assert.equal(p.operations[0].properties['Azure-Tag-Owner'],'New');
 assert.equal(p.operations[0].properties['Azure-EnrichmentSource'],'Azure Resource Graph');
});
test('authoritative subnet collection can seed enrichment without a second subnet GET',()=>{
 const s=snapshot(),client=stub();s.resources.find(r=>r.id===subnet.id).infrastructure=I.project(subnet,options,true,true);
 s.infrastructure=I.create(client,undefined,options).inventory(s);assert.equal(s.infrastructure.stats.detailReads,2);assert.equal(s.infrastructure.completedOwners.length,3);
});
test('ARG pagination follows skip tokens and explicitly scopes each request',()=>{
 let n=0;const client=stub([vm,store],{graph:q=>++n===1?{data:[vm],$skipToken:'next',resultTruncated:'true'}:{data:[store],resultTruncated:false}}),s=snapshot([vm,store]);
 const r=I.create(client,undefined,options).inventory(s);assert.equal(r.stats.graphPages,2);assert.equal(r.stats.detailReads,0);assert.equal(client.calls[1][1].options.$skipToken,'next');assert.deepEqual(client.calls[0][1].subscriptions,[H.sub]);assert.equal(client.calls[0][1].options.allowPartialScopes,false);
});
test('missing ARG rows get individual ARM fallback without inventing or deleting resources',()=>{
 const {s,p}=build([vm],{graph:()=>({data:[]})});assert.equal(s.infrastructure.stats.detailReads,1);assert.equal(s.resources.length,1);assert.equal(p.counts.deleted,0);assert.equal(p.operations[0].properties['Azure-VMSize'],'Standard_D2s_v5');assert.equal(p.operations[0].properties['Azure-EnrichmentSource'],'Azure Resource Manager');
});
test('partial ARG pages retain readable metadata and allow other detail reads',()=>{
 let n=0;const {s,p}=build([vm,store],{graph:()=>{if(++n===1)return {data:[vm],$skipToken:'next'};throw C.readError('Permission denied');}});
 assert.equal(s.infrastructure.partial,true);assert.equal(s.infrastructure.metadata.length,2);assert.equal(p.counts.created,2);assert.equal(p.partial,true);assert.equal(s.partial,false);assert.deepEqual(s.completedSubscriptions,[H.sub]);
});
test('denied current network reads can add Graph references but never retire previous links',()=>{
 const {s,p}=build(all,{details:r=>{if(r.id===nic.id)throw C.readError('Denied current NIC');return all.find(x=>x.id===r.id);}});
 assert.equal(p.partial,true);assert.ok(!p.infrastructure.completedOwners.includes(C.identity(H.tenant,nic.id)));
 assert.ok(p.infrastructure.pairs.some(r=>r.source===C.identity(H.tenant,vm.id)&&r.target===C.identity(H.tenant,nic.id)));
 assert.ok(!s.infrastructure.completedOwners.includes(C.identity(H.tenant,nic.id)));
});
test('unresolved and wrong-type references preserve owner coverage and never create placeholder nodes',()=>{
 const rows=all.filter(r=>r.id!==pip.id);const {p}=build(rows);assert.ok(p.warnings.some(w=>/outside the selected readable/.test(w.message)));assert.ok(!p.infrastructure.completedOwners.includes(C.identity(H.tenant,nic.id)));assert.equal(p.counts.created,rows.length);
 const wrong={...pip,type:'Microsoft.Storage/storageAccounts'};const result=build(all.map(r=>r.id===pip.id?wrong:r));assert.ok(result.p.warnings.some(w=>/unexpected type/.test(w.message)));
});
test('relationships can cross selected subscriptions and stay excluded when the referenced scope is not selected',()=>{
 const external={...store,id:store.id.replace(H.sub,H.otherSub)},endpoint={...pe,properties:{...pe.properties,privateLinkServiceConnections:[{properties:{privateLinkServiceId:external.id}}]}};
 const s=snapshot([vnet,subnet,nsg,nic,vm,pip,endpoint]);s.subscriptionIds.push(H.otherSub);s.completedSubscriptions.push(H.otherSub);s.resources.push(C.normalize(external,{...H.info,subscriptionId:H.otherSub},H.tenant));
 const client=stub([vnet,subnet,nsg,nic,vm,pip,endpoint,external],{graph:q=>({data:[vnet,nsg,nic,vm,pip,endpoint,external].filter(r=>r.id.split('/')[2]===q.subscriptions[0])})});
 s.infrastructure=I.create(client,undefined,options).inventory(s);const p=C.plan([],s,{},options);I.plan(s,p,()=>true);assert.ok(p.infrastructure.pairs.some(r=>r.source===C.identity(H.tenant,endpoint.id)&&r.target===C.identity(H.tenant,external.id)));
});
test('invalid Archi associations are reported without marking an owner complete',()=>{
 const {s}=build();const p=C.plan([],s,{},options);I.plan(s,p,()=>false);assert.equal(p.infrastructure.pairs.length,0);assert.equal(p.infrastructure.completedOwners.length,0);assert.equal(p.partial,true);
});
test('ARG cross-scope identities, substituted types, duplicate pages and repeated tokens stay fatal',()=>{
 const cases=[()=>({data:[{...vm,id:vm.id.replace(H.sub,H.otherSub)}]}),()=>({data:[{...vm,tenantId:H.clientId}]}),()=>({data:[{...vm,type:store.type}]}),()=>({data:[vm,vm]}),()=>({data:[],$skipToken:'same'})];
 for(const graph of cases)assert.throws(()=>build([vm],{graph}),/scope|type disagrees|Duplicate|Repeated/);
});
test('malformed or truncated ARG responses warn and still attempt detailed reads',()=>{
 for(const response of [{data:'invalid'},{data:[vm],resultTruncated:'true'}]){
  const {s,p}=build([vm],{graph:()=>response});assert.equal(s.infrastructure.partial,true);assert.equal(p.counts.created,1);
 }
});
test('one denied Graph subscription does not block enrichment in another',()=>{
 const second={...store,id:store.id.replace(H.sub,H.otherSub)},s=snapshot([vm]);s.subscriptionIds.push(H.otherSub);s.completedSubscriptions.push(H.otherSub);s.resources.push(C.normalize(second,{...H.info,subscriptionId:H.otherSub},H.tenant));
 const client=stub([vm,second],{graph:q=>{if(q.subscriptions[0]===H.sub)throw C.readError('Denied');return {data:[second]};}});
 const result=I.create(client,undefined,options).inventory(s);assert.equal(result.metadata.length,2);assert.equal(result.partial,true);
});
test('subnet expansion uses paginated ARM lists and merges overlap with generic resources',()=>{
 const second={...subnet,id:subnet.id+'2',name:'app2'};const next='https://management.azure.com'+vnet.id+'/subnets?api-version=2025-09-01&next=2';
 const io=H.io([...start([vnet,subnet]),H.page([subnet],next),H.page([second])]);const s=A.create(io,H.token).inventory({tenantId:H.tenant,subscriptionIds:[H.sub]},[],options);
 assert.equal(s.resources.filter(r=>r.type===subnet.type).length,2);assert.ok(s.resources.find(r=>r.id===subnet.id).infrastructure.complete);assert.equal(s.partial,false);assert.ok(io.calls.every(c=>c[0]==='GET'));
});
test('denied subnet collection preserves prior subnet and never turns absence into deletion',()=>{
 const io=H.io([...start([vnet]),{status:403},missing]),e=old(subnet);const s=A.create(io,H.token).inventory({tenantId:H.tenant,subscriptionIds:[H.sub]},[e],options);
 assert.equal(s.partial,true);assert.deepEqual(s.confirmedMissing,[]);assert.ok(!C.plan([e],s,{},options).operations.some(op=>op.elementId===e.id));
});
test('subnet absence requires authoritative GET and known 404 before deletion',()=>{
 const e=old(subnet),io=H.io([...start([vnet]),H.page([]),missing]);const s=A.create(io,H.token).inventory({tenantId:H.tenant,subscriptionIds:[H.sub]},[e],options);
 assert.deepEqual(s.confirmedMissing,[C.identity(H.tenant,subnet.id)]);assert.ok(io.calls.at(-1)[1].endsWith('/subnets/app?api-version=2025-09-01'));assert.equal(C.plan([e],s,{},options).counts.deleted,1);
 const recovered=A.create(H.io([...start([vnet]),H.page([]),H.ok(subnet)]),H.token).inventory({tenantId:H.tenant,subscriptionIds:[H.sub]},[e],options);assert.ok(recovered.resources.find(r=>r.id===subnet.id).infrastructure.complete);assert.equal(C.plan([e],recovered,{},options).counts.updated,1);
});
test('disabled feature does not expand, verify, update or delete existing subnets',()=>{
 const e=old(subnet),io=H.io(start([vnet,subnet])),s=A.create(io,H.token).inventory({tenantId:H.tenant,subscriptionIds:[H.sub]},[e]);
 assert.equal(io.calls.length,3);assert.ok(!s.resources.some(r=>r.id===subnet.id));assert.ok(!C.plan([e],s,{}).operations.some(op=>op.elementId===e.id));
});
test('subnet pagination and child identity cannot escape the VNet',()=>{
 const other={...subnet,id:subnet.id.replace('/vnet/','/foreign/')};
 assert.throws(()=>A.create(H.io([...start([vnet]),H.page([other])]),H.token).inventory({tenantId:H.tenant,subscriptionIds:[H.sub]},[],options),/escaped/);
 assert.throws(()=>A.create(H.io([...start([vnet]),H.page([],'https://management.azure.com'+vnet.id+'/peerings?next=2')]),H.token).inventory({tenantId:H.tenant,subscriptionIds:[H.sub]},[],options),/escaped/);
});
test('ARG transport uses only the ARM endpoint, handles retry and suppresses response secrets',()=>{
 const io=H.io([{status:429,headers:{'retry-after':'1'}},H.ok({data:[]})]);const client=A.create(io,H.token);
 assert.deepEqual(client.queryGraph({subscriptions:[H.sub],query:'Resources'}),{data:[]});assert.equal(io.calls[0][0],'POST');assert.match(io.calls[0][1],/^https:\/\/management\.azure\.com\/providers\/Microsoft.ResourceGraph\/resources\?/);assert.equal(io.sleeps[0],1000);
 assert.throws(()=>A.create(H.io([{status:403,body:{error:{message:'SECRET'}}}]),H.token).queryGraph({subscriptions:[H.sub],query:'Resources'}),e=>e.azureReadFailure && !e.message.includes('SECRET'));
 assert.throws(()=>A.create(H.io([]),{...H.token,resource:'graph'}).queryGraph({subscriptions:[H.sub],query:'Resources'}),/ARM token/);
});
test('detail reads validate identities and subnet reads use a pinned API without provider discovery',()=>{
 const io=H.io([H.ok(subnet)]);assert.equal(A.create(io,H.token).details(subnet).id,subnet.id);assert.equal(io.calls.length,1);
 assert.throws(()=>A.create(H.io([H.ok({...subnet,id:subnet.id+'x'})]),H.token).details(subnet),/identity/);
});
test('Graph omission cannot bypass ARM deletion confirmation',()=>{
 const e=old(vm),s=snapshot([]);s.infrastructure={version:1,metadata:[],records:[],completedOwners:[],warnings:[],partial:false,stats:{}};
 assert.throws(()=>C.plan([e],s,{},options),/Deletion not independently confirmed/);
});
