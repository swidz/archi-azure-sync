# User manual

For a fresh installation, run **Sync Azure.ajs**. The three scripts in **scripts/utils** are optional tools for inspection and maintenance; there is no mandatory discovery or specialization-installation step.

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
~~~

- AZURE_ROOT_FOLDER controls the first custom folder below Technology & Physical. It is a model-folder name, not a filesystem path.
- AZURE_USE_SPECIALIZATIONS defaults to false. Resources are ordinary Nodes with custom images on their diagram occurrences. Setting it to true explicitly enables creation/assignment of the mapped native specializations.

The existing config/specializations.js filename is retained for compatibility. It still controls base types and icon paths when specializations are off. All bundled base types are Node. Unmapped resources use Node and the generic Azure icon. You do not need to install thousands of profiles to synchronize.

Do not put passwords, client secrets, access tokens or refresh tokens in these files or model properties.

## 6. First synchronization

1. Create a new test model, or open a copy of your existing model. Select its root in the Models tree.
2. Double-click **Sync Azure.ajs** in Scripts Manager.
3. Choose your authentication method, tenant GUID and subscription GUIDs. Separate multiple subscription IDs with commas, semicolons or whitespace. Device sign-in also asks for the application client ID.
4. Wait for collection and verification to finish. The script performs Azure read operations only.
5. Review the create/update/restore/deletion counts and destination-folder preview. Cancel leaves the model unchanged. On an empty model, imported objects should be creations, with no deletions.
6. Confirm application. Review the resulting folder tree and element properties.
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

## 8. Use icons in diagrams

Drag imported Nodes from the Models tree onto an ArchiMate View. With specializations disabled, Archi stores custom images on **diagram occurrences**, not on the underlying Node.

**After adding Nodes to a view, run Sync Azure again.** It assigns the configured Azure image to every existing occurrence of scoped managed elements and sets **Image Position → Top Center**. Images are embedded in the model and survive save/reopen; diagram positions and sizes are preserved. Resize a shape yourself if it needs more room for the icon and label.

Sync does not create diagrams or install a background listener. An occurrence added after a run receives its image on the next run. Each sync reapplies the Azure icon and Top Center placement to scoped elements, including existing occurrences with a manually selected image.

When the specialization flag is true, existing mapped occurrences use the specialization image and still receive Top Center positioning during sync.

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
| Export Azure Inventory.ajs | Inspect actual Azure resources and compare inventory with mappings. Saves JSON; does not change the model. Store exports outside your model Git repository. |
| Discover Azure Resource Types.ajs | Review provider-advertised types for catalog maintenance. Saves JavaScript rows with blank icons. Results include operation/status entries and are not automatically merged. |
| Manage Azure Specializations.ajs | Advanced, offline bulk profile maintenance. Not needed for normal sync. Its own AZURE_USE_SPECIALIZATIONS flag also defaults to false; explicitly set it true in that utility to enable it, then review the confirmation. It can install every enabled catalog entry or remove script-owned disabled entries without deleting elements. |

Turning the main script's specialization flag off detaches script-owned specialization assignments from synchronized elements and uses custom diagram images. Existing profile definitions and assignments on unselected elements remain. Unowned user specializations are preserved. The utility's flag is separate and only controls that explicit bulk-maintenance operation.

## 11. Upgrade an existing installation

Save your model and keep any custom mapping changes. Download/extract the new complete package or update your clone, preserving local edits to config/specializations.js and your chosen settings in Sync Azure.ajs. Git users should review local changes before pulling.

Replace runtime files and move the three utility entry points into scripts/utils. Remove stale copies/links at the old scripts root after verifying that their new counterparts exist. Refresh Scripts Manager or restart Archi. Do not move your Azure inventory/discovery exports into the repository as part of the upgrade.

Run Sync Azure on a copy of the existing model first. The default next run reorganizes scoped elements and switches their script-owned specializations to custom diagram images. It preserves IDs, documentation, relationships and diagram layout. Save/reopen and run again to verify no duplicate concepts or folders before using the updated script for your regular model.

## 12. Scope and verification

This is an Azure Resource Manager infrastructure inventory. Subscription/resource-group containers and resources returned by the generic ARM resource listing are included. Some child resources need service-specific collectors; adding their mapping alone does not make the collector enumerate them. Entra directory objects and data-plane contents are outside this release.

See [verification](verification.md) for executed tests and [catalog and icons](catalog.md) for editing mappings. The scripts run on demand and do not automatically save models, commit Git changes, or schedule future runs.