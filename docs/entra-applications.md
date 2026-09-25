# Entra ID app registrations

Version 0.10 adds registered applications from the selected Entra tenant as **Node** elements. Run **Sync Azure.ajs** as usual. This imports application objects from Microsoft Graph; enterprise applications (service principals), managed identities, users/groups and agent identity blueprints are outside this collector.

## Before your first run

1. Update the complete package, including lib/entra-applications.js. No extra Archi plugin or library is required.
2. Keep AZURE_INCLUDE_ENTRA_APPLICATIONS = true in scripts/Sync Azure.ajs. The export utility has its own identical flag. Both default to true.
3. Give the signed-in user tenant-wide access to read app registrations and use one of the connection options below. Azure subscription Reader permissions alone do not grant Microsoft Graph access.
4. Run Sync Azure.ajs with your usual tenant and subscription IDs, review the combined preview and apply. App collection covers the whole selected tenant once, regardless of which subscriptions you selected for ARM resources.
5. Inspect the new Nodes, save, and run again to verify that they update in place.

To run ARM-only sync, set AZURE_INCLUDE_ENTRA_APPLICATIONS = false. This leaves existing Entra Nodes, folders and sync timestamps unchanged. Since version 0.11, Graph permission/consent and other acquisition failures are logged as warnings and ARM synchronization continues. Successfully read app records can still update their Nodes; unreadable apps remain untouched, and an incomplete Entra collection cannot delete apps. Discovery of ARM resource types remains independent of this flag.

## Connection options

**Azure CLI, without a new app registration:** use your existing interactive CLI session in the selected tenant. Archi requests separate ARM and Microsoft Graph tokens using the installed CLI. Your CLI application consent, signed-in user's directory access and Conditional Access policies must permit application reads. If Graph access is denied, have your tenant administrator check that access or use the direct device option. The script does not change permissions or create an authentication app. See [CLI token acquisition](https://learn.microsoft.com/en-us/cli/azure/account?view=azure-cli-latest#az-account-get-access-token).

**Direct device sign-in:** in the public-client registration already used for this script, open **API permissions → Add a permission → Microsoft Graph → Delegated permissions → Application.Read.All**. Have an authorized administrator grant consent. Retain Azure Service Management / user_impersonation for ARM. No client secret is needed. ARM and Graph require separate tokens, so the script presents a second device-code sign-in for Microsoft Graph. Use the same intended tenant/account. [Graph application read permissions](https://learn.microsoft.com/en-us/graph/api/application-list?view=graph-rest-1.0), [permission consent requirements](https://learn.microsoft.com/en-us/graph/permissions-reference#applicationreadall).

Do not confuse the authentication app's Client ID (model property Azure-ClientId) with an inventoried application's Client ID (element property Azure-ApplicationId).

## Folders and properties

~~~text
Technology & Physical
└── Azure                              (AZURE_ROOT_FOLDER)
    └── Entra ID [tenant-GUID]
        └── App registrations
            └── Application display name  (Node)
~~~

Tenant IDs separate folders even when different tenants contain apps with identical names. Apps do not have an Azure subscription or resource group, so those properties remain empty. The script creates no subscription/resource-group relationships for these Nodes and infers no application dependencies.

| Property | Value for app registrations |
| --- | --- |
| Azure-TenantId | Selected directory tenant GUID |
| Azure-ObjectId | Directory Object ID returned as Graph id |
| Azure-ApplicationId | Application (Client) ID returned as Graph appId |
| Azure-ObjectType | Microsoft.Graph/applications, the catalog key used by this package |
| Azure-ObjectName | Application displayName |
| Azure-URL | Documented Graph object endpoint, https://graph.microsoft.com/v1.0/applications/OBJECT_ID; calling it requires Graph authentication |
| Azure-SubscriptionId, Azure-SubscriptionName | Empty |
| Azure-ResourceGroupId, Azure-ResourceGroupName, Azure-ParentObjectId | Empty |
| CreatedDate / CreatedTime | First creation of the Node in this repository, not app registration time |
| LastSyncDate / LastSyncTime | Successful Entra reconciliation time |
| IsDeleted, DeletedDate / DeletedTime | Existing soft-deletion/restoration rules |

The Node identity is tenant + Graph application Object ID. A display-name change or different ARM subscription selection reuses the same Node. A deleted/recreated registration with a different Object ID creates a new Node. A restored registration with the original Object ID restores the existing Node. Application IDs are metadata, not identity keys. Model property Azure-LastSuccessfulEntraSyncAt records the last applied run that included Entra.

Sync creates no diagrams and applies no icons. The optional Apply Azure Appearance utility uses the bundled App Registrations icon on existing diagram occurrences. Native specializations remain off by default; an optional profile is still based on Node.

## Collection and deletion checks

The collector calls GET /v1.0/applications with $select=id,appId,displayName and follows every @odata.nextLink. It requests no credentials, certificates, redirect URLs, owners or permission-grant contents. Only those three selected identity fields enter the export and model. The collector recognizes and skips the separate agentIdentityBlueprint subtype returned by the current list API. [List API](https://learn.microsoft.com/en-us/graph/api/application-list?view=graph-rest-1.0).

For previously synced apps absent from the complete list, it calls GET /v1.0/applications/{id} with the same projection. A successful response restores the missing list entry. Only a recognized resource-not-found 404 after a complete collection and successful absence checks permits soft deletion. Permission failures, ambiguous 404s, malformed list pages and failed page requests are reported in the Scripts output window and disable deletion for the Entra collection; available records can still synchronize. Invalid identities, duplicate objects and unsafe pagination remain fatal. [Get API](https://learn.microsoft.com/en-us/graph/api/application-get?view=graph-rest-1.0).

Use an account with full tenant-wide app-read access, not access limited to apps it owns. Individual checks reduce false deletion from incomplete listings, but cannot distinguish every authorization-masked not-found response from deletion. Review deletion counts and test with a disposable app before relying on a live deletion cycle.

Export Azure Inventory uses schemaVersion 3 with a separate entraApplications section when enabled; resources remains the ARM list. Each collector records completion and warning details, and status indicates the overall complete/partial result. See [partial synchronization](partial-sync.md). The ordinary Sync script fetches fresh data instead of importing an export file.

Offline collector/authentication tests and a disposable Archi model test passed. Live Graph permissions, tenant coverage and a real app delete/restore cycle still require validation with your account.
