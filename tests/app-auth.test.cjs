const test=require("node:test"), assert=require("node:assert/strict"), fs=require("node:fs"), vm=require("node:vm");
const H=require("./helpers.cjs");
function app(method="azure-cli", overrides={}, options, mode="sync", confirm=true, graphError=false, scenario={}) {
    const props={"Azure-ClientId":H.clientId,...overrides}, prompts=[], calls=[], alerts=[],tokens=[],logs=[];
    function bearer(resource){const t={accessToken:"fake",expiresAt:9999999999999,resource:resource||"arm",tenantId:H.tenant};tokens.push(t);return t;}
    const context={
        AzureCore:H.C, console:{log:s=>logs.push(s)},
        model:{isSet:()=>true,prop:function(k,v){if(arguments.length===2)props[k]=v;return props[k];}},
        window:{
            promptSelection:(label,choices)=>{calls.push(["choices",...choices]);return method===null?null:
                choices.find(x=>x.startsWith(method==="azure-cli"?"Azure CLI":"Device"));},
            prompt:(label)=>{prompts.push(label);return /tenant/i.test(label)?H.tenant:/Subscription IDs/.test(label)?(scenario.subscriptions||H.sub):H.clientId;},
            confirm:()=>confirm,alert:s=>alerts.push(s),promptSaveFile:()=>"/snapshot.json"
        },
        AzureConnections:require("../lib/connections.js"), AzureInfrastructure:require("../lib/infrastructure.js"),
        AzureJava:{io:scenario.io || {now:()=>Date.parse(H.snapshot().collectedAt)},write:(file,text)=>calls.push(["exported",JSON.parse(text)])},
        AzureEntra:{...require("../lib/entra-applications.js"),create:(io,token,progress)=>({inventory:()=>{calls.push(["graph-inventory"]);if(graphError)return require("../lib/entra-applications.js").create(H.io([{status:403,body:{error:{code:"Authorization_RequestDenied"}}}]),token,progress).inventory(H.tenant,[]);return {tenantId:H.tenant,completed:true,collectedAt:H.snapshot().collectedAt,applications:[{id:H.clientId,appId:H.clientId,displayName:"Entra app"}],confirmedMissing:[]};}})},
        AzureCliJava:{createIo:()=>{calls.push(["cli-process"]);return {};}},
        AzureCli:{signIn:(io,cfg,resource)=>{calls.push(["cli",cfg,resource]);if(scenario.authFailure)scenario.authFailure(cfg,resource);return bearer(resource);}},
        AzureClient:{
            deviceLogin:(io,cfg,display,resource)=>{calls.push(["device",cfg,resource]);return bearer(resource);},
            create:()=>({...scenario.armClient,inventory:(cfg,existing,o)=>{if(scenario.onInventory)scenario.onInventory(o);return scenario.snapshot || H.snapshot();}})
        },
        AzureArchi:{prepareAppearance:()=>({count:2}),applyAppearance:(m,a,o)=>calls.push(["appearance",o]),readElements:()=>[],prepareImages:()=>{throw Error("Sync must not prepare images");},prepareProfiles:(m,map,root,remove,includeImages)=>{calls.push(["profiles-planned",includeImages]);return {};},applyProfiles:()=>calls.push(["profiles-applied"]),
            apply:(m,p,o)=>calls.push(["applied",o,p])}
    };
    vm.runInNewContext(fs.readFileSync(require.resolve("../lib/app.js"),"utf8"),context);
    context.AzureApp.run(mode,"/repo",[],options);
    return {props,prompts,calls,alerts,tokens,logs};
}
test("selecting CLI skips client ID prompt and preserves device client configuration",()=>{
    const r=app();assert.equal(r.alerts.length,1);assert.match(r.alerts[0],/complete/);
    assert.ok(r.calls.some(c=>c[0]==="cli"));assert.ok(!r.calls.some(c=>c[0]==="device"));
    assert.ok(!r.prompts.some(p=>p.includes("client")));assert.equal(r.props["Azure-ClientId"],H.clientId);
    assert.equal(r.props["Azure-AuthMethod"],"azure-cli");
});
test("device sign-in remains selectable and requires client ID",()=>{
    const r=app("device-code");assert.ok(r.calls.some(c=>c[0]==="device"));
    assert.ok(!r.calls.some(c=>c[0]==="cli-process"));assert.ok(r.prompts.some(p=>p.includes("client")));
    assert.equal(r.props["Azure-AuthMethod"],"device-code");
});
test("last successfully applied method is offered first",()=>{
    const r=app("device-code",{"Azure-AuthMethod":"azure-cli"});
    assert.match(r.calls[0][1],/^Azure CLI/);assert.equal(r.props["Azure-AuthMethod"],"device-code");
});
test("cancelling authentication selection causes no sign-in or model application",()=>{
    const r=app(null);assert.equal(r.prompts.length,0);assert.equal(r.calls.length,1);
    assert.ok(!r.props["Azure-AuthMethod"]);assert.match(r.alerts[0],/Cancelled/);
});

