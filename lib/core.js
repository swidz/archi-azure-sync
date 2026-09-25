/* Pure reconciliation logic. No Azure credentials or Archi dependencies. */
var AzureCore = (function () {
    "use strict";
    var OWNER = "archi-azure-sync/v1";
    var DEFAULT_ICON = "general/10001-icon-service-All-Resources.png";
    var GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    var TYPES = ["node", "device", "system-software", "technology-collaboration",
        "technology-interface", "path", "communication-network", "technology-function",
        "technology-process", "technology-interaction", "technology-event", "technology-service", "artifact"];
    var PROPS = ["Azure-TenantId", "Azure-SubscriptionId", "Azure-ObjectId", "Azure-ObjectType",
        "Azure-ResourceGroupId", "Azure-ResourceGroupName", "Azure-ObjectName", "Azure-URL",
        "Azure-SubscriptionName", "CreatedDate", "CreatedTime", "DeletedDate", "DeletedTime",
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
            resourceGroupName: rg || "", resourceGroupId: rg ? parts.slice(0, 5).join("/") : ""};
    }
    function validateExisting(existing, tenant, selected) {
        var index = Object.create(null);
        existing.forEach(function (e) {
            var p = e.properties;
            if (!p["Azure-ObjectId"]) return;
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
    function settings(options) {
        options = options || {};
        var root = options.rootFolderName === undefined ? "Azure" : options.rootFolderName;
        assert(typeof root === "string" && root.trim().length > 0 && !/[\r\n]/.test(root), "Azure root folder name must be non-empty text.");
        assert(options.useSpecializations === undefined || typeof options.useSpecializations === "boolean",
            "useSpecializations must be true or false.");
        return {rootFolderName: root.trim(), useSpecializations: options.useSpecializations === true};
    }
    function plan(existing, snapshot, mapping, options) {
        var opts = settings(options);
        var tenant = guid(snapshot.tenantId);
        var selected = snapshot.subscriptionIds.map(guid);
        assert(selected.length > 0 && new Set(selected).size === selected.length, "Invalid subscription scope.");
        assert(selected.every(function (s) { return snapshot.completedSubscriptions.indexOf(s) >= 0; }),
            "Incomplete inventory: no model changes are permitted.");
        var clock = stamp(snapshot.collectedAt), index = validateExisting(existing, tenant, selected);
        var seen = Object.create(null), operations = [], counts = {created: 0, updated: 0, restored: 0, deleted: 0, stillDeleted: 0};
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
            if (old) assert(old.type === base, "Mapping changes the base type of " + r.id +
                ". Change the element type in Archi first; existing relationships are preserved.");
            var props = {
                "Azure-TenantId": tenant, "Azure-SubscriptionId": lower(r.subscriptionId),
                "Azure-ObjectId": r.id, "Azure-ObjectType": r.type,
                "Azure-ResourceGroupId": r.resourceGroupId, "Azure-ResourceGroupName": r.resourceGroupName,
                "Azure-ObjectName": r.name, "Azure-SubscriptionName": r.subscriptionName,
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
        return {operations: operations, counts: counts, clock: clock, tenantId: tenant, subscriptionIds: selected};
    }
    return {OWNER: OWNER, PROPS: PROPS, TYPES: TYPES, DEFAULT_ICON: DEFAULT_ICON, settings: settings, assert: assert, lower: lower, guid: guid,
        subscriptions: subscriptions, armId: armId, identity: identity, stamp: stamp,
        mappings: mappings, normalize: normalize, validateExisting: validateExisting, plan: plan};
}());
if (typeof module !== "undefined") module.exports = AzureCore;
