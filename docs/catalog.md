# Catalog and icons

## Edit mappings

~~~javascript
var AZURE_SPECIALIZATIONS = [
    ["Microsoft.Compute/virtualMachines", "node", "compute/10021-icon-service-Virtual-Machine.png"],
    // ["Microsoft.Sql/servers", "node", "databases/10132-icon-service-SQL-Server.png"],
];
~~~

Rows contain the ARM type, Archi Technology base type and relative image path under assets/icons. Use exact paths from assets/icon-index.json; Linux paths are case-sensitive.

Comment out whole rows to disable profiles. Rerun **Manage Azure Specializations** to create/update enabled entries and remove disabled entries previously recorded as owned. Elements/relationships survive. Commenting a type does not filter inventory. Sync alone does not prune obsolete profiles.

Every supplied row uses Node. Technology-layer alternatives include system-software, device, communication-network, technology-service and artifact. Existing concept types are not silently replaced; migrate them in Archi before synchronizing.

Profile names are **Azure: <full ARM type>**, distinguishing nested types. Azure kind variants are not separate types: Function Apps and Web Apps can both be Microsoft.Web/sites. This version maps by type.

## Refresh types

There is no timeless list of all public/private/preview Azure service types. The checked-in list collapses API versions in Microsoft's Bicep schema index and adds subscription/resource-group containers. Exact source commit, checksum and counts are in config/catalog-provenance.json.

**Discover Azure Resource Types.ajs** reads all pages of selected subscriptions' provider metadata, exporting a Node row per advertised type. It does not register providers or change Azure. This may reveal types absent from the public schema; it still is not a data-plane catalog.

Compare the exported list in Git/an editor, copy desired new rows into config/specializations.js and choose icons. The script does not automatically overwrite comments or custom mappings.

Maintainers can regenerate the public snapshot:

~~~text
node tools/build-catalog.cjs path/to/bicep-generated-index.json <source-commit>
~~~

This writes config/specializations.generated.js for review and updates provenance/icon index. It leaves the user's specializations.js untouched. Review and merge the output; the extra generated copy need not be committed.

## Icons

The V24 ZIP contains 714 SVGs. This repository includes PNG rasterizations at a maximum dimension of 96 pixels, preserving aspect ratios and transparent backgrounds. Original designs/names are retained. The ZIP's original terms and FAQ are in assets/terms.

Mapping defaults:

- 204 resource types use explicit service/nearest mapped parent icons.
- 338 use provider-family icons.
- 2,864 use Azure's generic All Resources icon.

These defaults do not claim a unique service icon for every type. Edit any third-column path; all 714 assets are available even when not assigned by default.

The script uses model.createImage() to embed image bytes, model.createSpecialization() to create native profiles, and element.specialization to apply them. An existing diagram object's custom image may override its specialization image; choose the specialization image source in Archi. Once saved, icons do not depend on the original filesystem path.

Maintainers can recreate PNGs with a JDK and JSVG 2.1.0, available in Archi 5.10's plugins:

~~~text
java -Djava.awt.headless=true -cp "path/to/jsvg.jar" tools/RasterizeIcons.java "path/to/unpacked/Icons" assets/icons
~~~

Sources: [Bicep type definitions](https://github.com/Azure/bicep-types-az), [provider discovery](https://learn.microsoft.com/en-us/rest/api/resources/providers/list?view=rest-resources-2021-04-01), [Azure icon guidance](https://learn.microsoft.com/en-us/azure/architecture/icons/), [supplied V24 archive](https://arch-center.azureedge.net/icons/Azure_Public_Service_Icons_V24.zip), [jArchi model API](https://github.com/archimatetool/archi-scripting-plugin/wiki/Model).