test("default sync never creates or prepares specializations",()=>{
    const r=app();assert.ok(r.calls.some(c=>c[0]==="applied"));
    assert.ok(!r.calls.some(c=>c[0].startsWith("profiles-")));
    assert.equal(r.calls.find(c=>c[0]==="applied")[1].rootFolderName,"Azure");
});
test("specializations remain explicitly opt-in",()=>{
    const r=app("azure-cli",{}, {useSpecializations:true,rootFolderName:"Cloud"});
    assert.ok(r.calls.some(c=>c[0]==="profiles-applied"));
    assert.equal(r.calls.find(c=>c[0]==="applied")[1].rootFolderName,"Cloud");
});
test("specialization utility is guarded when disabled",()=>{
    const r=app("azure-cli",{},undefined,"specializations");
    assert.equal(r.calls.length,0);assert.match(r.alerts[0],/disabled/);
});
test("cancelling preview does not apply folders, icons, configuration or profiles",()=>{
    const r=app("azure-cli",{},undefined,"sync",false);
    assert.ok(!r.calls.some(c=>c[0]==="applied"||c[0]==="profiles-applied"));
    assert.equal(r.props["Azure-AuthMethod"],undefined);
});

test("appearance is offline and preserves synchronization metadata",()=>{
    const overrides={"Azure-LastSuccessfulSyncAt":"old","Azure-ImagePosition":"bottom-right","Azure-TextPosition":"top-left"};
    const r=app("azure-cli",overrides,{imagePosition:"bottom-right",textPosition:"top-left"},"appearance");
    assert.equal(r.prompts.length,0);assert.equal(r.calls.length,1);assert.equal(r.calls[0][0],"appearance");
    assert.equal(r.calls[0][1].imagePositionValue,8);assert.equal(r.calls[0][1].textPositionValue,0);
    assert.equal(r.props["Azure-LastSuccessfulSyncAt"],"old");assert.equal(r.props["Azure-AuthMethod"],undefined);
});
test("cancelling appearance causes no mutation or authentication",()=>{
    const r=app("azure-cli",{},undefined,"appearance",false);assert.equal(r.calls.length,0);assert.equal(r.prompts.length,0);
});

test("sync never invokes diagram appearance and opt-in profiles exclude image import",()=>{
    const r=app("azure-cli",{}, {useSpecializations:true});
    assert.match(r.alerts[0],/synchronization complete/);
    assert.ok(!r.calls.some(c=>c[0]==="appearance"));
    assert.equal(r.calls.find(c=>c[0]==="profiles-planned")[1],false);
});
test("appearance uses its own options instead of old sync-owned settings",()=>{
    const r=app("azure-cli",{"Azure-ImagePosition":"bottom-right","Azure-TextPosition":"top-left"},undefined,"appearance");
    assert.equal(r.calls[0][1].imagePosition,"top-center");assert.equal(r.calls[0][1].textPosition,"bottom-center");
});


