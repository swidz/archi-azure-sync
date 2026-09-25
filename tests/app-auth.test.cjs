const test=require("node:test"), assert=require("node:assert/strict"), fs=require("node:fs"), vm=require("node:vm");
const H=require("./helpers.cjs");
function app(method="azure-cli", overrides={}) {
    const props={"Azure-ClientId":H.clientId,...overrides}, prompts=[], calls=[], alerts=[];
    const context={
        AzureCore:H.C, console:{log(){}},
        model:{isSet:()=>true,prop:function(k,v){if(arguments.length===2)props[k]=v;return props[k];}},
        window:{
            promptSelection:(label,choices)=>{calls.push(["choices",...choices]);return method===null?null:
                choices.find(x=>x.startsWith(method==="azure-cli"?"Azure CLI":"Device"));},
            prompt:(label)=>{prompts.push(label);return /tenant/i.test(label)?H.tenant:/Subscription IDs/.test(label)?H.sub:H.clientId;},
            confirm:()=>true,alert:s=>alerts.push(s)
        },
        AzureJava:{io:{}},
        AzureCliJava:{createIo:()=>{calls.push(["cli-process"]);return {};}},
        AzureCli:{signIn:(io,cfg)=>{calls.push(["cli",cfg]);return {accessToken:"fake",expiresAt:9999999999999};}},
        AzureClient:{
            deviceLogin:(io,cfg)=>{calls.push(["device",cfg]);return {accessToken:"fake",expiresAt:9999999999999};},
            create:()=>({inventory:()=>H.snapshot()})
        },
        AzureArchi:{readElements:()=>[],prepareProfiles:()=>({}),applyProfiles:()=>{},
            apply:()=>calls.push(["applied"])}
    };
    vm.runInNewContext(fs.readFileSync(require.resolve("../lib/app.js"),"utf8"),context);
    context.AzureApp.run("sync","/repo",[]);
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
