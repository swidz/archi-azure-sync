/* Read-only connection discovery. Raw setting values never leave this module. */
var AzureConnections = (function () {
    "use strict";
    var C = typeof AzureCore !== "undefined" ? AzureCore : require("./core.js");
    var A = typeof AzureClient !== "undefined" ? AzureClient : require("./azure-client.js");
    var API = "2025-03-01", ARM = "https://management.azure.com";
    function safeName(value) { return typeof value === "string" && /^[A-Za-z0-9_.:/{}% -]{1,256}$/.test(value) ? value : ""; }
    function fields(value) {
        // Semicolon-delimited ADO.NET/ODBC values, including quoted/escaped secrets.
        var out = Object.create(null), i = 0, n = value.length;
        while (i < n) {
            while (i < n && /[;\s]/.test(value.charAt(i))) i++;
            if (i === n) break;
            var start = i;
            while (i < n && value.charAt(i) !== "=" && value.charAt(i) !== ";") i++;
            if (value.charAt(i) !== "=") return null;
            var key = C.lower(value.slice(start,i).trim()).replace(/\s/g, ""); i++;
            while (i < n && /\s/.test(value.charAt(i))) i++;
            var result = "", quote = value.charAt(i), closed = false;
            if (quote === "'" || quote === '"' || quote === "{") {
                var end = quote === "{" ? "}" : quote; i++;
                while (i < n) {
                    var ch = value.charAt(i++);
                    if (ch === end) {
                        if (value.charAt(i) === end) { result += end; i++; }
                        else { closed = true; break; }
                    } else result += ch;
                }
                if (!closed) return null;
                while (i < n && /\s/.test(value.charAt(i))) i++;
                if (i < n && value.charAt(i) !== ";") return null;
            } else {
                start = i; while (i < n && value.charAt(i) !== ";") i++;
                result = value.slice(start,i).trim();
            }
            if (!key || Object.prototype.hasOwnProperty.call(out,key)) return null;
            out[key] = result;
        }
        return out;
    }
    function host(value) {
        if (typeof value !== "string") return "";
        var v = value.trim(), uri = /^[a-z][a-z0-9+.-]*:\/\/([^/?#]+)/i.exec(v);
        if (uri) v = uri[1].slice(uri[1].lastIndexOf("@") + 1);
        else v = v.replace(/^tcp:/i, "").split(/[/?#]/)[0];
        v = v.replace(/[:,]\d+$/, "").replace(/\.$/, "");
        return /^[a-z0-9.-]+$/i.test(v) ? C.lower(v) : "";
    }
    function descriptor(value) {
        if (typeof value !== "string" || !value.trim() || value.length > 65536) return null;
        if (/^\s*@Microsoft\.(KeyVault|AppConfiguration)\(/i.test(value)) return {unresolved:"external-reference"};
        var f = /^[a-z][a-z0-9+.-]*:\/\//i.test(value.trim()) ? null : fields(value), endpoint = "", db = "", entity = "", kind = "", account = "";
        if (f) {
            var servers = [f.server,f.datasource,f.address,f.addr,f.networkaddress].filter(function(v){return v !== undefined;});
            if (servers.length > 1 || (f.database !== undefined && f.initialcatalog !== undefined)) return {unresolved:"ambiguous-fields"};
            endpoint = host(servers[0] || f.endpoint || f.blobendpoint || f.queueendpoint || f.tableendpoint || "");
            db = f.database || f.initialcatalog || "";
            entity = f.entitypath || "";
            account = f.accountname || "";
            if (account && (!/^[a-z0-9]{3,24}$/.test(account) || (f.endpointsuffix && C.lower(f.endpointsuffix) !== "core.windows.net"))) return {unresolved:"unsupported-storage"};
            if (!endpoint && account) endpoint = account + ".blob.core.windows.net";
        } else endpoint = host(value);
        if (/^[a-z0-9-]+(?:\.privatelink)?\.database\.windows\.net$/.test(endpoint)) kind = "sql";
        else if (/^[a-z0-9-]+(?:\.privatelink)?\.servicebus\.windows\.net$/.test(endpoint)) kind = "servicebus";
        else if (/^[a-z0-9]+(?:\.privatelink)?\.(?:blob|queue|table|file)\.core\.windows\.net$/.test(endpoint)) kind = "storage";
        if (!kind) return null;
        if ((db && !safeName(db)) || (entity && !safeName(entity))) return {unresolved:"unsupported-name"};
        if (account && endpoint.split(".")[0] !== account) return {unresolved:"conflicting-storage-endpoints"};
        // Construct from a small allowlist; never redact an arbitrary string with regex replacement.
        var sanitized = (kind === "sql" ? "Server=" : "Endpoint=") + endpoint + (db ? ";Database=" + db : "") + (entity ? ";EntityPath=" + entity : "") + ";Credentials=[REDACTED]";
        return {kind:kind,endpoint:endpoint,database:db,entity:entity,sanitized:sanitized};
    }
    function create(io, token, client, progress) {
        progress = progress || function () {};
        function settings(site, category) {
            C.assert(category === "appsettings" || category === "connectionstrings", "Unexpected configuration endpoint.");
            var id = C.armId(site.id);
            C.assert(/^\/subscriptions\/[^/]+\/resourceGroups\/[^/]+\/providers\/Microsoft.Web\/sites\/[^/]+$/i.test(id), "Invalid app resource path.");
            var url = ARM + id.split("/").map(encodeURIComponent).join("/") + "/config/" + category + "/list?api-version=" + API;
            for (var attempt=0; attempt<5; attempt++) {
                if (io.now() >= token.expiresAt - 15000) throw C.readError("ARM sign-in expired during connection discovery.");
                var r;
                try { r = io.request("POST", url, {Authorization:"Bearer " + token.accessToken,Accept:"application/json","Content-Type":"application/json"}, "{}"); }
                catch (ignored) { throw C.readError("Connection configuration request failed (network, timeout or TLS)."); }
                if (r.status === 200) {
                    if (!r.body || !r.body.properties || typeof r.body.properties !== "object" || Array.isArray(r.body.properties)) throw C.readError("Malformed connection configuration response.");
                    return r.body.properties;
                }
                if ((r.status === 429 || r.status >= 500) && attempt < 4) { io.sleep(A.retryDelay(r,attempt,io.now())); continue; }
                // Do not include any server-provided strings: errors may echo settings/secrets.
                throw C.readError("Read " + category + ": HTTP " + r.status + ". Configuration access requires Microsoft.Web/sites/config/list/action.");
            }
        }
        function inventory(snapshot) {
            var tenant = C.guid(snapshot.tenantId), selected = snapshot.subscriptionIds.map(C.guid);
            C.assert(token.resource === undefined || token.resource === "arm", "Connection discovery requires an ARM token.");
            C.assert(!token.tenantId || C.lower(token.tenantId) === tenant, "Connection token tenant mismatch.");
            var result = {version:1,records:[],completedOwners:[],warnings:[],partial:false}, resources = snapshot.resources, available = Object.create(null);
            resources.forEach(function(r){
                C.assert(C.lower(r.tenantId) === tenant && selected.indexOf(C.lower(r.subscriptionId)) >= 0 && C.lower(C.armId(r.id).split('/')[2]) === C.lower(r.subscriptionId), "Connection inventory scope mismatch.");
                available[C.identity(tenant,r.id)] = r;
            });
            function warn(site, message) { C.attempt(result.warnings, "Connections for " + site.id, progress, function(){throw C.readError(message);}); }
            function match(d, hint) {
                var name = d.endpoint.split(".")[0], entity = hint && (hint.queueName || hint.topicName) || d.entity;
                if (d.entity && hint && entity && C.lower(d.entity) !== C.lower(entity)) return [];
                return resources.filter(function(r){
                    var type = C.lower(r.type), parts = C.lower(r.id).split("/");
                    if (d.kind === "sql") return parts[8] === name && (d.database ? type === "microsoft.sql/servers/databases" && C.lower(parts.slice(10).join('/')) === C.lower(d.database) : type === "microsoft.sql/servers");
                    if (d.kind === "storage") return type === "microsoft.storage/storageaccounts" && parts[8] === name;
                    if (parts[8] !== name) return false;
                    if (!entity) return type === "microsoft.servicebus/namespaces";
                    if (hint && hint.queueName && type !== "microsoft.servicebus/namespaces/queues") return false;
                    if (hint && hint.topicName && type !== "microsoft.servicebus/namespaces/topics") return false;
                    return (type === "microsoft.servicebus/namespaces/queues" || type === "microsoft.servicebus/namespaces/topics") && C.lower(parts.slice(10).join('/')) === C.lower(entity);
                });
            }
            resources.filter(function(r){return C.lower(r.type) === "microsoft.web/sites";}).forEach(function(site){
                var startWarnings = result.warnings.length, owner = C.identity(tenant,site.id), app = null, connections = null;
                var projected = Object.create(null), identities = Object.create(null), consumed = Object.create(null), functionsSeen = Object.create(null);
                function emit(name, origin, d, consumer, binding) {
                    if (!d || d.unresolved) { warn(site,"A connection could not be resolved safely (unsupported format or external secret reference)."); return; }
                    var targets = match(d,binding);
                    if (targets.length !== 1) { warn(site,"A recognized " + d.kind + " connection has " + targets.length + " matching targets in the selected readable inventory; no relationship inferred."); return; }
                    var type = binding ? (/trigger$/i.test(binding.type) ? "triggering-relationship" : "flow-relationship") : "serving-relationship";
                    var out = binding && C.lower(binding.direction) === "out", provider = C.identity(tenant,targets[0].id);
                    if (consumer === provider) { warn(site,"A self-referencing connection was skipped."); return; }
                    result.records.push({owner:owner,source:out ? consumer : provider,target:out ? provider : consumer,type:type,evidence:{
                        ownerId:site.id,consumerId:available[consumer].id,connectionName:name,connectionSource:origin,
                        connectionString:d.sanitized,endpoint:d.endpoint,database:d.database,entity:binding && (binding.queueName || binding.topicName || binding.path) || d.entity,
                        bindingType:binding ? binding.type : "",bindingName:binding ? binding.name : "",subscriptionName:binding ? binding.subscriptionName : "",bindingDisabled:binding ? binding.disabled : false
                    }});
                }
                function resolve(name) {
                    var names=[name,"AzureWebJobs"+name];
                    for(var i=0;i<names.length;i++) if(projected[names[i]]) return {name:names[i],value:projected[names[i]]};
                    return null;
                }
                function variable(value) {
                    if (typeof value !== "string") return "";
                    var unresolved=false;
                    value=value.replace(/%([^%]+)%/g,function(all,key){if(!app || typeof app[key] !== "string"){unresolved=true;return "";}return app[key];});
                    return !unresolved && safeName(value) ? value : "";
                }
                try {
                    var ar=C.attempt(result.warnings,"Application settings for " + site.id,progress,function(){return settings(site,"appsettings");});
                    if(ar.ok) app=ar.value;
                    var cr=C.attempt(result.warnings,"Connection strings for " + site.id,progress,function(){return settings(site,"connectionstrings");});
                    if(cr.ok) connections=cr.value;
                    Object.keys(app || {}).forEach(function(name){
                        var value=app[name], d=descriptor(value), suffix=/__(fullyQualifiedNamespace|blobServiceUri|queueServiceUri|tableServiceUri|serviceUri)$/i.exec(name);
                        if(suffix && d && !d.unresolved) {
                            var prefix=name.slice(0,suffix.index);
                            if(!safeName(prefix)){warn(site,"Unsupported connection setting name.");return;}
                            d.sanitized="Endpoint="+d.endpoint+";Authentication=ManagedIdentity";
                            if(identities[prefix] && (identities[prefix].unresolved || identities[prefix].kind!==d.kind || identities[prefix].endpoint.split('.')[0]!==d.endpoint.split('.')[0])) {identities[prefix]={unresolved:"conflicting-settings"};return;}
                            identities[prefix]=d;
                        } else if(d || (typeof value === "string" && /(?:^|;)\s*(?:Server|Data Source|Endpoint|AccountName)\s*=/i.test(value))) {
                            if(!safeName(name)){warn(site,"Unsupported connection setting name.");return;}
                            projected[name]=d || {unresolved:"unsupported-format"};
                        }
                    });
                    Object.keys(identities).forEach(function(prefix){
                        if(Object.prototype.hasOwnProperty.call(app,prefix)) projected[prefix]=descriptor(app[prefix]) || {unresolved:"unsupported-exact-setting"};
                        else projected[prefix]=identities[prefix];
                    });
                    // Functions refer to app settings, not the App Service connectionstrings dictionary.
                    var isFunction=C.lower(site.kind).split(',').indexOf('functionapp')>=0 || resources.some(function(r){return C.lower(r.type)==='microsoft.web/sites/functions' && C.lower(C.childParent(r.type,r.id))===C.lower(site.id);});
                    if(isFunction && app) C.attempt(result.warnings,"Function bindings for " + site.id,progress,function(){
                        client.pages(site.id.split('/').map(encodeURIComponent).join('/') + "/functions?api-version="+API,site.subscriptionId,true,function(raw){
                            // Scope checks do not echo configuration payloads.
                            C.assert(raw && typeof raw.id==='string' && C.lower(C.childParent('Microsoft.Web/sites/functions',raw.id))===C.lower(site.id),"Function binding escaped its app.");
                            var consumer=C.identity(tenant,raw.id);
                            C.assert(!functionsSeen[consumer],"Duplicate function binding identity.");functionsSeen[consumer]=true;
                            if(!available[consumer]) {warn(site,"A function binding has no readable Function element; skipped.");return;}
                            var config=raw.properties && raw.properties.config;
                            if(!config || !Array.isArray(config.bindings)){warn(site,"Function binding metadata is unavailable; existing connection relationships are preserved.");return;}
                            config.bindings.forEach(function(b){
                                if(!b || !/^(serviceBusTrigger|serviceBus|queueTrigger|queue|blobTrigger|blob)$/i.test(b.type || '')) return;
                                var name=b.connection || (/^servicebus/i.test(b.type)?'AzureWebJobsServiceBus':'AzureWebJobsStorage');
                                if(!safeName(name) || !safeName(b.name || 'binding')) {warn(site,"Unsupported binding reference.");return;}
                                var resolved=resolve(name), binding={type:b.type,name:b.name || 'binding',disabled:raw.properties.isDisabled===true || config.disabled===true,direction:C.lower(b.direction),queueName:variable(b.queueName),topicName:variable(b.topicName),subscriptionName:variable(b.subscriptionName),path:variable(b.path)};
                                if(!resolved || (/trigger$/i.test(b.type) && binding.direction && binding.direction!=='in') || (!/trigger$/i.test(b.type) && ['in','out'].indexOf(binding.direction)<0) ||
                                    (/^servicebus/i.test(b.type) && ((!binding.queueName && !binding.topicName) || (binding.queueName && binding.topicName))) ||
                                    (binding.topicName && !binding.subscriptionName && /trigger$/i.test(b.type)) || (/^queue/i.test(b.type) && !binding.queueName) || (/^blob/i.test(b.type) && !binding.path)) {warn(site,"A binding connection, entity or direction could not be resolved; skipped.");return;}
                                if(!resolved.value || resolved.value.unresolved || resolved.value.kind !== (/^servicebus/i.test(b.type)?'servicebus':'storage')) {warn(site,"Binding and connection service types disagree or cannot be resolved.");return;}
                                consumed[resolved.name]=true;emit(resolved.name,'FunctionBinding',resolved.value,consumer,binding);
                            });
                        });
                    });
                    Object.keys(projected).forEach(function(name){if(!consumed[name])emit(name,'ApplicationSettings',projected[name],owner,null);});
                    Object.keys(connections || {}).forEach(function(name){
                        if(!safeName(name)){warn(site,"Unsupported connection string name.");return;}
                        emit(name,'AppServiceConnectionStrings',descriptor(connections[name] && connections[name].value),owner,null);
                    });
                    if(result.warnings.length===startWarnings)result.completedOwners.push(owner);
                } finally {
                    // Drop raw references before returning a sanitized snapshot. Never resolve Key Vault secrets.
                    Object.keys(app || {}).forEach(function(k){app[k]=null;});Object.keys(connections || {}).forEach(function(k){connections[k]=null;});
                    app=null;connections=null;projected=null;
                }
            });
            result.partial=result.warnings.length>0;return result;
        }
        return {inventory:inventory};
    }
    function plan(snapshot, armPlan, allowed, progress) {
        var grouped=Object.create(null), c=snapshot.connections, bases=Object.create(null), incomplete=Object.create(null), warnings=[];
        if(!c)return null;
        armPlan.operations.forEach(function(op){if(op.properties['Azure-ObjectId'] && !C.isEntraApplication(op.properties['Azure-ObjectType']))bases[C.identity(armPlan.tenantId,op.properties['Azure-ObjectId'])]=op.base;});
        c.records.forEach(function(r){
            if(allowed && !allowed(r.type,bases[r.source],bases[r.target])){
                incomplete[r.owner]=true;
                C.attempt(warnings,"Connection relationship",progress,function(){throw C.readError("Archi does not permit the inferred relationship for the configured element types; skipped.");});return;
            }
            var key=JSON.stringify([r.source,r.target,r.type]);
            if(!grouped[key])grouped[key]={source:r.source,target:r.target,type:r.type,evidence:[]};
            var list=grouped[key].evidence, text=JSON.stringify(r.evidence);
            if(!list.some(function(e){return JSON.stringify(e)===text;}))list.push(r.evidence);
        });
        armPlan.connections={pairs:Object.keys(grouped).sort().map(function(k){return grouped[k];}),completedOwners:c.completedOwners.filter(function(k){return !incomplete[k];})};
        armPlan.warnings=(armPlan.warnings || []).concat(c.warnings,warnings);
        armPlan.partial=armPlan.partial || c.partial || warnings.length>0;
        return armPlan.connections;
    }
    return {create:create,plan:plan,descriptor:descriptor};
}());
if(typeof module!=="undefined")module.exports=AzureConnections;
