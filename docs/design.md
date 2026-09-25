# Design and source review

Reviewed 2026-09-25. This is a jArchi JavaScript package, not an Archi modification or Eclipse plugin.

## Library choices

| Option | Assessment |
| --- | --- |
| Azure SDK for Java: azure-resourcemanager-resources + azure-identity | Supported Microsoft libraries for inventory and device credentials. GraalVM jArchi supports Java.addToClasspath() for external JARs. Packaging transitive dependencies and checking compatibility with Eclipse adds deployment work. |
| MSAL4J | Supported authentication alternative for a future separately packaged Java helper. Microsoft recommends supported authentication libraries where feasible. |
| Azure CLI | **Implemented as an optional authentication method.** jArchi invokes the local CLI for an existing interactive user session and separate ARM/Graph tokens; no custom app registration is needed. CLI 2.54+ is an optional dependency and owns its local authentication cache. |
| Python / Node helper | Not required. Inventory and model reconciliation remain inside jArchi. |
| Java standard HTTPS library + documented Azure REST | **Implemented for inventory and direct device sign-in.** Already in Archi's runtime. Selecting Azure CLI additionally uses a bounded local subprocess for authentication. |

The adapter uses java.net.HttpURLConnection through Java.type. Protocol logic, scope/paging checks and reconciliation are separately testable without credentials.

- lib/core.js — identity, scope, mappings, properties and change planning.
- lib/azure-client.js — device authorization, inventory, pagination/retries, discovery and deletion verification.
- lib/entra-applications.js — projected Microsoft Graph application collection, validated pagination, individual missing-object checks and isolated tenant-scoped planning.
- lib/java-runtime.js — Java HTTPS and file operations.
- lib/azure-cli.js — CLI session/token validation and safe command construction.
- lib/azure-cli-java.js — cross-platform CLI discovery and bounded subprocess execution; stdout stays in memory and stderr is discarded.
- lib/archi-adapter.js — stable managed folder identities, concept relocation, custom diagram icons, explicit ARM containment compositions and optional profile lifecycle.
- lib/app.js — dialogs, configuration and change preview.
- config/specializations.js — editable resource-type mapping.

Collection and validation complete before application. This is not a distributed transaction: Azure may change during collection. No Azure write/delete API is called.

## Folder and image behavior

Each element remains in its built-in Technology/Physical layer, below a configurable managed root, subscription, resource group (or Other), and full ARM type. Folders are keyed by properties rather than their display names. Subscription IDs distinguish identical display names. Renames reuse folder IDs; empty folders are retained and unselected elements are untouched. Unowned folder-name conflicts stop application and can require Undo.

Relationships have their own managed root under Archi's Relationships category, using the same AZURE_ROOT_FOLDER name. Below it, the same folder resolver used for elements creates source subscription → source resource group (or Other) → full source ARM type. It reads rel.source properties after concept updates; target properties and relationship labels do not determine the folder. Subscription-source links use Other, and real resource groups named Other remain distinct. No source-name or relationship-type folder is added. The adapter finds built-in categories by ancestry, so translated labels work. Root folder keys are scoped by parent folder GUID; the Technology and Relationships roots are independent. Existing owned relationships in the selected scope are moved with Folder.add(), preserving IDs and diagram references. Manual matching relationships and unselected links retain their folders.

Specializations default off. Scoped assignments owned by this script are detached, but profile definitions and unowned assignments are retained. Sync never prepares or loads icon files and never changes diagram custom images, image sources, image positions or text placement. Even opt-in Sync profile creation is metadata-only: new profiles have no images, and existing profile images are retained. The separate guarded profile manager can still install profile icons.

The optional offline Apply Azure Appearance utility owns diagram formatting. It finds existing managed Azure occurrences through objectRefs(), imports custom images and applies its own image/text variables (Top Center and Bottom Center by default). It never contacts Azure or updates sync timestamps. Bundled icons have a maximum dimension of 48 pixels. Existing shape bounds and links are preserved. Previously applied custom images are retained by Sync, including after users decide to stop running the utility.

Entra app registrations use Node and a separate tenant/Object-ID identity. ARM validation ignores the explicit Microsoft.Graph/applications type; Graph validation does not accept ARM identities. App collection is enabled by the main/export script flag and uses a separate Graph token acquired through the chosen authentication method. ARM and Graph collection/validation finish before a combined plan is applied. Disabling Graph leaves existing apps unchanged. App Nodes live under Azure / Entra ID [tenant GUID] / App registrations and have no invented subscription/group links.

## Explicit containment relationships

Core planning builds tenant-qualified, case-insensitive parent/child identities from ARM IDs. Subscription Nodes compose resource group Nodes; group Nodes compose their member Node resources. Namespace Nodes additionally compose queues/topics, Function App Nodes assign Technology Functions, and SQL server Nodes serve database Nodes. Node-to-Technology-Function composition is rejected by Archi; Technology Functions therefore have no direct resource-group composition. Subscription-level resources do not acquire a synthetic Other parent. Missing parent Nodes are counted in the preview and skipped.

