/* Protocol/ARM logic with injectable transport for deterministic tests. */
var AzureClient = (function () {
    "use strict";
    var C = typeof AzureCore !== "undefined" ? AzureCore : require("./core.js");
    var ARM = "https://management.azure.com";
    var AUTH = "https://login.microsoftonline.com";
    var API = "2021-04-01";
    function code(response) {
        var e = response.body && response.body.error;
        var s = typeof e === "string" ? e : e && e.code;
        return /^[A-Za-z0-9_.-]{1,100}$/.test(s || "") ? s : "UnknownError";
    }
    function fail(response, context) {
        // Never include response bodies, token requests or raw transport exceptions.
        throw C.readError(context + ": HTTP " + response.status + " (" + code(response) + ").");
    }
    function form(fields) {
        return Object.keys(fields).map(function (k) { return encodeURIComponent(k) + "=" + encodeURIComponent(fields[k]); }).join("&");
    }
    function retryDelay(r, attempt, now) {
        var h = r.headers || {}, raw = h["retry-after"], delay;
        if (raw && /^\d+$/.test(raw)) delay = Number(raw) * 1000;
        else if (raw) delay = Date.parse(raw) - now;
        else if (h["x-ms-retry-after-ms"]) delay = Number(h["x-ms-retry-after-ms"]);
        if (!isFinite(delay) || delay < 0) delay = Math.pow(2, attempt) * 1000;
        // If the service asks for a very long pause, stop instead of retrying too soon.
        if (delay > 120000) throw C.readError("Azure requested a long retry delay. Run the script again later.");
        return delay;
    }
    function request(io, method, url, headers, body) {
        try { return io.request(method, url, headers, body); }
        catch (ignored) { throw C.readError("HTTPS request failed (network, timeout, proxy or TLS)."); }
    }
    function deviceLogin(io, config, display, resource) {
        C.assert(resource === undefined || resource === "arm" || resource === "graph", "Unknown token resource.");
        var tenant = C.guid(config.tenantId), client = C.guid(config.clientId);
        var url = AUTH + "/" + tenant + "/oauth2/v2.0/";
        var scope = resource === "graph" ? "https://graph.microsoft.com/Application.Read.All" : ARM + "/user_impersonation";
        var r = request(io, "POST", url + "devicecode", {"Content-Type": "application/x-www-form-urlencoded"},
            form({client_id: client, scope: scope}));
        if (r.status !== 200) fail(r, "Start " + (resource === "graph" ? "Microsoft Graph" : "Azure") + " device sign-in");
        var d = r.body;
        C.assert(d && d.device_code && d.user_code && d.verification_uri && Number(d.expires_in) > 0,
            "Invalid device authorization response.");
        C.assert(/^https:\/\/(?:microsoft\.com|www\.microsoft\.com|login\.microsoftonline\.com)\//i.test(d.verification_uri),
            "Unexpected sign-in URL.");
        var deadline = io.now() + Number(d.expires_in) * 1000;
        var interval = Math.max(5, Number(d.interval) || 5) * 1000;
        if (display({uri: d.verification_uri, code: d.user_code}) === false) throw new Error("Sign-in cancelled.");
        try {
            while (io.now() < deadline) {
                io.sleep(interval);
                if (io.now() >= deadline) break;
                r = request(io, "POST", url + "token", {"Content-Type": "application/x-www-form-urlencoded"},
                    form({grant_type: "urn:ietf:params:oauth:grant-type:device_code",
                        client_id: client, device_code: d.device_code}));
                if (r.status === 200) {
                    C.assert(r.body && r.body.access_token && Number(r.body.expires_in) > 0, "Invalid token response.");
                    return {accessToken: r.body.access_token, expiresAt: io.now() + Number(r.body.expires_in) * 1000, tenantId:tenant, resource:resource || "arm"};
                }
                var error = code(r);
                if (error === "authorization_pending") continue;
                if (error === "slow_down") { interval += 5000; continue; }
                if (r.status === 429 || r.status >= 500) {
                    interval = Math.max(interval, retryDelay(r, 0, io.now()));
                    continue;
                }
                fail(r, "Device sign-in");
            }
            throw C.readError("Device sign-in expired. Run the script again.");
        } finally { d.device_code = null; r = null; }
    }
    function create(io, token, progress) {
        progress = progress || function () {};
        function get(url, allow404) {
            C.assert(/^https:\/\/management\.azure\.com\//i.test(url), "Refusing an unexpected ARM host.");
            for (var attempt = 0; attempt < 5; attempt++) {
                if (io.now() >= token.expiresAt - 15000) throw C.readError("Sign-in expired. Run the script again.");
                var r = request(io, "GET", url, {Authorization: "Bearer " + token.accessToken, Accept: "application/json"});
                if (r.status === 200 || (allow404 && r.status === 404)) return r;
                if ((r.status === 429 || r.status >= 500) && attempt < 4) {
                    io.sleep(retryDelay(r, attempt, io.now()));
                    continue;
                }
                fail(r, "Read Azure inventory");
            }
        }
        function pages(path, subscription, restrictCollection, consume) {
            var collectionPath = C.lower((ARM + path).split("?")[0]);
            var url = ARM + path, result = [], visited = Object.create(null);
            var prefix = ARM + "/subscriptions/" + C.guid(subscription);
            while (url) {
                // Reject foreign hosts/scopes, userinfo, ports, fragments and path traversal before attaching a token.
                var pathOnly = url.split("?")[0];
                C.assert(C.lower(pathOnly).indexOf(C.lower(prefix) + "/") === 0 &&
                    pathOnly.indexOf("/../") < 0 && !/[#\\]/.test(url) && !/%2e|%2f|%5c/i.test(pathOnly),
                    "Pagination escaped the selected subscription.");
                C.assert(!restrictCollection || C.lower(pathOnly) === collectionPath, "Pagination escaped its child collection.");
                C.assert(!visited[url], "Repeated Azure nextLink; inventory is incomplete.");
                visited[url] = true;
                C.assert(Object.keys(visited).length <= 100000, "Too many inventory pages.");
                var r = get(url), body = r.body;
                if (!body || !Array.isArray(body.value)) throw C.readError("Malformed inventory page; collection is incomplete.");
                if (consume) body.value.forEach(consume);
                else result = result.concat(body.value);
                C.assert(body.nextLink === undefined || body.nextLink === null || typeof body.nextLink === "string",
                    "Invalid nextLink.");
                url = body.nextLink || "";
            }
            return result;
        }
        var providersCache = Object.create(null);
        function providers(sub) {
            if (!providersCache[sub]) providersCache[sub] = pages("/subscriptions/" + sub + "/providers?api-version=" + API, sub);
            return providersCache[sub];
        }
        function apiVersion(sub, type) {
            var parts = type.split("/"), ns = parts.shift(), resourceType = parts.join("/");
            var matches = providers(sub).filter(function (p) { return C.lower(p.namespace) === C.lower(ns); });
            var resourceTypes = matches.length ? matches[0].resourceTypes || [] : [];
            var types = resourceTypes.filter(function (t) { return C.lower(t.resourceType) === C.lower(resourceType); });
            var versions = types.length ? types[0].apiVersions || [] : [];
            versions = versions.filter(function (v) { return /^\d{4}-\d{2}-\d{2}(?:-[a-z0-9.-]+)?$/i.test(v); });
            versions.sort().reverse();
            var stable = versions.filter(function (v) { return !/preview|beta|alpha/i.test(v); });
            if (!versions.length) throw C.readError("No provider API version to verify missing resource: " + type);
            return stable[0] || versions[0];
        }
        function encodedId(id) { return C.armId(id).split("/").map(encodeURIComponent).join("/"); }
        function inventory(config, existing) {
            var tenant = C.guid(config.tenantId), subs = config.subscriptionIds.map(C.guid);
            var index = C.validateExisting(existing || [], tenant, subs);
            var snapshot = {schemaVersion: 3, partial:false, warnings:[], tenantId: tenant, subscriptionIds: subs,
                collectedAt: "", completedSubscriptions: [], confirmedMissing: [], resources: []};
            var seen = Object.create(null);
            function add(raw, sub, origin) {
                var r = C.normalize(raw, sub, tenant), key = C.identity(tenant, r.id), prior = seen[key];
                origin = origin || "generic";
                if (prior) {
                    // ARM Resources List and a child endpoint may legitimately overlap, but repeated pages may not.
                    C.assert(C.childSpec(r.type) && C.lower(prior.resource.type) === C.lower(r.type) && !prior.origins[origin],
                        "Duplicate resource across Azure inventory pages: " + r.id);
                    prior.origins[origin] = true;
                    if (origin !== "generic") Object.keys(r).forEach(function (k) { prior.resource[k] = r[k]; });
                    return prior.resource;
                }
                var origins = Object.create(null); origins[origin] = true;
                seen[key] = {resource:r, origins:origins}; snapshot.resources.push(r); return r;
            }
            subs.forEach(function (subId, number) {
                progress("Reading subscription " + (number + 1) + "/" + subs.length + " (" + subId + ")");
                var warningStart = snapshot.warnings.length;
                C.attempt(snapshot.warnings, "Subscription " + subId, progress, function () {
                    var sub = get(ARM + "/subscriptions/" + subId + "?api-version=2022-12-01").body;
                    C.assert(sub && C.lower(sub.subscriptionId) === subId && C.lower(sub.tenantId) === tenant &&
                        typeof sub.displayName === "string",
                        "Subscription is unavailable, disabled, or belongs to a different tenant: " + subId);
                    if (sub.state !== "Enabled") throw C.readError("Subscription is not enabled: " + subId);
                    add({id: "/subscriptions/" + subId, type: "Microsoft.Resources/subscriptions", name: sub.displayName}, sub);
                    C.attempt(snapshot.warnings, "Resource groups in " + subId, progress, function () {
                        pages("/subscriptions/" + subId + "/resourcegroups?api-version=" + API, subId, false, function (rg) {
                            rg.type = "Microsoft.Resources/resourceGroups"; add(rg, sub);
                        });
                    });
                    function addListedResource(r) {
                        // Container objects were explicitly fetched from their authoritative endpoints above.
                        if (C.lower(r.type) !== "microsoft.resources/resourcegroups" &&
                            C.lower(r.type) !== "microsoft.resources/subscriptions") add(r, sub);
                    }
                    var listed = C.attempt(snapshot.warnings, "Resources in " + subId, progress, function () {
                        pages("/subscriptions/" + subId + "/resources?api-version=" + API, subId, false, addListedResource);
                    });
                    // A subscription-wide list can be denied while individual resource groups are readable.
                    if (!listed.ok) snapshot.resources.filter(function (r) {
                        return r.subscriptionId === subId && C.lower(r.type) === "microsoft.resources/resourcegroups";
                    }).forEach(function (group) {
                        var groupSeen = Object.create(null);
                        C.attempt(snapshot.warnings, "Resources in " + group.id, progress, function () {
                            pages(encodedId(group.id) + "/resources?api-version=" + API, subId, true, function (r) {
                                var normalized = C.normalize(r, sub, tenant);
                                C.assert(C.lower(normalized.resourceGroupId) === C.lower(group.id), "Resource escaped its resource group.");
                                var key = C.identity(tenant, r.id);
                                C.assert(!groupSeen[key], "Duplicate resource across resource-group fallback pages.");
                                groupSeen[key] = true;
                                C.assert(!seen[key] || C.lower(seen[key].resource.type) === C.lower(r.type), "Fallback resource type disagrees with subscription inventory.");
                                // Earlier subscription pages may overlap a group fallback.
                                if (!seen[key]) addListedResource(r);
                            });
                        });
                    });
                    var collectedChildren = Object.create(null);
                    function verifyMissing(children) {
                        // Verify parents before collecting children, so a parent recovered by GET is also expanded.
                        Object.keys(index).forEach(function (key) {
                            var old = index[key], p = old.properties;
                            if (seen[key] || p["Azure-SyncManagedBy"] !== C.OWNER || C.lower(p["Azure-SubscriptionId"]) !== subId) return;
                            var type = p["Azure-ObjectType"], spec = C.childSpec(type);
                            if (!!spec !== children) return;
                            C.attempt(snapshot.warnings, "Verify resource " + p["Azure-ObjectId"], progress, function () {
                                var version = spec ? spec.apiVersion : C.lower(type) === "microsoft.resources/resourcegroups" ? API : apiVersion(subId, type);
                                var check = get(ARM + encodedId(p["Azure-ObjectId"]) + "?api-version=" + version, true);
                                if (check.status === 200) {
                                    var raw = check.body;
                                    if (raw && (C.lower(type) === "microsoft.resources/resourcegroups" || spec)) {
                                        C.assert(!raw.type || C.lower(raw.type) === C.lower(type), "Resource verification returned a different type."); raw.type = type;
                                    }
                                    C.assert(raw && C.identity(tenant, raw.id) === key, "Resource verification returned a different ID.");
                                    add(raw, sub);
                                } else {
                                    var missingCode = code(check), knownMissing = ["ResourceNotFound", "ResourceGroupNotFound", "ParentResourceNotFound"].indexOf(missingCode) >= 0;
                                    var covered = spec && collectedChildren[C.identity(tenant, C.childParent(type, p["Azure-ObjectId"])) + "|" + spec.collection];
                                    if (covered && C.lower(type).indexOf("microsoft.servicebus/") === 0 && missingCode === "MessagingEntityNotFound") knownMissing = true;
                                    if (covered && spec.collection === "functions" && missingCode === "NotFound") knownMissing = true;
                                    if (!knownMissing) throw C.readError("Ambiguous HTTP 404; refusing deletion: " + p["Azure-ObjectId"]);
                                    snapshot.confirmedMissing.push(key);
                                }
                            });
                        });
                    }
                    verifyMissing(false);
                    function parentDetails(parent, version) {
                        var raw = get(ARM + encodedId(parent.id) + "?api-version=" + version).body;
                        C.assert(raw && C.identity(tenant, raw.id) === C.identity(tenant, parent.id) && C.lower(raw.type) === C.lower(parent.type),
                            "Parent metadata returned a different resource.");
                        var detail = C.normalize(raw, sub, tenant);
                        parent.kind = detail.kind; parent.skuTier = detail.skuTier;
                    }
                    var parents = snapshot.resources.filter(function (r) { return r.subscriptionId === subId; });
                    parents.forEach(function (parent) {
                        var type = C.lower(parent.type), collections = [];
                        var metadata = C.attempt(snapshot.warnings, "Child metadata for " + parent.id, progress, function () {
                            if (type === "microsoft.servicebus/namespaces") {
                                if (!parent.skuTier) parentDetails(parent, "2024-01-01");
                                if (!parent.skuTier) throw C.readError("Service Bus namespace SKU is missing; cannot establish topic coverage.");
                                collections = ["Microsoft.ServiceBus/namespaces/queues"];
                                // Basic tier does not support topics. Any previously managed topic is still verified individually.
                                if (C.lower(parent.skuTier) !== "basic") collections.push("Microsoft.ServiceBus/namespaces/topics");
                            } else if (type === "microsoft.web/sites") {
                                if (!parent.kind) parentDetails(parent, "2025-03-01");
                                if (!parent.kind) throw C.readError("Web App kind is missing; cannot establish function coverage.");
                                if (C.lower(parent.kind).split(",").map(function (k) { return k.trim(); }).indexOf("functionapp") >= 0)
                                    collections = ["Microsoft.Web/sites/functions"];
                            } else if (type === "microsoft.sql/servers") collections = ["Microsoft.Sql/servers/databases"];
                        });
                        if (!metadata.ok) {
                            // Even with denied parent details, try the known read-only child endpoints.
                            if (type === "microsoft.servicebus/namespaces") collections = ["Microsoft.ServiceBus/namespaces/queues", "Microsoft.ServiceBus/namespaces/topics"];
                            else if (type === "microsoft.web/sites") collections = ["Microsoft.Web/sites/functions"];
                        }
                        collections.forEach(function (childType) {
                            var spec = C.childSpec(childType), parentKey = C.identity(tenant, parent.id), origin = parentKey + "|" + spec.collection;
                            progress("Reading " + spec.collection + " for " + parent.name);
                            C.attempt(snapshot.warnings, spec.collection + " in " + parent.id, progress, function () {
                                pages(encodedId(parent.id) + "/" + spec.collection + "?api-version=" + spec.apiVersion, subId, true, function (raw) {
                                    C.assert(raw && (!raw.type || C.lower(raw.type) === C.lower(childType)), "Unexpected child resource type.");
                                    C.assert(C.identity(tenant, C.childParent(childType, raw.id)) === parentKey, "Child resource escaped its parent.");
                                    // Never copy function config, source files, test data, invocation URLs or secrets into the snapshot/model.
                                    add({id:raw.id, name:raw.name, type:childType}, sub, origin);
                                });
                                collectedChildren[origin] = true;
                            });
                        });
                    });
                    verifyMissing(true);
                });
                if (snapshot.warnings.length === warningStart) snapshot.completedSubscriptions.push(subId);
            });
            snapshot.partial = snapshot.warnings.length > 0;
            // A read error anywhere in a subscription disables its deletion reconciliation for this run.
            snapshot.confirmedMissing = snapshot.confirmedMissing.filter(function (key) {
                return snapshot.completedSubscriptions.indexOf(key.split("|")[1].split("/")[2]) >= 0;
            });
            snapshot.collectedAt = new Date(io.now()).toISOString();
            return snapshot;
        }
        function discover(subs, warnings) {
            warnings = warnings || [];
            var types = new Set(["Microsoft.Resources/subscriptions", "Microsoft.Resources/resourceGroups"]);
            subs.forEach(function (sub) {
                C.attempt(warnings, "Provider discovery in " + sub, progress, function () {
                    pages("/subscriptions/" + C.guid(sub) + "/providers?api-version=" + API, sub, true, function (p) {
                        (p.resourceTypes || []).forEach(function (t) { types.add(p.namespace + "/" + t.resourceType); });
                    });
                });
            });
            return Array.from(types).sort(function (a, b) { return C.lower(a).localeCompare(C.lower(b)); });
        }
        return {inventory: inventory, discover: discover, pages: pages};
    }
    return {deviceLogin: deviceLogin, create: create, retryDelay: retryDelay};
}());
if (typeof module !== "undefined") module.exports = AzureClient;
