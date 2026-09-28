/* Properties-only reconciliation for explicitly selected, already managed elements. */
var AzureRefresh = (function() {
    "use strict";
    var C = typeof AzureCore !== "undefined" ? AzureCore : require("./core.js");
    var E = typeof AzureEntra !== "undefined" ? AzureEntra : require("./entra-applications.js");
    function candidates(existing, cfg, options) {
        return existing.filter(function(e) {
            var p = e.properties;
            return p["Azure-SyncManagedBy"] === C.OWNER && C.lower(p["Azure-TenantId"]) === C.guid(cfg.tenantId) &&
                (C.isEntraApplication(p["Azure-ObjectType"]) ? options.includeEntraApplications : cfg.subscriptionIds.indexOf(C.lower(p["Azure-SubscriptionId"])) >= 0);
        });
    }
    function plan(existing, snapshot, options) {
        var opts = C.settings(Object.assign({}, options, {selectedTypes:null, enrichInfrastructure:true, useSpecializations:false})), ids = Object.create(null), found = Object.create(null);
        existing.forEach(function(e) { ids[e.id] = e; });
        snapshot.resources.forEach(function(r) { found[C.identity(snapshot.tenantId, r.id)] = true; });
        var armExisting = existing.filter(function(e) { return !C.isEntraApplication(e.properties["Azure-ObjectType"]) && found[C.identity(snapshot.tenantId, e.properties["Azure-ObjectId"])]; });
        var result = C.plan(armExisting, snapshot, {}, opts);
        if (snapshot.entraApplications) {
            var apps = Object.create(null);
            snapshot.entraApplications.applications.forEach(function(a) { apps[E.identity(snapshot.tenantId, a.id)] = true; });
            var graphExisting = existing.filter(function(e) { return C.isEntraApplication(e.properties["Azure-ObjectType"]) && apps[E.identity(snapshot.tenantId, e.properties["Azure-ObjectId"])]; });
            E.merge(result, E.plan(graphExisting, snapshot.entraApplications, {}, opts, snapshot.collectedAt));
        }
        var resources = Object.create(null);
        snapshot.resources.forEach(function(r) { resources[C.identity(snapshot.tenantId, r.id)] = r; });
        result.operations.forEach(function(op) {
            C.assert(op.elementId && ids[op.elementId] && (op.action === "updated" || op.action === "restored"), "Property refresh cannot create or delete elements.");
            var p = op.properties, r = !C.isEntraApplication(p["Azure-ObjectType"]) && resources[C.identity(snapshot.tenantId, p["Azure-ObjectId"])];
            if (r && r.refreshedMetadata) {
                var row = r.refreshedMetadata;
                Object.keys(row.properties).forEach(function(k) { p[k] = row.properties[k]; });
                p["Azure-EnrichmentSource"] = "Azure Resource Manager";
                p["Azure-EnrichmentCoverage"] = row.warnings.length ? "partial" : "complete";
                p["Azure-LastEnrichmentDate"] = result.clock.date; p["Azure-LastEnrichmentTime"] = result.clock.time;
                row.warnings.forEach(function(w) { result.warnings.push({scope:r.id, message:w}); });
            }
        });
        result.partial = result.partial || result.warnings.length > 0;
        result.skipped = existing.length - result.operations.length;
        return result;
    }
    return {candidates:candidates, plan:plan};
}());
if (typeof module !== "undefined") module.exports = AzureRefresh;
