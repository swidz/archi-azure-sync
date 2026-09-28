# Selective synchronization and existing-object property refresh

## Select types for normal synchronization

1. Run **scripts/Sync Azure.ajs**, choose authentication, and enter the tenant and subscriptions.
2. The **Azure object types** popup opens before Azure sign-in or inventory reads. For a full inventory, leave **All Azure types (including types not in this catalog)** checked. To select a subset, click **Clear all**.
3. Search by service name or ARM type. Tick individual rows, or use **Select shown** to check every matching row. Filtering does not uncheck hidden rows; the selected count covers the entire list. Continue is disabled for an empty selection. Cancel or Escape stops without changing the model.
4. Continue, sign in if requested, and review the create/update/restore/deletion preview. Apply, review, and save the model.

The popup uses the editable type catalog plus types already in the model. Provider metadata contains many child and operation types, so entries in the catalog do not guarantee live resources or API support. All types also includes resource types not yet present in the catalog. You can update the catalog using the existing discovery utility. Catalog rows still control mappings; commenting a row out is not an inventory exclusion rule for All types.

Common choices:

| Azure objects | Type to check |
| --- | --- |
| Individual Functions inside Function Apps | Microsoft.Web/sites/functions |
| Function Apps and Web Apps | Microsoft.Web/sites |
| Service Bus queues | Microsoft.ServiceBus/namespaces/queues |
| Service Bus topics | Microsoft.ServiceBus/namespaces/topics |
| Service Bus namespaces | Microsoft.ServiceBus/namespaces |
| SQL databases | Microsoft.Sql/servers/databases |
| Virtual machines | Microsoft.Compute/virtualMachines |
| VNet subnets | Microsoft.Network/virtualNetworks/subnets |
| Entra app registrations | Microsoft.Graph/applications |

Function Apps and Web Apps share the same ARM type. Selecting a parent type alone does not automatically select its children. Selecting a supported child includes the parent needed to collect and organize it, along with its resource group and subscription. Unrelated parent resources and groups are omitted from the imported scope. Parents of previously imported selected objects are also retained when readable, allowing confirmed child deletion to update its relationships.

AZURE_INCLUDE_ENTRA_APPLICATIONS=false hides app registrations and skips Graph. AZURE_ENRICH_INFRASTRUCTURE=false hides subnets. When only app registrations are selected, there is no ARM inventory/sign-in; the existing tenant/subscription prompts are still used for authentication configuration. App registration collection is tenant-wide when selected.

## What happens when the selection changes?

Suppose the first run imports Functions and queues. On the next run you select only VMs. The script updates/imports VMs and their required organization context. It does not check old Functions/queues for deletion, change their LastSync fields, or rename/move/retire their relationships. Shared subscription/resource-group context can still be refreshed.

Only an explicitly selected type can be marked IsDeleted=yes, and only after the existing independent missing-object verification succeeds in a completely read subscription. A denied or incomplete read preserves previous data. Context-only parents cannot be retired merely because they were not found while collecting selected children. Reselect a type later to reconcile its lifecycle.

Generated structural links are reconciled only when both endpoints were reconciled in the current run. Connection and infrastructure inference use the current selected readable inventory. Select both endpoint types to discover a new cross-service link. References outside that scope can produce warnings; earlier links are preserved.

The last applied selection is stored as a JSON array in the non-secret model property **Azure-SelectedObjectTypes**; JSON null means All types. Cancelled runs do not overwrite it. **Azure-LastSuccessfulSyncTypes** records the scope of the most recent complete applied sync. A complete status refers to that selected scope, not to unselected resources. LastSyncDate/LastSyncTime advance only for reconciled elements and links.

AZURE_SELECT_OBJECT_TYPES=true in Sync Azure enables the popup. Setting it to false restores always-All-types behavior and bypasses the saved selection. The Export Azure Inventory utility retains full enabled inventory behavior and does not use the main script's saved type selection.

## Refresh properties on existing model objects

1. Open your model and run **scripts/utils/Refresh Azure Properties.ajs**.
2. Choose authentication and tenant/subscriptions. The utility lists already managed Azure elements in that scope, including Entra applications when enabled. Manually created elements without this synchronizer's ownership marker are excluded.
3. All listed objects initially have checks. Filter by name, type, subscription, Azure ID or Archi ID and adjust the checked set. Clear all and Select shown work as in the type popup. Continue to read only the checked objects.
4. Review the number of readable objects and skipped objects. Confirm to update properties, then save the model.

The utility uses individual ARM or Graph resource GETs. It may read subscription details and ARM provider metadata to validate the tenant, update subscription names and choose the correct API version. It does not enumerate all Azure resources, list function bindings, read connection strings, or query Resource Graph.

Only existing element properties are updated: Azure identity/descriptive properties, successful LastSync timestamps, and enabled allowlisted infrastructure metadata/tags. Repository CreatedDate/CreatedTime are preserved. Custom properties, Archi labels, element types, specializations, folders, relationships and views stay unchanged. An Azure rename updates Azure-ObjectName while retaining the architect's element label.

A readable object previously marked deleted is restored (IsDeleted=no and deletion timestamps cleared). A missing, denied or otherwise unreadable object is skipped with a warning; its timestamps and deletion state remain unchanged. This utility never creates objects or relationships and never marks an object deleted. Use normal Sync with the desired types when lifecycle or relationships need reconciliation.

Model-level status is recorded separately in **Azure-LastPropertyRefreshAt**, **Azure-LastPropertyRefreshStatus** and **Azure-LastPropertyRefreshWarningCount**. It does not overwrite the last full/selected inventory sync status or the saved type selection.

## Implementation and validation

The searchable checkbox popup uses SWT already bundled with Archi; no extra plugin, package or runtime is required. It is implemented with [SWT Table checkbox support](https://help.eclipse.org/latest/topic/org.eclipse.platform.doc.isv/reference/api/org/eclipse/swt/widgets/Table.html). Filtered ARM collection uses [Resources List resourceType filters](https://learn.microsoft.com/en-us/rest/api/resources/resources/list?view=rest-resources-2021-04-01), plus the existing dedicated child endpoints.

Offline regression tests cover two successive selections, independent selected-object deletion, partial access, cancellation, Graph-only selection and individual property reads. tests/selection-smoke.ajs exercises actual Archi model updates, the native full-catalog dialog, property preservation and save/reload with synthetic data on Windows. Live tenant permissions and native Linux/macOS popup interaction still require validation in those environments.
