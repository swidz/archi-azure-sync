# Azure resources for Archi

Synchronize Azure Resource Manager inventory and Entra app registrations into an existing, selected Archi model using jArchi. **Run scripts/Sync Azure.ajs for everyday use.** The scripts in scripts/utils are optional inspection and maintenance tools.

**[User manual: installation from GitHub, first run, and subsequent runs](docs/user-manual.md)** · [Azure connection options](docs/authentication.md)

Resources default to ordinary Technology-layer **Nodes**; individual Azure Functions use **Technology Function**. Elements are organized under **Azure → Subscription → Resource group (or Other) → Object type**. Existing managed elements are moved into this hierarchy on the next applied sync. Their IDs, relationships and diagram layout are preserved.

**Icons are optional. Sync Azure.ajs does not add custom images or change diagram image/text placement.** Run **scripts/utils/Apply Azure Appearance.ajs** only if you want Azure icons on Nodes you have manually placed in views. It runs locally, without Azure authentication. Bundled images have a maximum dimension of **48 pixels**; the utility defaults to images at **Top Center** and names at **Bottom Center**. Specializations remain off by default.

Sync creates **unnamed composition relationships** from each subscription to its resource groups and from each resource group to its Node resources. It also collects Service Bus queues/topics, individual Azure Functions and SQL databases with the [service relationships described here](docs/child-resources.md). Generated relationships follow their **source object** under **Relationships → Azure → Source subscription → Source resource group (or Other) → Source object type**, using the same AZURE_ROOT_FOLDER setting. Repeated runs search the entire model by actual **source element GUID + target element GUID + relationship type** and reuse existing links. **No script generates diagrams or diagram connections.**

Entra app registrations are imported as **Nodes** under **Azure → Entra ID [tenant GUID] → App registrations**. This is enabled by default and requires Microsoft Graph read access. Denied Graph access is reported in the Scripts output window; readable ARM resources still synchronize. See [Entra setup and scope](docs/entra-applications.md) before your first upgraded run; set AZURE_INCLUDE_ENTRA_APPLICATIONS=false for ARM-only sync.

Connection discovery reads App Service/Function App configuration and creates **Serving**, **Triggering** and **Flow** relationships where supported configuration identifies a unique target. Only sanitized connection details are stored on relationships. Enabled by default; see [connection discovery, permissions and coverage](docs/connections.md).

## Quick start

1. From this GitHub repository choose **Code → Download ZIP** and extract the whole package, or clone the HTTPS URL from Code.
2. Install **Archi 5.8+ / Java 21 and jArchi 1.12+**, using the GraalVM JavaScript engine. No Node.js, Python or extra JARs are needed for normal use.
3. Put the complete package in your existing jArchi Scripts folder, or point **Preferences → Scripting → Scripts folder** at this package's scripts directory. Keep lib, config and assets beside scripts. See the [manual](docs/user-manual.md#3-make-the-scripts-visible) for links and other installation options.
4. [Connect to Azure](docs/authentication.md): either run **az login** using Azure CLI 2.54+ and select **Azure CLI (no own app registration)**, or choose direct device sign-in using your public-client app. Both methods support user sign-in/MFA without a client secret in the model.
5. Select a test model, run **Sync Azure.ajs**, enter tenant/subscription IDs, review the preview and apply. No utility script is required first.
6. Review, save and commit the model using your usual workflow. **Optional:** after manually placing elements in a view, run **utils/Apply Azure Appearance.ajs** if you want icons and label positioning. Skip it for plain Archi shapes.

All selected subscriptions in one run must belong to the specified tenant. Enabled Entra collection reads that whole tenant once, independently of the subscription list. Unselected subscriptions and other tenants' elements remain untouched. Azure public cloud is supported.

## Script settings

At the top of scripts/Sync Azure.ajs:

~~~javascript
var AZURE_ROOT_FOLDER = "Azure";
var AZURE_USE_SPECIALIZATIONS = false;
var AZURE_INCLUDE_ENTRA_APPLICATIONS = true;
var AZURE_DISCOVER_CONNECTIONS = true;
~~~