test('Entra sync signs in separately to Graph using either method and combines the plans',()=>{
 for(const method of ['azure-cli','device-code']){
  const r=app(method,{}, {includeEntraApplications:true});
  assert.ok(r.calls.some(c=>c[0]===(method==='azure-cli'?'cli':'device')&&c[2]==='graph'));
  const plan=r.calls.find(c=>c[0]==='applied')[2];assert.equal(plan.operations.length,2);assert.equal(plan.entraTenantId,H.tenant);
  assert.ok(r.tokens.length===2 && r.tokens.every(t=>t.accessToken===null));
 }
});
test('Graph permission failure applies ARM results and reports warnings without advancing Graph success',()=>{
 const r=app('azure-cli',{}, {includeEntraApplications:true,useSpecializations:true},'sync',true,true);
 const plan=r.calls.find(c=>c[0]==='applied')[2];assert.equal(plan.operations.length,1);assert.equal(plan.partial,true);assert.equal(plan.entraTenantId,undefined);
 assert.ok(r.calls.some(c=>c[0]==='profiles-applied'));assert.equal(r.props['Azure-AuthMethod'],'azure-cli');
 assert.match(r.alerts[0],/completed with warnings/);assert.ok(r.logs.some(s=>s.includes('[WARNING]')&&s.includes('403')));assert.ok(r.tokens.every(t=>t.accessToken===null));
});
test('Disabling Entra makes no Graph call; cancelling combined preview mutates no model',()=>{
 const excluded=app('azure-cli',{}, {includeEntraApplications:false});assert.ok(!excluded.calls.some(c=>c[0]==='graph-inventory'));
 const r=app('azure-cli',{}, {includeEntraApplications:true},'sync',false);assert.ok(!r.calls.some(c=>c[0]==='applied'));assert.ok(r.tokens.every(t=>t.accessToken===null));
});
test('Export includes separate tenant-scoped app inventory without model writes or tokens',()=>{
 const r=app('azure-cli',{}, {includeEntraApplications:true},'export');
 const snapshot=r.calls.find(c=>c[0]==='exported')[1];assert.equal(snapshot.schemaVersion,3);assert.equal(snapshot.entraApplications.applications.length,1);
 assert.ok(!JSON.stringify(snapshot).includes('fake'));assert.ok(!r.calls.some(c=>c[0]==='applied'));assert.ok(r.tokens.every(t=>t.accessToken===null));
});

