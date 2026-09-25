const test = require("node:test"), assert = require("node:assert/strict");
const A = require("../lib/azure-cli.js"), H = require("./helpers.cjs");
const config = {tenantId:H.tenant, subscriptionIds:[H.sub,H.otherSub]};
const account = {id:H.sub,tenantId:H.tenant,environmentName:"AzureCloud",state:"Enabled",user:{type:"user"}};
const bearer = {tenant:H.tenant,subscription:H.sub,tokenType:"Bearer",accessToken:"synthetic-test-token",
    expires_on:Date.parse("2026-09-25T11:20:30Z")/1000,expiresOn:"ambiguous local datetime"};
function io(values=[account,bearer]) {
    const queue=[...values], calls=[];
    return {calls,now:()=>Date.parse("2026-09-25T10:20:30Z"),run:args=>{
        calls.push(args); const value=queue.shift();
        return value && Object.hasOwn(value,"exitCode") ? value : {exitCode:0,stdout:JSON.stringify(value)};
    }};
}
test("CLI uses selected subscription, ARM audience and UTC token expiry without client ID",()=>{
    const fake=io(), token=A.signIn(fake,config);
    assert.equal(token.accessToken,bearer.accessToken);assert.equal(token.expiresAt,bearer.expires_on*1000);
    assert.deepEqual(fake.calls[0],["account","show","--subscription",H.sub,"--output","json","--only-show-errors"]);
    assert.deepEqual(fake.calls[1],["account","get-access-token","--subscription",H.sub,"--resource",
        "https://management.azure.com/","--output","json","--only-show-errors"]);
});
test("CLI account tenant and subscription mismatch cannot produce a token",()=>{
    for(const bad of [{tenantId:H.clientId},{id:H.otherSub}]) {
        const fake=io([{...account,...bad}]);
        assert.throws(()=>A.signIn(fake,config),/does not match/);assert.equal(fake.calls.length,1);
    }
});
test("CLI rejects sovereign cloud, disabled subscription and workload sessions",()=>{
    for(const bad of [{environmentName:"AzureUSGovernment"},{state:"Disabled"},{user:{type:"servicePrincipal"}}])
        assert.throws(()=>A.signIn(io([{...account,...bad}]),config),/AzureCloud|not enabled|interactive user/);
});
test("CLI token tenant, subscription, token type and token content are checked",()=>{
    for(const bad of [{tenant:H.clientId},{subscription:H.otherSub},{tokenType:"Other"},{accessToken:""}])
        assert.throws(()=>A.signIn(io([account,{...bearer,...bad}]),config),/metadata|bearer token/);
});
test("CLI refuses local expiry strings and requires modern expires_on",()=>{
    const old={...bearer};delete old.expires_on;
    assert.throws(()=>A.signIn(io([account,old]),config),/2.54/);
    assert.throws(()=>A.signIn(io([account,{...bearer,expires_on:"not a number"}]),config),/expires_on/);
});
test("CLI rejects expired and nearly expired tokens",()=>{
    for(const seconds of [0,Date.parse("2026-09-25T10:20:50Z")/1000])
        assert.throws(()=>A.signIn(io([account,{...bearer,expires_on:seconds}]),config),/expired|expiry/);
});
test("CLI failures and malformed JSON never expose output or tokens",()=>{
    for(const response of [{exitCode:1,stdout:"SECRET"}, {exitCode:0,stdout:"SECRET"}])
        assert.throws(()=>A.signIn(io([response]),config),e=>!e.message.includes("SECRET"));
    assert.throws(()=>A.signIn({now:Date.now,run:()=>{throw Error("SECRET");}},config),e=>!e.message.includes("SECRET"));
});
test("CLI commands contain no passwords, raw shell arguments or implicit global account switching",()=>{
    const fake=io();A.signIn(fake,config);
    assert.ok(fake.calls.every(a=>!a.includes("login")&&!a.includes("set")&&!a.includes("--password")));
    assert.throws(()=>A.signIn(io(),{...config,subscriptionIds:[H.sub+" & echo injected"]}),/GUID/);
});
test("native POSIX executable paths are passed as single arguments without a shell",()=>{
    assert.deepEqual(A.command("/opt/a folder/az",["account","show"],false),
        ["/opt/a folder/az","account","show"]);
});
test("Windows batch launcher quotes spaces and parentheses",()=>{
    const command=A.command("C:\\Program Files (x86)\\Azure\\az.cmd",["account","show"],true,"C:\\Windows\\System32\\cmd.exe");
    assert.deepEqual(command.slice(0,5),["C:\\Windows\\System32\\cmd.exe","/d","/s","/v:off","/c"]);
    assert.equal(command[5],'""C:\\Program Files (x86)\\Azure\\az.cmd" account show"');
});
test("shell metacharacters and relative executable paths are rejected",()=>{
    for(const path of ["az.cmd","C:\\bad%PATH%\\az.cmd","C:\\bad&name\\az.cmd",'C:\\bad"\\az.cmd'])
        assert.throws(()=>A.command(path,["account"],true,"C:\\Windows\\System32\\cmd.exe"));
    for(const arg of ["hi&echo","$(echo)","space argument","a\nb"])
        assert.throws(()=>A.command("/usr/bin/az",[arg],false),/arguments/);
    assert.throws(()=>A.command("az",["account"],false),/absolute/);
});