Set AZURE_DISCOVER_CONNECTIONS=false to skip configuration reads and preserve previously discovered connections. The Export utility has its own flag.

Subscription folder labels include display name and GUID. Full ARM types form single folder labels. Missing resource groups use Other; a real group named Other is labelled Other (resource group). Changing the root name renames the managed roots under Technology & Physical and Relationships. Empty folders are retained.

Optional appearance settings live in **scripts/utils/Apply Azure Appearance.ajs**:

~~~javascript
var AZURE_IMAGE_POSITION = "top-center";
var AZURE_TEXT_POSITION = "bottom-center";
~~~

Positions accept top/middle/bottom combined with left/center/right, for example "top-center" or "bottom-right". Image position also accepts "fill", which scales the image to the shape. Sync does not read or save these settings.

## Scripts

| Entry point | Purpose |
| --- | --- |
| scripts/Sync Azure.ajs | Collect and verify inventory, preview changes, create/update/soft-delete elements, organize folders and ensure composition relationships. Does not add custom images or format diagrams. |
| scripts/utils/Apply Azure Appearance.ajs | Optional: locally apply custom icons and image/name positions to managed Azure objects already placed in views. No Azure connection or sync-timestamp changes. |
| scripts/utils/Export Azure Inventory.ajs | Save actual inventory as JSON without modifying the model. |
| scripts/utils/Discover Azure Resource Types.ajs | Export provider-advertised types for manual catalog review; does not merge them automatically. |
| scripts/utils/Manage Azure Specializations.ajs | Optional offline bulk profile maintenance, explicitly guarded by its own false-by-default flag. Not needed for synchronization. |

config/specializations.js contains **3,407 editable type/base/icon mappings** (3,406 ARM types plus the curated Microsoft.Graph/applications entry) even when profile creation is disabled. All shipped base types are Node except Microsoft.Web/sites/functions, which uses technology-function; unmapped types use Node, with the generic Azure icon only when the appearance utility is run. The V24 archive contributes **714 PNG icons**, reused across resource types. Commenting out a mapping does not filter inventory. Existing custom images remain until you change or remove them in Archi; skipping the appearance utility does not remove previously applied images. See [catalog and icons](docs/catalog.md).

## Element properties

| Property | Meaning |
| --- | --- |
| Azure-TenantId | Subscription tenant, verified against Azure metadata |
| Azure-SubscriptionId | Selected subscription GUID |
| Azure-SubscriptionName | Subscription display name |
| Azure-ObjectId | Full ARM resource ID for infrastructure; directory Object ID GUID for Entra app registrations |
| Azure-ObjectType | ARM type, such as Microsoft.Compute/virtualMachines, or Microsoft.Graph/applications |
| Azure-ApplicationId | Application (Client) ID for Entra registrations; empty on ARM elements |
| Azure-ObjectName | Name returned by Azure |
| Azure-ResourceGroupId | Full resource-group ARM ID, empty for subscription-level objects |
| Azure-ResourceGroupName | Group name, empty for subscription-level objects |
| Azure-ParentObjectId | Namespace, Function App or SQL server ARM ID for the supported child types; otherwise empty |
| Azure-URL | Tenant-specific Azure portal link for ARM; Graph application endpoint for Entra |
| CreatedDate, CreatedTime | First creation in this Archi repository, not Azure provisioning time |
| DeletedDate, DeletedTime | First confirmed absence; empty while active; preserved on repeated absent runs |
| LastSyncDate, LastSyncTime | Latest **successful** reconciliation of the selected element, including deleted elements |
| IsDeleted | yes or no |
| Azure-SyncManagedBy | Ownership marker: archi-azure-sync/v1 |

Dates use YYYY-MM-DD; times use UTC HH:mm:ssZ. One timestamp is used for the run. Restoration retains the element ID, relationships and original Created values and clears Deleted values. Resource elements are never physically deleted.

LastSync values advance for elements successfully reconciled in the applied run, including unchanged readable resources. Unverified elements retain all their existing properties and timestamps during partial runs. Cancelled runs do not apply changes. See [partial synchronization and output warnings](docs/partial-sync.md).

