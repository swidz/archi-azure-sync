# Azure resources for Archi

Synchronize Azure Resource Manager (ARM) inventory into an **existing, selected Archi model** using jArchi. The scripts run inside Archi on Windows, Linux and macOS. No Azure CLI, Node.js, Python, extra JARs or client secret is needed to run them.

**Default mapping: every Azure resource type becomes a Technology-layer Node**, with a native Archi specialization. The editable catalog contains **3,406 resource types across 286 namespaces** from Microsoft's public Bicep schema index. The supplied V24 archive contributes **714 PNG icons**. This is a dated catalog snapshot; a discovery script also lists types advertised by your subscriptions.

## Quick start

1. Install **Archi 5.8+ / Java 21 and jArchi 1.12+**, using the GraalVM JavaScript engine. Integration-tested here on Archi 5.10 and jArchi 1.12 on Windows.
2. Keep the whole repository together. Point **Preferences → Scripting → Scripts folder** to this repository's **scripts** directory, or link the .ajs files in Scripts Manager **at their original locations**. Do not copy just the entry points: lib, config and assets must remain alongside scripts.
3. Create an Entra application as described in [Authentication](docs/authentication.md). You need its tenant ID, application (client) ID and subscription IDs. Give the signed-in user Reader access at each subscription scope.
4. Open/select your architecture model and run **Sync Azure.ajs**.
5. Enter the IDs. Open the displayed Microsoft device-login URL in your browser and enter the short code. Complete sign-in and MFA, then click OK in Archi. Your password is entered only on Microsoft's sign-in page.
6. Review the create/update/restore/delete counts and apply. Review and save/commit the model using your usual Archi collaboration workflow.

All selected subscriptions in one run must belong to the specified tenant. Run again for another tenant. Other tenants and unselected subscriptions are untouched.

## Scripts

| Entry point | Purpose |
| --- | --- |
| scripts/Sync Azure.ajs | Collect all pages, verify missing resources, preview changes, then create/update/soft-delete elements. Creates only specializations needed by the inventory. |
| scripts/Manage Azure Specializations.ajs | Install/update uncommented catalog entries and remove previously managed entries no longer enabled. No Azure sign-in. |
| scripts/Discover Azure Resource Types.ajs | Read provider metadata and export an editable list of advertised types. Review/merge it into the main catalog. |
| scripts/Export Azure Inventory.ajs | Export inventory to JSON without modifying the model. Contains infrastructure metadata, no credentials or tokens. |

Comment out a whole row in **config/specializations.js**, then rerun **Manage Azure Specializations** to remove that profile. Elements and relationships survive. Commenting out a profile does **not** filter inventory. New resources with no enabled mapping use an ordinary Node; existing resources retain their base type.

Common services have specific icons; others use a provider-family or generic resource icon. Every icon path is editable. See [catalog and icons](docs/catalog.md).

## Element properties

| Property | Meaning |
| --- | --- |
| Azure-TenantId | Subscription tenant, verified against Azure metadata |
| Azure-SubscriptionId | Selected subscription GUID |
| Azure-SubscriptionName | Subscription display name |
| Azure-ObjectId | Full ARM resource ID, **not an Entra directory object GUID** |
| Azure-ObjectType | ARM type, such as Microsoft.Compute/virtualMachines |
| Azure-ObjectName | Name returned by Azure |
| Azure-ResourceGroupId | Full resource-group ARM ID, empty for subscription-level objects |
| Azure-ResourceGroupName | Group name, empty for subscription-level objects |
| Azure-URL | Tenant-specific Azure portal resource link |
| CreatedDate, CreatedTime | First creation in this Archi repository, not Azure provisioning time |
| DeletedDate, DeletedTime | First confirmed absence; empty while active; preserved on repeated absent runs |
| LastSyncDate, LastSyncTime | Latest **successful** reconciliation of the selected element, including deleted elements |
| IsDeleted | yes or no |
| Azure-SyncManagedBy | Ownership marker: archi-azure-sync/v1 |

Dates use YYYY-MM-DD; times use UTC HH:mm:ssZ. One timestamp is used for the run. Restoration retains the element ID, relationships and original Created values and clears Deleted values. Resource elements are never physically deleted.

LastSync values advance on every successfully applied run, including unchanged resources. Failed/cancelled runs leave them unchanged so they cannot masquerade as successful synchronization. Unselected elements retain their timestamps.

Resource groups and subscriptions are also Nodes. A group's resource-group properties refer to itself; a subscription's are empty.

## Model configuration and Git

The script stores only non-secret configuration and synchronization metadata:

- Azure-TenantId, Azure-ClientId, Azure-SubscriptionIds — next-run defaults.
- Azure-LastSuccessfulSyncAt, Azure-LastSuccessfulSyncSubscriptions — last applied run.
- Azure-SyncSpecializations — ownership registry for managed profiles.

An optional Azure-UserId property may document an expected account but is not used to authenticate; the browser determines the signed-in account. There is no password/secret prompt, persistent token cache or offline_access scope. Tokens are held in process memory during a run and the retained reference is cleared afterward. JVM memory cannot guarantee immediate secure erasure.

The **script repository** is separate from the **model repository**. Scripts do not automatically save, commit or publish models. Native specialization/image save/reload is tested; check your team's coArchi/coArchi2 round trip with its installed version.

## Reconciliation and failures

- Identity is case-insensitive **tenant ID + ARM resource ID**.
- All selected subscriptions and all list pages must complete before model changes.
- Pagination stays on the selected subscription and fixed ARM host; redirects are disabled.
- HTTP 429/5xx receive bounded retries. Malformed responses, duplicate identities, token expiry, disabled subscriptions or tenant mismatch abort.
- Missing list entries are individually fetched using provider-advertised API versions. Only recognized resource-not-found errors permit soft deletion. HTTP 403, ambiguous 404 and unavailable API metadata abort.
- A move/rename that changes the ARM ID creates a new identity and soft-deletes the old identity after verification.
- Descriptions, unrelated properties, relationships and diagram layouts survive. Azure-owned names/properties refresh.
- Base-type changes stop with an explanation; change the type deliberately in Archi first.
- Only profiles in the script's ownership registry can be removed. Unowned profile-name collisions are rejected.
- Network/authentication/validation failures occur before mutation. An exceptional failure during image import or application can leave partial in-memory changes; use **Edit → Undo** before retrying. The script uses public jArchi undoable APIs.

To **explicitly adopt** an existing manually maintained Azure element, set its exact Azure-TenantId, Azure-SubscriptionId, Azure-ObjectId, Azure-ObjectType, original CreatedDate/CreatedTime, and Azure-SyncManagedBy=archi-azure-sync/v1. Ensure only one concept has the identity. Otherwise identity collisions are rejected.

## Inventory coverage

This release inventories Azure public cloud's **generic ARM Resources List**, selected resource groups and subscription containers. It follows every page and imports any returned resource type, even if absent from the catalog.

A type catalog does not imply that Azure's generic listing returns every object of that type. Some nested resources, such as subnets and database children, require service-specific list APIs. Entra users/groups, blobs, Kubernetes workloads, SaaS application objects, tenant/management-group scope and sovereign clouds are outside this release. It does not infer relationships or create diagrams. Treat the export as an ARM infrastructure inventory, not a universal Azure CMDB.

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
