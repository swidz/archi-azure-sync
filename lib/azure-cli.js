/* Azure CLI authentication contract and safe command construction; no model writes. */
var AzureCli = (function () {
    "use strict";
    var C = typeof AzureCore !== "undefined" ? AzureCore : require("./core.js");
    function command(executable, args, windows, commandProcessor) {
        C.assert(typeof executable === "string" && !/["\r\n\0]/.test(executable), "Invalid Azure CLI executable path.");
        // Arguments are fixed switches, GUIDs and the ARM URL. Never accept arbitrary shell text.
        C.assert(Array.isArray(args) && args.every(function (a) {
            return typeof a === "string" && /^[A-Za-z0-9:/.=_-]+$/.test(a);
        }), "Invalid Azure CLI arguments.");
        if (windows) {
            C.assert(/^(?:[A-Za-z]:[\\/]|\\\\)/.test(executable), "Use an absolute Azure CLI executable path.");
            C.assert(!/[%!&^]/.test(executable), "Azure CLI path contains unsupported command-shell characters.");
            if (/\.(cmd|bat)$/i.test(executable)) {
                C.assert(commandProcessor && /^[A-Za-z]:[\\/]/.test(commandProcessor) &&
                    !/["%\r\n\0]/.test(commandProcessor), "Invalid Windows command processor.");
                return [commandProcessor, "/d", "/s", "/v:off", "/c",
                    '""' + executable + '" ' + args.join(" ") + '"'];
            }
        } else C.assert(executable.charAt(0) === "/", "Use an absolute Azure CLI executable path.");
        return [executable].concat(args);
    }
    function signIn(io, config) {
        var tenant = C.guid(config.tenantId);
        C.assert(config.subscriptionIds && config.subscriptionIds.length, "Select at least one subscription.");
        var subscription = C.guid(config.subscriptionIds[0]);
        var help = " Run az login --tenant " + tenant + " in a terminal, complete sign-in, then run this script again.";
        function json(args) {
            var result;
            try { result = io.run(args.concat(["--output", "json", "--only-show-errors"])); }
            catch (ignored) { throw new Error("Azure CLI could not run or timed out. Check the local CLI installation." + help); }
            C.assert(result && result.exitCode === 0, "Azure CLI could not read the signed-in session." + help);
            var parsed;
            try { parsed = JSON.parse(result.stdout); }
            catch (ignored) { throw new Error("Azure CLI returned invalid JSON. Check the CLI installation; raw output was suppressed."); }
            finally { result.stdout = ""; }
            C.assert(parsed && typeof parsed === "object", "Invalid Azure CLI response.");
            return parsed;
        }
        var account = json(["account", "show", "--subscription", subscription]);
        C.assert(C.lower(account.id) === subscription && C.lower(account.tenantId) === tenant,
            "Azure CLI account does not match the selected tenant/subscription." + help);
        C.assert(account.environmentName === "AzureCloud", "Select AzureCloud in Azure CLI; sovereign clouds are not supported.");
        C.assert(account.state === "Enabled", "The selected Azure CLI subscription is not enabled.");
        C.assert(account.user && account.user.type === "user",
            "The Azure CLI option requires an interactive user session." + help);
        var response = json(["account", "get-access-token", "--subscription", subscription,
            "--resource", "https://management.azure.com/"]);
        try {
            C.assert(C.lower(response.tenant) === tenant && C.lower(response.subscription) === subscription,
                "Azure CLI token metadata does not match the selected tenant/subscription.");
            C.assert(C.lower(response.tokenType) === "bearer" &&
                typeof response.accessToken === "string" && response.accessToken.length > 0,
                "Azure CLI returned an invalid bearer token.");
            C.assert(/^\d+$/.test(String(response.expires_on)), "Azure CLI 2.54+ is required (UTC expires_on is missing).");
            var expiresAt = Number(response.expires_on) * 1000;
            C.assert(Number.isSafeInteger(expiresAt) && expiresAt > io.now() + 60000,
                "Azure CLI token is expired or too close to expiry." + help);
            return {accessToken: response.accessToken, expiresAt: expiresAt};
        } finally { response.accessToken = null; }
    }
    return {signIn: signIn, command: command};
}());
if (typeof module !== "undefined") module.exports = AzureCli;
