/* Pure reconciliation logic. No Azure credentials or Archi dependencies. */
var AzureCore = (function () {
    "use strict";
    var OWNER = "archi-azure-sync/v1";
    var ENTRA_APPLICATION_TYPE = "Microsoft.Graph/applications";
    function isEntraApplication(type) { return lower(type) === lower(ENTRA_APPLICATION_TYPE); }
    var DEFAULT_ICON = "general/10001-icon-service-All-Resources.png";
    var GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    var TYPES = ["node", "device", "system-software", "technology-collaboration",
        "technology-interface", "path", "communication-network", "technology-function",
        "technology-process", "technology-interaction", "technology-event", "technology-service", "artifact"];
    // Explicit ARM child collections. These versions also support individual existence checks.
    var CHILD_TYPES = {
        "microsoft.servicebus/namespaces/queues": {type:"Microsoft.ServiceBus/namespaces/queues", parentType:"Microsoft.ServiceBus/namespaces", collection:"queues", apiVersion:"2024-01-01"},
        "microsoft.servicebus/namespaces/topics": {type:"Microsoft.ServiceBus/namespaces/topics", parentType:"Microsoft.ServiceBus/namespaces", collection:"topics", apiVersion:"2024-01-01"},
        "microsoft.web/sites/functions": {type:"Microsoft.Web/sites/functions", parentType:"Microsoft.Web/sites", collection:"functions", apiVersion:"2025-03-01"},
        "microsoft.sql/servers/databases": {type:"Microsoft.Sql/servers/databases", parentType:"Microsoft.Sql/servers", collection:"databases", apiVersion:"2023-08-01"}
    };
    function childSpec(type) { return CHILD_TYPES[lower(type)] || null; }
    function childParent(type, id) {
        var spec = childSpec(type);
        if (!spec) return "";
        var parts = armId(id).split("/");
        assert(parts.length >= 11 && parts.slice(1).every(function (p) { return p.length > 0; }) && lower(parts[3]) === "resourcegroups" &&
            lower(parts[5]) === "providers" && lower(parts[6] + "/" + parts[7]) === lower(spec.parentType) && lower(parts[9]) === spec.collection,
            "Child resource ID disagrees with its Azure type.");
        return parts.slice(0, 9).join("/");
    }
    var PROPS = ["Azure-TenantId", "Azure-SubscriptionId", "Azure-ObjectId", "Azure-ObjectType",
        "Azure-ResourceGroupId", "Azure-ResourceGroupName", "Azure-ObjectName", "Azure-URL",
        "Azure-SubscriptionName", "Azure-ParentObjectId", "Azure-ApplicationId", "CreatedDate", "CreatedTime", "DeletedDate", "DeletedTime",
        "LastSyncDate", "LastSyncTime", "IsDeleted", "Azure-SyncManagedBy"];

    function assert(ok, message) { if (!ok) throw new Error(message); }
    function lower(s) { return String(s || "").toLowerCase(); }
    function guid(s) {
        s = String(s || "").trim();
        assert(GUID.test(s), "Expected a GUID: " + s);
        return lower(s);
    }
    function subscriptions(text) {
        var items = String(text || "").split(/[\s,;]+/).filter(Boolean).map(guid);
        assert(items.length > 0, "Enter at least one subscription ID.");
        return Array.from(new Set(items));
    }
    function armId(id) {
        id = String(id || "").replace(/\/+$/, "");
        assert(/^\/subscriptions\/[0-9a-f-]{36}(?:\/|$)/i.test(id), "Invalid subscription resource ID: " + id);
        guid(id.split("/")[2]);
        assert(!/[?#\\\r\n]/.test(id) && id.indexOf("/../") < 0, "Invalid resource ID.");
        return id;
    }
    function identity(tenant, id) { return guid(tenant) + "|" + lower(armId(id)); }
    function stamp(iso) {
        var d = new Date(iso);
        assert(!isNaN(d.getTime()), "Invalid synchronization timestamp.");
        var s = d.toISOString();
        return {date: s.slice(0, 10), time: s.slice(11, 19) + "Z", iso: s};
    }
    function mappings(rows) {
        assert(Array.isArray(rows), "Specializations must be an array.");
        var result = Object.create(null);
        rows.forEach(function (row) {
            assert(Array.isArray(row) && row.length >= 2 && row.length <= 3, "Invalid specialization row.");
            var type = String(row[0]), base = String(row[1]), icon = String(row[2] || "");
            assert(/^[A-Za-z0-9.]+\/[A-Za-z0-9_./-]+$/.test(type), "Invalid Azure resource type: " + type);
            assert(TYPES.indexOf(base) >= 0, "Not a Technology-layer base type: " + base);
            assert(!result[lower(type)], "Duplicate resource type: " + type);
            assert(!icon || (!/^(?:\/|[A-Za-z]:)/.test(icon) && icon.split(/[\\/]/).indexOf("..") < 0),
                "Icon must be a relative path inside assets/icons.");
            result[lower(type)] = {azureType: type, base: base, icon: icon, name: "Azure: " + type};
        });
        return result;
    }
    function normalize(raw, sub, tenant) {
        var id = armId(raw.id), parts = id.split("/");
        assert(lower(parts[2]) === guid(sub.subscriptionId), "Resource returned outside the requested subscription.");
        assert(typeof raw.name === "string" && raw.name.length > 0, "Resource name missing: " + id);
        assert(typeof raw.type === "string" && raw.type.indexOf("/") > 0, "Resource type missing: " + id);
        var rg = lower(parts[3]) === "resourcegroups" ? parts[4] : "";
        return {id: id, type: raw.type, name: raw.name, tenantId: guid(tenant),
            subscriptionId: guid(sub.subscriptionId), subscriptionName: String(sub.displayName),
            resourceGroupName: rg || "", resourceGroupId: rg ? parts.slice(0, 5).join("/") : "",
            parentResourceId: childParent(raw.type, id), kind: typeof raw.kind === "string" ? raw.kind : "",
            skuTier: raw.sku && typeof (raw.sku.tier || raw.sku.name) === "string" ? (raw.sku.tier || raw.sku.name) : ""};
    }
    function validateExisting(existing, tenant, selected) {
        var index = Object.create(null);
        existing.forEach(function (e) {
            var p = e.properties;
            if (!p["Azure-ObjectId"] || isEntraApplication(p["Azure-ObjectType"])) return;
            // An unowned matching ID must never silently result in a duplicate.
            var tid = p["Azure-TenantId"] || tenant;
            if (lower(tid) !== lower(tenant)) return;
            var id = armId(p["Azure-ObjectId"]), sub = lower(id.split("/")[2]);
            if (selected.indexOf(sub) < 0) return;
            var key = identity(tid, id);
            assert(!index[key], "Duplicate Azure identity in the model: " + id);
            if (p["Azure-SyncManagedBy"] === OWNER) {
                assert(lower(p["Azure-SubscriptionId"]) === sub, "Stored subscription disagrees with resource ID: " + id);
                assert(p["Azure-TenantId"], "Managed element has no tenant: " + id);
                assert(p["Azure-ObjectType"], "Managed element has no resource type: " + id);
            }
            index[key] = e;
        });
        return index;
    }
    // Only acquisition failures are recoverable. Invalid scope, model conflicts and coding errors stay fatal.
    function readError(message) {
        var error = new Error(message); error.azureReadFailure = true; return error;
    }
    function attempt(warnings, scope, progress, action) {
        try { return {ok:true, value:action()}; }
        catch (error) {
            if (!error || error.azureReadFailure !== true) throw error;
            var warning = {scope:String(scope), message:String(error.message)};
            warnings.push(warning);
            (progress || function () {})("[WARNING] " + warning.scope.replace(/[\r\n\t]/g, " ") + ": " + warning.message + " Continuing; unverified objects will be preserved.");
            return {ok:false};
        }
    }
    function settings(options) {
        options = options || {};
        var root = options.rootFolderName === undefined ? "Azure" : options.rootFolderName;
        assert(typeof root === "string" && root.trim().length > 0 && !/[\r\n]/.test(root), "Azure root folder name must be non-empty text.");
        assert(options.useSpecializations === undefined || typeof options.useSpecializations === "boolean",
            "useSpecializations must be true or false.");
        assert(options.includeEntraApplications === undefined || typeof options.includeEntraApplications === "boolean", "includeEntraApplications must be true or false.");
        var positions = ["top-left", "top-center", "top-right", "middle-left", "middle-center", "middle-right",
            "bottom-left", "bottom-center", "bottom-right"];
        var image = options.imagePosition === undefined ? "top-center" : options.imagePosition;
        var label = options.textPosition === undefined ? "bottom-center" : options.textPosition;
        assert(typeof image === "string" && (positions.indexOf(image) >= 0 || image === "fill"), "Invalid image position: " + image);
        assert(typeof label === "string" && positions.indexOf(label) >= 0, "Invalid text position: " + label);
        var labelIndex = positions.indexOf(label);
        return {rootFolderName: root.trim(), useSpecializations: options.useSpecializations === true, includeEntraApplications: options.includeEntraApplications === true,
            imagePosition: image, textPosition: label, imagePositionValue: image === "fill" ? 9 : positions.indexOf(image),
            textPositionValue: Math.floor(labelIndex / 3), textAlignmentValue: [1, 2, 4][labelIndex % 3]};
    }
    // ARM containment only: subscription -> group, group -> every resource in the group.
    // Subscription-level resources have no group and deliberately receive no inferred parent link.
    function compositions(resources, baseTypes) {
        baseTypes = baseTypes || {};
        var available = Object.create(null), pairs = [], missingParents = 0;
        resources.forEach(function (r) { available[identity(r.tenantId, r.id)] = true; });
        resources.forEach(function (r) {
            var type = lower(r.type), parentId;
            // A Node cannot compose a Technology Function. Its Function App assignment provides the valid link.
            if (type === "microsoft.web/sites/functions" && baseTypes[identity(r.tenantId, r.id)] === "technology-function") return;
            if (type === "microsoft.resources/subscriptions") return;
            if (type === "microsoft.resources/resourcegroups") parentId = "/subscriptions/" + guid(r.subscriptionId);
            else parentId = r.resourceGroupId;
            if (!parentId) return;
            var source = identity(r.tenantId, parentId), target = identity(r.tenantId, r.id);
            assert(source !== target, "A resource cannot compose itself.");
            if (!available[source]) { missingParents++; return; }
            pairs.push({source: source, target: target});
        });
        return {pairs: pairs, missingParents: missingParents};
    }
    function serviceRelationships(resources, baseTypes) {
        var available = Object.create(null), pairs = [], missingParents = 0;
        baseTypes = baseTypes || {};
        resources.forEach(function (r) { available[identity(r.tenantId, r.id)] = r; });
        resources.forEach(function (r) {
            var spec = childSpec(r.type);
            if (!spec) return;
            var parent = childParent(r.type, r.id), source = identity(r.tenantId, parent), target = identity(r.tenantId, r.id);
            if (!available[source]) { missingParents++; return; }
            assert(lower(available[source].type) === lower(spec.parentType), "Child resource has an unexpected parent type.");
            var type = spec.collection === "databases" ? "serving-relationship" : "composition-relationship";
            if (spec.collection === "functions" && baseTypes[target] === "technology-function") type = "assignment-relationship";
            pairs.push({source:source, target:target, type:type, name:""});
        });
        return {pairs:pairs, missingParents:missingParents};
    }
    function plan(existing, snapshot, mapping, options) {
        var opts = settings(options);
        var tenant = guid(snapshot.tenantId);
        var selected = snapshot.subscriptionIds.map(guid);
        assert(selected.length > 0 && new Set(selected).size === selected.length, "Invalid subscription scope.");
        var partial = snapshot.schemaVersion === 3 && snapshot.partial === true && Array.isArray(snapshot.warnings) && snapshot.warnings.length > 0;
        assert(partial || selected.every(function (s) { return snapshot.completedSubscriptions.indexOf(s) >= 0; }),
            "Incomplete inventory: no model changes are permitted.");
        var clock = stamp(snapshot.collectedAt), index = validateExisting(existing, tenant, selected);
        var seen = Object.create(null), baseTypes = Object.create(null), operations = [], counts = {created: 0, updated: 0, restored: 0, deleted: 0, stillDeleted: 0};
        snapshot.resources.forEach(function (r) {
            var key = identity(r.tenantId, r.id);
            assert(lower(r.tenantId) === tenant && selected.indexOf(lower(r.subscriptionId)) >= 0,
                "Resource outside requested tenant/subscriptions.");
            assert(lower(armId(r.id).split("/")[2]) === lower(r.subscriptionId), "Resource scope mismatch.");
            assert(!seen[key], "Duplicate Azure ID in inventory: " + r.id);
            seen[key] = true;
            var old = index[key], rule = mapping[lower(r.type)];
            if (old) assert(old.properties["Azure-SyncManagedBy"] === OWNER,
                "Existing element is not owned by this synchronizer: " + r.id + ". See README adoption instructions.");
            var base = rule ? rule.base : (old ? old.type : "node");
            baseTypes[key] = base;
            if (old) assert(old.type === base, "Mapping changes the base type of " + r.id +
                ". Change the element type in Archi first; existing relationships are preserved.");
            var props = {
                "Azure-TenantId": tenant, "Azure-SubscriptionId": lower(r.subscriptionId),
                "Azure-ObjectId": r.id, "Azure-ObjectType": r.type,
                "Azure-ResourceGroupId": r.resourceGroupId, "Azure-ResourceGroupName": r.resourceGroupName,
                "Azure-ObjectName": r.name, "Azure-SubscriptionName": r.subscriptionName,
                "Azure-ParentObjectId": childParent(r.type, r.id), "Azure-ApplicationId":"",
                "Azure-URL": "https://portal.azure.com/#@" + tenant + "/resource" + r.id.split("/").map(encodeURIComponent).join("/"),
                "Azure-SyncManagedBy": OWNER, "IsDeleted": "no",
                "CreatedDate": old ? old.properties.CreatedDate : clock.date,
                "CreatedTime": old ? old.properties.CreatedTime : clock.time,
                "DeletedDate": "", "DeletedTime": "", "LastSyncDate": clock.date, "LastSyncTime": clock.time
            };
            assert(props.CreatedDate && props.CreatedTime,
                "Managed element has no repository creation timestamps: " + r.id);
            var action = !old ? "created" : old.properties.IsDeleted === "yes" ? "restored" : "updated";
            counts[action]++;
            operations.push({action: action, elementId: old && old.id, name: r.name, base: base,
                specialization: opts.useSpecializations && rule ? rule.name : null,
                icon: rule && rule.icon ? rule.icon : DEFAULT_ICON, properties: props});
        });
        Object.keys(index).forEach(function (key) {
            var old = index[key], p = old.properties;
            if (seen[key] || p["Azure-SyncManagedBy"] !== OWNER) return;
            // No deletion anywhere in a subscription with incomplete reads, even if an individual GET returned 404.
            if (partial && snapshot.completedSubscriptions.indexOf(lower(p["Azure-SubscriptionId"])) < 0) return;
            assert(snapshot.confirmedMissing.indexOf(key) >= 0,
                "Deletion not independently confirmed: " + p["Azure-ObjectId"]);
            var wasDeleted = p.IsDeleted === "yes";
            var action = wasDeleted ? "stillDeleted" : "deleted";
            counts[action]++;
            var rule = mapping[lower(p["Azure-ObjectType"])];
            operations.push({action: action, elementId: old.id,
                icon: rule && rule.icon ? rule.icon : DEFAULT_ICON, properties: {
                IsDeleted: "yes", DeletedDate: wasDeleted ? p.DeletedDate : clock.date,
                DeletedTime: wasDeleted ? p.DeletedTime : clock.time,
                LastSyncDate: clock.date, LastSyncTime: clock.time
            }});
        });
        var containment = compositions(snapshot.resources, baseTypes), services = serviceRelationships(snapshot.resources, baseTypes);
        return {operations: operations, counts: counts, clock: clock, tenantId: tenant, subscriptionIds: selected,
            partial: partial, completedSubscriptions: snapshot.completedSubscriptions.slice(), warnings: (snapshot.warnings || []).slice(),
            compositions: containment, relationships: {
                pairs: containment.pairs.map(function (p) { return {source:p.source, target:p.target, type:"composition-relationship", name:""}; }).concat(services.pairs),
                missingParents: containment.missingParents + services.missingParents
            }};
    }
    return {readError: readError, attempt: attempt, ENTRA_APPLICATION_TYPE: ENTRA_APPLICATION_TYPE, isEntraApplication: isEntraApplication, OWNER: OWNER, PROPS: PROPS, TYPES: TYPES, DEFAULT_ICON: DEFAULT_ICON, settings: settings, assert: assert, lower: lower, guid: guid,
        subscriptions: subscriptions, armId: armId, identity: identity, stamp: stamp,
        childSpec: childSpec, childParent: childParent, serviceRelationships: serviceRelationships,
        mappings: mappings, normalize: normalize, compositions: compositions, validateExisting: validateExisting, plan: plan};
}());
if (typeof module !== "undefined") module.exports = AzureCore;