test('Graph token acquisition or consent failure is nonfatal and still clears ARM credentials',()=>{
 const r=app('azure-cli',{}, {includeEntraApplications:true},'sync',true,false,{authFailure:(cfg,resource)=>{if(resource==='graph')throw H.C.readError('Consent is required');}});
 const p=r.calls.find(c=>c[0]==='applied')[2];assert.equal(p.partial,true);assert.equal(p.operations.length,1);assert.ok(r.logs.some(l=>l.includes('Consent is required')));assert.ok(r.tokens.every(t=>t.accessToken===null));
});
test('CLI auth tries later selected subscriptions when the first is unavailable',()=>{
 const r=app('azure-cli',{},undefined,'sync',true,false,{subscriptions:H.sub+','+H.otherSub,authFailure:cfg=>{if(cfg.subscriptionIds[0]===H.sub)throw H.C.readError('Unavailable subscription');}});
 assert.ok(r.calls.some(c=>c[0]==='cli'&&c[1].subscriptionIds[0]===H.otherSub));assert.ok(r.calls.some(c=>c[0]==='applied'));
});
test('ARM sign-in failure still allows the independent Entra inventory to apply',()=>{
 const r=app('azure-cli',{}, {includeEntraApplications:true},'sync',true,false,{authFailure:(cfg,resource)=>{if(resource!=='graph')throw H.C.readError('ARM access denied');}});
 const p=r.calls.find(c=>c[0]==='applied')[2];assert.equal(p.operations.length,1);assert.equal(p.operations[0].properties['Azure-ObjectType'],H.C.ENTRA_APPLICATION_TYPE);assert.equal(p.partial,true);
});
test('No readable data does not apply profiles, model metadata or configuration',()=>{
 const r=app('azure-cli',{}, {includeEntraApplications:true,useSpecializations:true},'sync',true,false,{authFailure:()=>{throw H.C.readError('No access');}});
 assert.ok(!r.calls.some(c=>c[0]==='applied'||c[0]==='profiles-applied'));assert.equal(r.props['Azure-AuthMethod'],undefined);assert.match(r.alerts[0],/No readable objects/);
});
test('Cancellation and integrity errors remain fatal and are printed to output',()=>{
 for(const message of ['Sign-in cancelled.','Tenant mismatch']){
  const r=app('azure-cli',{}, {includeEntraApplications:true},'sync',true,false,{authFailure:()=>{throw Error(message);}});
  assert.ok(!r.calls.some(c=>c[0]==='applied'));assert.ok(r.logs.some(l=>l.includes('[ERROR]')&&l.includes(message)));
 }
});
test('Partial export records warnings without model changes',()=>{
 const r=app('azure-cli',{}, {includeEntraApplications:true},'export',true,true),s=r.calls.find(c=>c[0]==='exported')[1];
 assert.equal(s.entraApplications.partial,true);assert.equal(s.entraApplications.completed,false);assert.equal(s.entraApplications.warnings.length,1);assert.ok(!r.calls.some(c=>c[0]==='applied'));
});