After all concept operations, the adapter scans the entire model and indexes existing composition, assignment and serving relationships by actual source.id, then target.id, then relationship type, adding only missing directed links. Diagram occurrences are normalized to concepts and deduplicated by relationship GUID. Labels, folders and cached metadata never form lookup keys. Existing manual matching links remain unowned and unchanged. All generated links have blank names; applying a sync also clears any existing name on owned links after checking the selected tenant/subscription scope, including links with deleted endpoints. Cleanup changes the Name field without replacing the relationship or changing its type. Owned links record Azure-SourceElementId/Azure-TargetElementId from actual Archi GUIDs and Azure-SourceObjectId/Azure-TargetObjectId from ARM identities, refreshing stale cached values. They also carry lifecycle metadata; confirmed endpoint deletion marks the link deleted, and restoration clears its deletion timestamp without replacing its identity. Updates are restricted to owned endpoints in the selected tenant and subscriptions. Links remain model concepts: production scripts never create views or diagram connections.

## Coverage

Inventory uses subscription Get, resource-group List and generic Resources List, then explicit [Service Bus, Functions and SQL child collectors](child-resources.md). Generic and child endpoint records merge only when the same child ARM identity appears in distinct sources. Duplicates within a single endpoint remain errors. Missing parents already in the model are verified before expansion, so recovered parents also have their children collected. Provider metadata supplies supported API versions for individually checking missing resources and exporting available types.

Resource Graph was considered, but indexed/type-specific coverage and permission-dependent results complicate absence handling. The implementation instead uses direct ARM lists plus individual checks. Neither a type catalog nor generic ARM inventory replaces every service's child/data-plane API.

All child collectors run before application, finish every page and fail the scope on errors; never turn a failed collector into an empty list.

## torchlight-azure

Inspected [archilight/torchlight-azure](https://github.com/archilight/torchlight-azure) at commit 05f9129 (2019-01-28). Its README targets Archi 4.3. Its Java source extends UI providers and figure classes and reads AzureIcon properties to substitute rendering. It also includes Azure palette/editor code.

The older overlay is historical context. It is not a dependency and no old plugin code was copied. Native jArchi APIs now cover the required behavior: createImage, createSpecialization, element.specialization and profile.delete. The latter clears references while retaining concepts.

Real-runtime tests verify managed folders, relocation, custom images, Top Center placement, optional profiles, save/reload and relationship preservation. Model traversal normalizes diagram instances to underlying concepts, avoiding duplicate inventory entries when elements appear in views. objectRefs() identifies visual occurrences; .concept alone cannot distinguish a concept proxy from a diagram object.

The child API versions are pinned to the documented control-plane contracts. Individual child absence checks use those versions without depending on provider type-discovery coverage. A child collection can paginate only within its exact collection path. Child payloads are projected onto resource identity fields, excluding function files, config, invocation URLs and other payload content.

See [Entra application design and API contracts](entra-applications.md) for projected fields, consent, scope and export format.

## Sources

- [Azure Resource Management Java SDK](https://learn.microsoft.com/en-us/java/api/overview/azure/resourcemanager-resources-readme?view=azure-java-stable)
- [Azure Identity Java SDK](https://learn.microsoft.com/en-us/java/api/overview/azure/identity-readme?view=azure-java-stable)
- [MSAL4J](https://github.com/AzureAD/microsoft-authentication-library-for-java)
- [Azure CLI authentication](https://learn.microsoft.com/en-us/cli/azure/authenticate-azure-cli-interactively)
- [jArchi external JAR loading](https://github.com/archimatetool/archi-scripting-plugin/wiki/Runtime-Options)
- [jArchi model/profile API](https://github.com/archimatetool/archi-scripting-plugin/wiki/Model)
- [jArchi visual-object image and text API](https://github.com/archimatetool/archi-scripting-plugin/wiki/Visual-Objects)
- [jArchi element/property APIs](https://github.com/archimatetool/archi-scripting-plugin/wiki/All-Objects)
- [Resources List](https://learn.microsoft.com/en-us/rest/api/resources/resources/list?view=rest-resources-2021-04-01)
- [Resource groups List](https://learn.microsoft.com/en-us/rest/api/resources/resource-groups/list?view=rest-resources-2021-04-01)
- [Subscriptions Get](https://learn.microsoft.com/en-us/rest/api/resources/subscriptions/get?view=rest-resources-2022-12-01)
- [Providers List](https://learn.microsoft.com/en-us/rest/api/resources/providers/list?view=rest-resources-2021-04-01)
- [Resource Graph overview](https://learn.microsoft.com/en-us/azure/governance/resource-graph/overview)