Resource groups and subscriptions are also Nodes. A group's resource-group properties refer to itself; a subscription's are empty.

## Composition relationships

The whole is the source and the part is the target: **subscription → resource group → resource**. Node resources returned by inventory link directly to their resource group. Technology Functions link through their Function App using assignment, because Archi rejects Node-to-Technology-Function composition. Links are ArchiMate composition relationships in the model with blank Name fields. Add existing relationships to a view manually when needed.

All synced relationship Name fields are blank, including SQL server-to-database serving links. Each applied sync clears any existing names on script-owned relationships in the selected tenant/subscriptions, including manually edited names and soft-deleted links. Connection-discovery links follow the separate per-app coverage rules in the connection guide. Relationship types, endpoint GUIDs, folders and creation dates are preserved. Matching manually authored relationships retain their names.

Existing composition, assignment and serving relationships are matched using their actual source and target Archi element GUIDs, with type as an additional qualifier. Names, folders and cached properties do not determine identity. Manually authored matching relationships keep their names, properties and folders. On the next applied sync, existing script-owned links in the selected tenant/subscriptions move into the source-based hierarchy under **Relationships → Azure**, retaining their relationship GUIDs, creation timestamps and diagram references. Script-owned links carry Azure-SourceElementId and Azure-TargetElementId (Archi GUIDs), Azure-SourceObjectId and Azure-TargetObjectId (ARM IDs), tenant/subscription IDs, ownership and creation/deletion/last-sync timestamps. Cached endpoint properties are refreshed from the actual endpoints. They are retained and marked deleted when either endpoint is soft-deleted, and restored when both endpoints return. Unselected subscriptions remain untouched.

**Other** is only a folder. Resources without a resource group receive no invented group or group relationship. A missing parent Node is reported in the preview and its link is skipped. The explicit service links are namespace → queue/topic composition, Function App → Technology Function assignment, and SQL server → database serving. Connection discovery additionally infers dependencies and supported Function binding interactions from configuration; it does not infer arbitrary application calls or network topology.

For example, namespace-to-queue links are placed under Microsoft.ServiceBus/namespaces, Function App-to-function links under Microsoft.Web/sites, and SQL server-to-database links under Microsoft.Sql/servers. Subscription-to-group links use Other / Microsoft.Resources/subscriptions because the source subscription has no resource group. The source name is not an additional folder level.

## Model configuration and Git

The script stores only non-secret configuration and synchronization metadata:

- Azure-AuthMethod — selectable device-code or azure-cli authentication, remembered after successful sync.
- Azure-TenantId, Azure-ClientId, Azure-SubscriptionIds — next-run defaults; CLI does not require a client ID.
- Azure-LastSuccessfulSyncAt, Azure-LastSuccessfulSyncSubscriptions — last fully completed applied run; partial runs do not advance these.
- Azure-LastSuccessfulEntraSyncAt — last complete applied Entra inventory.
- Azure-LastSyncAttemptAt, Azure-LastSyncStatus, Azure-LastSyncWarningCount — latest applied run time, complete/partial status and collection warning count.
- Azure-SyncSpecializations — ownership registry for managed profiles.

An optional Azure-UserId property may document an expected account but is not used to authenticate; the browser determines the signed-in account. There is no password/secret prompt or token storage in the model. Direct device sign-in has no persistent token cache and requests no offline_access scope. The CLI option reuses Azure CLI's own local authentication cache, which must stay outside your Git repositories. Both methods hold the current token in memory during the run and clear the retained reference afterward. JVM memory cannot guarantee immediate secure erasure.

The **script repository** is separate from the **model repository**. Scripts do not automatically save, commit or publish models. Custom image, folder and optional specialization save/reload are tested; check your team's coArchi/coArchi2 round trip with its installed version.

## Reconciliation and failures

