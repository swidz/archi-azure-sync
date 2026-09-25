const test=require("node:test"), assert=require("node:assert/strict");
const A=require("../lib/azure-client.js"), H=require("./helpers.cjs");
const cfg={tenantId:H.tenant,clientId:H.clientId,subscriptionIds:[H.sub]};
const device={device_code:"never-log-me",user_code:"ABCD-EFGH",verification_uri:"https://microsoft.com/devicelogin",expires_in:900,interval:5};
const providers=H.page([{namespace:"Microsoft.Compute",resourceTypes:[{resourceType:"virtualMachines",apiVersions:["2026-01-01-preview","2025-01-01"]}]}]);
test("device sign-in displays only browser URL and user code; honors pending and slowdown",()=>{
    const io=H.io([H.ok({...device}),{status:400,body:{error:"authorization_pending"}},{status:400,body:{error:"slow_down"}},H.ok({access_token:"test",expires_in:3600})]);
    const t=A.deviceLogin(io,cfg,d=>assert.deepEqual(d,{uri:device.verification_uri,code:device.user_code}));
    assert.equal(t.accessToken,"test");assert.deepEqual(io.sleeps,[5000,5000,10000]);
    assert.ok(!io.calls[0][3].includes("offline_access"));
});
test("sign-in cancel does not request tokens",()=>{
    const io=H.io([H.ok({...device})]);assert.throws(()=>A.deviceLogin(io,cfg,()=>false),/cancelled/);
    assert.equal(io.calls.length,1);
});
test("sign-in errors never include server descriptions or secrets",()=>{
    const io=H.io([H.ok({...device}),{status:400,body:{error:"authorization_declined",error_description:"SECRET"}}]);
    assert.throws(()=>A.deviceLogin(io,cfg,()=>true),e=>e.message.includes("authorization_declined")&&!e.message.includes("SECRET"));
});
test("sign-in expiry stops polling",()=>{
    const io=H.io([H.ok({...device,expires_in:1})]);
    assert.throws(()=>A.deviceLogin(io,cfg,()=>true),/expired/);assert.equal(io.calls.length,1);
});
test("inventory paginates and includes subscription/resource group containers",()=>{
    const next="https://management.azure.com/subscriptions/"+H.sub+"/resources?api-version=2021-04-01&$skiptoken=next";
    const rg={id:"/subscriptions/"+H.sub+"/resourceGroups/rg-test",name:"rg-test"};
    const io=H.io([H.ok(H.info),H.page([rg]),H.page([],next),H.page([H.raw])]);
    const s=A.create(io,H.token).inventory(cfg,[]);
    assert.equal(s.resources.length,3);assert.deepEqual(s.completedSubscriptions,[H.sub]);
    assert.equal(s.resources[1].type,"Microsoft.Resources/resourceGroups");
});
test("failed later page retains earlier objects and reports incomplete scope",()=>{
    const next="https://management.azure.com/subscriptions/"+H.sub+"/resources?next=1";
    const io=H.io([H.ok(H.info),H.page([]),H.page([H.raw],next),{status:403,body:{error:{code:"AuthorizationFailed"}}}]);
    const snap=A.create(io,H.token).inventory(cfg,[]);
    assert.equal(snap.resources.length,2);assert.equal(snap.partial,true);assert.deepEqual(snap.completedSubscriptions,[]);assert.match(snap.warnings[0].message,/403/);
});
test("foreign and cross-subscription nextLinks never receive tokens",()=>{
    for(const next of ["https://evil.example/steal","https://management.azure.com/subscriptions/"+H.otherSub+"/resources",
        "https://management.azure.com/subscriptions/"+H.sub+"/../other/resources",
        "https://management.azure.com/subscriptions/"+H.sub+"/%2e%2e/resources"]) {
        const io=H.io([H.page([],next)]);
        assert.throws(()=>A.create(io,H.token).pages("/subscriptions/"+H.sub+"/resources",H.sub),/escaped/);
        assert.equal(io.calls.length,1);
    }
});
test("repeated nextLink and malformed pages abort",()=>{
    const url="https://management.azure.com/subscriptions/"+H.sub+"/resources";
    const io=H.io([H.page([],url)]);
    assert.throws(()=>A.create(io,H.token).pages("/subscriptions/"+H.sub+"/resources",H.sub),/Repeated/);
    assert.throws(()=>A.create(H.io([H.ok({})]),H.token).pages("/subscriptions/"+H.sub+"/resources",H.sub),/Malformed/);
});
test("throttle retry follows Retry-After",()=>{
    const io=H.io([{status:429,body:{},headers:{"retry-after":"3"}},H.page([])]);
    A.create(io,H.token).pages("/subscriptions/"+H.sub+"/resources",H.sub);
    assert.deepEqual(io.sleeps,[3000]);
});
test("subscription tenant mismatch aborts",()=>{
    const io=H.io([H.ok({...H.info,tenantId:H.clientId})]);
    assert.throws(()=>A.create(io,H.token).inventory(cfg,[]),/different tenant/);
});
test("404 verifies missing resource with a supported stable API version",()=>{
    const io=H.io([H.ok(H.info),H.page([]),H.page([]),providers,{status:404,body:{error:{code:"ResourceNotFound"}}}]);
    const s=A.create(io,H.token).inventory(cfg,[H.existing()]);
    assert.deepEqual(s.confirmedMissing,[H.C.identity(H.tenant,H.id)]);
    assert.match(io.calls.at(-1)[1],/api-version=2025-01-01$/);
});
test("missing list entry that still exists is restored to inventory",()=>{
    const io=H.io([H.ok(H.info),H.page([]),H.page([]),providers,H.ok(H.raw)]);
    const s=A.create(io,H.token).inventory(cfg,[H.existing()]);
    assert.ok(s.resources.some(r=>r.id===H.id));assert.equal(s.confirmedMissing.length,0);
});
test("access loss and ambiguous 404 cannot mark deletion",()=>{
    for(const response of [{status:403,body:{error:{code:"AuthorizationFailed"}}},
        {status:404,body:{error:{code:"NoRegisteredProviderFound"}}}]) {
        const io=H.io([H.ok(H.info),H.page([]),H.page([]),providers,response]);
        const snap=A.create(io,H.token).inventory(cfg,[H.existing()]);assert.equal(snap.partial,true);
        assert.deepEqual(snap.confirmedMissing,[]);assert.match(snap.warnings[0].message,/403|Ambiguous/);
        assert.ok(!H.C.plan([H.existing()],snap,{}).operations.some(o=>o.elementId===H.existing().id));
    }
});
test("one failing subscription preserves the successful selected scope",()=>{
    const io=H.io([H.ok(H.info),H.page([]),H.page([]),{status:403,body:{}}]);
    const snap=A.create(io,H.token).inventory({...cfg,subscriptionIds:[H.sub,H.otherSub]},[]);
    assert.deepEqual(snap.completedSubscriptions,[H.sub]);assert.equal(snap.partial,true);assert.equal(snap.resources.length,1);
});
test("expired access token is not sent",()=>{
    const io=H.io([]);
    const snap=A.create(io,{...H.token,expiresAt:0}).inventory(cfg,[]);
    assert.equal(snap.partial,true);assert.match(snap.warnings[0].message,/expired/);
    assert.equal(io.calls.length,0);
});
test("provider discovery includes resource containers and deduplicates types",()=>{
    const io=H.io([providers]);
    assert.deepEqual(A.create(io,H.token).discover([H.sub]),["Microsoft.Compute/virtualMachines","Microsoft.Resources/resourceGroups","Microsoft.Resources/subscriptions"]);
});


test("Graph device sign-in requests only delegated Application.Read.All in the selected tenant",()=>{
 const io=H.io([H.ok({...device}),H.ok({access_token:'graph-token',expires_in:3600})]);
 const token=A.deviceLogin(io,cfg,()=>true,'graph');
 assert.equal(new URLSearchParams(io.calls[0][3]).get('scope'),'https://graph.microsoft.com/Application.Read.All');
 assert.ok(io.calls[0][1].includes('/'+H.tenant+'/'));assert.equal(token.resource,'graph');assert.equal(token.tenantId,H.tenant);
 assert.throws(()=>A.deviceLogin(H.io([]),cfg,()=>true,'bad'),/Unknown token resource/);
});
