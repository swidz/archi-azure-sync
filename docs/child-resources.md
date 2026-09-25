# Service Bus, Azure Functions and SQL child resources

Run **scripts/Sync Azure.ajs** as usual. These collectors also run during **utils/Export Azure Inventory.ajs**. Icons remain optional in **utils/Apply Azure Appearance.ajs**; no diagrams are generated.

| Parent → child | Child ARM type | Default Archi type | Relationship |
| --- | --- | --- | --- |
| Service Bus namespace → queue | Microsoft.ServiceBus/namespaces/queues | Node | Composition |
| Service Bus namespace → topic | Microsoft.ServiceBus/namespaces/topics | Node | Composition |
| Function App → function | Microsoft.Web/sites/functions | Technology Function | Assignment |
| SQL logical server → database | Microsoft.Sql/servers/databases | Node | Serving |

All generated relationship Name fields are blank. Sync also clears old or custom names on existing script-owned links in the selected scope, including SQL serving links, while preserving relationship identity. Matching manual relationships keep their names.

The relationship source is the parent and the target is the child. Existing subscription/resource-group compositions remain. Individual Technology Functions are linked through their Function App rather than by a direct resource-group composition, which Archi does not permit.

Archi rejects composition from a Node to a Technology Function. This package uses the valid assignment relationship. To prefer Function Nodes with composition, change that row in config/specializations.js to node before importing. For existing Functions, changing the mapping stops before model mutation until you explicitly migrate the concept type in Archi. IDs are never silently replaced.

Each supported child has Azure-ParentObjectId set to its namespace, Function App or SQL server ARM ID. Other requested Azure properties and creation/deletion/last-sync timestamps follow the existing rules. Folder organization remains Azure / subscription / resource group / full ARM type; children keep their actual resource group.

## Collection and permissions

Use the same tenant, selected subscriptions and interactive authentication method as Sync. The account needs management-plane read access to the parents and child collections. Custom roles may omit those reads, and the Function runtime may be unavailable; request failures are printed as warnings and other readable collections continue. No Service Bus connection strings, function keys, SQL credentials or data-plane access are used.

- Service Bus uses the namespace queues and topics lists. Basic-tier namespaces collect queues only because topics are not supported. If generic ARM metadata omits the SKU, the namespace is read to determine it. Topic subscriptions, rules, dead-letter subqueues and messages are not additional imported elements.
- Function Apps are recognized from the site kind, including combined values such as functionapp,linux. If kind is missing, site metadata is read before deciding. Individual functions of the production app are collected; deployment slots are not expanded. Source files, configurations, test data, function keys and invocation URLs are not copied into inventory exports or the Archi model. The script does not call listkeys, invoke functions, or call the SCM/data-plane host directly.
- Azure SQL databases are listed under Microsoft.Sql/servers. System databases such as master are included when Azure returns them. Databases also returned by generic ARM inventory are merged by tenant plus ARM ID. SQL managed instances, SQL on VMs, tables and schema objects are not expanded by this collector.

Successful pages are retained if a later request fails. Denied queues do not block topics, Functions or SQL databases; available child records still synchronize. If a subscription has any collection or verification failure, no absent resources in that subscription are marked deleted. Unreadable existing children and their relationships retain their properties and timestamps. Missing entries still receive individual GET checks. Recognized Function NotFound and Service Bus MessagingEntityNotFound responses require completed parent collection coverage. Scope violations and duplicate identities remain fatal. See [partial synchronization](partial-sync.md). Collection and verification are not a transactional Azure snapshot; changes during collection can require a retry.

Repeated syncs reuse concepts by Azure identity and relationships by actual source and target Archi GUIDs plus type. Generated links live in **Relationships → Azure → Source subscription → Source resource group (or Other) → Source object type** (or the configured AZURE_ROOT_FOLDER); existing owned links in the selected scope are relocated there on the next sync without changing their GUIDs. Manually authored matching relationships retain their names, properties and folders and are not taken over. Owned composition, assignment and serving links share soft-deletion/restoration behavior: they remain in the model, preserving IDs and original creation timestamps. No existing diagrams are formatted by Sync.

## Documented APIs

All endpoints are GET requests to management.azure.com and use the existing ARM token:

| Collection | API version | Reference |
| --- | --- | --- |
| namespace/queues | 2024-01-01 | [Queues List By Namespace](https://learn.microsoft.com/en-us/rest/api/servicebus/controlplane/queues/list-by-namespace?view=rest-servicebus-controlplane-2024-01-01) |
| namespace/topics | 2024-01-01 | [Topics List By Namespace](https://learn.microsoft.com/en-us/rest/api/servicebus/controlplane/topics/list-by-namespace?view=rest-servicebus-controlplane-2024-01-01) |
| site/functions | 2025-03-01 | [Web Apps List Functions](https://learn.microsoft.com/en-us/rest/api/appservice/web-apps/list-functions?view=rest-appservice-2025-03-01) |
| server/databases | 2023-08-01 | [Databases List By Server](https://learn.microsoft.com/en-us/rest/api/sql/databases/list-by-server?view=rest-sql-2023-08-01) |

Missing individual Functions use [Get Function](https://learn.microsoft.com/en-us/rest/api/appservice/web-apps/get-function?view=rest-appservice-2025-03-01). Microsoft documents the Basic-tier restriction in its [Service Bus topics quickstart](https://learn.microsoft.com/en-us/azure/service-bus-messaging/service-bus-quickstart-topics-subscriptions-portal).

## First run after upgrading

1. Open a copy of your model and run Sync with your usual subscription IDs.
2. Review the additional child-element and relationship counts. Existing database Nodes should be updates rather than duplicates.
3. Inspect the Function element type, Azure-ParentObjectId, and relationship directions under **Relationships → Azure**, grouped by source subscription, group and type. Namespace links go under Microsoft.ServiceBus/namespaces, Function App links under Microsoft.Web/sites, and SQL server links under Microsoft.Sql/servers.
4. Run Sync again and check that no duplicate child Nodes/functions or relationships appear.
5. If desired, place children in your own view and run the separate appearance utility for icons.

Offline collector tests and actual Archi model tests cover these paths. A live child-collection run using your account remains to be performed; your older exported inventory cannot establish current function/queue/topic visibility.
