/* Allowlisted enrichment and explicit resource references. No settings, secrets, files or diagrams. */
var AzureInfrastructure = (function () {
    "use strict";
    var C = typeof AzureCore !== "undefined" ? AzureCore : require("./core.js");
    var SUBNET = "microsoft.network/virtualnetworks/subnets";
    var TYPES = ["microsoft.compute/virtualmachines", "microsoft.network/virtualnetworks", SUBNET,
        "microsoft.network/networkinterfaces", "microsoft.network/privateendpoints", "microsoft.network/publicipaddresses",
        "microsoft.network/networksecuritygroups", "microsoft.web/sites", "microsoft.sql/servers",
        "microsoft.sql/servers/databases", "microsoft.storage/storageaccounts"];
    var OWNERS = [SUBNET, "microsoft.network/networkinterfaces", "microsoft.network/privateendpoints"];
    function object(v) { return !!v && typeof v === "object" && !Array.isArray(v); }
    function project(raw, options, detailed, authoritative) {
        var opts = C.settings(options), properties = {}, references = [], warnings = [], p = object(raw.properties) ? raw.properties : {};
        var type = C.lower(raw.type), id = C.armId(raw.id), complete = authoritative && object(raw.properties);
        function warn(message) { if (warnings.indexOf(message) < 0) warnings.push(message); complete = false; }
        function scalar(key, value) {
            if (value === undefined) return;
            if (value === null) { properties[key] = ""; return; }
            if (["string", "number", "boolean"].indexOf(typeof value) < 0 || String(value).length > 2048 || /[\x00-\x1f]/.test(String(value))) {
                warn("Unsupported value in allowlisted metadata field " + key + "."); return;
            }
            properties[key] = String(value);
        }
        function list(key, value) {
            if (value === undefined) return;
            if (value === null) { properties[key] = "[]"; return; }
            if (!Array.isArray(value) || value.length > 256 || value.some(function(v){return typeof v !== "string" || v.length > 256 || /[\x00-\x1f]/.test(v);})) {
                warn("Unsupported value in allowlisted metadata field " + key + "."); return;
            }
            properties[key] = JSON.stringify(Array.from(new Set(value)).sort());
        }
        scalar("Azure-Location", raw.location); scalar("Azure-Kind", raw.kind);
        if (object(raw.sku)) { scalar("Azure-SkuName", raw.sku.name); scalar("Azure-SkuTier", raw.sku.tier); scalar("Azure-SkuCapacity", raw.sku.capacity); }
        list("Azure-AvailabilityZones", raw.zones);
        if (raw.tags !== undefined) {
            if (raw.tags !== null && !object(raw.tags)) warn("Invalid resource tags; selected tag values were preserved.");
            else opts.tagKeys.forEach(function(key){
                var names = Object.keys(raw.tags || {}).filter(function(k){return C.lower(k) === C.lower(key);});
                if (names.length > 1) { warn("Ambiguous selected tag key " + key + "."); return; }
                scalar("Azure-Tag-" + key, names.length ? raw.tags[names[0]] : "");
            });
        }
        if (!detailed) return {properties:properties, references:[], warnings:warnings, complete:false};
        scalar("Azure-ProvisioningState", p.provisioningState);
        if (type === "microsoft.compute/virtualmachines") {
            scalar("Azure-VMSize", (p.hardwareProfile || {}).vmSize);
            scalar("Azure-OSType", ((p.storageProfile || {}).osDisk || {}).osType);
        }
        if (type === "microsoft.web/sites") {
            var site = p.siteConfig || {};
            scalar("Azure-Runtime", site.linuxFxVersion || site.windowsFxVersion);
            scalar("Azure-HttpsOnly", p.httpsOnly); scalar("Azure-MinimumTlsVersion", site.minTlsVersion);
            scalar("Azure-PublicNetworkAccess", p.publicNetworkAccess);
        }
        if (type === "microsoft.sql/servers") {
            scalar("Azure-Version", p.version); scalar("Azure-MinimumTlsVersion", p.minimalTlsVersion);
            scalar("Azure-PublicNetworkAccess", p.publicNetworkAccess);
        }
        if (type === "microsoft.sql/servers/databases") { scalar("Azure-DatabaseStatus", p.status); scalar("Azure-MaxSizeBytes", p.maxSizeBytes); }
        if (type === "microsoft.storage/storageaccounts") {
            scalar("Azure-AccessTier", p.accessTier); scalar("Azure-MinimumTlsVersion", p.minimumTlsVersion);
            scalar("Azure-HttpsOnly", p.supportsHttpsTrafficOnly); scalar("Azure-PublicNetworkAccess", p.publicNetworkAccess);
            scalar("Azure-AllowBlobPublicAccess", p.allowBlobPublicAccess);
        }
        if (type === "microsoft.network/publicipaddresses") { scalar("Azure-PublicIPAddress", p.ipAddress); scalar("Azure-IPAllocationMethod", p.publicIPAllocationMethod); }
        if (type === "microsoft.network/virtualnetworks") list("Azure-AddressPrefixes", (p.addressSpace || {}).addressPrefixes);
        if (type === SUBNET) {
            list("Azure-AddressPrefixes", p.addressPrefixes !== undefined ? p.addressPrefixes : p.addressPrefix ? [p.addressPrefix] : undefined);
            scalar("Azure-PrivateEndpointNetworkPolicies", p.privateEndpointNetworkPolicies);
            scalar("Azure-PrivateLinkServiceNetworkPolicies", p.privateLinkServiceNetworkPolicies);
        }
        function reference(value, path, expected, reverse) {
            if (value === undefined || value === null) return;
            if (typeof value !== "string" || !value) { warn("Invalid resource reference at " + path + "."); return; }
            var target;
            try { target = C.armId(value); var parts=target.split("/"); C.assert(parts.length>=9 && C.lower(parts[3])==="resourcegroups" && C.lower(parts[5])==="providers" && parts.slice(1).every(function(p){return p.length>0;}), "Expected an Azure resource reference."); }
            catch (ignored) { warn("Invalid resource reference at " + path + "; the value was omitted."); return; }
            references.push({source:reverse ? target : id, target:reverse ? id : target,
                sourceType:reverse ? expected : type, targetType:reverse ? type : expected,
                ownerId:id, property:path});
        }
        function refObject(value, path, expected, reverse, required) {
            if (value === undefined || value === null) { if(required)warn("Missing required resource reference at " + path + "."); return; }
            if (!object(value) || !value.id) { warn("Invalid resource reference object at " + path + "."); return; }
            reference(value.id, path + ".id", expected, reverse);
        }
        if (OWNERS.indexOf(type) >= 0 && !object(raw.properties)) warn("Network properties are unavailable; previous links will be preserved.");
        if (type === SUBNET) refObject(p.networkSecurityGroup, "properties.networkSecurityGroup", "microsoft.network/networksecuritygroups");
        if (type === "microsoft.network/networkinterfaces") {
            refObject(p.virtualMachine, "properties.virtualMachine", "microsoft.compute/virtualmachines", true);
            refObject(p.networkSecurityGroup, "properties.networkSecurityGroup", "microsoft.network/networksecuritygroups");
            if (!Array.isArray(p.ipConfigurations)) warn("NIC IP configurations are unavailable; previous links will be preserved.");
            else {
                var ips=[];
                p.ipConfigurations.forEach(function(ip){
                    if (!object(ip) || !object(ip.properties)) { warn("Malformed NIC IP configuration."); return; }
                    refObject(ip.properties.subnet, "properties.ipConfigurations[].properties.subnet", SUBNET, false, true);
                    refObject(ip.properties.publicIPAddress, "properties.ipConfigurations[].properties.publicIPAddress", "microsoft.network/publicipaddresses");
                    if (ip.properties.privateIPAddress) ips.push(ip.properties.privateIPAddress);
                });
                list("Azure-PrivateIPAddresses", ips);
            }
        }
        if (type === "microsoft.network/privateendpoints") {
            refObject(p.subnet, "properties.subnet", SUBNET, false, true);
            if (p.networkInterfaces !== undefined && !Array.isArray(p.networkInterfaces)) warn("Malformed private endpoint interfaces.");
            else (p.networkInterfaces || []).forEach(function(nic){refObject(nic,"properties.networkInterfaces[]","microsoft.network/networkinterfaces",false,true);});
            var statuses=[];
            if (!Array.isArray(p.privateLinkServiceConnections) && !Array.isArray(p.manualPrivateLinkServiceConnections)) warn("Private endpoint target connections are unavailable.");
            ["privateLinkServiceConnections", "manualPrivateLinkServiceConnections"].forEach(function(field){
                if (p[field] === undefined || p[field] === null) return;
                if (!Array.isArray(p[field])) { warn("Malformed private endpoint target connections."); return; }
                p[field].forEach(function(link){
                    var lp=link && link.properties;
                    if (!object(lp) || !lp.privateLinkServiceId) { warn("Private endpoint target resource ID is unavailable."); return; }
                    reference(lp.privateLinkServiceId,"properties." + field + "[].properties.privateLinkServiceId", "");
                    if ((lp.privateLinkServiceConnectionState || {}).status) statuses.push(lp.privateLinkServiceConnectionState.status);
                });
            });
            list("Azure-PrivateLinkStatuses",statuses);
        }
        return {properties:properties, references:references, warnings:warnings, complete:!!complete};
    }
    function create(client, progress, options) {
        progress = progress || function(){};
        var opts=C.settings(options);
        function inventory(snapshot) {
            var result={version:1,metadata:[],records:[],completedOwners:[],warnings:[],partial:false,stats:{graphPages:0,detailReads:0,subnets:0}};
            var tenant=C.guid(snapshot.tenantId), subs=snapshot.subscriptionIds.map(C.guid), current=Object.create(null), graph=Object.create(null);
            snapshot.resources.forEach(function(r){current[C.identity(tenant,r.id)]=r;});
            function warn(scope,message){result.warnings.push({scope:scope,message:message});progress("[WARNING] " + scope + ": " + message + " Continuing; unverified metadata and links will be preserved.");}
            subs.forEach(function(sub){
                if(!snapshot.resources.some(function(r){return r.subscriptionId===sub && TYPES.indexOf(C.lower(r.type))>=0 && C.lower(r.type)!==SUBNET;}))return;
                progress("Reading Resource Graph enrichment for subscription " + sub);
                C.attempt(result.warnings,"Resource Graph enrichment in " + sub,progress,function(){
                    var skip,seenTokens=Object.create(null),seenIds=Object.create(null),pages=0;
                    do {
                        var query={subscriptions:[sub],query:"Resources | where type in~ (" + TYPES.filter(function(t){return t!==SUBNET && snapshot.resources.some(function(r){return r.subscriptionId===sub && C.lower(r.type)===t;});}).map(function(t){return "'"+t+"'";}).join(",") + ") | project id,type,tenantId,location,kind,sku,zones,tags,properties | order by id asc",options:{$top:1000,resultFormat:"objectArray",allowPartialScopes:false}};
                        if(skip)query.options.$skipToken=skip;
                        var body=client.queryGraph(query);
                        if(!body || !Array.isArray(body.data))throw C.readError("Malformed Resource Graph page; detail reads will be attempted.");
                        result.stats.graphPages++;
                        C.assert(++pages<=100000,"Too many Resource Graph pages.");
                        body.data.forEach(function(raw){
                            C.assert(raw && typeof raw.id==="string" && typeof raw.type==="string","Resource Graph identity is missing.");
                            var id=C.armId(raw.id),key=C.identity(tenant,id);
                            C.assert(C.lower(id.split('/')[2])===sub && (!raw.tenantId || C.lower(raw.tenantId)===tenant),"Resource Graph returned an object outside the selected scope.");
                            C.assert(!seenIds[key],"Duplicate resource across Resource Graph pages.");seenIds[key]=true;
                            var r=current[key];if(!r)return; // Enrichment never introduces generic resources or proves deletion.
                            C.assert(C.lower(r.type)===C.lower(raw.type),"Resource Graph type disagrees with ARM inventory.");
                            graph[key]=project(raw,opts,true,false);
                        });
                        skip=body.$skipToken;
                        C.assert(skip===undefined || skip===null || typeof skip==="string","Invalid Resource Graph continuation token.");
                        if((body.resultTruncated===true || C.lower(body.resultTruncated)==="true") && !skip)throw C.readError("Resource Graph response was truncated without a continuation token.");
                        if(skip){C.assert(!seenTokens[skip],"Repeated Resource Graph continuation token.");seenTokens[skip]=true;}
                    } while(skip);
                });
            });
            snapshot.resources.forEach(function(r){
                var key=C.identity(tenant,r.id),type=C.lower(r.type),row=graph[key],source=row ? "Azure Resource Graph" : "ARM inventory";
                var topology=OWNERS.indexOf(type)>=0, start=result.warnings.length;
                if(type===SUBNET)result.stats.subnets++;
                if(topology || (!row && TYPES.indexOf(type)>=0)) {
                    if(type===SUBNET && r.infrastructure){row=r.infrastructure;source="Azure Resource Manager";}
                    else {
                        progress("Reading infrastructure details for " + r.name);
                        var read=C.attempt(result.warnings,"Infrastructure details for " + r.id,progress,function(){
                            result.stats.detailReads++;
                            return project(client.details(r),opts,true,true);
                        });
                        if(read.ok){row=read.value;source="Azure Resource Manager";}
                    }
                }
                var properties={};
                if(row) {
                    Object.keys(row.properties).forEach(function(k){properties[k]=row.properties[k];});
                    row.warnings.forEach(function(w){warn(r.id,w);});
                    row.references.forEach(function(ref){
                        var a=current[C.identity(tenant,ref.source)],b=current[C.identity(tenant,ref.target)];
                        if(!a || !b) { warn(r.id,"Referenced resource is outside the selected readable inventory (" + ref.property + ")."); return; }
                        if((ref.sourceType && C.lower(a.type)!==ref.sourceType) || (ref.targetType && C.lower(b.type)!==ref.targetType)) { warn(r.id,"Referenced resource has an unexpected type (" + ref.property + ")."); return; }
                        if(C.lower(ref.source)===C.lower(ref.target)) { warn(r.id,"Self-referencing infrastructure link was omitted."); return; }
                        ref=Object.assign({},ref,{readSource:source});result.records.push(ref);
                    });
                    if(topology && row.complete && result.warnings.length===start)result.completedOwners.push(key);
                }
                // Common fields just read by ARM take precedence over the potentially older Graph index.
                if(r.metadata) {
                    Object.keys(r.metadata.properties).forEach(function(k){properties[k]=r.metadata.properties[k];});
                    r.metadata.warnings.forEach(function(w){warn(r.id,w);});
                }
                if(Object.keys(properties).length)result.metadata.push({key:key,properties:properties,source:source,
                    coverage:result.warnings.length===start && (TYPES.indexOf(type)<0 || !!row) && (!topology || row.complete) ? "complete" : "partial"});
            });
            result.partial=result.warnings.length>0;
            return result;
        }
        return {inventory:inventory};
    }
    function plan(snapshot, modelPlan, allowed, progress) {
        var data=snapshot.infrastructure;if(!data)return;
        var resources=Object.create(null),operations=Object.create(null),bases=Object.create(null),groups=Object.create(null),incomplete=Object.create(null),warnings=[];
        snapshot.resources.forEach(function(r){resources[C.identity(modelPlan.tenantId,r.id)]=r;});
        modelPlan.operations.forEach(function(op){
            if(op.properties["Azure-ObjectId"] && !C.isEntraApplication(op.properties["Azure-ObjectType"])){
                var key=C.identity(modelPlan.tenantId,op.properties["Azure-ObjectId"]);operations[key]=op;bases[key]=op.base;
            }
        });
        data.metadata.forEach(function(row){
            var op=operations[row.key];if(!op)return;
            Object.keys(row.properties).forEach(function(k){op.properties[k]=row.properties[k];});
            op.properties["Azure-EnrichmentSource"]=row.source;
            op.properties["Azure-EnrichmentCoverage"]=row.coverage;
            op.properties["Azure-LastEnrichmentDate"]=modelPlan.clock.date;op.properties["Azure-LastEnrichmentTime"]=modelPlan.clock.time;
        });
        data.records.forEach(function(ref){
            var source=C.identity(modelPlan.tenantId,ref.source),target=C.identity(modelPlan.tenantId,ref.target),owner=C.identity(modelPlan.tenantId,ref.ownerId);
            var a=resources[source],b=resources[target],message;
            if(!a || !b || !bases[source] || !bases[target])message="Referenced resource is outside the selected readable inventory (" + ref.property + ").";
            else if((ref.sourceType && C.lower(a.type)!==ref.sourceType) || (ref.targetType && C.lower(b.type)!==ref.targetType))message="Referenced resource has an unexpected type (" + ref.property + ").";
            else if(source===target)message="Self-referencing infrastructure link was omitted.";
            else if(allowed && !allowed("association-relationship",bases[source],bases[target]))message="The mapped Archi types do not allow an infrastructure association.";
            if(message){incomplete[owner]=true;warnings.push({scope:ref.ownerId,message:message});if(progress)progress("[WARNING] " + ref.ownerId + ": " + message);return;}
            var key=JSON.stringify([source,target,"association-relationship"]);
            if(!groups[key])groups[key]={source:source,target:target,type:"association-relationship",evidence:[]};
            var evidence={ownerId:ref.ownerId,sourceId:ref.source,targetId:ref.target,property:ref.property,readSource:ref.readSource};
            if(!groups[key].evidence.some(function(e){return JSON.stringify(e)===JSON.stringify(evidence);}))groups[key].evidence.push(evidence);
        });
        modelPlan.infrastructure={pairs:Object.keys(groups).sort().map(function(k){return groups[k];}),completedOwners:data.completedOwners.filter(function(k){return !incomplete[k];}),stats:data.stats};
        modelPlan.warnings=(modelPlan.warnings || []).concat(data.warnings,warnings);
        modelPlan.partial=modelPlan.partial || data.partial || warnings.length>0;
        return modelPlan.infrastructure;
    }
    return {project:project,create:create,plan:plan,TYPES:TYPES,SUBNET:SUBNET};
}());
if (typeof module !== "undefined") module.exports = AzureInfrastructure;
