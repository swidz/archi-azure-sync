/* Interactive entry points; load only local trusted script files. */
var AzureApp = (function () {
    "use strict";
    var C = AzureCore;
    function config(m) {
        function ask(label, key) {
            var result = window.prompt(label, String(m.prop(key) || ""));
            if (result === null) throw new Error("Cancelled.");
            return result;
        }
        var choices = ["Device sign-in (app registration)", "Azure CLI (no own app registration)"];
        if (String(m.prop("Azure-AuthMethod") || "") === "azure-cli") choices.reverse();
        var selected = window.promptSelection("Choose Azure authentication method", choices);
        if (selected === null) throw new Error("Cancelled.");
        C.assert(choices.indexOf(String(selected)) >= 0, "Unknown authentication method.");
        var cfg = {
            authMethod: String(selected).indexOf("Azure CLI") === 0 ? "azure-cli" : "device-code",
            tenantId: C.guid(ask("Azure tenant ID (GUID)", "Azure-TenantId")),
            subscriptionIds: C.subscriptions(ask("Subscription IDs: comma, semicolon or whitespace separated", "Azure-SubscriptionIds"))
        };
        if (cfg.authMethod === "device-code")
            cfg.clientId = C.guid(ask("Public client application ID (GUID). See README for app registration.", "Azure-ClientId"));
        return cfg;
    }
    function saveConfig(m, cfg) {
        m.prop("Azure-TenantId", cfg.tenantId);
        m.prop("Azure-AuthMethod", cfg.authMethod);
        // Keep a previously configured device client ID when using Azure CLI.
        if (cfg.clientId) m.prop("Azure-ClientId", cfg.clientId);
        m.prop("Azure-SubscriptionIds", cfg.subscriptionIds.join(","));
    }
    function signIn(cfg, resource) {
        if (cfg.authMethod === "azure-cli") {
            var io = AzureCliJava.createIo(), last;
            // A removed/inaccessible first subscription must not block other selected subscriptions.
            for (var i = 0; i < cfg.subscriptionIds.length; i++) {
                var candidate = {tenantId:cfg.tenantId, subscriptionIds:[cfg.subscriptionIds[i]]};
                var signed = C.attempt([], "Azure CLI " + (resource || "arm") + " sign-in using subscription " + cfg.subscriptionIds[i], function (line) { console.log(line); }, function () {
                    return AzureCli.signIn(io, candidate, resource);
                });
                if (signed.ok) return signed.value;
                last = cfg.subscriptionIds[i];
            }
            throw C.readError("Azure CLI could not obtain a " + (resource || "arm") + " token from any selected subscription. Check login and access; last subscription: " + last);
        }
        return AzureClient.deviceLogin(AzureJava.io, cfg, function (d) {
            return window.confirm("Sign in to " + (resource === "graph" ? "Microsoft Graph (Entra app registrations)" : "Azure") + " in your browser.\n\n" + d.uri +
                "\n\nDevice code: " + d.code + "\n\nComplete sign-in, then click OK. Cancel stops the script.\n" +
                "Your password and MFA response are entered only on Microsoft's website.");
        }, resource);
    }

    function warningSummary(warnings) {
        return warnings.length ? "\n\nPartial synchronization: " + warnings.length + " warning(s). See the Scripts output window. Unverified objects and relationships are preserved; deletion is disabled for incomplete scopes." : "";
    }
    function countText(c) {
        return "Create: " + c.created + "\nUpdate: " + c.updated + "\nRestore: " + c.restored +
            "\nMark deleted: " + c.deleted + "\nAlready deleted: " + c.stillDeleted;
    }
    function refreshProperties(cfg, existing, opts) {
        var candidates = AzureRefresh.candidates(existing, cfg, opts);
        if (!candidates.length) { window.alert("No managed Azure elements were found in the selected tenant/subscriptions. Run Sync Azure first."); return; }
        var chosen = AzureSelection.elements(candidates);
        if (!chosen || !chosen.length) return;
        var armToken = null, entraToken = null;
        function progress(line) { console.log(line); }
        try {
            var arm = chosen.filter(function(e) { return !C.isEntraApplication(e.properties["Azure-ObjectType"]); });
            var graph = chosen.filter(function(e) { return C.isEntraApplication(e.properties["Azure-ObjectType"]); });
            var warnings = [], snapshot = {schemaVersion:3,tenantId:cfg.tenantId,subscriptionIds:cfg.subscriptionIds,completedSubscriptions:cfg.subscriptionIds.slice(),resources:[],confirmedMissing:[],warnings:[],partial:false,collectedAt:new Date(AzureJava.io.now()).toISOString()};
            if (arm.length) {
                var signed = C.attempt(warnings, "ARM property refresh sign-in", progress, function() { return signIn(cfg); });
                armToken = signed.ok ? signed.value : null;
                if (armToken) snapshot = AzureClient.create(AzureJava.io, armToken, progress).refresh(cfg, arm, opts);
                else { snapshot.partial = true; snapshot.warnings = warnings; snapshot.completedSubscriptions = []; }
            }
            if (graph.length) {
                var graphWarnings = [], graphSigned = C.attempt(graphWarnings, "Entra property refresh sign-in", progress, function() { return signIn(cfg, "graph"); });
                entraToken = graphSigned.ok ? graphSigned.value : null;
                snapshot.entraApplications = entraToken ? AzureEntra.create(AzureJava.io, entraToken, progress).refresh(cfg.tenantId, graph) :
                    {schemaVersion:3,tenantId:cfg.tenantId,completed:false,partial:true,warnings:graphWarnings,applications:[],confirmedMissing:[],collectedAt:snapshot.collectedAt};
            }
            snapshot.collectedAt = new Date(AzureJava.io.now()).toISOString();
            var plan = AzureRefresh.plan(chosen, snapshot, opts);
            plan.warnings.forEach(function(w) { console.log("[WARNING] " + w.scope + ": " + w.message); });
            if (!plan.operations.length) { window.alert("No readable objects to refresh. The model was not changed. See the Scripts output window."); return; }
            if (!window.confirm("Refresh properties on " + plan.operations.length + " existing Azure elements?\n\nSelected: " + chosen.length + "\nUnreadable or missing, preserved: " + plan.skipped +
                "\nWarnings: " + plan.warnings.length + "\n\nElement names, types, folders, specializations, relationships and diagrams remain unchanged. No new elements or deletion markers will be created. Readable objects update LastSyncDate/LastSyncTime and can be restored from IsDeleted=yes.")) return;
            AzureArchi.applyProperties(model, plan); saveConfig(model, cfg);
            window.alert("Azure property refresh complete.\n\nUpdated: " + plan.operations.length + "\nSkipped, preserved: " + plan.skipped + "\nWarnings: " + plan.warnings.length + "\n\nReview and save the model. See the Scripts output window for any warnings.");
        } finally {
            if (armToken) armToken.accessToken = null;
            if (entraToken) entraToken.accessToken = null;
        }
    }
    function run(mode, root, rows, options) {
        var token = null, graphToken = null;
        try {
            C.assert(model.isSet(), "Select a model before running this script.");
            var opts = C.settings(options);
            var mapping = C.mappings(rows);
            if (mode === "appearance") {
                var appearance = AzureArchi.prepareAppearance(model, mapping, root);
                if (!appearance.count) { window.alert("No managed Azure diagram objects found. Place Nodes on a view first."); return; }
                if (!window.confirm("Apply Azure custom images and text placement to " + appearance.count + " diagram objects?\n\nImage: " + opts.imagePosition + "\nText: " + opts.textPosition + "\n\nThis local operation does not connect to Azure or change synchronization timestamps.")) return;
                AzureArchi.applyAppearance(model, appearance, opts);
                window.alert("Azure diagram appearance updated. Save the model when ready.");
                return;
            }
            if (mode === "specializations") {
                if (!opts.useSpecializations) {
                    window.alert("Specializations are disabled. This optional utility requires AZURE_USE_SPECIALIZATIONS = true in its script. Normal synchronization does not require specializations.");
                    return;
                }
                var profiles = AzureArchi.prepareProfiles(model, mapping, root, true);
                if (!window.confirm("Apply Azure specializations?\n\nCreate: " + profiles.creates.length +
                    "\nUpdate icons: " + profiles.updates.length + "\nRemove: " + profiles.removes.length +
                    "\n\nRemoving specializations keeps their elements and relationships.")) return;
                AzureArchi.applyProfiles(model, profiles);
                window.alert("Azure specializations updated. Save the model when ready.");
                return;
            }
            var cfg = config(model);
            var existing = mode === "sync" || mode === "refresh" ? AzureArchi.readElements(model) : [];
            if (mode === "refresh") { refreshProperties(cfg, existing, opts); return; }
            if (mode === "sync" && opts.promptForTypes) {
                var selectedTypes = AzureSelection.types(model, mapping, existing, opts);
                if (selectedTypes === undefined) return;
                opts = C.settings(Object.assign({}, opts, {selectedTypes:selectedTypes}));
            }
            opts.includeEntraApplications = opts.includeEntraApplications && C.typeSelected(C.ENTRA_APPLICATION_TYPE, opts);
            var needsArm = opts.selectedTypes === null || opts.selectedTypes.some(function(t) { return !C.isEntraApplication(t); });
            var scopeText = opts.selectedTypes === null ? "All Azure types" : opts.selectedTypes.length + " selected type(s), plus required parents";
            if (mode === "sync") console.log("Object scope: " + (opts.selectedTypes === null ? "all types" : opts.selectedTypes.join(", ")) + ". Unselected objects and relationships are preserved.");
            C.validateExisting(existing, cfg.tenantId, cfg.subscriptionIds);
            if (opts.includeEntraApplications && mode !== "catalog") AzureEntra.validateExisting(existing, cfg.tenantId);
            function progress(line) { console.log(line); }
            var authWarnings = [], signed = needsArm ? C.attempt(authWarnings, "Azure Resource Manager sign-in", progress, function () { return signIn(cfg); }) : {ok:false};
            token = signed.ok ? signed.value : null;
            var client = token ? AzureClient.create(AzureJava.io, token, progress) : null;
            if (mode === "catalog") {
                if (!client) { window.alert("No ARM access. See the Scripts output window for details."); return; }
                var discoveryWarnings = [], types = client.discover(cfg.subscriptionIds, discoveryWarnings);
                var out = window.promptSaveFile({title: "Save discovered Azure types (does not overwrite your curated catalog automatically)",
                    filterExtensions: ["*.js"]});
                if (!out) return;
                var content = "// Discovered from Azure provider metadata on " + new Date().toISOString() +
                    "\n// Discovery warnings: " + discoveryWarnings.length + " (see Scripts output; missing rows do not prove removal)." +
                    "\n// Review and merge into config/specializations.js. Comment out any unwanted row.\nvar AZURE_SPECIALIZATIONS = [\n" +
                    types.map(function (t) { return "    " + JSON.stringify([t, mapping[C.lower(t)] ? mapping[C.lower(t)].base : "node", ""]) + ","; }).join("\n") + "\n];\n";
                AzureJava.write(out, content);
                window.alert("Exported " + types.length + " resource types." + (discoveryWarnings.length ? "\nPartial discovery: " + discoveryWarnings.length + " warning(s). See the Scripts output window; this is not a complete catalog." : "") + "\nSee README for merging new types.");
                return;
            }
            var snapshot = client ? client.inventory(cfg, existing, opts) : {schemaVersion:3, tenantId:cfg.tenantId,
                subscriptionIds:cfg.subscriptionIds, selectedTypes:opts.selectedTypes, completedSubscriptions:needsArm ? [] : cfg.subscriptionIds.slice(), resources:[], confirmedMissing:[],
                collectedAt:new Date(AzureJava.io.now()).toISOString(), partial:needsArm, warnings:authWarnings};
            if (opts.enrichInfrastructure && client) {
                snapshot.infrastructure = AzureInfrastructure.create(client, progress, opts).inventory(snapshot);
                snapshot.collectedAt = new Date(AzureJava.io.now()).toISOString();
            }
            if (opts.discoverConnections && client) {
                snapshot.connections = AzureConnections.create(AzureJava.io, token, client, progress).inventory(snapshot);
                snapshot.collectedAt = new Date(AzureJava.io.now()).toISOString();
            }
            if (opts.includeEntraApplications) {
                var graphWarnings = [], graphSigned = C.attempt(graphWarnings, "Microsoft Graph sign-in for Entra app registrations", progress, function () { return signIn(cfg, "graph"); });
                graphToken = graphSigned.ok ? graphSigned.value : null;
                snapshot.entraApplications = graphToken ? AzureEntra.create(AzureJava.io, graphToken, progress).inventory(cfg.tenantId, existing) :
                    {schemaVersion:3,tenantId:cfg.tenantId,completed:false,partial:true,warnings:graphWarnings,applications:[],confirmedMissing:[],collectedAt:snapshot.collectedAt};
                snapshot.schemaVersion = 3;
                snapshot.collectedAt = new Date(AzureJava.io.now()).toISOString();
            }
            var warnings = (snapshot.warnings || []).concat(snapshot.entraApplications ? snapshot.entraApplications.warnings || [] : []).concat(snapshot.connections ? snapshot.connections.warnings : []).concat(snapshot.infrastructure ? snapshot.infrastructure.warnings : []);
            snapshot.status = warnings.length ? "partial" : "complete";
            var warningText = warningSummary(warnings);
            if (mode === "export") {
                var file = window.promptSaveFile({title: "Save Azure inventory (contains infrastructure metadata, no tokens)",
                    filterExtensions: ["*.json"]});
                if (file) {
                    AzureJava.write(file, JSON.stringify(snapshot, null, 2) + "\n");
                    window.alert("Azure inventory exported." + warningText);
                }
                return;
            }
            var plan = C.plan(existing, snapshot, mapping, opts), used = Object.create(null);
            if (opts.includeEntraApplications) AzureEntra.merge(plan, AzureEntra.plan(existing, snapshot.entraApplications, mapping, opts, snapshot.collectedAt));
            if (opts.discoverConnections && snapshot.connections) AzureConnections.plan(snapshot, plan, AzureArchi.isAllowedRelationship, progress);
            if (opts.enrichInfrastructure && snapshot.infrastructure) AzureInfrastructure.plan(snapshot, plan, AzureArchi.isAllowedRelationship, progress);
            warnings = plan.warnings || warnings; warningText = warningSummary(warnings);
            if (plan.partial && !plan.operations.length) {
                console.log("No readable objects were available for synchronization. The model was not changed.");
                window.alert("No readable objects were available. The model was not changed." + warningText);
                return;
            }
            plan.operations.forEach(function (op) {
                if (op.specialization) used[C.lower(op.properties["Azure-ObjectType"])] = mapping[C.lower(op.properties["Azure-ObjectType"])];
            });
            var profilePlan = opts.useSpecializations ? AzureArchi.prepareProfiles(model, used, root, false, false) : null;
            if (!window.confirm("Azure inventory is ready (" + (snapshot.resources.length + (snapshot.entraApplications ? snapshot.entraApplications.applications.length : 0)) + " objects).\n\n" +
                countText(plan.counts) + "\nObject types: " + scopeText + "\nUnselected types: preserved" + warningText + "\n\nOrganize scoped elements under: " + opts.rootFolderName +
                " / Subscription / Resource group (or Other) / Object type" +
                (opts.includeEntraApplications ? "\nEntra app registrations: " + opts.rootFolderName + " / Entra ID [" + cfg.tenantId + "] / App registrations (whole tenant)" : "\nEntra app registrations: excluded") +
                "\nSpecializations: " + (opts.useSpecializations ? "on" : "off") +
                "\nGenerated relationships: Relationships / " + opts.rootFolderName +
                " / Source subscription / Source resource group (or Other) / Source object type" +
                "\nSynced relationship names: blank (existing names will be cleared)" +
                "\nFunction App to Technology Function: Serving (legacy synced Assignment links will be converted)" +
                "\nDiagram layout and icons: unchanged" +
                "\nModel relationships to ensure: " + plan.relationships.pairs.length +
                "\nInfrastructure relationships to ensure: " + (plan.infrastructure ? plan.infrastructure.pairs.length : 0) +
                "\nConnection relationships to ensure: " + (plan.connections ? plan.connections.pairs.length : 0) +
                (plan.relationships.missingParents ? "\nMissing parent Nodes: " + plan.relationships.missingParents : "") +
                "\n\nApply to the selected model?")) return;
            if (profilePlan) AzureArchi.applyProfiles(model, profilePlan);
            var applied = AzureArchi.apply(model, plan, opts);
            saveConfig(model, cfg);
            model.prop("Azure-SelectedObjectTypes", JSON.stringify(opts.selectedTypes));
            console.log(countText(plan.counts));
            if (plan.infrastructure) console.log("Infrastructure enrichment: " + snapshot.infrastructure.metadata.length + " elements, " + plan.infrastructure.stats.subnets + " subnets, " + plan.infrastructure.pairs.length + " links to ensure; " + plan.infrastructure.stats.graphPages + " Resource Graph pages and " + plan.infrastructure.stats.detailReads + " ARM detail reads.");
            if (applied && applied.relationships && applied.relationships.migrated) console.log("Function relationships converted to Serving: " + applied.relationships.migrated);
            console.log(warnings.length ? "Azure synchronization completed with " + warnings.length + " warning(s). Incomplete scopes were preserved." : "Azure synchronization complete.");
            window.alert("Azure synchronization " + (warnings.length ? "completed with warnings." : "complete.") + "\n\n" + countText(plan.counts) + warningText +
                (applied && applied.relationships ? "\nModel relationships created: " + applied.relationships.created + "\nFunction relationships converted to Serving: " + applied.relationships.migrated : "") +
                (applied && applied.connections ? "\nConnection relationships created: " + applied.connections.created + "\nConnection relationships marked deleted: " + applied.connections.deleted : "") +
                (applied && applied.infrastructure ? "\nInfrastructure relationships created: " + applied.infrastructure.created + "\nInfrastructure relationships marked deleted: " + applied.infrastructure.deleted : "") +
                "\n\nReview the model, then save/commit using your normal workflow.\nOptional: to add icons to Nodes already placed in views, run utils/Apply Azure Appearance.ajs. Skip it to keep your existing diagram appearance.");
        } catch (error) {
            // Our errors deliberately exclude raw HTTP bodies and credentials.
            console.log("[ERROR] Azure operation stopped: " + String(error.message || "Unexpected error"));
            window.alert("Azure operation stopped.\n\n" + String(error.message || "Unexpected error") +
                "\n\nIf model application had started, use Edit > Undo before retrying.");
        } finally {
            if (token) token.accessToken = null;
            if (graphToken) graphToken.accessToken = null;
            token = null; graphToken = null;
        }
    }
    return {run: run};
}());
