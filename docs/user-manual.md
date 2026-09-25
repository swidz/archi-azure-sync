# User manual

For a fresh installation, run **Sync Azure.ajs**. The four scripts in **scripts/utils** are optional tools for inspection and maintenance; there is no mandatory discovery or specialization-installation step.

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

Configure an Entra public-client application, enable public client flows, and configure Azure Service Management delegated user_impersonation permission and consent. No client secret is needed. Choose **Device sign-in (app registration)**, enter tenant/subscription/client IDs, and complete the displayed device-code sign-in.

The [connection guide](authentication.md) contains complete setup, permission requirements, authentication choices, and troubleshooting for both methods.

## 5. Set the synchronization options

At the top of **scripts/Sync Azure.ajs**:

~~~javascript
var AZURE_ROOT_FOLDER = "Azure";
var AZURE_USE_SPECIALIZATIONS = false;
var AZURE_IMAGE_POSITION = "top-center";
var AZURE_TEXT_POSITION = "bottom-center";
~~~

- AZURE_ROOT_FOLDER controls the first custom folder below Technology & Physical. It is a model-folder name, not a filesystem path.
- AZURE_IMAGE_POSITION defaults to "top-center".
- AZURE_TEXT_POSITION defaults to "bottom-center", controlling both vertical placement and horizontal alignment of the name.
- Both position settings accept "top-left", "top-center", "top-right", "middle-left", "middle-center", "middle-right", "bottom-left", "bottom-center", "bottom-right". Images also accept "fill", which scales to the shape.
- AZURE_USE_SPECIALIZATIONS defaults to false. Resources are ordinary Nodes with custom images on their diagram occurrences. Setting it to true explicitly enables creation/assignment of the mapped native specializations.

The existing config/specializations.js filename is retained for compatibility. It still controls base types and icon paths when specializations are off. All bundled base types are Node. Unmapped resources use Node and the generic Azure icon. You do not need to install thousands of profiles to synchronize.

Do not put passwords, client secrets, access tokens or refresh tokens in these files or model properties.

## 6. First synchronization

1. Create a new test model, or open a copy of your existing model. Select its root in the Models tree.
2. Double-click **Sync Azure.ajs** in Scripts Manager.
3. Choose your authentication method, tenant GUID and subscription GUIDs. Separate multiple subscription IDs with commas, semicolons or whitespace. Device sign-in also asks for the application client ID.
4. Wait for collection and verification to finish. The script performs Azure read operations only.
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

Managed folder identity is recorded in folder properties. Repeat runs reuse folders, and subscription-name changes update the label. Changing AZURE_ROOT_FOLDER renames the managed root. Existing managed elements from older versions are moved into this hierarchy during the next applied sync, preserving concept IDs, relationships and diagram references. Unselected subscription elements are not moved or reformatted. Empty folders are retained; the script never deletes model folders.

If a desired folder name is already occupied by an unrelated, unowned folder, the script reports the conflict rather than taking ownership. If application started, use Edit → Undo before renaming that conflicting folder or choosing another root name and rerunning.

### Composition relationships

The sync creates ArchiMate **composition** relationships labelled **composed of**, with these directions:

- Subscription Node → each resource group Node in that subscription.
- Resource group Node → each resource Node belonging to that group, including nested resources returned by inventory.

Find them in the model's Relationships folder. They express whole-to-part containment, with the composition diamond at the parent. Existing links with matching source/target are reused, so repeating Sync adds no duplicates. Manual relationships retain their labels and properties. Script-owned links are retained with deletion timestamps when either endpoint disappears and restored when both endpoints return. Unselected subscriptions are untouched.

The **Other** folder is not an Azure resource group: it has no synthetic Node or composition links. If a parent Node is missing from inventory, the preview reports it and that link is skipped. The script never creates a view or draws connections. Add existing relationships to your manually created diagrams using Archi when desired.

## 8. Use icons in diagrams

Archi stores custom images on **diagram occurrences**, not on the underlying Node. This is why images previously seemed to require two syncs: a fresh import created Nodes before you placed them in a view. Existing occurrences receive their images during the first applied sync; objects placed afterward need local formatting.

1. Run **Sync Azure.ajs** once to create or update the model elements and relationships.
2. Create a view yourself and drag the desired Nodes onto it.
3. Run **scripts/utils/Apply Azure Appearance.ajs** and confirm. It assigns custom images and name placement to all managed Azure occurrences in the selected model, across its views. It needs no Azure sign-in and does not change inventory properties, relationships or synchronization timestamps.
4. Save the model when ready. After adding more Nodes later, run the same local utility again.

