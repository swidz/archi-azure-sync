/* Microsoft Graph application inventory and tenant-scoped reconciliation. No credentials are persisted. */
var AzureEntra = (function () {
    "use strict";
    var C = typeof AzureCore !== "undefined" ? AzureCore : require("./core.js");
    var A = typeof AzureClient !== "undefined" ? AzureClient : require("./azure-client.js");
    var GRAPH = "https://graph.microsoft.com", COLLECTION = GRAPH + "/v1.0/applications";
    var SELECT = "id,appId,displayName";
    function identity(tenant, id) { return C.guid(tenant) + "|graph|applications|" + C.guid(id); }
    function normalize(raw) {
        C.assert(raw && (!raw["@odata.type"] || raw["@odata.type"] === "#microsoft.graph.application"), "Unexpected Entra object type.");
        C.assert(typeof raw.displayName === "string" && raw.displayName.trim(), "Entra application display name is missing.");
        return {id:C.guid(raw.id), appId:C.guid(raw.appId), displayName:raw.displayName};
    }
    function validateExisting(existing, tenant) {
        tenant = C.guid(tenant);
        var index = Object.create(null);
        existing.forEach(function (e) {
            var p = e.properties;
            if (!C.isEntraApplication(p["Azure-ObjectType"])) return;
            C.assert(p["Azure-TenantId"], "Entra application has no tenant ID.");
            if (C.lower(p["Azure-TenantId"]) !== tenant) return;
            var key = identity(tenant, p["Azure-ObjectId"]);
            C.assert(!index[key], "Duplicate Entra application Object ID in the model.");
            C.assert(!p["Azure-SubscriptionId"] && !p["Azure-ResourceGroupId"] && !p["Azure-ResourceGroupName"], "Entra applications must be tenant-scoped.");
            index[key] = e;
        });
        return index;
    }
    function errorCode(r) {
        var code = r.body && r.body.error && r.body.error.code;
        return /^[A-Za-z0-9_.-]{1,100}$/.test(code || "") ? code : "UnknownError";
    }
    function pageUrl(url) {
        C.assert(typeof url === "string" && url.indexOf(COLLECTION + "?") === 0 && !/[#\\\r\n]/.test(url), "Entra pagination escaped the applications collection.");
        var parameters = Object.create(null);
        url.slice(COLLECTION.length + 1).split("&").forEach(function (pair) {
            var n = pair.indexOf("="), name, value;
            C.assert(n > 0, "Malformed Graph pagination query.");
            try { name = decodeURIComponent(pair.slice(0,n)); value = decodeURIComponent(pair.slice(n+1)); }
            catch (ignored) { throw new Error("Malformed Graph pagination encoding."); }
            C.assert(["$select", "$top", "$skiptoken", "$skip"].indexOf(name) >= 0 && parameters[name] === undefined, "Unexpected Graph pagination query.");
            parameters[name] = value;
        });
        C.assert(parameters.$select === SELECT, "Graph pagination changed the selected fields.");
        ["$top","$skip"].forEach(function (key) {
            C.assert(parameters[key] === undefined || /^\d+$/.test(parameters[key]), "Invalid Graph page size or offset.");
        });
        return url;
    }
    function create(io, token, progress) {
        progress = progress || function () {};
        function get(url, allow404) {
            for (var attempt=0; attempt<5; attempt++) {
                C.assert(io.now() < token.expiresAt - 15000, "Microsoft Graph sign-in expired. Run Sync again.");
                var r;
                try { r = io.request("GET", url, {Authorization:"Bearer " + token.accessToken, Accept:"application/json"}); }
                catch (ignored) { throw new Error("Microsoft Graph request failed (network, timeout or TLS)."); }
                if (r.status === 200 || (allow404 && r.status === 404)) return r;
                if ((r.status === 429 || r.status >= 500) && attempt < 4) { io.sleep(A.retryDelay(r, attempt, io.now())); continue; }
                throw new Error("Read Entra applications: HTTP " + r.status + " (" + errorCode(r) + "). Check Microsoft Graph Application.Read.All permission and tenant-wide app read access; ARM Reader is insufficient.");
            }
        }
        function inventory(tenant, existing) {
            tenant = C.guid(tenant);
            C.assert(token.resource === "graph" && C.lower(token.tenantId) === tenant, "Microsoft Graph token does not match the selected tenant/audience.");
            var index = validateExisting(existing || [], tenant), seen = Object.create(null), visited = Object.create(null);
            var result = {tenantId:tenant, completed:false, applications:[], confirmedMissing:[], collectedAt:""};
            var url = COLLECTION + "?$select=" + SELECT + "&$top=999", page=0;
            function add(raw) {
                var app = normalize(raw), key = identity(tenant, app.id);
                C.assert(!seen[key], "Duplicate Entra application across inventory pages.");
                seen[key] = true; result.applications.push(app);
            }
            while (url) {
                pageUrl(url);
                C.assert(!visited[url] && page < 100000, "Repeated or excessive Microsoft Graph pagination.");
                visited[url] = true; page++;
                progress("Reading Entra app registrations, page " + page);
                var body = get(url).body;
                C.assert(body && Array.isArray(body.value), "Malformed Entra application page.");
                body.value.forEach(function (raw) {
                    // Graph /applications also returns agent blueprints; this collector imports app registrations only.
                    if (raw && raw["@odata.type"] === "#microsoft.graph.agentIdentityBlueprint") return;
                    add(raw);
                });
                var next = body["@odata.nextLink"];
                C.assert(next === undefined || next === null || (typeof next === "string" && next.length > 0), "Invalid Graph nextLink.");
                url = next || "";
            }
            Object.keys(index).forEach(function (key) {
                var old = index[key];
                if (seen[key] || old.properties["Azure-SyncManagedBy"] !== C.OWNER) return;
                var id = C.guid(old.properties["Azure-ObjectId"]);
                var r = get(COLLECTION + "/" + id + "?$select=" + SELECT, true);
                if (r.status === 200) {
                    C.assert(C.guid(r.body && r.body.id) === id, "Entra existence check returned another Object ID.");
                    add(r.body);
                } else {
                    C.assert(["Request_ResourceNotFound", "ResourceNotFound"].indexOf(errorCode(r)) >= 0, "Ambiguous Entra 404; no deletion will be applied.");
                    result.confirmedMissing.push(key);
                }
            });
            result.completed = true; result.collectedAt = new Date(io.now()).toISOString();
            return result;
        }
        return {inventory:inventory};
    }
    function plan(existing, snapshot, mapping, options, collectedAt) {
        C.assert(snapshot && snapshot.completed === true && Array.isArray(snapshot.applications) && Array.isArray(snapshot.confirmedMissing), "Incomplete Entra inventory: no model changes permitted.");
        var tenant = C.guid(snapshot.tenantId), index = validateExisting(existing, tenant), seen = Object.create(null);
        var clock = C.stamp(collectedAt || snapshot.collectedAt), opts = C.settings(options), rule = mapping[C.lower(C.ENTRA_APPLICATION_TYPE)];
        C.assert(!rule || rule.base === "node", "Entra app registrations must use Node in the mapping.");
        var operations = [], counts = {created:0,updated:0,restored:0,deleted:0,stillDeleted:0};
        snapshot.applications.forEach(function (raw) {
            var app = normalize(raw), key = identity(tenant, app.id), old = index[key];
            C.assert(!seen[key], "Duplicate Entra application identity in snapshot."); seen[key] = true;
            C.assert(!old || old.properties["Azure-SyncManagedBy"] === C.OWNER, "Existing Entra application is not owned by this synchronizer.");
            C.assert(!old || old.type === "node", "Existing Entra application must be a Node; change its type in Archi first.");
            var p = {"Azure-TenantId":tenant, "Azure-SubscriptionId":"", "Azure-SubscriptionName":"",
                "Azure-ObjectId":app.id, "Azure-ApplicationId":app.appId, "Azure-ObjectType":C.ENTRA_APPLICATION_TYPE,
                "Azure-ObjectName":app.displayName, "Azure-ResourceGroupId":"", "Azure-ResourceGroupName":"", "Azure-ParentObjectId":"",
                "Azure-URL":COLLECTION + "/" + app.id, "Azure-SyncManagedBy":C.OWNER, IsDeleted:"no",
                CreatedDate:old ? old.properties.CreatedDate : clock.date, CreatedTime:old ? old.properties.CreatedTime : clock.time,
                DeletedDate:"", DeletedTime:"", LastSyncDate:clock.date, LastSyncTime:clock.time};
            C.assert(p.CreatedDate && p.CreatedTime, "Managed Entra application has no repository creation timestamps.");
            var action = !old ? "created" : old.properties.IsDeleted === "yes" ? "restored" : "updated"; counts[action]++;
            operations.push({action:action,elementId:old && old.id,base:"node",name:app.displayName,properties:p,
                specialization:opts.useSpecializations && rule ? rule.name : null,icon:rule && rule.icon ? rule.icon : C.DEFAULT_ICON});
        });
        Object.keys(index).forEach(function (key) {
            var old = index[key], p = old.properties;
            if (seen[key] || p["Azure-SyncManagedBy"] !== C.OWNER) return;
            C.assert(snapshot.confirmedMissing.indexOf(key) >= 0, "Entra deletion was not independently confirmed.");
            var wasDeleted = p.IsDeleted === "yes", action = wasDeleted ? "stillDeleted" : "deleted"; counts[action]++;
            operations.push({action:action,elementId:old.id,properties:{IsDeleted:"yes",DeletedDate:wasDeleted?p.DeletedDate:clock.date,
                DeletedTime:wasDeleted?p.DeletedTime:clock.time,LastSyncDate:clock.date,LastSyncTime:clock.time}});
        });
        return {tenantId:tenant,clock:clock,operations:operations,counts:counts};
    }
    function merge(armPlan, entraPlan) {
        C.assert(armPlan.tenantId === entraPlan.tenantId && armPlan.clock.iso === entraPlan.clock.iso, "Entra and ARM sync scopes/timestamps disagree.");
        armPlan.operations = armPlan.operations.concat(entraPlan.operations);
        Object.keys(armPlan.counts).forEach(function (key) { armPlan.counts[key] += entraPlan.counts[key]; });
        armPlan.entraTenantId = entraPlan.tenantId;
        return armPlan;
    }
    return {create:create,plan:plan,merge:merge,identity:identity,validateExisting:validateExisting};
}());
if (typeof module !== "undefined") module.exports = AzureEntra;
