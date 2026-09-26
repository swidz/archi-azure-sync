# Connection discovery

Version 0.12 reads configuration from **App Services and Function Apps** and creates relationships to recognizable Azure resources. Run **Sync Azure.ajs** normally; the main script enables discovery with:

```javascript
var AZURE_DISCOVER_CONNECTIONS = true;
```

Set it to false to skip all connection-configuration requests and leave previously discovered connection relationships untouched. Export Azure Inventory has its own flag with the same default. No new plugin or runtime is required. This feature uses the existing ARM token, independently of Microsoft Graph.

## Setup and first run

1. Update the whole package, including lib/connections.js and both updated entry points. Preserve your mapping and script settings.
2. Ensure the signed-in user can read application settings and connection strings for the relevant apps. The relevant Azure action is **Microsoft.Web/sites/config/list/action**; ordinary subscription Reader access does not supply that action. Your administrator can grant an appropriately scoped role. The script never changes Azure permissions.
3. Select subscriptions containing **both the application and its referenced resources**. Cross-subscription matching is supported within the same tenant.
4. Run Sync Azure.ajs. Review **Connection relationships to ensure** and any output warnings, then apply the preview.
5. Inspect the relationships under Relationships / Azure / source subscription / source group / source object type. Open their Properties to see sanitized connection evidence. Save/commit using your normal model workflow.

Access denied, expired tokens, network errors, unresolved references and ambiguous targets produce warnings. The rest of inventory synchronization continues. No diagrams or diagram connections are generated; add model relationships to your own views as usual.

## Relationships inferred

| Configuration evidence | Model relationship |
| --- | --- |
| Azure SQL server/database connection | SQL database (or server when no database is specified) → app: Serving |
| Service Bus namespace or EntityPath connection | Namespace, queue or topic → app: Serving |
| Storage connection or identity endpoint | Storage account → app: Serving |
| Function Service Bus queue/topic trigger | Queue/topic → individual Function: Triggering |
| Function Storage queue/blob trigger | Storage account → individual Function: Triggering |
| Supported Function output binding | Individual Function → queue/topic/storage account: Flow |
| Supported non-trigger input binding | Queue/topic/storage account → individual Function: Flow |

The standard Function mapping remains Technology Function. The script checks each inferred relationship against Archi's allowed relationship rules before application. Unsupported custom element combinations produce warnings.

A connection string by itself supplies dependency evidence, so it creates Serving. Triggering and Flow require a supported Function binding and its direction. These are **configured** relationships, not proof that a connection has been used or that a function is running. Available disabled-function metadata is included in bindingDisabled within the evidence.

For bindings, the script resolves connection setting names, AzureWebJobs aliases, the default AzureWebJobsServiceBus/AzureWebJobsStorage settings, %SettingName% entity references, and common managed-identity endpoint settings such as Bus__fullyQualifiedNamespace or Storage__queueServiceUri. Exact connection values take precedence over identity setting prefixes. A setting consumed by a supported binding does not also generate a redundant app-level Serving relationship.

Service Bus topic triggers store the configured subscriptionName as evidence and connect the imported topic Node to the Function. They do not invent a topic-subscription element. Storage bindings connect at storage-account level; container/blob/queue path metadata is retained without inventing uncollected child resources.

## Relationship properties

Relationship names remain blank. Each connection relationship is matched by **actual source Archi GUID + target Archi GUID + relationship type**, across the whole model, and retains its GUID on repeat synchronization.

| Property | Value |
| --- | --- |
| Azure-ConnectionName | Application setting or connection-string name |
| Azure-ConnectionString | Reconstructed, sanitized connection details |
| Azure-ConnectionSource | ApplicationSettings, AppServiceConnectionStrings or FunctionBinding |
| Azure-ConnectionEndpoint | Recognized endpoint hostname |
| Azure-ConnectionSanitized | yes |
| Azure-ConnectionCoverage | complete or partial for the contributing app configuration |
| Azure-ConnectionEvidence | JSON list of sanitized records, including owning app, consumer, setting name, endpoint, database/entity and binding details |
| Azure-RelationKind | connection, distinguishing these from structural relationships |

