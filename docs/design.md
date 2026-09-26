# Design and source review

Reviewed 2026-09-26. This is a jArchi JavaScript package, not an Archi modification or Eclipse plugin.

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
- lib/infrastructure.js — allowlisted metadata and tags, scoped Resource Graph enrichment, current ARM network reads, explicit resource-ID associations and per-owner coverage.
- lib/connections.js — transient configuration reads, allowlist-based sanitization, exact target matching, binding direction and per-app evidence coverage.
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

Core planning builds tenant-qualified, case-insensitive parent/child identities from ARM IDs. Subscription Nodes compose resource group Nodes; group Nodes compose their member Node resources. Namespace Nodes additionally compose queues/topics, Function App Nodes serve Technology Functions, SQL server Nodes serve database Nodes, and VNet Nodes compose subnet Nodes. Node-to-Technology-Function composition is rejected by Archi; Technology Functions therefore have no direct resource-group composition. Subscription-level resources do not acquire a synthetic Other parent. Missing parent Nodes are counted in the preview and skipped.

Before relationship indexing, the adapter identifies requested Function App → Technology Function Serving pairs by their actual endpoint GUIDs. It converts only script-owned structural Assignment links matching those readable pairs, using the public jArchi `.type` setter. The setter replaces the relationship concept (new relationship GUID), transfers properties and documentation, and updates existing diagram references. Source/target element GUIDs do not change. New concept IDs are marked visited to avoid counting diagram occurrences twice. Manual links, inferred connection links and absent/unreadable/unselected pairs are excluded. Subsequent syncs reuse the Serving link by endpoint GUIDs and type. See the [jArchi relationship type conversion implementation](https://github.com/archimatetool/archi-scripting-plugin/blob/master/com.archimatetool.script/src/com/archimatetool/script/dom/model/ArchimateRelationshipProxy.java).

After all concept operations, the adapter scans the entire model and indexes existing composition, assignment and serving relationships by actual source.id, then target.id, then relationship type, adding only missing directed links. Diagram occurrences are normalized to concepts and deduplicated by relationship GUID. Labels, folders and cached metadata never form lookup keys. Existing manual matching links remain unowned and unchanged. All generated links have blank names; applying a sync also clears any existing name on owned links after checking the selected tenant/subscription scope, including links with deleted endpoints. Cleanup changes the Name field without replacing the relationship or changing its type. Owned links record Azure-SourceElementId/Azure-TargetElementId from actual Archi GUIDs and Azure-SourceObjectId/Azure-TargetObjectId from ARM identities, refreshing stale cached values. They also carry lifecycle metadata; confirmed endpoint deletion marks the link deleted, and restoration clears its deletion timestamp without replacing its identity. Updates are restricted to owned endpoints in the selected tenant and subscriptions. Links remain model concepts: production scripts never create views or diagram connections.

## Coverage

Inventory uses subscription Get, resource-group List and generic Resources List, then explicit [Service Bus, Functions, SQL and subnet child collectors](child-resources.md). Generic and child endpoint records merge only when the same child ARM identity appears in distinct sources. Duplicates within a single endpoint remain errors. Missing parents already in the model are verified before expansion, so recovered parents also have their children collected. Provider metadata supplies supported API versions for individually checking missing resources and exporting available types.

Resource Graph enriches resources already found by direct ARM inventory. It never introduces generic elements or establishes absence. Queries use one explicit subscription, paginate objectArray responses, and retain successful pages on recoverable failures. Missing indexed resources receive direct ARM detail fallback; NIC/private endpoint owners always receive current ARM reads before association retirement. Subnet lists provide authoritative reference projections. Only allowlisted fields survive collection. Neither a type catalog, indexed Resource Graph result nor generic ARM inventory replaces every service's child/data-plane API.

Collectors run before model application and retain successful pages. Tagged acquisition errors are caught at subscription/list/child/existence-check boundaries; unknown exceptions and integrity violations propagate. Schema version 3 includes warnings, partial state and completed subscriptions. Any failed read disables all deletion within that subscription; partial Entra collection disables tenant app deletion. Fully read subscriptions still reconcile absent resources even if another subscription fails. See [partial synchronization](partial-sync.md) for model status and relationship handling.

## torchlight-azure

Inspected [archilight/torchlight-azure](https://github.com/archilight/torchlight-azure) at commit 05f9129 (2019-01-28). Its README targets Archi 4.3. Its Java source extends UI providers and figure classes and reads AzureIcon properties to substitute rendering. It also includes Azure palette/editor code.

The older overlay is historical context. It is not a dependency and no old plugin code was copied. Native jArchi APIs now cover the required behavior: createImage, createSpecialization, element.specialization and profile.delete. The latter clears references while retaining concepts.

Real-runtime tests verify managed folders, relocation, custom images, Top Center placement, optional profiles, save/reload and relationship preservation. Model traversal normalizes diagram instances to underlying concepts, avoiding duplicate inventory entries when elements appear in views. objectRefs() identifies visual occurrences; .concept alone cannot distinguish a concept proxy from a diagram object.

The child API versions are pinned to the documented control-plane contracts. Individual child absence checks use those versions without depending on provider type-discovery coverage. A child collection can paginate only within its exact collection path. The resource collector projects child payloads onto resource identity fields. When enrichment is enabled, it additionally projects common metadata and subnet prefixes/policies/NSG references onto allowlisted structures. Enabled connection discovery separately reads only supported binding fields from Function config; raw config, source files and invocation URLs are never persisted.

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

## Connection relationships

See [connection discovery](connections.md). Raw settings are parsed and discarded inside the collector; its public snapshot contains only reconstructed evidence. Target matching uses current selected ARM resources. Configuration warnings are separate from ARM resource coverage. The adapter independently maintains connection-owned relationships, matching actual endpoint GUIDs/type, merging evidence for partially read apps and retiring absent evidence only with complete per-app coverage and reconciled endpoints. Relationships follow their actual source folders across selected subscriptions. Archi relationship validation occurs before the preview. Manual links remain unowned and unchanged.

## Infrastructure relationships and ARI review

See [infrastructure enrichment](infrastructure.md) for supported types, fields, association directions and API contracts. The implementation was informed by Microsoft ARI commit 579232984611a3a45ab47391f882867f3fd52b23, but no ARI source or PowerShell dependencies are included. Unlike an inventory report based solely on indexed data, model lifecycle decisions still require ARM coverage.

The adapter shares one evidence-relationship reconciliation implementation between configuration connections and infrastructure associations. Their ownership kinds, evidence properties and completed-owner sets remain separate. Each matches actual source/target GUIDs and relationship type, preserves matching manual links, resolves folders from the actual source, and retires absent evidence only after complete owner reads with reconciled endpoints. ARG-only additions can be applied while preserving prior evidence when current ARM verification fails. Unselected or unresolved targets protect the owner's existing links.

Metadata updates merge only supplied allowlisted fields into element operations. Per-resource enrichment coverage and timestamps are distinct from ARM element reconciliation. Disabling enrichment leaves previously imported subnets, their structural relationships, metadata and infrastructure associations unchanged. No extra configuration or credentials are persisted in model properties.
