const test=require("node:test"), assert=require("node:assert/strict"), fs=require("node:fs"), vm=require("node:vm");
const H=require("./helpers.cjs");
function app(method="azure-cli", overrides={}, options, mode="sync", confirm=true) {
    const props={"Azure-ClientId":H.clientId,...overrides}, prompts=[], calls=[], alerts=[];
    const context={
        AzureCore:H.C, console:{log(){}},
        model:{isSet:()=>true,prop:function(k,v){if(arguments.length===2)props[k]=v;return props[k];}},
        window:{
            promptSelection:(label,choices)=>{calls.push(["choices",...choices]);return method===null?null:
                choices.find(x=>x.startsWith(method==="azure-cli"?"Azure CLI":"Device"));},
            prompt:(label)=>{prompts.push(label);return /tenant/i.test(label)?H.tenant:/Subscription IDs/.test(label)?H.sub:H.clientId;},
            confirm:()=>confirm,alert:s=>alerts.push(s)
        },
        AzureJava:{io:{}},
        AzureCliJava:{createIo:()=>{calls.push(["cli-process"]);return {};}},
        AzureCli:{signIn:(io,cfg)=>{calls.push(["cli",cfg]);return {accessToken:"fake",expiresAt:9999999999999};}},
        AzureClient:{
            deviceLogin:(io,cfg)=>{calls.push(["device",cfg]);return {accessToken:"fake",expiresAt:9999999999999};},
            create:()=>({inventory:()=>H.snapshot()})
        },
        AzureArchi:{prepareAppearance:()=>({count:2}),applyAppearance:(m,a,o)=>calls.push(["appearance",o]),readElements:()=>[],prepareImages:()=>{throw Error("Sync must not prepare images");},prepareProfiles:(m,map,root,remove,includeImages)=>{calls.push(["profiles-planned",includeImages]);return {};},applyProfiles:()=>calls.push(["profiles-applied"]),
            apply:(m,p,o)=>calls.push(["applied",o])}
    };
    vm.runInNewContext(fs.readFileSync(require.resolve("../lib/app.js"),"utf8"),context);
    context.AzureApp.run(mode,"/repo",[],options);
    return {props,prompts,calls,alerts};
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
