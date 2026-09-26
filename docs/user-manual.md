# User manual

For a fresh installation, run **Sync Azure.ajs**. The four scripts in **scripts/utils** are optional tools for inspection and maintenance; there is no mandatory discovery, icon or specialization-installation step. **Icons are optional and are never applied by the standard sync script.**

## 1. Download from GitHub

On this repository's GitHub page, choose **Code → Download ZIP**, then extract the complete archive. Alternatively, copy the HTTPS URL from **Code** and run:

~~~sh
git clone "PASTE-THE-HTTPS-URL-FROM-GITHUB" archi-azure-sync
~~~

Keep the complete extracted/cloned folder. Do not download only the .ajs files or only the scripts directory. The runtime needs sibling lib, config and assets directories.

~~~text
archi-azure-sync/
├── scripts/
│   ├── Sync Azure.ajs                  ← everyday entry point
│   └── utils/
│       ├── Apply Azure Appearance.ajs
│       ├── Export Azure Inventory.ajs
│       ├── Discover Azure Resource Types.ajs
│       └── Manage Azure Specializations.ajs
├── lib/
├── config/
│   └── specializations.js             ← type and icon mappings; profiles optional
├── assets/
│   └── icons/
└── docs/
    └── user-manual.md
~~~

The repository ZIP is not an Archi plugin and should not be installed through Manage Plug-ins.

## 2. Install Archi and jArchi

Install **Archi 5.8 or later**, using Java 21, and **jArchi 1.12 or later**. Use the **GraalVM JavaScript** engine. This version was tested on Archi 5.10 and jArchi 1.12 on Windows; it uses portable Java APIs for Linux and macOS as well.

