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
        throw new Error(context + ": HTTP " + response.status + " (" + code(response) + ").");
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
        C.assert(delay <= 120000, "Azure requested a long retry delay. Run the script again later.");
        return delay;
    }
    function deviceLogin(io, config, display) {
        var tenant = C.guid(config.tenantId), client = C.guid(config.clientId);
        var url = AUTH + "/" + tenant + "/oauth2/v2.0/";
        var scope = ARM + "/user_impersonation";
        var r = io.request("POST", url + "devicecode", {"Content-Type": "application/x-www-form-urlencoded"},
            form({client_id: client, scope: scope}));
        if (r.status !== 200) fail(r, "Start device sign-in");
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
                r = io.request("POST", url + "token", {"Content-Type": "application/x-www-form-urlencoded"},
                    form({grant_type: "urn:ietf:params:oauth:grant-type:device_code",
                        client_id: client, device_code: d.device_code}));
                if (r.status === 200) {
                    C.assert(r.body && r.body.access_token && Number(r.body.expires_in) > 0, "Invalid token response.");
                    return {accessToken: r.body.access_token, expiresAt: io.now() + Number(r.body.expires_in) * 1000};
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
            throw new Error("Device sign-in expired. Run the script again.");
        } finally { d.device_code = null; r = null; }
    }
    function create(io, token, progress) {
        progress = progress || function () {};
        function get(url, allow404) {
            C.assert(/^https:\/\/management\.azure\.com\//i.test(url), "Refusing an unexpected ARM host.");
            C.assert(io.now() < token.expiresAt - 15000, "Sign-in expired. Run the script again.");
            for (var attempt = 0; attempt < 5; attempt++) {
                var r = io.request("GET", url, {Authorization: "Bearer " + token.accessToken, Accept: "application/json"});
                if (r.status === 200 || (allow404 && r.status === 404)) return r;
                if ((r.status === 429 || r.status >= 500) && attempt < 4) {
                    io.sleep(retryDelay(r, attempt, io.now()));
                    continue;
                }
                fail(r, "Read Azure inventory");
            }
        }
        function pages(path, subscription) {
            var url = ARM + path, result = [], visited = Object.create(null);
            var prefix = ARM + "/subscriptions/" + C.guid(subscription);
            while (url) {
                // Reject foreign hosts/scopes, userinfo, ports, fragments and path traversal before attaching a token.
                var pathOnly = url.split("?")[0];
                C.assert(C.lower(pathOnly).indexOf(C.lower(prefix) + "/") === 0 &&
                    pathOnly.indexOf("/../") < 0 && !/[#\\]/.test(url) && !/%2e|%2f|%5c/i.test(pathOnly),
                    "Pagination escaped the selected subscription.");
                C.assert(!visited[url], "Repeated Azure nextLink; inventory is incomplete.");
                visited[url] = true;
                C.assert(Object.keys(visited).length <= 100000, "Too many inventory pages.");
                var r = get(url), body = r.body;
                C.assert(body && Array.isArray(body.value), "Malformed inventory page.");
                result = result.concat(body.value);
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
            C.assert(versions.length, "No provider API version to verify missing resource: " + type);
            return stable[0] || versions[0];
        }
        function encodedId(id) { return C.armId(id).split("/").map(encodeURIComponent).join("/"); }
        function inventory(config, existing) {
            var tenant = C.guid(config.tenantId), subs = config.subscriptionIds.map(C.guid);
            var index = C.validateExisting(existing || [], tenant, subs);
            var snapshot = {schemaVersion: 1, tenantId: tenant, subscriptionIds: subs,
                collectedAt: "", completedSubscriptions: [], confirmedMissing: [], resources: []};
            var seen = Object.create(null);
            function add(raw, sub) {
                var r = C.normalize(raw, sub, tenant), key = C.identity(tenant, r.id);
                C.assert(!seen[key], "Duplicate resource across Azure inventory pages: " + r.id);
                seen[key] = true;
                snapshot.resources.push(r);
            }
            subs.forEach(function (subId, number) {
                progress("Reading subscription " + (number + 1) + "/" + subs.length + " (" + subId + ")");
                var sub = get(ARM + "/subscriptions/" + subId + "?api-version=2022-12-01").body;
                C.assert(sub && C.lower(sub.subscriptionId) === subId && C.lower(sub.tenantId) === tenant &&
                    typeof sub.displayName === "string" && sub.state === "Enabled",
                    "Subscription is unavailable, disabled, or belongs to a different tenant: " + subId);
                add({id: "/subscriptions/" + subId, type: "Microsoft.Resources/subscriptions", name: sub.displayName}, sub);
                pages("/subscriptions/" + subId + "/resourcegroups?api-version=" + API, subId).forEach(function (rg) {
                    rg.type = "Microsoft.Resources/resourceGroups"; add(rg, sub);
                });
                pages("/subscriptions/" + subId + "/resources?api-version=" + API, subId).forEach(function (r) {
                    // Container objects were explicitly fetched from their authoritative endpoints above.
                    if (C.lower(r.type) !== "microsoft.resources/resourcegroups" &&
                        C.lower(r.type) !== "microsoft.resources/subscriptions") add(r, sub);
                });
                // Missing list entries are checked individually to avoid interpreting filtering/RBAC changes as deletion.
                Object.keys(index).forEach(function (key) {
                    var old = index[key], p = old.properties;
                    if (seen[key] || p["Azure-SyncManagedBy"] !== C.OWNER || C.lower(p["Azure-SubscriptionId"]) !== subId) return;
                    var type = p["Azure-ObjectType"], version =
                        C.lower(type) === "microsoft.resources/resourcegroups" ? API : apiVersion(subId, type);
                    var check = get(ARM + encodedId(p["Azure-ObjectId"]) + "?api-version=" + version, true);
                    if (check.status === 200) {
                        var raw = check.body;
                        if (C.lower(type) === "microsoft.resources/resourcegroups") raw.type = type;
                        C.assert(raw && C.identity(tenant, raw.id) === key, "Resource verification returned a different ID.");
                        add(raw, sub);
                    } else {
                        C.assert(["ResourceNotFound", "ResourceGroupNotFound", "ParentResourceNotFound"].indexOf(code(check)) >= 0,
                            "Ambiguous HTTP 404; refusing deletion: " + p["Azure-ObjectId"]);
                        snapshot.confirmedMissing.push(key);
                    }
                });
                snapshot.completedSubscriptions.push(subId);
            });
            snapshot.collectedAt = new Date(io.now()).toISOString();
            return snapshot;
        }
        function discover(subs) {
            var types = new Set(["Microsoft.Resources/subscriptions", "Microsoft.Resources/resourceGroups"]);
            subs.forEach(function (sub) {
                providers(C.guid(sub)).forEach(function (p) {
                    (p.resourceTypes || []).forEach(function (t) { types.add(p.namespace + "/" + t.resourceType); });
                });
            });
            return Array.from(types).sort(function (a, b) { return C.lower(a).localeCompare(C.lower(b)); });
        }
        return {inventory: inventory, discover: discover, pages: pages};
    }
    return {deviceLogin: deviceLogin, create: create, retryDelay: retryDelay};
}());
if (typeof module !== "undefined") module.exports = AzureClient;
