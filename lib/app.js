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
        return {
            tenantId: C.guid(ask("Azure tenant ID (GUID)", "Azure-TenantId")),
            clientId: C.guid(ask("Public client application ID (GUID). See README for app registration.", "Azure-ClientId")),
            subscriptionIds: C.subscriptions(ask("Subscription IDs: comma, semicolon or whitespace separated", "Azure-SubscriptionIds"))
        };
    }
    function saveConfig(m, cfg) {
        m.prop("Azure-TenantId", cfg.tenantId);
        m.prop("Azure-ClientId", cfg.clientId);
        m.prop("Azure-SubscriptionIds", cfg.subscriptionIds.join(","));
    }
    function signIn(cfg) {
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
    function run(mode, root, rows) {
        var token = null;
        try {
            C.assert(model.isSet(), "Select a model before running this script.");
            var mapping = C.mappings(rows);
            if (mode === "specializations") {
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
            var plan = C.plan(existing, snapshot, mapping), used = Object.create(null);
            plan.operations.forEach(function (op) {
                if (op.specialization) used[C.lower(op.properties["Azure-ObjectType"])] = mapping[C.lower(op.properties["Azure-ObjectType"])];
            });
            var profilePlan = AzureArchi.prepareProfiles(model, used, root, false);
            if (!window.confirm("Azure inventory is ready (" + snapshot.resources.length + " objects).\n\n" +
                countText(plan.counts) + "\n\nApply to the selected model?")) return;
            AzureArchi.applyProfiles(model, profilePlan);
            AzureArchi.apply(model, plan);
            saveConfig(model, cfg);
            console.log(countText(plan.counts));
            window.alert("Azure synchronization complete.\n\n" + countText(plan.counts) +
                "\n\nReview the model, then save/commit using your normal workflow.");
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
