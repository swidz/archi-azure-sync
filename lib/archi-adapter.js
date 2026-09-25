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
    function prepareProfiles(m, mapping, root, removeObsolete, includeImages) {
        // Sync manages profile metadata only; the optional profile utility may install icons.
        includeImages = includeImages !== false;
        var owned = registry(m), previous = Object.create(null), wanted = Object.create(null), creates = [], updates = [], removes = [];
        owned.forEach(function (r) { previous[profileKey(r.name, r.base)] = r; });
        Object.keys(mapping).forEach(function (type) {
            var rule = mapping[type], key = profileKey(rule.name, rule.base);
            wanted[key] = true;
            var current = m.findSpecialization(rule.name, rule.base);
            C.assert(!current || previous[key], "Specialization already exists and is not owned by this script: " + rule.name);
            var file = includeImages && rule.icon ? AzureJava.icon(root, rule.icon) : null;
            var item = {rule: rule, file: file, current: current, updateImage: includeImages};
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
        plan.updates.forEach(function (item) { if (item.updateImage) item.current.image = item.image; });
        plan.removes.forEach(function (profile) { profile.delete(); });
        m.prop(REGISTRY, JSON.stringify(plan.registry));
    }
    // Validate icon paths before the confirmation dialog; decode only when used in a view.
    function prepareImages(plan, root) {
        var result = Object.create(null);
        plan.operations.forEach(function (op) {
            var icon = op.icon || C.DEFAULT_ICON;
            if (!result[icon]) result[icon] = AzureJava.icon(root, icon);
        });
        return result;
    }
    function styleObject(m, object, icon, opts, images, imageCache) {
        var file = images && images[icon || C.DEFAULT_ICON];
        C.assert(file, "Image paths must be prepared before applying diagram icons.");
        if (!imageCache[file]) imageCache[file] = m.createImage(file);
        object.image = imageCache[file];
        object.imageSource = 1; // CUSTOM
        object.imagePosition = opts.imagePositionValue;
        object.textPosition = opts.textPositionValue;
        object.textAlignment = opts.textAlignmentValue;
    }
    // Offline appearance-only operation: never changes Azure metadata, timestamps or relationships.
    function prepareAppearance(m, mapping, root) {
        var seen = Object.create(null), items = [], count = 0;
        $(m).find("element").each(function (item) {
            var e = item.concept || item, id = text(e.id);
            if (seen[id]) return;
            seen[id] = true;
            if (text(e.prop("Azure-SyncManagedBy")) !== C.OWNER || !e.prop("Azure-ObjectId")) return;
            var objects = [];
            $(e).objectRefs().each(function (object) { objects.push(object); });
            if (!objects.length) return;
            var rule = mapping[C.lower(e.prop("Azure-ObjectType"))];
            items.push({objects: objects, icon: rule && rule.icon ? rule.icon : C.DEFAULT_ICON});
            count += objects.length;
        });
        return {items: items, count: count, images: prepareImages({operations: items}, root)};
    }
    function applyAppearance(m, appearance, options) {
        var opts = C.settings(options), cache = Object.create(null);
        appearance.items.forEach(function (item) {
            item.objects.forEach(function (object) { styleObject(m, object, item.icon, opts, appearance.images, cache); });
        });
    }
    function applyRelationships(m, plan, index, destination) {
        var resources = Object.create(null), relations = Object.create(null), visited = Object.create(null), managed = [];
        // Actual Archi endpoint GUIDs are authoritative, regardless of labels, folder or cached properties.
        // Relationship type distinguishes legitimate links of different kinds between the same endpoints.
        function endpointRelations(source, target) {
            var sourceId = text(source.id), targetId = text(target.id);
            if (!relations[sourceId]) relations[sourceId] = Object.create(null);
            if (!relations[sourceId][targetId]) relations[sourceId][targetId] = Object.create(null);
            return relations[sourceId][targetId];
        }
        Object.keys(index).forEach(function (id) {
            var e = index[id], tenant = text(e.prop("Azure-TenantId")), sub = C.lower(e.prop("Azure-SubscriptionId"));
            if (text(e.prop("Azure-SyncManagedBy")) !== C.OWNER || C.lower(tenant) !== plan.tenantId || plan.subscriptionIds.indexOf(sub) < 0) return;
            resources[C.identity(tenant, e.prop("Azure-ObjectId"))] = e;
        });
        $(m).find("relationship").each(function (item) {
            var rel = item.concept || item;
            if (visited[text(rel.id)]) return;
            visited[text(rel.id)] = true;
            if (["composition-relationship", "assignment-relationship", "serving-relationship"].indexOf(text(rel.type)) < 0) return;
            var source = rel.source, target = rel.target;
            if (!source || !target) return;
            var byType = endpointRelations(source, target);
            // Search the entire model, including manual links and relationships in older folders.
            if (!byType[text(rel.type)]) byType[text(rel.type)] = rel;
            if (text(rel.prop("Azure-SyncManagedBy")) === C.OWNER && ["composition", "assignment", "serving"].indexOf(text(rel.prop("Azure-RelationKind"))) >= 0) managed.push(rel);
        });
        var created = 0;
        plan.relationships.pairs.forEach(function (pair) {
            var source = resources[pair.source], target = resources[pair.target];
            C.assert(source && target, "Relationship endpoint missing after applying elements; Undo and retry.");
            var byType = endpointRelations(source, target);
            if (byType[pair.type]) return;
            var rel = m.createRelationship(pair.type, pair.name, source, target);
            rel.prop("Azure-SyncManagedBy", C.OWNER);
            rel.prop("Azure-RelationKind", pair.type.replace("-relationship", ""));
            rel.prop("CreatedDate", plan.clock.date); rel.prop("CreatedTime", plan.clock.time);
            byType[pair.type] = rel; managed.push(rel); created++;
        });
        managed.forEach(function (rel) {
            var source = rel.source, target = rel.target, pTenant = C.lower(target.prop("Azure-TenantId")), sub = C.lower(target.prop("Azure-SubscriptionId"));
            if (pTenant !== plan.tenantId || plan.subscriptionIds.indexOf(sub) < 0 ||
                text(source.prop("Azure-SyncManagedBy")) !== C.OWNER || text(target.prop("Azure-SyncManagedBy")) !== C.OWNER ||
                C.lower(source.prop("Azure-TenantId")) !== pTenant || C.lower(source.prop("Azure-SubscriptionId")) !== sub) return;
            // Synced relationships use their type and endpoints; clear legacy and custom labels.
            if (text(rel.name)) rel.name = "";
            var folder = destination(rel);
            if (text($(rel).parent().first().id) !== text(folder.id)) folder.add(rel);
            rel.prop("Azure-SourceElementId", text(source.id));
            rel.prop("Azure-TargetElementId", text(target.id));
            var deleted = text(source.prop("IsDeleted")) === "yes" || text(target.prop("IsDeleted")) === "yes";
            var wasDeleted = text(rel.prop("IsDeleted")) === "yes";
            rel.prop("Azure-TenantId", pTenant); rel.prop("Azure-SubscriptionId", sub);
            rel.prop("Azure-SourceObjectId", text(source.prop("Azure-ObjectId")));
            rel.prop("Azure-TargetObjectId", text(target.prop("Azure-ObjectId")));
            rel.prop("IsDeleted", deleted ? "yes" : "no");
            if (!deleted || !wasDeleted) {
                rel.prop("DeletedDate", deleted ? plan.clock.date : "");
                rel.prop("DeletedTime", deleted ? plan.clock.time : "");
            }
            rel.prop("LastSyncDate", plan.clock.date); rel.prop("LastSyncTime", plan.clock.time);
        });
        return {created: created, ensured: plan.relationships.pairs.length, missingParents: plan.relationships.missingParents};
    }
    function apply(m, plan, options) {
        var opts = C.settings(options), index = Object.create(null);
        var folders = Object.create(null), owned = Object.create(null);
        registry(m).forEach(function (r) { owned[profileKey(r.name, r.base)] = true; });
        // One model traversal: concepts and their diagram occurrences must not be applied twice.
        $(m).find("element").each(function (item) {
            var e = item.concept || item, id = text(e.id);
            if (index[id]) return;
            index[id] = e;
        });
        $(m).find("folder").each(function (f) {
            if (text(f.prop("Azure-SyncManagedBy")) !== C.OWNER) return;
            var key = text(f.prop("Azure-SyncFolderKey"));
            if (!key) return;
            var parent = $(f).parent().first(), id = text(parent.id) + "|" + key;
            C.assert(!folders[id], "Duplicate managed Azure folder; resolve it before syncing: " + f.name);
            folders[id] = f;
        });
        function ensureFolder(parent, key, name) {
            var id = text(parent.id) + "|" + key, f = folders[id];
            if (!f) {
                // Do not silently take ownership of a user's unrelated folder.
                $(parent).children("folder").each(function (child) {
                    C.assert(text(child.name) !== name,
                        "Folder name already in use outside this sync hierarchy: " + name + ". Rename it or choose another AZURE_ROOT_FOLDER; Undo if application started.");
                });
                f = parent.createFolder(name);
                f.prop("Azure-SyncManagedBy", C.OWNER);
                f.prop("Azure-SyncFolderKey", key);
                folders[id] = f;
            }
            if (text(f.name) !== name) f.name = name;
            return f;
        }
        var subscriptionNames = Object.create(null);
        plan.operations.forEach(function (op) {
            var p = op.properties;
            if (p["Azure-SubscriptionId"]) subscriptionNames[C.lower(p["Azure-TenantId"]) + "|" + C.lower(p["Azure-SubscriptionId"])] = p["Azure-SubscriptionName"];
        });
        function layerFolder(e) {
            // Locate the built-in category by ancestry, including translated/renamed labels.
            var layer = $(e).parent().first(), ancestor = $(layer).parent().first();
            while (ancestor && text(ancestor.type) === "folder") {
                layer = ancestor; ancestor = $(layer).parent().first();
            }
            C.assert(layer && text(layer.type) === "folder", "Concept has no layer folder.");
            return layer;
        }
        function destination(e, category) {
            // Use the same resource metadata hierarchy for elements and relationship sources.
            var root = ensureFolder(category || layerFolder(e), "root", opts.rootFolderName);
            var tenant = C.lower(e.prop("Azure-TenantId")), sub = C.lower(e.prop("Azure-SubscriptionId"));
            var subKey = tenant + "|" + sub;
            var subName = text(subscriptionNames[subKey] || e.prop("Azure-SubscriptionName") || sub);
            var subFolder = ensureFolder(root, "subscription|" + subKey, subName + " [" + sub + "]");
            var rg = text(e.prop("Azure-ResourceGroupName"));
            // A real resource group named Other remains separate from subscription-level resources.
            var rgName = rg ? (C.lower(rg) === "other" ? rg + " (resource group)" : rg) : "Other";
            var rgFolder = ensureFolder(subFolder, rg ? "resource-group|" + C.lower(rg) : "no-resource-group", rgName);
            var type = text(e.prop("Azure-ObjectType"));
            return ensureFolder(rgFolder, "type|" + C.lower(type), type);
        }
        plan.operations.forEach(function (op) {
            var e = op.elementId ? index[op.elementId] : m.createElement(op.base, op.name);
            C.assert(e, "Model changed after planning; abort and Undo the script.");
            index[text(e.id)] = e;
            if (op.name !== undefined) e.name = op.name;
            Object.keys(op.properties).forEach(function (key) {
                if (text(e.prop(key)) !== op.properties[key]) e.prop(key, op.properties[key]);
                else if (e.prop(key) === null || e.prop(key) === undefined) e.prop(key, op.properties[key]);
            });
            var folder = destination(e);
            if (text($(e).parent().first().id) !== text(folder.id)) folder.add(e);
            if (opts.useSpecializations && op.specialization) e.specialization = op.specialization;
            else if (!opts.useSpecializations && owned[profileKey(text(e.specialization), text(e.type))]) e.specialization = null;
        });
        var relationships = applyRelationships(m, plan, index, function (rel) {
            // A link follows its source resource hierarchy within the Relationships category.
            return destination(rel.source, layerFolder(rel));
        });
        m.prop("Azure-LastSuccessfulSyncAt", plan.clock.iso);
        m.prop("Azure-LastSuccessfulSyncSubscriptions", plan.subscriptionIds.join(","));
        return {relationships: relationships};
    }
    return {readElements: readElements, prepareProfiles: prepareProfiles, applyProfiles: applyProfiles,
        prepareAppearance: prepareAppearance, applyAppearance: applyAppearance, apply: apply};
}());
