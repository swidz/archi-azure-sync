// Usage: node tools/build-catalog.cjs <bicep generated/index.json> <source-commit>
// Writes config/specializations.generated.js: never overwrites the user's commented/editable catalog.
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const root = path.resolve(__dirname, "..");
const raw = fs.readFileSync(process.argv[2]);
const input = JSON.parse(raw);
if (!input.resources || typeof input.resources !== "object") throw Error("Expected a Bicep resource type index");
const dedupe = new Map();
for (const entry of Object.keys(input.resources)) {
    const type = entry.slice(0, entry.lastIndexOf("@"));
    if (type) dedupe.set(type.toLowerCase(), type);
}
for (const type of ["Microsoft.Resources/subscriptions", "Microsoft.Resources/resourceGroups"]) dedupe.set(type.toLowerCase(), type);
const types = [...dedupe.values()].sort((a,b) => a.toLowerCase().localeCompare(b.toLowerCase()));
const rules = JSON.parse(fs.readFileSync(path.join(root, "config/icon-rules.json"), "utf8"));
const exact = Object.fromEntries(Object.entries(rules.exact).map(([k,v]) => [k.toLowerCase(),v]));
const ns = Object.fromEntries(Object.entries(rules.namespace).map(([k,v]) => [k.toLowerCase(),v]));
const icons = [];
function walk(dir) {
    for (const e of fs.readdirSync(dir, {withFileTypes:true})) {
        const file = path.join(dir, e.name);
        if (e.isDirectory()) walk(file);
        else if (e.name.endsWith(".png")) icons.push(path.relative(path.join(root, "assets/icons"), file).split(path.sep).join("/"));
    }
}
walk(path.join(root, "assets/icons"));
icons.sort();
const byName = new Map();
for (const icon of icons) {
    const name = path.posix.basename(icon);
    if (!byName.has(name)) byName.set(name, icon); // some official files occur in more than one category
}
const counts = {exact:0, providerFamily:0, generic:0};
function icon(type) {
    const lower = type.toLowerCase(), namespace = lower.split("/")[0];
    // Child types may use the nearest explicitly mapped parent's service icon.
    let parent = lower, match;
    while (parent.includes("/") && !match) {
        match = exact[parent]; parent = parent.slice(0, parent.lastIndexOf("/"));
    }
    let name;
    if (match) { counts.exact++; name = match; }
    else if (ns[namespace]) { counts.providerFamily++; name = ns[namespace]; }
    else { counts.generic++; name = rules.fallback; }
    if (!byName.has(name)) throw Error("Icon not found: " + name);
    return byName.get(name);
}
const rows = types.map(t => [t, "node", icon(t)]);
const header = "// Azure ARM resource types from Microsoft's Bicep index (API versions collapsed).\n" +
    "// Comment out a WHOLE row to disable that specialization. Sync still imports the resource as Node.\n" +
    "// Columns: [ARM type, Archi Technology base type, relative PNG icon path].\n" +
    "// Re-run Manage Azure Specializations.ajs to reconcile additions/removals. See docs/catalog.md.\n";
fs.writeFileSync(path.join(root,"config/specializations.generated.js"), header+"var AZURE_SPECIALIZATIONS = [\n"+
    rows.map(r=>"    "+JSON.stringify(r)+",").join("\n")+"\n];\n");
fs.writeFileSync(path.join(root,"assets/icon-index.json"),JSON.stringify(icons,null,2)+"\n");
const provenance = {
    retrievedAt: new Date().toISOString(), sourceRepository:"https://github.com/Azure/bicep-types-az",
    sourceCommit:process.argv[3] || "not supplied",
    sourcePath:"generated/index.json", sourceSha256:crypto.createHash("sha256").update(raw).digest("hex"),
    resourceTypeCount:rows.length, namespaceCount:new Set(types.map(t=>t.split("/")[0])).size,
    iconCount:icons.length, iconMappingCounts:counts,
    scope:"Public Bicep schema snapshot plus subscription/resource-group containers; not every possible private/preview/data-plane type."
};
fs.writeFileSync(path.join(root,"config/catalog-provenance.json"),JSON.stringify(provenance,null,2)+"\n");
console.log(JSON.stringify(provenance,null,2));