- ARM identity is case-insensitive **tenant ID + ARM resource ID**; Entra applications use a separate tenant + Graph Object ID identity.
- Collection finishes before model application. Recoverable read failures are printed as warnings, and readable inventory is still offered for application.
- Pagination stays on the selected subscription and fixed ARM host; redirects are disabled.
- HTTP 429/5xx receive bounded retries. Permission/consent errors, unavailable subscriptions, expired tokens, network failures, malformed list pages and exhausted retries skip the affected reads and continue. Tenant/identity mismatches, unsafe pagination and duplicate identities still stop before mutation.
- Missing list entries are individually fetched using supported API versions. Only recognized resource-not-found responses in a completely read subscription or Entra tenant permit deletion. Any incomplete read disables deletion for that subscription, or for the Entra app collection. HTTP 403 and uncertain 404s never mean deletion.
- A move/rename that changes the ARM ID creates a new identity and soft-deletes the old identity after verification.
- Descriptions, unrelated properties, relationships and diagram layouts survive. Azure-owned names/properties refresh.
- Base-type changes stop with an explanation; change the type deliberately in Archi first.
- Sync never loads icon assets, including when specialization creation is enabled. New profiles created by Sync have no image; existing profile images are retained. The optional Manage Azure Specializations utility can install profile icons, which Archi may display through its own profile inheritance. Sync does not switch any diagram image source.
- Specializations are opt-in. With the flag off, scoped script-owned assignments are detached, while definitions and unowned assignments remain. The guarded utility can explicitly remove owned profiles.
- Read failures are reported in the Scripts output window and summarized in the preview/final dialog. Unknown errors and model conflicts still stop; an exceptional failure during application can leave partial in-memory changes, so use **Edit → Undo** before retrying. The script uses public jArchi undoable APIs.

Partial runs update owned relationships only when both endpoints were reconciled; links involving unreadable endpoints remain unchanged. See [error handling and partial-run examples](docs/partial-sync.md).

To **explicitly adopt** an existing manually maintained Azure element, set its exact Azure-TenantId, Azure-SubscriptionId, Azure-ObjectId, Azure-ObjectType, original CreatedDate/CreatedTime, and Azure-SyncManagedBy=archi-azure-sync/v1. Ensure only one concept has the identity. Otherwise identity collisions are rejected.

## Inventory coverage

This release inventories Azure public cloud's **generic ARM Resources List**, selected resource groups and subscription containers, plus dedicated lists for **Service Bus queues/topics, Function App functions, and Azure SQL logical-server databases**. It follows every page and imports any returned resource type, even if absent from the catalog. Microsoft Graph additionally lists app registrations from the selected tenant when enabled.

A type catalog does not imply that Azure's generic listing returns every object of that type. Other nested resources, such as subnets, still require additional collectors. Function deployment slots, Service Bus topic subscriptions and SQL managed-instance databases are not expanded by these new collectors. Entra users/groups, enterprise applications/service principals, managed identities, agent identity blueprints, blobs, Kubernetes workloads, SaaS data, other tenant/management-group objects and sovereign clouds are outside this release. Subscription/resource-group containment, documented service relationships and supported configuration-derived connections are created; diagrams are never generated. The export covers ARM infrastructure and enabled Entra app registrations; it is not a universal Azure CMDB.

Individual missing-resource checks reduce false deletions from incomplete visibility. A provider's authorization-masked 404 still cannot be distinguished with certainty from deletion. Use a stable account with subscription-wide Reader permissions and review deletion counts.

See [design and research](docs/design.md) for SDK alternatives, torchlight-azure and sources.

## Development

Node.js 20+ is needed **only for offline development tests**:

~~~text
npm test
npm run check
~~~

The real-runtime **tests/archi-smoke.ajs** creates a disposable model, checks jArchi APIs, embeds icons, saves/reloads, preserves relationships and installs the complete catalog twice. Run through jArchi/ACLI in a separate test workspace. Outputs go to the ignored work directory. Archi CLI can return exit code zero after a script error: require the **ARCHI_AZURE_SMOKE_PASSED** marker and a fresh work/archi-smoke-result.json.

See the [verification record](docs/verification.md) for executed checks and remaining live-tenant validation.
