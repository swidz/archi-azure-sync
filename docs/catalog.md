# Catalog and icons

Specialization creation is **off by default**. The catalog still maps Azure types to base types and custom diagram icons. Start with [the user manual](user-manual.md); scripts/Sync Azure.ajs is the normal entry point.

## Edit mappings

~~~javascript
var AZURE_SPECIALIZATIONS = [
    ["Microsoft.Compute/virtualMachines", "node", "compute/10021-icon-service-Virtual-Machine.png"],
    // ["Microsoft.Sql/servers", "node", "databases/10132-icon-service-SQL-Server.png"],
];
~~~

Rows contain the ARM or supported Graph type, Archi Technology base type and relative image path under assets/icons. Use exact paths from assets/icon-index.json; Linux paths are case-sensitive.

Comment out whole rows to disable their mapping; inventory still imports the type, using Node for new unmapped elements and the generic icon only when the optional appearance utility is run. Native profiles are an advanced opt-in: set AZURE_USE_SPECIALIZATIONS=true in the main script to use them during sync. The optional scripts/utils/Manage Azure Specializations.ajs has its own false-by-default guard; enable it explicitly to reconcile all catalog profiles. Removing profiles preserves elements/relationships. Sync alone does not prune profile definitions or load profile icons: it creates new profiles without images and retains any existing profile images. The optional profile manager still installs images when explicitly enabled.

The curated Microsoft.Graph/applications row adds Entra app registrations as Node with the App Registrations icon. App Nodes must retain the Node base type. There are 3,407 mappings in total: 3,406 ARM types plus this Graph entry.

All supplied rows use Node except Microsoft.Web/sites/functions, which uses technology-function. Service Bus queues/topics use the Service Bus icon; individual Functions use the Function Apps icon when the optional appearance utility is run. Technology-layer alternatives include system-software, device, communication-network, technology-service and artifact. Existing concept types are not silently replaced; migrate them in Archi before synchronizing.

Profile names are **Azure: <full ARM type>**, distinguishing nested types. Azure kind variants are not separate types: Function Apps and Web Apps can both be Microsoft.Web/sites. This version maps icons by type. The collector additionally reads the site kind to recognize Function Apps and enumerate their functions. See [child resources](child-resources.md).

## Refresh types

There is no timeless list of all public/private/preview Azure service types. The checked-in list collapses API versions in Microsoft's Bicep schema index and adds subscription/resource-group containers. Exact source commit, checksum and counts are in config/catalog-provenance.json.

**Discover Azure Resource Types.ajs** reads all pages of selected subscriptions' provider metadata, exporting a row per advertised type using its existing curated base type, or Node for an unmapped type. It does not register providers or change Azure. This may reveal types absent from the public schema; it still is not a data-plane catalog.

Compare the exported list in Git/an editor, copy desired new rows into config/specializations.js and choose icons. The script does not automatically overwrite comments or custom mappings.

Maintainer build tools are available in the source repository; see [catalog regeneration](https://github.com/swidz/archi-azure-sync/blob/main/docs/design.md#catalog-and-icon-maintenance).

## Icons

The V24 ZIP contains 714 SVGs. This repository includes PNG rasterizations at a maximum dimension of 48 pixels (half the previous 96), preserving aspect ratios and transparent backgrounds. Original designs/names are retained. The ZIP's original terms and FAQ are in assets/terms.

Original catalog snapshot defaults, before the three child-resource icon overrides:

- 204 resource types use explicit service/nearest mapped parent icons.
- 338 use provider-family icons.
- 2,864 use Azure's generic All Resources icon.

These defaults do not claim a unique service icon for every type. Edit any third-column path; all 714 assets are available even when not assigned by default.

**Sync never loads icon files or applies custom images or text placement.** The optional **scripts/utils/Apply Azure Appearance.ajs** uses model.createImage() and assigns custom images to existing diagram occurrences. Configure its AZURE_IMAGE_POSITION and AZURE_TEXT_POSITION variables (defaults: Top Center image, Bottom Center name). It covers all managed Azure occurrences in the selected model and runs without Azure authentication or synchronization-timestamp changes. Skip it if you want plain shapes. Existing images remain until changed in Archi.

When explicitly enabled, native profiles use model.createSpecialization() and element.specialization. The optional profile manager can install profile icons, and Archi may display these through its profile inheritance. Sync never switches diagram image sources; the appearance utility explicitly selects custom images. No script creates diagrams or connections. Once saved, embedded icons do not depend on their original filesystem path.

See [icon maintenance](https://github.com/swidz/archi-azure-sync/blob/main/docs/design.md#catalog-and-icon-maintenance) for rebuilding assets from the original SVGs.

Sources: [Bicep type definitions](https://github.com/Azure/bicep-types-az), [provider discovery](https://learn.microsoft.com/en-us/rest/api/resources/providers/list?view=rest-resources-2021-04-01), [Azure icon guidance](https://learn.microsoft.com/en-us/azure/architecture/icons/), [supplied V24 archive](https://arch-center.azureedge.net/icons/Azure_Public_Service_Icons_V24.zip), [jArchi model API](https://github.com/archimatetool/archi-scripting-plugin/wiki/Model).
