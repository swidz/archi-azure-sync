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
    function signIn(cfg) {
        if (cfg.authMethod === "azure-cli") return AzureCli.signIn(AzureCliJava.createIo(), cfg);
        return AzureClient.deviceLogin(AzureJava.io, cfg, function (d) {
            return window.confirm("Sign in to Azure in your browser.\n\n" + d.uri +
                "\n\nDevice code: " + d.code + "\n\nComplete sign-in, then click OK. Cancel stops the script.\n" +
                "Your password and MFA response are entered only on Microsoft's website.");
        });
    }

    function countText(c) {
        return "Create: " + c.created + "\nUpdate: " + c.updated + "\nRestore: " + c.restored +
            "\nMark deleted: " + c.deleted + "\nAlready deleted: " + c.stillDeleted;
    }
    function run(mode, root, rows, options) {
        var token = null;
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
            var existing = mode === "sync" ? AzureArchi.readElements(model) : [];
            C.validateExisting(existing, cfg.tenantId, cfg.subscriptionIds);
            token = signIn(cfg);
            var client = AzureClient.create(AzureJava.io, token, function (line) { console.log(line); });
            if (mode === "catalog") {
                var types = client.discover(cfg.subscriptionIds);
                var out = window.promptSaveFile({title: "Save discovered Azure types (does not overwrite your curated catalog automatically)",
                    filterExtensions: ["*.js"]});
                if (!out) return;
                var content = "// Discovered from Azure provider metadata on " + new Date().toISOString() +
                    "\n// Review and merge into config/specializations.js. Comment out any unwanted row.\nvar AZURE_SPECIALIZATIONS = [\n" +
                    types.map(function (t) { return "    " + JSON.stringify([t, "node", ""]) + ","; }).join("\n") + "\n];\n";
                AzureJava.write(out, content);
                window.alert("Exported " + types.length + " resource types. See README for merging new types.");
                return;
            }
            var snapshot = client.inventory(cfg, existing);
            if (mode === "export") {
                var file = window.promptSaveFile({title: "Save Azure inventory (contains infrastructure metadata, no tokens)",
                    filterExtensions: ["*.json"]});
                if (file) AzureJava.write(file, JSON.stringify(snapshot, null, 2) + "\n");
                return;
            }
            var plan = C.plan(existing, snapshot, mapping, opts), used = Object.create(null);
            plan.operations.forEach(function (op) {
                if (op.specialization) used[C.lower(op.properties["Azure-ObjectType"])] = mapping[C.lower(op.properties["Azure-ObjectType"])];
            });
            var profilePlan = opts.useSpecializations ? AzureArchi.prepareProfiles(model, used, root, false, false) : null;
            if (!window.confirm("Azure inventory is ready (" + snapshot.resources.length + " objects).\n\n" +
                countText(plan.counts) + "\n\nOrganize scoped elements under: " + opts.rootFolderName +
                " / Subscription / Resource group (or Other) / Object type" +
                "\nSpecializations: " + (opts.useSpecializations ? "on" : "off") +
                "\nDiagram appearance: unchanged" +
                "\nComposition links to ensure: " + plan.compositions.pairs.length +
                (plan.compositions.missingParents ? "\nMissing parent Nodes: " + plan.compositions.missingParents : "") +
                "\n\nApply to the selected model?")) return;
            if (profilePlan) AzureArchi.applyProfiles(model, profilePlan);
            var applied = AzureArchi.apply(model, plan, opts);
            saveConfig(model, cfg);
            console.log(countText(plan.counts));
            window.alert("Azure synchronization complete.\n\n" + countText(plan.counts) +
                (applied && applied.relationships ? "\nComposition relationships created: " + applied.relationships.created : "") +
                "\n\nReview the model, then save/commit using your normal workflow.\nOptional: to add icons to Nodes already placed in views, run utils/Apply Azure Appearance.ajs. Skip it to keep your existing diagram appearance.");
        } catch (error) {
            // Our errors deliberately exclude raw HTTP bodies and credentials.
            window.alert("Azure operation stopped.\n\n" + String(error.message || "Unexpected error") +
                "\n\nIf model application had started, use Edit > Undo before retrying.");
        } finally {
            if (token) token.accessToken = null;
            token = null;
        }
    }
    return {run: run};
}());