Images default to **Top Center** and names to **Bottom Center**. Change AZURE_IMAGE_POSITION and AZURE_TEXT_POSITION in Sync Azure.ajs before syncing; a successful sync saves those choices as Azure-ImagePosition and Azure-TextPosition model properties for the local utility. The utility affects managed Azure occurrences throughout the model, including subscriptions outside your last sync scope. A normal Sync formats only its selected scope.

The bundled PNGs have a maximum dimension of **48 pixels**, reduced from 96 while preserving aspect ratio and transparency. This is a one-time asset-size change, not repeated shrinking on each run. Diagram positions and shape dimensions are preserved. Applying Sync or the local utility replaces existing managed occurrences' images with the updated assets. Custom replacement PNGs use their own dimensions; the optional "fill" image placement stretches to the shape.

Images are embedded in the model and survive save/reopen. No diagrams, connections or background listeners are generated. With specializations enabled, Sync assigns the profile image to existing mapped occurrences; the local utility always assigns a custom image without removing any specialization assignment.

## 9. Subsequent runs

1. Open your model. For CLI authentication, refresh sign-in with az login if the session requires it.
2. Run **Sync Azure.ajs**. The last successfully used authentication method and IDs are offered again.
3. Review the counts and apply.
4. Inspect changes, save, and commit as appropriate.

Existing elements are matched by tenant and ARM resource ID. A repeat run does not create duplicates. CreatedDate/CreatedTime remain unchanged; LastSyncDate/LastSyncTime advance on successful application. Confirmed missing resources remain in the model with IsDeleted=yes and deletion timestamps. If the same ARM ID returns, the original element is restored and deletion timestamps cleared.

Authentication, incomplete inventory, or uncertain deletion checks stop before model application. An unexpected error during application can leave partial in-memory changes; use **Edit → Undo** before retrying.

## 10. Optional utilities

| Utility under scripts/utils | When to use it |
| --- | --- |
| Apply Azure Appearance.ajs | After manually placing Nodes on a view, apply icons and image/name placement locally. Covers all managed Azure diagram occurrences in the selected model, without Azure authentication or sync-timestamp changes. |
| Export Azure Inventory.ajs | Inspect actual Azure resources and compare inventory with mappings. Saves JSON; does not change the model. Store exports outside your model Git repository. |
| Discover Azure Resource Types.ajs | Review provider-advertised types for catalog maintenance. Saves JavaScript rows with blank icons. Results include operation/status entries and are not automatically merged. |
| Manage Azure Specializations.ajs | Advanced, offline bulk profile maintenance. Not needed for normal sync. Its own AZURE_USE_SPECIALIZATIONS flag also defaults to false; explicitly set it true in that utility to enable it, then review the confirmation. It can install every enabled catalog entry or remove script-owned disabled entries without deleting elements. |

Turning the main script's specialization flag off detaches script-owned specialization assignments from synchronized elements and uses custom diagram images. Existing profile definitions and assignments on unselected elements remain. Unowned user specializations are preserved. The utility's flag is separate and only controls that explicit bulk-maintenance operation.

## 11. Upgrade an existing installation

Save your model and keep any custom mapping changes. Download/extract the new complete package or update your clone, preserving local edits to config/specializations.js and your chosen settings in Sync Azure.ajs. Git users should review local changes before pulling.

Replace runtime files and assets, including the updated 48-pixel PNGs. Keep all four utility entry points under scripts/utils. Remove stale copies/links at the old scripts root after verifying that their new counterparts exist. Refresh Scripts Manager or restart Archi. Do not move your Azure inventory/discovery exports into the repository as part of the upgrade.

Run Sync Azure on a copy of the existing model first. The default next run reorganizes scoped elements and switches their script-owned specializations to custom diagram images. It preserves IDs, documentation and diagram layout, reuses existing containment relationships and creates any missing ones. Save/reopen and run again to verify no duplicate concepts or folders before using the updated script for your regular model.

## 12. Scope and verification

This is an Azure Resource Manager infrastructure inventory. Subscription/resource-group containers and resources returned by the generic ARM resource listing are included. Some child resources need service-specific collectors; adding their mapping alone does not make the collector enumerate them. Entra directory objects and data-plane contents are outside this release.

See [verification](verification.md) for executed tests and [catalog and icons](catalog.md) for editing mappings. The scripts run on demand and do not automatically save models, commit Git changes, or schedule future runs.