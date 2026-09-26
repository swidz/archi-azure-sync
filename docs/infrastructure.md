# Infrastructure enrichment and subnet inventory

Version 0.13 adds selected resource properties, tags, subnet Nodes and relationships backed by explicit Azure resource IDs. Run **scripts/Sync Azure.ajs** normally. The Export utility collects the same projected data without modifying the model. No extra plugin, app registration, PowerShell module or ARI installation is required.

## Settings and first run

At the top of **scripts/Sync Azure.ajs**:

~~~javascript
var AZURE_ENRICH_INFRASTRUCTURE = true;
var AZURE_TAG_KEYS = ["Environment", "Application", "Owner", "CostCenter"];
~~~

The Export utility has independent settings with the same defaults. Set the first flag to false to skip enrichment and subnet collection; existing enriched properties, subnet elements, subnet containment and infrastructure associations remain unchanged. Other inventory, Service Bus/Function/SQL children, Entra and connection discovery keep their own behavior.

Set AZURE_TAG_KEYS to [] to stop importing tags. Up to 32 distinct keys are supported, starting with a letter and containing letters, digits, underscore or hyphen, with a maximum of 64 characters each. Matching is case-insensitive; the configured spelling determines the model property name. Credential-like key names are rejected. Only select organizational metadata: selected tag values are stored in the model and inventory export and can therefore enter the model's Git history. Removing a key from the list stops refreshing it; it does not erase values already stored under that property.

For an upgraded installation:

1. Replace the complete runtime package, including the new lib/infrastructure.js, preserving your local settings and mapping edits.
2. Open a copy of your model and run Sync with your usual tenant and subscriptions. No utility needs to run first.
3. Review the preview and any warnings in the Scripts output; apply the result.
4. Inspect subnet Nodes, the new element properties and Association links under Relationships / Azure. All links have blank names and follow their source element's subscription, resource group and type.
5. Run again to check that existing element and relationship GUIDs are reused. Save the model when satisfied.

Sync creates no diagrams and changes no diagram images, label positions or layouts. The separate appearance utility remains optional. Existing Function App-to-Technology Function **Serving** and other service relationships are retained.

## Collection, permissions and coverage

Generic ARM inventory and dedicated child lists still determine which elements exist. Enrichment queries **Azure Resource Graph** (ARG) separately for each selected subscription using the existing ARM token. It is a read-only POST to the documented Resource Graph query endpoint, with pagination and explicit subscription scope. ARG is distinct from **Microsoft Graph**, which the optional Entra application collector uses. Turning off Entra collection does not disable ARG enrichment.

ARG supplies the selected detailed fields for the supported types below. Only resources already found in the current ARM inventory can be enriched. Common metadata from the ARM response takes precedence over the indexed ARG copy. If a supported resource is missing from ARG, the collector attempts a direct ARM detail read. ARG denial or partial pages are reported; successfully read ARM inventory and available enrichment continue. A warning still makes the overall applied run partial, even if fallback detail reads succeed.

Network interface and private endpoint details are always read directly through ARM before retiring their old associations. Subnets are enumerated through each VNet's ARM subnets endpoint; these responses supply subnet metadata and NSG references. The generic list is not treated as complete subnet coverage. Missing existing subnets receive individual ARM existence checks under the existing conservative deletion rules.

Use your existing user authentication and subscription Reader or equivalent management-plane read access. Custom roles may omit resource detail or subnet reads; errors are printed and the affected existing data is preserved. No new service credentials, access-key calls, configuration-list actions or Microsoft Graph scopes are required for this feature. Tenant policies and actual permissions still apply. Existing **connection discovery** separately needs App Service configuration access: AZURE_DISCOVER_CONNECTIONS=false skips those configuration reads while leaving infrastructure enrichment enabled.

ARG is an indexed source and can lag Azure. Its omissions never authorize element deletion or relationship retirement. This feature does not replace the current ARM inventory with ARG and does not claim to accelerate the whole sync: detail reads for network owners and the other collectors still run.

## Imported element properties

Fields are written only when the corresponding source supplies them. Availability varies by service and API. Common properties are projected from readable ARM resources; detailed enrichment covers VMs, VNets, subnets, NICs, private endpoints, public IPs, NSGs, App Service sites, SQL servers/databases and storage accounts.

| Scope | Properties |
| --- | --- |
| Common metadata | Azure-Location, Azure-Kind, Azure-SkuName, Azure-SkuTier, Azure-SkuCapacity, Azure-AvailabilityZones |
| Selected tags | Azure-Tag-Environment, Azure-Tag-Application, Azure-Tag-Owner, Azure-Tag-CostCenter by default |
| Supported detailed resources | Azure-ProvisioningState when supplied |
| Virtual machines | Azure-VMSize, Azure-OSType |
| VNets and subnets | Azure-AddressPrefixes |
| Subnets | Azure-PrivateEndpointNetworkPolicies, Azure-PrivateLinkServiceNetworkPolicies |
| Network interfaces | Azure-PrivateIPAddresses |
| Public IP addresses | Azure-PublicIPAddress, Azure-IPAllocationMethod |
| Private endpoints | Azure-PrivateLinkStatuses |
| App Service sites / Function Apps | Azure-Runtime, Azure-HttpsOnly, Azure-MinimumTlsVersion, Azure-PublicNetworkAccess |
| SQL servers | Azure-Version, Azure-MinimumTlsVersion, Azure-PublicNetworkAccess |
| SQL databases | Azure-DatabaseStatus, Azure-MaxSizeBytes |
| Storage accounts | Azure-AccessTier, Azure-MinimumTlsVersion, Azure-HttpsOnly, Azure-PublicNetworkAccess, Azure-AllowBlobPublicAccess |

