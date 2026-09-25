const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const root = path.resolve(__dirname, ".."), C = require("../lib/core.js");
for (const dir of ["lib","scripts"]) {
    for (const f of fs.readdirSync(path.join(root,dir), {recursive:true})) {
        if (/\.(js|ajs)$/.test(f)) new vm.Script(fs.readFileSync(path.join(root,dir,f),"utf8"),{filename:f});
    }
}
const ctx = {};
vm.runInNewContext(fs.readFileSync(path.join(root,"config/specializations.js"),"utf8"),ctx);
const map = C.mappings(ctx.AZURE_SPECIALIZATIONS);
for (const rule of Object.values(map)) {
    if (rule.icon && !fs.existsSync(path.join(root,"assets/icons",rule.icon))) throw Error("Missing icon "+rule.icon);
}
console.log("Syntax and "+Object.keys(map).length+" type/icon mappings verified.");
