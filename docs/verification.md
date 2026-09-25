# Verification record

Date: 2026-09-25.

## Executed locally

- 99 offline tests passed on Node.js 24.19.0 / Windows.
- JavaScript/entry-point syntax and all 3,407 mapping/icon references passed validation.
- Actual **Archi 5.10.0.202608252016 + jArchi 1.12.0.202604070605**, using the installed GraalVM engine, passed the model smoke test in an isolated configuration/data directory.
- Updated model test: 46 assertions cover folders/profiles/migration, 48-pixel icons, configurable image/name positions in the optional utility, no generated diagrams, composition creation/reuse, manual relationship preservation, soft-delete/restoration, scope and save/reload. New checks confirm Sync works with icon loading disabled, leaves plain diagram Nodes without custom images, preserves existing images and placement, stores no appearance settings, and creates optional profiles without importing or clearing profile images.
- Child model test: 33 assertions in tests/children-smoke.ajs passed with synthetic ARM responses inside GraalVM. They cover collector-to-model integration, Service Bus composition, Technology Function assignment, SQL serving, duplicate prevention, deletion/restoration, unselected scope, manual serving preservation and save/reload. Version 0.7 additionally verifies the Azure relationship folder, actual endpoint GUID metadata, reuse after renaming/moving with stale cached properties, stable relationship GUIDs and creation dates during migration, a configurable root name, translated category names, manual-folder preservation and save/reload. The model smoke test also verifies that only selected subscription relationships are relocated. Version 0.8 checks source-based subscription/group/type folders across all generated relationship kinds, subscription-source Other and real Other resource groups, migration from the flat Azure root, unchanged folder IDs on repeat and subscription rename, and save/reload.
- Version 0.9 was verified in both model tests: all new relationships have blank names; repeated sync clears legacy and custom names across composition, assignment and SQL serving links without duplicate creation; names on soft-deleted owned links are cleared; manual and unselected links retain their names; blank names survive save/reload.
- Entra model test: 17 assertions in tests/entra-smoke.ajs passed in the installed Graal engine: projected Graph collection, Node type, Object/Client IDs, tenant folders, no invented subscription/group, identity across repeat/rename/subscription changes, disabled collection and other-tenant isolation, soft delete/restore, optional icon handling, and save/reload. The 46-assertion model and 33-assertion child tests also passed again.
- Actual jArchi Java HTTPS reached public Entra discovery metadata (HTTP 200) and ARM without credentials (expected HTTP 401).
- Icon preparation rendered 714 SVGs into PNGs at a maximum dimension of 48 pixels. No runtime rasterizer is required.
- Historical v0.6 validation: offline replay of the older user-provided inventory passed: 3,128 objects, 95 types, 634 folders, 3,152 relationships (3,126 compositions plus 26 SQL server-to-database serving links) and zero profiles. Existing SQL databases were retained without duplicates. Repeat sync preserved IDs and optional diagram appearance. Application took about 2.5 seconds initially and 0.9 seconds on repeat, excluding Azure/network/UI/saving. This older export contains no individual Functions, queues or topics; their collection was tested with synthetic ARM responses, not live access. This export is no longer available at its original path, so the large replay was not rerun for v0.10; the 46- and 33-assertion Archi tests above were rerun successfully for the relationship changes.
- The optional CLI process bridge passed in actual Windows Archi/jArchi with a fake az.cmd: spaces/parentheses in its path, token JSON parsing, noisy stderr drainage, exit-code handling and timeout/child-process termination.
- Automated tests use disposable models; no existing architecture model or live tenant credentials are used. The user separately exported a live inventory covering 3,128 objects across two subscriptions; that confirms inventory collection for that session, not a live deletion/restoration test.

The Entra runtime marker is ARCHI_ENTRA_SMOKE_PASSED.

Runtime result markers: ARCHI_AZURE_SMOKE_PASSED, ARCHI_AZURE_CHILDREN_SMOKE_PASSED and ARCHI_AZURE_TRANSPORT_PASSED. JSON results go under the ignored work directory. Reproducible .ajs scripts cover model APIs, HTTPS transport and the CLI subprocess bridge. The CLI marker is ARCHI_AZURE_CLI_PROCESS_PASSED.

The isolated test configuration enabled only built-in Archi plugins and jArchi. Other installed plugins were excluded after an unrelated database plugin interrupted the first CLI attempt.

## Still requiring your environment

- Live Microsoft Graph consent, tenant-wide application visibility, pagination and a controlled app deletion/restoration cycle with the intended account. The Entra tests used synthetic responses, not live directory access.

- A live run of the new child endpoints against your Service Bus namespaces, Function Apps and SQL servers, including deployment/runtime availability and actual permission coverage.

- Complete device sign-in against your app registration, consent and Conditional Access.
- Automated CLI sign-in/token testing against a live session is not included: the Java process bridge tests use a fake CLI. The user independently completed authentication and inventory export in their session.
- Continued inventory access using your intended account and subscriptions; a user-provided export was successfully compared locally.
- A controlled live resource create/delete/recreate cycle and provider-specific responses.
- Corporate proxy/trust-store settings, if applicable.
- Native Archi execution on Linux/macOS. The code uses portable Java/jArchi APIs, but only Windows was available here.
- Your coArchi/coArchi2 version's specialization/image commit/clone round trip.

The included GitHub Actions workflow runs offline tests on Windows, Ubuntu and macOS once pushed to an enabled GitHub repository. Those CI runs have not been executed in this local task.

## Suggested first tenant run

1. Use a copy of your model and a small subscription with full read access.
2. Export inventory and compare it with Azure Portal's ARM resource list.
3. Check subscription → resource group and resource group → resource composition links under Relationships → Azure, using each link's source subscription, group (or Other) and ARM type. Sync again; no duplicate concepts or links should appear, and no diagrams should be generated. Generated relationships should have blank Name fields, including previously named SQL serving links.
4. Manually add an element to two views and run Sync: no custom images or formatting should be added. Optionally run utils/Apply Azure Appearance.ajs; check 48-pixel icons at Top Center and names at Bottom Center, with unchanged sync timestamps and shape bounds. Change the positions manually and sync again; they should remain unchanged.
5. Delete a disposable Azure test resource through your normal Azure workflow; sync and check IsDeleted/timestamps.
6. Recreate the same resource ID; restoration should clear deletion fields and preserve Created values.
7. Try a subscription without read access; the run should stop before model changes.
8. Save and round-trip through the model collaboration tool, including folders and custom icons.

Step 5 is a manual acceptance test. These scripts perform no Azure deletion.