List-valued properties are sorted, deduplicated JSON arrays. Scalars are stored as text. Absent fields preserve existing values; explicit null scalars clear the value. When Azure returns a tags object, selected keys missing from it are cleared; when the entire tags field is unavailable, old tag values remain. Unsupported values produce warnings and preserve the affected property. Raw properties JSON, unselected tags, credentials, keys, connection strings, VM custom data and arbitrary configuration are not included by this feature.

Each applied metadata projection also records:

| Property | Meaning |
| --- | --- |
| Azure-EnrichmentSource | Detail source: Azure Resource Graph, Azure Resource Manager, or ARM inventory. Common fields can also come from the latest ARM inventory. |
| Azure-EnrichmentCoverage | complete or partial for that resource's current projection and applicable network reads. This does not mean every possible Azure field was supplied or that ARG is current. |
| Azure-LastEnrichmentDate / Azure-LastEnrichmentTime | UTC date/time when this projection was applied, including partial updates. These do not certify the freshness of fields preserved from earlier runs. |

Existing identity and lifecycle properties retain their documented meanings. A detail-read failure does not prevent a readable resource's basic identity from being synchronized. No runtime setting or token is written to the model.

## Subnet Nodes and explicit relationships

A subnet uses Microsoft.Network/virtualNetworks/subnets and the default Node mapping. Its Azure-ParentObjectId is the VNet ARM ID. It lives under Azure / subscription / resource group / Microsoft.Network/virtualNetworks/subnets. Both the VNet and its resource group compose the subnet, consistent with other Node children.

These additional links use **Association**, with source and target recorded as follows:

| Source → target | Evidence in Azure |
| --- | --- |
| VM → NIC | NIC properties.virtualMachine.id |
| NIC → subnet | NIC IP configuration's subnet.id |
| NIC → public IP | NIC IP configuration's publicIPAddress.id |
| NIC → NSG | NIC properties.networkSecurityGroup.id |
| Subnet → NSG | Subnet properties.networkSecurityGroup.id |
| Private endpoint → subnet | Private endpoint properties.subnet.id |
| Private endpoint → NIC | Private endpoint properties.networkInterfaces[].id |
| Private endpoint → target resource | privateLinkServiceId in automatic or manual private-link service connections |

These associations describe resource configuration, not runtime calls or network reachability. They do not imply Triggering, traffic direction, an approved private link, or that firewall rules permit communication. Private-link statuses are retained separately on the endpoint. VM-to-NIC evidence is collected from the NIC, even though the VM is the relationship source.

Targets must exist in the current readable inventory, in the same tenant and within the selected subscriptions. Cross-subscription links are supported when both subscriptions are selected. Unresolved, out-of-scope, self-referencing or incompatible references are reported and skipped; no placeholder elements are invented. The affected owner retains its existing links until a complete read can verify their status.

The adapter matches actual source element GUID + target element GUID + relationship type. Multiple references for the same pair share one relationship with combined evidence. Existing matching manual relationships are reused without taking ownership, renaming, moving or adding properties to them.

Script-owned infrastructure associations carry the usual identity, lifecycle and endpoint GUID properties, plus:

- Azure-InfrastructureEvidence: JSON evidence containing ownerId, sourceId, targetId, property and readSource. The owner is the resource whose response supplied the reference.
- Azure-InfrastructureProperties: source property path, or a JSON list of paths.
- Azure-InfrastructureSource: ARM / ARG provenance derived from the evidence.
- Azure-InfrastructureCoverage: complete or partial evidence coverage.

A previously seen association is soft-deleted only after all its relevant owners are read successfully and no longer reference the target, or the owner is authoritatively confirmed deleted, with both endpoints in the reconciled scope. Permission failures, incomplete reference structures and unselected resources preserve prior evidence and relationships. Restoration reuses the existing relationship GUID and original creation time. Enrichment and configuration-derived connection discovery have separate evidence and completion tracking.

## Scope and sources

This increment does not collect network flows, effective routes, NSG rules, load balancer/application gateway backend topology, management groups, Advisor recommendations, vulnerabilities or cost data. It does not scan all resource properties for IDs or infer every possible dependency. Such additions need separate supported collectors and ArchiMate mapping decisions.

The approach was informed by reviewing [Microsoft Azure Resource Inventory (ARI)](https://github.com/microsoft/ARI/tree/579232984611a3a45ab47391f882867f3fd52b23), whose reports combine Resource Graph properties and explicit infrastructure references. This package uses independently written JavaScript; it does not copy ARI source or include its PowerShell/Excel dependencies or reporting exclusions.

API references: [Resource Graph overview](https://learn.microsoft.com/en-us/azure/governance/resource-graph/overview), [Resource Graph Resources query, 2024-04-01](https://learn.microsoft.com/en-us/rest/api/azureresourcegraph/resourcegraph/resources/resources?view=rest-azureresourcegraph-resourcegraph-2024-04-01), and [Subnets List, 2025-09-01](https://learn.microsoft.com/en-us/rest/api/virtualnetwork/subnets/list?view=rest-virtualnetwork-2025-09-01). Other ARM detail reads use provider metadata to select a supported API version, preferring stable versions.

See [verification](verification.md) for the offline and real Archi tests. Infrastructure collection has been exercised with synthetic responses and disposable models; live tenant acceptance remains necessary.