When multiple settings resolve to the same endpoints and relationship type, a single relationship retains every evidence record. The convenience properties above use a JSON array when multiple distinct values exist. Endpoint GUID/ARM ID properties and Created/Deleted/LastSync properties follow the existing conventions. Azure-SubscriptionId on the relationship follows its **source**, including cross-subscription links.

Example:

```text
Azure-ConnectionName = OrdersDatabase
Azure-ConnectionString = Server=sql-prod.database.windows.net;Database=Orders;Credentials=[REDACTED]
Azure-ConnectionSource = AppServiceConnectionStrings
Azure-ConnectionSanitized = yes
```

Matching manual or differently managed relationships are reused without changing their names, properties or folders; a notice is printed. The script does not take ownership or add connection properties to those manual links.

## Credential handling

Raw settings are read transiently in memory. The script constructs stored values from a small allowlist of recognizable hostnames, database/entity names and authentication markers; it does not save a raw connection string and then attempt to mask selected words. Passwords, usernames, shared keys, SAS queries, URI credentials and unknown connection-string fields are excluded from snapshots, model properties and logs. Quoted/escaped SQL credentials are parsed without exposing their content.

Retained raw dictionary references are cleared before returning. As with access tokens, JavaScript/JVM memory does not provide guaranteed immediate secure erasure. Key Vault and App Configuration secret references are not dereferenced, service access keys are not requested, and endpoints found in settings are never contacted.

## Partial reads and removal

Readable connections can still be added or updated if another configuration request fails. Existing evidence from an incompletely read app is retained and combined with new readable evidence. A completely unreadable relationship is left unchanged.

When an app's configuration and supported binding discovery finish without warnings, relationships no longer supported by that configuration are soft-deleted, provided both endpoints are in the selected, reconciled scope. They are not physically removed. Repeated absence preserves deletion time; restoration reuses the original GUID and creation time. Disabling discovery, losing access, unresolved targets or selecting only one endpoint's subscription protects prior relationships from retirement. If an app's deletion is independently reconciled, its existing evidence can also be retired when both endpoints were reconciled.

Configuration warnings do not invalidate an otherwise complete ARM resource inventory. Resource deletion remains governed by ARM coverage; inferred connection retirement is separately governed by app configuration coverage. The overall run is partial when either reports warnings.

## Coverage and limits

Matching uses supported public Azure endpoint formats and resource IDs from the **current readable inventory of selected subscriptions**. It requires exactly one target. It does not guess from display names, create placeholders, resolve private DNS/custom aliases or scan credentials for arbitrary resource names. A database name that has no matching database does not silently fall back to its server.

This first version does not expand deployment slots, containers, Logic App workflows, Event Hubs, Redis, Cosmos DB, PostgreSQL/MySQL, SDK calls inside application source code, or custom connection formats. Unknown dedicated connection strings are reported. Unrelated app settings are ignored; settings that look like unsupported connection details are reported. Entra app registrations are not consumers in this collector.

Export Azure Inventory remains schemaVersion 3 and gains an optional connections section with version, records, completedOwners, warnings and partial. Only sanitized evidence enters it. Connection discovery reruns during Sync; exports are not imported.

## API references

- [List connection strings](https://learn.microsoft.com/en-us/rest/api/appservice/web-apps/list-connection-strings?view=rest-appservice-2025-03-01)
- [List application settings](https://learn.microsoft.com/en-us/rest/api/appservice/web-apps/list-application-settings?view=rest-appservice-2025-03-01)
- [List functions and configuration](https://learn.microsoft.com/en-us/rest/api/appservice/web-apps/list-functions?view=rest-appservice-2025-03-01)
- [Function Service Bus bindings](https://learn.microsoft.com/en-us/azure/azure-functions/functions-bindings-service-bus-trigger)
- [Azure identity-based connection settings](https://learn.microsoft.com/en-us/azure/azure-functions/functions-identity-based-connections-tutorial)

App settings and connection strings use documented **POST .../list** read operations; this does not modify the app. Function metadata uses GET. The script makes no Azure write/deploy/delete call.
