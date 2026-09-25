# Design and source review

Reviewed 2026-09-25. This is a jArchi JavaScript package, not an Archi modification or Eclipse plugin.

## Library choices

| Option | Assessment |
| --- | --- |
| Azure SDK for Java: azure-resourcemanager-resources + azure-identity | Supported Microsoft libraries for inventory and device credentials. GraalVM jArchi supports Java.addToClasspath() for external JARs. Packaging transitive dependencies and checking compatibility with Eclipse adds deployment work. |
| MSAL4J | Supported authentication alternative for a future separately packaged Java helper. Microsoft recommends supported authentication libraries where feasible. |
| Azure CLI | **Implemented as an optional authentication method.** jArchi invokes the local CLI for an existing interactive user session and ARM token; no custom app registration is needed. CLI 2.54+ is an optional dependency and owns its local authentication cache. |
| Python / Node helper | Not required. Inventory and model reconciliation remain inside jArchi. |
| Java standard HTTPS library + documented Azure REST | **Implemented for inventory and direct device sign-in.** Already in Archi's runtime. Selecting Azure CLI additionally uses a bounded local subprocess for authentication. |

The adapter uses java.net.HttpURLConnection through Java.type. Protocol logic, scope/paging checks and reconciliation are separately testable without credentials.

- lib/core.js — identity, scope, mappings, properties and change planning.
- lib/azure-client.js — device authorization, inventory, pagination/retries, discovery and deletion verification.
- lib/java-runtime.js — Java HTTPS and file operations.
- lib/azure-cli.js — CLI session/token validation and safe command construction.
- lib/azure-cli-java.js — cross-platform CLI discovery and bounded subprocess execution; stdout stays in memory and stderr is discarded.
- lib/archi-adapter.js — public jArchi APIs and managed profile lifecycle.
- lib/app.js — dialogs, configuration and change preview.
- config/specializations.js — editable resource-type mapping.

Collection and validation complete before application. This is not a distributed transaction: Azure may change during collection. No Azure write/delete API is called.

## Coverage

Inventory uses subscription Get, resource-group List and generic Resources List. Provider metadata supplies supported API versions for individually checking missing resources and exporting available types.

Resource Graph was considered, but indexed/type-specific coverage and permission-dependent results complicate absence handling. The implementation instead uses direct ARM lists plus individual checks. Neither a type catalog nor generic ARM inventory replaces every service's child/data-plane API.

Future extra collectors must run before application, finish every page and fail the scope on errors; never turn a failed collector into an empty list.

## torchlight-azure

Inspected [archilight/torchlight-azure](https://github.com/archilight/torchlight-azure) at commit 05f9129 (2019-01-28). Its README targets Archi 4.3. Its Java source extends UI providers and figure classes and reads AzureIcon properties to substitute rendering. It also includes Azure palette/editor code.

The older overlay is historical context. It is not a dependency and no old plugin code was copied. Native jArchi APIs now cover the required behavior: createImage, createSpecialization, element.specialization and profile.delete. The latter clears references while retaining concepts.

Real-runtime tests verify those operations, icon persistence and relationships. Model traversal normalizes diagram instances to underlying concepts, avoiding duplicate inventory entries when elements appear in views.

## Sources

- [Azure Resource Management Java SDK](https://learn.microsoft.com/en-us/java/api/overview/azure/resourcemanager-resources-readme?view=azure-java-stable)
- [Azure Identity Java SDK](https://learn.microsoft.com/en-us/java/api/overview/azure/identity-readme?view=azure-java-stable)
- [MSAL4J](https://github.com/AzureAD/microsoft-authentication-library-for-java)
- [Azure CLI authentication](https://learn.microsoft.com/en-us/cli/azure/authenticate-azure-cli-interactively)
- [jArchi external JAR loading](https://github.com/archimatetool/archi-scripting-plugin/wiki/Runtime-Options)
- [jArchi model/profile API](https://github.com/archimatetool/archi-scripting-plugin/wiki/Model)
- [jArchi element/property APIs](https://github.com/archimatetool/archi-scripting-plugin/wiki/All-Objects)
- [Resources List](https://learn.microsoft.com/en-us/rest/api/resources/resources/list?view=rest-resources-2021-04-01)
- [Resource groups List](https://learn.microsoft.com/en-us/rest/api/resources/resource-groups/list?view=rest-resources-2021-04-01)
- [Subscriptions Get](https://learn.microsoft.com/en-us/rest/api/resources/subscriptions/get?view=rest-resources-2022-12-01)
- [Providers List](https://learn.microsoft.com/en-us/rest/api/resources/providers/list?view=rest-resources-2021-04-01)
- [Resource Graph overview](https://learn.microsoft.com/en-us/azure/governance/resource-graph/overview)
