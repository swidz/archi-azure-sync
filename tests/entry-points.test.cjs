
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path"),vm=require("node:vm");
const root=path.resolve(__dirname,"..");
for(const [file,mode] of [["Sync Azure.ajs","sync"],["utils/Apply Azure Appearance.ajs","appearance"],["utils/Export Azure Inventory.ajs","export"],["utils/Discover Azure Resource Types.ajs","catalog"],["utils/Manage Azure Specializations.ajs","specializations"]]) {
    test("entry point resolves the whole package: "+file,()=>{
        const script=path.join(root,"scripts",file),loaded=[],calls=[];
        function javaPath(p){return {getParent:()=>javaPath(path.dirname(p)),toAbsolutePath:()=>path.resolve(p)};}
        vm.runInNewContext(fs.readFileSync(script,"utf8"),{
            __DIR__:path.dirname(script),Java:{type:()=>({get:javaPath})},
            load:p=>{assert.ok(fs.existsSync(p),p);loaded.push(p);},AZURE_SPECIALIZATIONS:[],
            AzureApp:{run:(...args)=>calls.push(args)}
        });
        assert.equal(calls[0][0],mode);assert.equal(calls[0][1],root);assert.equal(loaded.length,8);
        if(mode==="sync"||mode==="specializations")assert.equal(calls[0][3].useSpecializations,false);
    });
}
