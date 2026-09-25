/* All model mutations use public jArchi APIs and participate in Archi Undo. */
var AzureArchi = (function () {
    "use strict";
    var C = AzureCore;
    var REGISTRY = "Azure-SyncSpecializations";
    function text(x) { return x === null || x === undefined ? "" : String(x); }
    function readElements(m) {
        var result = [], visited = Object.create(null);
        $(m).find("element").each(function (element) {
            // find also visits diagram instances; normalize to the underlying concept.
            element = element.concept || element;
            if (visited[text(element.id)]) return;
            visited[text(element.id)] = true;
            if (!element.prop("Azure-ObjectId")) return;
            var properties = {};
            C.PROPS.forEach(function (key) {
                var values = element.prop(key, true);
                C.assert(!values || values.length <= 1, "Duplicate property " + key + " on " + element.id);
                properties[key] = text(element.prop(key));
            });
            if (properties["Azure-ObjectId"]) result.push({id: text(element.id), type: text(element.type),
                name: text(element.name), properties: properties});
        });
        return result;
    }
    function registry(m) {
        var raw = text(m.prop(REGISTRY));
        var records = raw ? JSON.parse(raw) : [];
        C.assert(Array.isArray(records), "Invalid specialization ownership registry.");
        records.forEach(function (r) {
            C.assert(r && typeof r.name === "string" && C.TYPES.indexOf(r.base) >= 0, "Invalid specialization registry entry.");
        });
        return records;
    }
    function profileKey(name, base) { return C.lower(name) + "|" + base; }
    function prepareProfiles(m, mapping, root, removeObsolete) {
        var owned = registry(m), previous = Object.create(null), wanted = Object.create(null), creates = [], updates = [], removes = [];
        owned.forEach(function (r) { previous[profileKey(r.name, r.base)] = r; });
        Object.keys(mapping).forEach(function (type) {
            var rule = mapping[type], key = profileKey(rule.name, rule.base);
            wanted[key] = true;
            var current = m.findSpecialization(rule.name, rule.base);
            C.assert(!current || previous[key], "Specialization already exists and is not owned by this script: " + rule.name);
            var file = rule.icon ? AzureJava.icon(root, rule.icon) : null;
            var item = {rule: rule, file: file, current: current};
            (current ? updates : creates).push(item);
        });
        if (removeObsolete) owned.forEach(function (r) {
            if (!wanted[profileKey(r.name, r.base)]) {
                var current = m.findSpecialization(r.name, r.base);
                if (current) removes.push(current);
            }
        });
        var next = removeObsolete ? [] : owned.filter(function (r) { return !wanted[profileKey(r.name, r.base)]; });
        Object.keys(mapping).forEach(function (type) { next.push({name: mapping[type].name, base: mapping[type].base}); });
        return {creates: creates, updates: updates, removes: removes, registry: next};
    }
    function applyProfiles(m, plan) {
        // Import all image bytes first. This validates actual image decoding before changing profiles.
        var imageCache = Object.create(null);
        plan.creates.concat(plan.updates).forEach(function (item) {
            if (item.file && !imageCache[item.file]) imageCache[item.file] = m.createImage(item.file);
            item.image = item.file ? imageCache[item.file] : null;
        });
        plan.creates.forEach(function (item) { m.createSpecialization(item.rule.name, item.rule.base, item.image); });
        plan.updates.forEach(function (item) { item.current.image = item.image; });
        plan.removes.forEach(function (profile) { profile.delete(); });
        m.prop(REGISTRY, JSON.stringify(plan.registry));
    }
    function apply(m, plan) {
        var index = Object.create(null);
        $(m).find("element").each(function (e) { e = e.concept || e; index[text(e.id)] = e; });
        plan.operations.forEach(function (op) {
            var e = op.elementId ? index[op.elementId] : m.createElement(op.base, op.name);
            C.assert(e, "Model changed after planning; abort and Undo the script.");
            if (op.name !== undefined) e.name = op.name;
            Object.keys(op.properties).forEach(function (key) {
                if (text(e.prop(key)) !== op.properties[key]) e.prop(key, op.properties[key]);
                // Blank deletion timestamps are explicit properties, including on newly created elements.
                else if (e.prop(key) === null || e.prop(key) === undefined) e.prop(key, op.properties[key]);
            });
            if (op.specialization) e.specialization = op.specialization;
        });
        m.prop("Azure-LastSuccessfulSyncAt", plan.clock.iso);
        m.prop("Azure-LastSuccessfulSyncSubscriptions", plan.subscriptionIds.join(","));
    }
    return {readElements: readElements, prepareProfiles: prepareProfiles, applyProfiles: applyProfiles, apply: apply};
}());
