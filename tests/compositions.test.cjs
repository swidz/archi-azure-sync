const test=require('node:test'),assert=require('node:assert/strict'),H=require('./helpers.cjs'),C=H.C;
const subscription=C.normalize({id:'/subscriptions/'+H.sub,type:'Microsoft.Resources/subscriptions',name:'Subscription'},H.info,H.tenant);
const group=C.normalize({id:H.resource.resourceGroupId,type:'Microsoft.Resources/resourceGroups',name:'rg-test'},H.info,H.tenant);
const key=r=>C.identity(r.tenantId,r.id);
test('composition direction is subscription to group and group to resource',()=>{
 const result=C.plan([],H.snapshot([H.resource,group,subscription]),H.mapping).compositions;
 assert.deepEqual(result,{pairs:[{source:key(group),target:key(H.resource)},{source:key(subscription),target:key(group)}],missingParents:0});
});
test('nested resources compose directly from their group; identities are case insensitive',()=>{
 const child={...H.resource,id:H.id+'/extensions/one',type:'Microsoft.Compute/virtualMachines/extensions',resourceGroupId:group.id.toUpperCase()};
 assert.deepEqual(C.compositions([subscription,{...group,id:group.id.toUpperCase()},H.resource,child]).pairs.at(-1),{source:key(group),target:key(child)});
});
test('Other is a folder only and missing parents are reported without invented nodes',()=>{
 const ungrouped=C.normalize({id:'/subscriptions/'+H.sub+'/providers/Microsoft.Resources/deployments/demo',type:'Microsoft.Resources/deployments',name:'demo'},H.info,H.tenant);
 assert.deepEqual(C.compositions([subscription,ungrouped]),{pairs:[],missingParents:0});
 assert.deepEqual(C.compositions([H.resource]),{pairs:[],missingParents:1});
});
test('same group name across subscriptions never joins different parents',()=>{
 const secondInfo={...H.info,subscriptionId:H.otherSub};
 const secondGroup=C.normalize({id:group.id.replace(H.sub,H.otherSub),type:group.type,name:group.name},secondInfo,H.tenant);
 assert.equal(C.compositions([secondGroup,H.resource]).pairs.length,0);
});
test('self composition is rejected',()=>{assert.throws(()=>C.compositions([{...H.resource,resourceGroupId:H.id}]),/compose itself/);});
test('appearance defaults and all positions translate to public jArchi constants',()=>{
 const defaults=C.settings();assert.equal(defaults.imagePositionValue,1);assert.equal(defaults.textPositionValue,2);assert.equal(defaults.textAlignmentValue,2);
 const names=['top-left','top-center','top-right','middle-left','middle-center','middle-right','bottom-left','bottom-center','bottom-right'];
 names.forEach((position,i)=>{const s=C.settings({imagePosition:position,textPosition:position});assert.equal(s.imagePositionValue,i);assert.equal(s.textPositionValue,Math.floor(i/3));assert.equal(s.textAlignmentValue,[1,2,4][i%3]);assert.deepEqual(C.settings(s),s);});
 assert.equal(C.settings({imagePosition:'fill'}).imagePositionValue,9);
 assert.throws(()=>C.settings({textPosition:'fill'}),/Invalid text position/);
 assert.throws(()=>C.settings({imagePosition:1}),/Invalid image position/);
});