Obtain jArchi through the [official Archi plugins page](https://www.archimatetool.com/plugins/). Install the supplied .archiplugin using **Help → Manage Plug-ins → Install New**, then restart Archi. If jArchi is already installed at the required version, reuse it.

No Node.js, Python, Azure Java SDK, additional JAR files, or old torchlight-azure plugin is required. Azure CLI is required only if you choose CLI authentication.

## 3. Make the scripts visible

Open **Scripts Manager** from Archi's **Tools** menu. Find your Scripts folder in **Preferences → Scripting** (the Preferences menu location varies by operating system).

The simplest installation is to place the complete archi-azure-sync folder inside your existing jArchi Scripts folder. For example on Windows:

~~~text
C:\Users\YOUR-NAME\Documents\Archi\scripts\
└── archi-azure-sync\
    ├── scripts\
    │   ├── Sync Azure.ajs
    │   └── utils\...
    ├── lib\...
    ├── config\...
    └── assets\...
~~~

Expand archi-azure-sync → scripts in Scripts Manager and use **Sync Azure.ajs**. The library location is deliberate: lib is beside the package's scripts directory. Utility scripts resolve the package root from their extra directory level.

Alternatively, point the Scripts folder preference directly at this package's scripts directory, or link the original .ajs files in Scripts Manager. If linking, keep utility links together under utils. Choose **Link**, not Copy: copied entry points cannot find their dependencies unless the full layout is preserved. See the [jArchi quick start](https://github.com/archimatetool/archi-scripting-plugin/wiki/jArchi-Quick-Start).

## 4. Connect to Azure

Both methods use an interactive user account with subscription-wide Reader or equivalent permissions. All subscriptions selected in one run must belong to the same tenant. Passwords and MFA responses are entered through Microsoft's sign-in interface, never into the script or model.

### Option A: Azure CLI, without your own app registration

Install Azure CLI 2.54 or later. On Windows, run in PowerShell:

~~~powershell
winget install --exact --id Microsoft.AzureCLI
~~~

Follow Microsoft's [installation instructions](https://learn.microsoft.com/en-us/cli/azure/install-azure-cli) for other platforms. Reopen the terminal and restart Archi after installation so it receives the updated PATH.

Sign in and list available subscription/tenant IDs:

~~~text
az login
az account list --query "[].{Name:name,Subscription:id,Tenant:tenantId}" --output table
~~~

For a specific tenant, use az login --tenant "TENANT_GUID". Complete the sign-in and MFA before returning to Archi. Choose **Azure CLI (no own app registration)** in the script. The script reuses that CLI session; it does not launch az login itself or require a client ID.

### Option B: Device sign-in with your own app registration

Configure an Entra public-client application, enable public client flows, and configure Azure Service Management delegated user_impersonation permission and consent. For enabled Entra app inventory, also configure Microsoft Graph delegated Application.Read.All and admin consent. No client secret is needed. Choose **Device sign-in (app registration)**, enter tenant/subscription/client IDs, and complete the displayed device-code sign-in.

The [connection guide](authentication.md) contains complete setup, permission requirements, authentication choices, and troubleshooting for both methods.

## 5. Set the synchronization options

At the top of **scripts/Sync Azure.ajs**:

~~~javascript
var AZURE_ROOT_FOLDER = "Azure";
var AZURE_USE_SPECIALIZATIONS = false;
var AZURE_INCLUDE_ENTRA_APPLICATIONS = true;
~~~

- AZURE_ROOT_FOLDER controls the custom root name under both Technology & Physical and Relationships. The default creates Technology & Physical → Azure for elements and Relationships → Azure for generated links. It is a model-folder name, not a filesystem path.
- AZURE_DISCOVER_CONNECTIONS defaults to true. It reads App Service/Function App settings and connection strings, then stores only sanitized evidence on inferred relationships. Set false to skip these reads. See [connection discovery](connections.md) for additional permissions, supported SQL/Service Bus/Storage formats and Function bindings.
- AZURE_INCLUDE_ENTRA_APPLICATIONS defaults to true. It adds tenant-wide app registrations via Microsoft Graph; configure [Entra access](entra-applications.md) first. Set false for ARM-only runs, leaving existing app Nodes untouched. The Export utility has a separate flag with the same default.
- AZURE_USE_SPECIALIZATIONS defaults to false. Resources are ordinary Nodes, except individual Azure Functions use Technology Function. Setting it to true explicitly enables creation/assignment of the mapped native specializations; Sync creates new profiles without images and retains existing profile images.

Sync does not load icon assets, assign custom images or change diagram image/text placement. If you want Azure icons, configure and run the separate **Apply Azure Appearance.ajs** utility described in section 8. Users who prefer plain Archi shapes can skip it.

The existing config/specializations.js filename is retained for compatibility. It controls base types and optional icon mappings. Bundled base types are Node except Microsoft.Web/sites/functions, which uses technology-function. Unmapped resources use Node and receive a generic Azure icon only when the optional appearance utility is run. You do not need to install thousands of profiles to synchronize.

Do not put passwords, client secrets, access tokens or refresh tokens in these files or model properties.

## 6. First synchronization

1. Create a new test model, or open a copy of your existing model. Select its root in the Models tree.
2. Double-click **Sync Azure.ajs** in Scripts Manager.
3. Choose your authentication method, tenant GUID and subscription GUIDs. Separate multiple subscription IDs with commas, semicolons or whitespace. Device sign-in also asks for the application client ID.
4. Wait for collection and verification to finish, including queues/topics in Service Bus namespaces, individual Functions in Function Apps, databases on SQL logical servers, and enabled Entra app registrations. Direct device authentication presents a second sign-in for Microsoft Graph. The script performs read operations only.
5. Review the create/update/restore/deletion counts, composition-link count and destination-folder preview. Cancel leaves the model unchanged. On an empty model, imported objects should be creations, with no deletions.
6. Confirm application. Review the resulting folder tree, element properties and composition relationships. No diagrams are created.
7. Save the model manually. Commit it using your usual model Git/coArchi workflow when ready.

The first run does not require any script in utils. If desired, utils/Export Azure Inventory.ajs can test connectivity and produce a JSON snapshot before modifying a model. Sync always fetches a fresh inventory from Azure; it does not import that JSON file.

## 7. Find the imported elements

~~~text
Technology & Physical
└── Azure
    └── Production [subscription-GUID]
        ├── rg-application
        │   ├── Microsoft.Compute/virtualMachines
        │   │   └── vm-application-01
        │   └── Microsoft.Resources/resourceGroups
        │       └── rg-application
        └── Other
            └── Microsoft.Resources/subscriptions
                └── Production
~~~

Each object type uses its full ARM type as one folder label, including slashes. Subscription folders include the display name and ID so identical display names remain distinct. Resources without a resource group go in **Other**. A real resource group named Other gets **Other (resource group)**, so it stays separate from that fallback folder.

Managed folder identity is recorded in folder properties. Repeat runs reuse folders, and subscription-name changes update the label. Changing AZURE_ROOT_FOLDER renames the managed roots under both Technology & Physical and Relationships. Existing managed elements from older versions are moved into this hierarchy during the next applied sync, preserving concept IDs, relationships and diagram references. Unselected subscription elements are not moved or reformatted. Empty folders are retained; the script never deletes model folders.

If a desired folder name is already occupied by an unrelated, unowned folder, the script reports the conflict rather than taking ownership. If application started, use Edit → Undo before renaming that conflicting folder or choosing another root name and rerunning.

### Composition relationships

The sync creates unnamed ArchiMate **composition** relationships, with these directions:

- Subscription Node → each resource group Node in that subscription.
- Resource group Node → each resource Node belonging to that group, including queues/topics and SQL databases. Individual Technology Functions are linked through their Function App using assignment; Node-to-Technology-Function composition is invalid in Archi.

All synced relationship Name fields are blank. On each applied sync, existing names are cleared from script-owned composition, assignment and serving links in the selected tenant/subscriptions, including SQL server-to-database links, custom labels and soft-deleted links. Their relationship GUIDs, types, source/target references and creation dates remain intact. Manually authored matching links and links outside the selected scope keep their names.

Find generated links under **Relationships → Azure → Source subscription → Source resource group (or Other) → Source object type**. Archi stores relationship concepts in its separate Relationships category. Composition, assignment and serving links all use their source element's hierarchy. The full source ARM type is one folder label, including slashes. Composition links express whole-to-part containment, with the composition diamond at the parent. Each run searches the whole model using the actual **source element GUID and target element GUID**, plus relationship type. Renaming or moving a link does not cause a duplicate; different relationship types between the same endpoints remain distinct. Manual matching relationships retain their labels, properties and folders. Script-owned links are retained with deletion timestamps when either endpoint disappears and restored when both endpoints return. Unselected subscriptions are untouched.

The **Other** folder is not an Azure resource group: it has no synthetic Node or composition links. If a parent Node is missing from inventory, the preview reports it and that link is skipped. The script never creates a view or draws connections. Add existing relationships to your manually created diagrams using Archi when desired.

Owned links from older versions, including the flat Azure folder, move into this source-based hierarchy on the next applied sync for their selected tenant/subscriptions. Their relationship GUIDs, creation timestamps and existing diagram connections are preserved. Azure-SourceElementId and Azure-TargetElementId record the actual Archi endpoint GUIDs; Azure-SourceObjectId and Azure-TargetObjectId continue to record the ARM IDs. The actual relationship endpoints are authoritative; stale cached properties are refreshed. Links outside the selected scope are not moved.

Example relationship folders (leaf annotations describe types and endpoints; the relationship Name fields are blank):

~~~text
Relationships
└── Azure
    └── Production [subscription-GUID]
        ├── Other
        │   └── Microsoft.Resources/subscriptions
        │       └── [Composition: subscription → resource group]
        └── rg-application
            ├── Microsoft.Resources/resourceGroups
            │   └── [Composition: resource group → resource]
            ├── Microsoft.ServiceBus/namespaces
            │   └── [Composition: namespace → queue or topic]
            ├── Microsoft.Web/sites
            │   └── [Assignment: Function App → function]
            └── Microsoft.Sql/servers
                └── [Serving: SQL server → database]
~~~

The source element supplies the subscription, resource group and object type; the target does not determine placement. Subscription-source links use Other because subscriptions have no resource group. A real group named Other still uses Other (resource group). No extra folder is created for the source element's name or the relationship type. Repeated runs reuse folder identities, including when the subscription display name changes.

### Service children and their relationships

| Parent | Imported child | Archi type | Relationship from parent |
| --- | --- | --- | --- |
| Service Bus namespace | Queue or topic | Node | Composition |
| Function App | Individual function | Technology Function | Assignment |
| SQL logical server | Database, including master when returned | Node | Serving |

These are collected automatically by Sync and Export Azure Inventory. No additional setup script is required. Existing SQL databases are matched by ARM ID and receive serving relationships without duplicate Nodes. Find children under their existing subscription/resource-group/type folders; Azure-ParentObjectId identifies their parent.

Archi rejects composition from a Node to a Technology Function. Assignment is the valid connection for a Function App Node performing a Technology Function. If you prefer Node plus composition, change the Microsoft.Web/sites/functions row in config/specializations.js to node before the first import. Existing concept type changes require an explicit manual migration in Archi.

See [child-resource discovery](child-resources.md) for permissions, scope and failure handling.

### Entra app registrations

App registrations are **Node** elements under **Technology & Physical → Azure → Entra ID [tenant GUID] → App registrations**. Their subscription/group properties are empty. Azure-ObjectId stores the directory Object ID; Azure-ApplicationId stores the Application (Client) ID. All apps visible with tenant-wide read permission are collected once, independently of the subscription selection. No subscription or group relationships are generated for them. Repeat runs preserve Node identity and use the same soft-deletion rules.

See [Entra connection and inventory details](entra-applications.md) for both authentication methods, permissions and properties.

## 8. Optional: add icons to diagrams

**Skip this section if you do not want Azure icons.** Sync updates inventory, folders and composition relationships without assigning custom images or formatting existing diagram objects. It does not remove images that were previously applied; remove unwanted custom images using Archi's image settings.

To use Azure icons:

1. Run **Sync Azure.ajs** to create or update model elements and relationships.
2. Create a view yourself and drag the desired Nodes onto it.
3. Run **scripts/utils/Apply Azure Appearance.ajs** and confirm. It applies custom images and name placement to all managed Azure occurrences in the selected model, across its views. It needs no Azure sign-in and does not change inventory properties, relationships or synchronization timestamps.
4. Save the model when ready. After adding more Nodes later, rerun the utility only if you want icons on those Nodes.

The two positioning variables are at the top of **Apply Azure Appearance.ajs**:

~~~javascript
var AZURE_IMAGE_POSITION = "top-center";
var AZURE_TEXT_POSITION = "bottom-center";
~~~

Both accept "top-left", "top-center", "top-right", "middle-left", "middle-center", "middle-right", "bottom-left", "bottom-center", "bottom-right". Images also accept "fill", which scales the image to the shape. The text setting controls vertical placement and horizontal alignment. The utility uses its own variables; old Azure-ImagePosition/Azure-TextPosition model properties from version 0.4 are ignored.

The bundled PNGs have a maximum dimension of **48 pixels**, reduced from 96 while preserving aspect ratio and transparency. This is a one-time asset-size change, not repeated shrinking on each run. Diagram positions and shape dimensions are preserved. Custom replacement PNGs use their own dimensions.

Archi stores custom images on diagram occurrences. The utility therefore formats Nodes already placed in views. It embeds the images in the model, so they survive save/reopen. It covers all managed Azure occurrences in the selected model, including subscriptions outside your last sync scope, and replaces any custom images previously chosen for those occurrences. Cancel the confirmation to keep their current appearance.

No diagrams or connections are generated. The utility always assigns custom images without changing specialization assignments. Users who explicitly install profile icons through Manage Azure Specializations may also see inherited images through Archi; Sync preserves those profile images and never changes the diagram image-source setting.

## Connection discovery

Run Sync Azure.ajs with AZURE_DISCOVER_CONNECTIONS=true. Select subscriptions containing both ends of the expected connections. Review the connection relationship count, apply, and inspect the properties of the resulting Serving/Triggering/Flow relationships. Access-denied and ambiguous matches appear as warnings; normal inventory continues. No separate utility is needed. See [the connection guide](connections.md) for examples, lifecycle rules and redaction details.

## 9. Subsequent runs

1. Open your model. For CLI authentication, refresh sign-in with az login if the session requires it.
2. Run **Sync Azure.ajs**. The last successfully used authentication method and IDs are offered again.
3. Review the counts and apply.
4. Inspect changes, save, and commit as appropriate.

Existing ARM elements are matched by tenant and ARM resource ID. Entra applications use tenant and Graph Object ID. A repeat run does not create duplicates. CreatedDate/CreatedTime remain unchanged; LastSyncDate/LastSyncTime advance on successful application. Confirmed missing resources remain in the model with IsDeleted=yes and deletion timestamps. If the same ARM ID returns, the original element is restored and deletion timestamps cleared.

Read/permission failures now appear as **[WARNING]** lines in the Scripts output window. The run continues and offers the objects it could read. A **completed with warnings** result is partial: unreadable elements and relationships stay unchanged, and no deletion occurs in incomplete scopes. Review the warnings, fix access if needed, and run Sync again. No additional setting is required. See [error handling and partial synchronization](partial-sync.md).

Cancellation, invalid tenant/identity data, unsafe pagination and model conflicts still stop. An unexpected error during model application can leave partial in-memory changes; use **Edit → Undo** before retrying.

## 10. Optional utilities

| Utility under scripts/utils | When to use it |
| --- | --- |
| Apply Azure Appearance.ajs | After manually placing Nodes on a view, apply icons and image/name placement locally. Covers all managed Azure diagram occurrences in the selected model, without Azure authentication or sync-timestamp changes. |
| Export Azure Inventory.ajs | Inspect actual Azure resources and compare inventory with mappings. Saves JSON; does not change the model. Store exports outside your model Git repository. |
| Discover Azure Resource Types.ajs | Review provider-advertised types for catalog maintenance. Saves JavaScript rows with blank icons. Results include operation/status entries and are not automatically merged. |
| Manage Azure Specializations.ajs | Advanced, offline bulk profile maintenance. Not needed for normal sync. Its own AZURE_USE_SPECIALIZATIONS flag also defaults to false; explicitly set it true in that utility to enable it, then review the confirmation. It can install every enabled catalog entry or remove script-owned disabled entries without deleting elements. |

Turning the main script's specialization flag off detaches script-owned specialization assignments from synchronized elements. It does not replace them with custom images. Existing profile definitions and assignments on unselected elements remain. Unowned user specializations are preserved. The utility's flag is separate and only controls that explicit bulk-maintenance operation.

## 11. Upgrade an existing installation

Save your model and keep any custom mapping changes. Download/extract the new complete package or update your clone, preserving local edits to config/specializations.js and your chosen settings in both Sync Azure.ajs and Apply Azure Appearance.ajs. Git users should review local changes before pulling.

Replace runtime files and assets, including the updated 48-pixel PNGs. Keep all four utility entry points under scripts/utils. Remove stale copies/links at the old scripts root after verifying that their new counterparts exist. Refresh Scripts Manager or restart Archi. Do not move your Azure inventory/discovery exports into the repository as part of the upgrade.

Version 0.6 adds child collectors and service relationships. Preserve any local catalog edits while merging the Microsoft.Web/sites/functions mapping to technology-function. If Functions were already imported as Nodes, the script stops before mutation on that type change; deliberately change their type in Archi, or retain the Node mapping to use composition.

Version 0.5 makes custom icons entirely optional. If you previously customized image/text positions in Sync Azure.ajs, move those values into Apply Azure Appearance.ajs. Existing custom images are retained, not removed or reformatted by Sync.

Run Sync Azure on a copy of the existing model first. The default next run reorganizes scoped elements and detaches script-owned specialization assignments without adding custom images. It preserves IDs, documentation and diagram layout, reuses existing containment relationships and creates any missing ones. Save/reopen and run again to verify no duplicate concepts or folders before using the updated script for your regular model.

Version 0.12 enables connection discovery by default. Replace all libraries and entry points together. Configuration reads require Microsoft.Web/sites/config/list/action; without it, warnings are reported and the rest of synchronization continues. Use AZURE_DISCOVER_CONNECTIONS=false to leave existing connection relationships untouched.

Version 0.11 adds automatic partial synchronization. Replace all library files together; run Sync Azure.ajs normally and inspect the Scripts output for warnings. It adds no plugin or authentication requirement.

Version 0.10 enables Entra app registration collection by default. Update all library files and configure Graph access, or set AZURE_INCLUDE_ENTRA_APPLICATIONS=false to retain ARM-only behavior. Preserve the Microsoft.Graph/applications Node mapping when merging your custom catalog.

Version 0.9 removes names from synced relationships. Run Sync Azure.ajs and apply for each relevant subscription to clear existing names; no separate cleanup utility is required.

Version 0.8 expands the relationship folder tree to Azure → Source subscription → Source resource group (or Other) → Source object type. Version 0.7 introduced the Azure relationship root and endpoint GUID properties. After updating the complete package, run Sync Azure.ajs normally and apply: existing owned links in the selected scope are relocated automatically without changing their identity. No utility script is needed.

## 12. Scope and verification

This is an Azure Resource Manager infrastructure inventory. Subscription/resource-group containers, generic ARM resources, Service Bus queues/topics, Function App functions, and SQL logical-server databases are included. Other child resources need additional collectors; adding their mapping alone does not make the collector enumerate them. Entra app registrations are included through Microsoft Graph. Enterprise applications/service principals, managed identities, other directory objects and data-plane contents remain outside this release.

See [verification](verification.md) for executed tests and [catalog and icons](catalog.md) for editing mappings. The scripts run on demand and do not automatically save models, commit Git changes, or schedule future runs.