function connectionScenario(){
 const prefix='/subscriptions/'+H.sub+'/resourceGroups/rg-test',site={id:prefix+'/providers/Microsoft.Web/sites/site',type:'Microsoft.Web/sites',name:'site'},db={id:prefix+'/providers/Microsoft.Sql/servers/sql/databases/db',type:'Microsoft.Sql/servers/databases',name:'db'};
 return {snapshot:H.snapshot([site,db].map(r=>H.C.normalize(r,H.info,H.tenant))),io:H.io([H.ok({properties:{}}),H.ok({properties:{Database:{value:'Server=sql.database.windows.net;Database=db;Password=SECRET'}}})])};
}
test('Connection discovery integrates with Sync and Graph, sanitized evidence and preview cancellation',()=>{
 for(const confirmed of [true,false]){
  const scenario=connectionScenario(),r=app('azure-cli',{}, {discoverConnections:true,includeEntraApplications:true},'sync',confirmed,false,scenario);
  assert.equal(scenario.io.calls.length,2);assert.ok(r.tokens.every(t=>t.accessToken===null));
  if(confirmed){const p=r.calls.find(c=>c[0]==='applied')[2];assert.equal(p.connections.pairs.length,1);assert.ok(!JSON.stringify(p).includes('SECRET'));assert.equal(p.connections.pairs[0].type,'serving-relationship');}
  else assert.ok(!r.calls.some(c=>c[0]==='applied'));
 }
});
test('Connection reads are optional and configuration denial does not stop normal inventory',()=>{
 const scenario=connectionScenario(),off=app('azure-cli',{}, {discoverConnections:false},'sync',true,false,scenario);assert.equal(scenario.io.calls.length,0);assert.ok(off.calls.some(c=>c[0]==='applied'));
 const bad=connectionScenario();bad.io=H.io([{status:403,body:{}},{status:403,body:{}}]);const r=app('azure-cli',{}, {discoverConnections:true},'sync',true,false,bad);
 const p=r.calls.find(c=>c[0]==='applied')[2];assert.equal(p.partial,true);assert.equal(p.connections.pairs.length,0);assert.ok(r.logs.some(l=>l.includes('HTTP 403')));
});
test('Inventory export includes only sanitized connection evidence and coverage',()=>{
 const r=app('azure-cli',{}, {discoverConnections:true},'export',true,false,connectionScenario()),s=r.calls.find(c=>c[0]==='exported')[1];
 assert.equal(s.connections.records.length,1);assert.equal(s.connections.completedOwners.length,1);assert.ok(!JSON.stringify(s).includes('SECRET'));assert.ok(!r.calls.some(c=>c[0]==='applied'));
});
function infrastructureScenario(fail=false){
 let forwarded,queries=0,details=0;
 const resource={...H.resource,metadata:require('../lib/infrastructure.js').project({...H.raw,location:'westeurope',tags:{Environment:'Dev',Password:'SECRET'}},{enrichInfrastructure:true},false,false)};
 return {snapshot:H.snapshot([resource]),onInventory:o=>{forwarded=o;},armClient:{queryGraph:q=>{queries++;if(fail)throw H.C.readError('Graph denied');return {data:[{...H.raw,properties:{hardwareProfile:{vmSize:'Standard_D2s_v5'},osProfile:{adminPassword:'SECRET'}}}]};},details:()=>{details++;if(fail)throw H.C.readError('Details denied');return H.raw;}},state:()=>({forwarded,queries,details})};
}
test('infrastructure enrichment integrates with main sync and respects preview cancellation',()=>{
 for(const confirmed of [true,false]){
  const scenario=infrastructureScenario(),r=app('azure-cli',{}, {enrichInfrastructure:true,tagKeys:['Environment']},'sync',confirmed,false,scenario);
  assert.equal(scenario.state().forwarded.enrichInfrastructure,true);assert.deepEqual(Array.from(scenario.state().forwarded.tagKeys),['Environment']);assert.equal(scenario.state().queries,1);assert.equal(scenario.state().details,0);
  assert.ok(r.tokens.every(t=>t.accessToken===null));
  if(confirmed){const p=r.calls.find(c=>c[0]==='applied')[2];assert.equal(p.operations[0].properties['Azure-VMSize'],'Standard_D2s_v5');assert.equal(p.operations[0].properties['Azure-Location'],'westeurope');assert.ok(p.infrastructure);assert.ok(!JSON.stringify(p).includes('SECRET'));assert.ok(r.logs.some(l=>l.includes('Infrastructure enrichment:')));}
  else assert.ok(!r.calls.some(c=>c[0]==='applied'));
 }
});
test('enrichment denial leaves resource sync available and disabling performs no enrichment',()=>{
 const scenario=infrastructureScenario(true),r=app('azure-cli',{}, {enrichInfrastructure:true},'sync',true,false,scenario);
 const p=r.calls.find(c=>c[0]==='applied')[2];assert.equal(p.partial,true);assert.equal(p.counts.created,1);assert.equal(p.operations[0].properties['Azure-Location'],'westeurope');assert.ok(!p.operations[0].properties['Azure-VMSize']);
 const disabled=infrastructureScenario(),off=app('azure-cli',{}, {enrichInfrastructure:false},'sync',true,false,disabled);assert.equal(disabled.state().queries,0);assert.equal(off.calls.find(c=>c[0]==='applied')[2].infrastructure,undefined);
});
test('export includes projected enrichment and coverage without model mutation',()=>{
 const scenario=infrastructureScenario(),r=app('azure-cli',{}, {enrichInfrastructure:true},'export',true,false,scenario),s=r.calls.find(c=>c[0]==='exported')[1];
 assert.equal(s.infrastructure.version,1);assert.equal(s.infrastructure.metadata.length,1);assert.equal(s.status,'complete');assert.ok(!JSON.stringify(s).includes('SECRET'));assert.ok(!r.calls.some(c=>c[0]==='applied'));
});
