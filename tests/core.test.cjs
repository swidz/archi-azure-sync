const test=require("node:test"), assert=require("node:assert/strict");
const H=require("./helpers.cjs"), {C}=H;
test("create all requested properties and UTC repository timestamps",()=>{
    const op=C.plan([],H.snapshot(),H.mapping).operations[0];
    for(const key of C.PROPS) assert.ok(Object.hasOwn(op.properties,key),key);
    assert.equal(op.base,"node"); assert.equal(op.properties.CreatedTime,"10:20:30Z");
    assert.equal(op.properties["Azure-ObjectId"],H.id); assert.equal(op.properties.IsDeleted,"no");
});
test("repeat sync updates in place and preserves created time",()=>{
    const old=H.existing(), p=C.plan([old],H.snapshot([H.resource],"2026-10-01T01:02:03Z"),H.mapping);
    assert.equal(p.counts.created,0); assert.equal(p.operations[0].elementId,old.id);
    assert.equal(p.operations[0].properties.CreatedDate,"2026-09-25");
    assert.equal(p.operations[0].properties.LastSyncDate,"2026-10-01");
});
test("ARM identity matches case insensitively",()=>{
    const r={...H.resource,id:H.id.toUpperCase()};
    assert.equal(C.plan([H.existing()],H.snapshot([r]),H.mapping).counts.updated,1);
});
test("unmapped resources still import as Node",()=>{
    assert.equal(C.plan([],H.snapshot(),{}).operations[0].base,"node");
});
test("resource names are encoded in Azure URLs",()=>{
    const r={...H.resource,id:H.id+" space"};
    assert.match(C.plan([],H.snapshot([r]),{}).operations[0].properties["Azure-URL"],/vm-1%20space$/);
});
test("confirm a missing resource before soft-deleting it",()=>{
    const snap=H.snapshot([]); assert.throws(()=>C.plan([H.existing()],snap,{}),/not independently confirmed/);
    snap.confirmedMissing=[C.identity(H.tenant,H.id)];
    const op=C.plan([H.existing()],snap,{}).operations[0];
    assert.equal(op.action,"deleted"); assert.equal(op.properties.DeletedDate,"2026-09-25");
});
test("repeated absence preserves original deletion time",()=>{
    const old=H.existing(); Object.assign(old.properties,{IsDeleted:"yes",DeletedDate:"2026-09-01",DeletedTime:"02:03:04Z"});
    const snap=H.snapshot([]); snap.confirmedMissing=[C.identity(H.tenant,H.id)];
    assert.equal(C.plan([old],snap,{}).operations[0].properties.DeletedDate,"2026-09-01");
});
test("reappearance clears deletion and keeps creation dates",()=>{
    const old=H.existing(); Object.assign(old.properties,{IsDeleted:"yes",DeletedDate:"2026-09-25",DeletedTime:"10:20:30Z"});
    const op=C.plan([old],H.snapshot(),H.mapping).operations[0];
    assert.equal(op.action,"restored"); assert.equal(op.properties.DeletedDate,"");assert.equal(op.properties.IsDeleted,"no");
});
test("unselected subscriptions and tenants are untouched",()=>{
    const old=H.existing(); old.properties["Azure-SubscriptionId"]=H.otherSub;
    old.properties["Azure-ObjectId"]=H.id.replace(H.sub,H.otherSub);
    assert.equal(C.plan([old],H.snapshot([]),{}).operations.length,0);
    old.properties["Azure-TenantId"]=H.clientId;
    assert.equal(C.plan([old],H.snapshot([]),{}).operations.length,0);
});
test("partial inventory cannot produce a plan",()=>{
    const snap=H.snapshot();snap.completedSubscriptions=[];
    assert.throws(()=>C.plan([H.existing()],snap,H.mapping),/Incomplete inventory/);
});
test("duplicate inventory and duplicate model IDs fail",()=>{
    assert.throws(()=>C.plan([],H.snapshot([H.resource,H.resource]),{}),/Duplicate Azure ID/);
    assert.throws(()=>C.plan([H.existing(),H.existing()],H.snapshot(),{}),/Duplicate Azure identity/);
});
test("unowned collision must be explicitly adopted",()=>{
    const old=H.existing();delete old.properties["Azure-SyncManagedBy"];
    assert.throws(()=>C.plan([old],H.snapshot(),{}),/not owned/);
    assert.equal(C.plan([old],H.snapshot([]),{}).operations.length,0);
});
test("inconsistent resource scope is rejected",()=>{
    const old=H.existing();old.properties["Azure-SubscriptionId"]=H.otherSub;
    assert.throws(()=>C.plan([old],H.snapshot(),{}),/disagrees/);
    assert.throws(()=>C.normalize({...H.raw,id:H.id.replace(H.sub,H.otherSub)},H.info,H.tenant),/outside/);
});
test("changing base type cannot silently replace existing elements",()=>{
    const map=C.mappings([[H.raw.type,"technology-service"]]);
    assert.throws(()=>C.plan([H.existing()],H.snapshot(),map),/base type/);
});
test("subscription list parses separators and rejects URL injection",()=>{
    assert.deepEqual(C.subscriptions(H.sub+"; "+H.otherSub+"\n"+H.sub),[H.sub,H.otherSub]);
    assert.throws(()=>C.subscriptions(""),/at least one/);
    assert.throws(()=>C.subscriptions(H.sub+"?x=1"),/GUID/);
});
test("mappings reject duplicates, nontechnology bases and path traversal",()=>{
    assert.throws(()=>C.mappings([[H.raw.type,"node"],[H.raw.type.toLowerCase(),"node"]]),/Duplicate/);
    assert.throws(()=>C.mappings([[H.raw.type,"application-component"]]),/Technology/);
    assert.throws(()=>C.mappings([[H.raw.type,"node","../secret"]]),/relative path/);
});
