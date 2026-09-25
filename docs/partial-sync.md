# Partial synchronization and errors

Version 0.11 continues after Azure/Graph read failures and synchronizes the inventory available to the signed-in account. Run **Sync Azure.ajs** as usual; this behavior is automatic and requires no new plugin or setting.

## What you will see

Open the Scripts output window after running the script. Each skipped read prints a line such as:

```text
[WARNING] Entra app registrations page 1 in tenant <tenant-id>: Read Entra applications: HTTP 403 (Authorization_RequestDenied). ... Continuing; unverified objects will be preserved.
```

Warnings identify the service, subscription, collection or object and a sanitized reason. They never include raw server bodies, CLI output, passwords or tokens. The preview and final dialog show the warning count and identify the run as partial. If nothing can be read, the script reports that no objects are available and makes no model or configuration changes.

| Failure | Result |
| --- | --- |
| Graph permissions or consent missing | Report the failure; continue applying readable ARM resources. Keep existing unreadable app Nodes unchanged. |
| One subscription denied | Skip it and continue the other selected subscriptions. |
| First CLI subscription unavailable | Try another selected subscription for token acquisition; never switch Azure CLI's global account. |
| Resource-group list denied | Continue the subscription's resource list and other collectors. |
| Subscription resource list fails | Retain earlier pages and try resource lists for groups already discovered in that run. |
| Queue/topic/function/database list denied | Keep earlier successful pages; continue sibling collections and other parents. |
| Parent kind/SKU unavailable | Report it, then try the known read-only child endpoints. |
| Individual absence check denied or uncertain | Preserve that object; continue checking other existing objects. |
| Network/timeout/TLS error, expired token, malformed list page, exhausted 429/5xx retries | Report the incomplete read and retain available results. |

Failed collection is never treated as a successful empty collection. Existing objects omitted from lists may still be recovered by individual GETs. Discovery cannot identify wholly unknown objects hidden by permissions, and a completely denied subscription metadata request skips that subscription. Graph and ARM use separate tokens; failure to acquire one does not prevent attempting the other. Explicit Cancel still stops the run.

## Deletion, relationships and timestamps

- A subscription with any collection or verification warning has **no deletion reconciliation** for that run. Other fully completed subscriptions can still soft-delete independently confirmed missing objects.
- Any incomplete Entra application collection disables app deletion for the selected tenant in that run.
- Objects actually read can be created, updated or restored. Objects not verified retain their names, properties, GUIDs, IsDeleted and all lifecycle timestamps.
- In partial runs, existing managed relationships update only when both endpoints were reconciled. Links involving an unreadable endpoint retain their names, folders, properties and timestamps. New relationships use successfully collected endpoints; missing parents are reported.
- LastSyncDate/LastSyncTime advance only for reconciled objects and relationships. Partial runs do not advance Azure-LastSuccessfulSyncAt or Azure-LastSuccessfulSyncSubscriptions. Azure-LastSuccessfulEntraSyncAt advances only for a complete applied Entra collection.
- Applied runs record Azure-LastSyncAttemptAt, Azure-LastSyncStatus (complete or partial), and Azure-LastSyncWarningCount. No-access and cancelled runs do not write this metadata. Authentication fallback diagnostics can appear even when a later attempt provides full inventory.

After access is restored, run **Sync Azure.ajs** again. Normal reconciliation resumes using the existing element and relationship GUIDs. No cleanup utility is required.

The distinction depends on what the service reports. A successful but permission-filtered list followed by an authorization-masked resource-not-found response cannot always be distinguished from real deletion. Use stable read permissions and review the deletion preview; reported access failures always disable deletion in their affected scope.

## Errors that still stop the run

Invalid tenant/object identity, unsafe pagination, duplicate identities, incompatible base types, conflicting model data and unknown programming errors are not swallowed. They stop with an explanation in the output and a dialog. This prevents applying data from the wrong scope or hiding model corruption. An exception during model application may require **Edit → Undo**. Collection errors are handled before model application; the script does not save the model automatically.

## Export and discovery

**Export Azure Inventory.ajs** follows the same collection policy and writes schemaVersion 3. The top-level status gives the combined complete/partial outcome. Top-level partial, warnings and completedSubscriptions describe ARM coverage; the optional entraApplications section carries its own completed, partial and warnings fields. Resources and app records contain only successfully read data. These exports are for inspection; Sync fetches fresh inventory rather than importing them.

**Discover Azure Resource Types.ajs** continues with the remaining subscriptions after a provider-discovery failure. It reports warning count in the dialog and exported file header. A partial catalog is not evidence that omitted types have been removed. Appearance and specialization utilities remain offline.

## API references

- [Microsoft Graph error responses](https://learn.microsoft.com/en-us/graph/errors): 401/403 indicate authentication/access failure, not confirmed absence.
- [Microsoft Graph authorization troubleshooting](https://learn.microsoft.com/en-us/graph/resolve-auth-errors): permissions, consent and Conditional Access can prevent reads or token acquisition.
- [ARM resources by resource group](https://learn.microsoft.com/en-us/rest/api/resources/resources/list-by-resource-group?view=rest-resources-2021-04-01): the group-level fallback endpoint.
