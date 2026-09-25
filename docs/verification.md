# Verification record

Date: 2026-09-25.

## Executed locally

- 67 offline tests passed on Node.js 24.19.0 / Windows.
- JavaScript/entry-point syntax and all 3,406 mapping/icon references passed validation.
- Actual **Archi 5.10.0.202608252016 + jArchi 1.12.0.202604070605**, using the installed GraalVM engine, passed the model smoke test in an isolated configuration/data directory.
- Updated model test: 40 assertions cover the existing folders/profiles/migration behavior plus 48-pixel icons, configurable image/name positions, offline appearance without another sync, no generated diagrams, composition creation/reuse, manual relationship preservation, soft-delete/restoration, unselected scope and relationship save/reload.
- Actual jArchi Java HTTPS reached public Entra discovery metadata (HTTP 200) and ARM without credentials (expected HTTP 401).
- Icon preparation rendered 714 SVGs into PNGs at a maximum dimension of 48 pixels. No runtime rasterizer is required.
- Offline replay of the user-provided inventory in an isolated, disposable in-memory Archi model passed: 3,128 objects, 95 types, 634 folders including built-in folders, 3,126 composition relationships and zero profiles. Repeated application preserved concept and relationship IDs and folder counts. No diagrams were generated. One manually placed occurrence per type received a custom Top Center image and Bottom Center label through the offline utility before another sync. Application took about 2.8 seconds initially and 1.1 seconds on repeat on this machine; these timings exclude Azure collection, UI overhead and disk saves.
- The optional CLI process bridge passed in actual Windows Archi/jArchi with a fake az.cmd: spaces/parentheses in its path, token JSON parsing, noisy stderr drainage, exit-code handling and timeout/child-process termination.
- Automated tests use disposable models; no existing architecture model or live tenant credentials are used. The user separately exported a live inventory covering 3,128 objects across two subscriptions; that confirms inventory collection for that session, not a live deletion/restoration test.

Runtime result markers: ARCHI_AZURE_SMOKE_PASSED and ARCHI_AZURE_TRANSPORT_PASSED. JSON results go under the ignored work directory. Reproducible .ajs scripts cover model APIs, HTTPS transport and the CLI subprocess bridge. The CLI marker is ARCHI_AZURE_CLI_PROCESS_PASSED.

The isolated test configuration enabled only built-in Archi plugins and jArchi. Other installed plugins were excluded after an unrelated database plugin interrupted the first CLI attempt.

## Still requiring your environment

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
3. Check subscription → resource group and resource group → resource composition links in the Relationships folder. Sync again; no duplicate concepts or links should appear, and no diagrams should be generated.
4. Manually add an element to two views and run utils/Apply Azure Appearance.ajs; check 48-pixel custom Azure images at Top Center and names at Bottom Center, with unchanged sync timestamps and shape bounds. Verify no profiles are created with the default flag.
5. Delete a disposable Azure test resource through your normal Azure workflow; sync and check IsDeleted/timestamps.
6. Recreate the same resource ID; restoration should clear deletion fields and preserve Created values.
7. Try a subscription without read access; the run should stop before model changes.
8. Save and round-trip through the model collaboration tool, including folders and custom icons.

Step 5 is a manual acceptance test. These scripts perform no Azure deletion.
