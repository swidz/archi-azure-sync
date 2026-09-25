const C = require("../lib/core.js");
const tenant = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const sub = "11111111-1111-1111-1111-111111111111";
const otherSub = "22222222-2222-2222-2222-222222222222";
const clientId = "cccccccc-cccc-cccc-cccc-cccccccccccc";
const id = "/subscriptions/" + sub + "/resourceGroups/rg-test/providers/Microsoft.Compute/virtualMachines/vm-1";
const raw = {id, type:"Microsoft.Compute/virtualMachines", name:"vm-1"};
const info = {subscriptionId:sub, displayName:"Test subscription", tenantId:tenant, state:"Enabled"};
const resource = C.normalize(raw, info, tenant);
const mapping = C.mappings([[raw.type,"node",""]]);
function snapshot(resources = [resource], at = "2026-09-25T10:20:30.000Z") {
    return {schemaVersion:1,tenantId:tenant,subscriptionIds:[sub],completedSubscriptions:[sub],
        collectedAt:at,resources,confirmedMissing:[]};
}
function existing() {
    const op = C.plan([], snapshot(), mapping).operations[0];
    return {id:"archi-id-1",type:op.base,name:op.name,properties:{...op.properties}};
}
function io(responses) {
    let time = Date.parse("2026-09-25T10:20:30Z");
    const calls=[], sleeps=[], queue=[...responses];
    return {calls,sleeps,now:()=>time,sleep:ms=>{sleeps.push(ms);time+=ms;},
        request:(...args)=>{calls.push(args);if(!queue.length)throw Error("Unexpected HTTP call");return queue.shift();}};
}
const ok = body => ({status:200,body});
const page = (value,nextLink) => ok({value,...(nextLink?{nextLink}:{})});
const token = {accessToken:"fake-token-for-tests",expiresAt:Date.parse("2026-09-26T00:00:00Z")};
module.exports = {C,tenant,sub,otherSub,clientId,id,raw,info,resource,mapping,snapshot,existing,io,ok,page,token};
