# Connecting to Azure

Every Azure-facing script asks you to select an authentication method. Both methods use your own user account and Azure RBAC and, for app registrations, Microsoft Graph permissions; neither stores a password, secret or access token in the Archi model.

| Method in the selector | Your own app registration? | Extra installation | How you sign in |
| --- | --- | --- | --- |
| **Device sign-in (app registration)** | Yes: a public-client app, without a client secret | None beyond Archi/jArchi | Enter the displayed code on Microsoft's website and complete MFA |
| **Azure CLI (no own app registration)** | No custom registration for this script | Azure CLI 2.54 or later | Run az login in a terminal; Archi obtains separate ARM and enabled Graph tokens from that CLI user session |

The choice is available in **Sync Azure**, **Export Azure Inventory** and **Discover Azure Resource Types**. **Manage Azure Specializations** is offline and does not sign in. After a successful applied synchronization, Azure-AuthMethod records the selection and places it first next time. You can switch methods on every run. The original device method remains the initial default.

## Requirements shared by both methods

- Know the **tenant GUID** and the **subscription GUIDs** you want to inventory.
- The signed-in user needs Reader or equivalent full read permissions at each selected subscription scope. Authentication does not grant additional resource access.
- Enabled Entra app inventory also requires tenant-wide app read access through Microsoft Graph. ARM Reader alone does not supply it. See [Entra application setup](entra-applications.md).
- Select only subscriptions belonging to that tenant. Use another run for another tenant.
- This release supports Azure public cloud (AzureCloud), not sovereign clouds or cross-tenant Azure Lighthouse inventory.
- Begin with a copy of your model and review the preview before applying changes.

## Option A — Azure CLI without a custom app registration

### 1. Install Azure CLI

Follow Microsoft's [Windows, macOS or Linux installation instructions](https://learn.microsoft.com/en-us/cli/azure/install-azure-cli). Use version **2.54+**; the script relies on its UTC expires_on field.

Open a terminal and check:

~~~text
az version
~~~

Restart Archi after installation so it inherits the updated PATH.

### 2. Sign in using your normal account

In PowerShell, Terminal or a Linux shell, replace TENANT_GUID with your directory tenant ID:

~~~text
az login --tenant "TENANT_GUID"
~~~

Complete the Windows account/broker or browser sign-in and MFA. If Azure CLI presents a subscription selector, finish that selection. The script will independently use the subscription IDs you enter in Archi.

If you prefer a device code or cannot open a local browser:

~~~text
az login --tenant "TENANT_GUID" --use-device-code
~~~

Your organization must permit the selected sign-in flow. If device-code authentication is blocked, the normal broker/browser login may be the appropriate approved option.

List the available IDs:

~~~text
az account list --query "[].{Name:name,Subscription:id,Tenant:tenantId}" --output table
~~~

No new client ID or client secret is needed for this method.

### 3. Select Azure CLI in Archi

1. Select the intended Archi model and run an Azure script.
2. Choose **Azure CLI (no own app registration)**.
3. Enter the tenant ID and one or more subscription IDs.
4. The script checks your CLI account and obtains a token for Azure Resource Manager; enabled Entra collection requests a separate Microsoft Graph token.
5. Review and apply the synchronization as usual.

The CLI method does **not** ask for a client ID. It retains any previously configured device-sign-in client ID so you can switch back.

Archi calls the installed CLI for account metadata and token acquisition; it does not launch an interactive az login subprocess. If sign-in is missing, expired or requires interaction, the error explains how to run az login in a terminal and retry. Existing CLI sessions signed in as service principals or managed identities are rejected by this interactive-user option.

The CLI's globally active subscription is not changed. The script passes the first selected subscription explicitly when acquiring the tenant token, and then inventories only the subscriptions entered in Archi.

### Executable discovery

The script looks for az on the PATH inherited by Archi, plus standard Windows MSI and macOS/Linux installation paths. Relative PATH entries and the current directory are not searched.

If Archi cannot find a nonstandard installation, set **ARCHI_AZURE_CLI** in the environment that launches Archi to the absolute path of az.cmd/az.exe on Windows or az on Linux/macOS. Do not include command arguments or surrounding quotes in the value. On Windows, paths containing %, !, & or ^ are rejected; spaces and parentheses are supported.

For example, in PowerShell, set the path before starting Archi from that shell:

~~~powershell
$env:ARCHI_AZURE_CLI = 'C:\Program Files\Microsoft SDKs\Azure\CLI2\wbin\az.cmd'
& 'C:\Program Files\Archi\Archi.exe'
~~~

On Linux, launch Archi from a shell with the variable set:

~~~sh
ARCHI_AZURE_CLI=/absolute/path/to/az /absolute/path/to/Archi
~~~

On macOS, the default discovery includes /opt/homebrew/bin/az and /usr/local/bin/az, which helps when launching Archi from Finder.

### CLI authentication cache

Azure CLI maintains its own local authentication cache, separate from the model. Unlike the direct device method, this option deliberately reuses that cache and may let CLI refresh a token when asked.

Keep the CLI configuration/cache outside both script and model Git repositories. If you set AZURE_CONFIG_DIR, use a private user-level directory. Archi captures token output in memory; it does not print it or write it to temporary files, model properties or inventory exports. CLI stderr is drained and suppressed. Each CLI invocation has a 90-second timeout and an output-size limit.

To sign out of Azure CLI when appropriate:

~~~text
az logout
~~~

This also affects other tools using the same CLI session.

## Option B — Direct device sign-in with your app registration

### One-time Entra setup

1. Create an app registration for this desktop script. For one organization, choose accounts in your directory only.
2. Record **Directory (tenant) ID** and **Application (client) ID**. The application's directory Object ID is not its Client ID.
3. In Authentication / advanced settings, enable **Allow public client flows**. Device authorization needs no client secret or redirect URI.
4. Add **Azure Service Management → Delegated permissions → user_impersonation**. Obtain consent according to your organization's policy.
5. For app registration inventory, add **Microsoft Graph → Delegated permissions → Application.Read.All** and obtain administrator consent. The signed-in user also needs tenant-wide access to read app registrations.
6. Assign the signed-in user the required Azure subscription read permissions.

### Connect from Archi

1. Run an Azure script and choose **Device sign-in (app registration)**.
2. Enter tenant ID, subscription IDs and application client ID.
3. Open the Microsoft URL shown in the dialog and enter the short device code.
4. Sign in using your own account and complete MFA.
5. Return to Archi and click OK, then review the resulting change counts.

The script requests https://management.azure.com/user_impersonation from the tenant-specific OAuth v2 device endpoint. It does not collect your password, request offline_access or maintain a persistent token cache. This method signs in anew for each operation. Enabled Entra collection additionally requests https://graph.microsoft.com/Application.Read.All in a second device-code flow for the same tenant/client. Both token references are cleared after use.

Conditional Access may prohibit device-code sign-in. Use an authentication option approved by your organization; no policy is bypassed.

## Stored configuration and token lifetime

The model may contain Azure-AuthMethod, Azure-TenantId, Azure-SubscriptionIds and, for the device method, Azure-ClientId. These are identifiers/settings, not credentials. An optional Azure-UserId is informational and does not determine who signs in.

Both methods keep the current access token in process memory while collecting inventory. The retained reference is cleared afterward; JVM memory cannot guarantee immediate secure erasure. Neither implementation refreshes the in-memory token midway through a long inventory. If it expires, the run stops before model application; rerun it to obtain a new token.

While synchronous sign-in/polling or CLI commands run, Archi may temporarily be unresponsive.

## Troubleshooting and other authentication approaches

| Symptom or question | Action |
| --- | --- |
| Azure CLI not found | Install it, restart Archi, or set ARCHI_AZURE_CLI to an absolute executable path. |
| CLI session unavailable / interaction needed | Run az login --tenant TENANT_GUID in a terminal and retry in Archi. Run az account show --subscription SUBSCRIPTION_GUID there for detailed CLI diagnostics. |
| CLI tenant/subscription mismatch | Sign in to the intended tenant and enter GUIDs from az account list. |
| CLI cloud is not AzureCloud | This release supports public Azure only. Configure the CLI for AzureCloud and sign in there if that is your intended environment. |
| Client ID requested unexpectedly | Select the Azure CLI option instead of Device sign-in. |
| ARM HTTP 403 | Check the user's Azure RBAC access to every selected subscription. |
| Microsoft Graph HTTP 403 / consent required | Check Graph Application.Read.All consent (device method), CLI Graph access and the user's tenant-wide app-read permissions. The combined run stops before model changes. Set AZURE_INCLUDE_ENTRA_APPLICATIONS=false to run ARM-only sync. |
| Device-code flow is blocked | Ask your identity administrators which interactive flow is approved; CLI's broker/browser login is a separate option. |
| Can I enter my password directly in the script? | No. Both implemented methods use Microsoft sign-in. Password-only ROPC cannot satisfy MFA and still requires an application client ID. |
| Service principal, certificate or managed identity? | These are not selectable authentication methods in this release. They would require a separate workload-authentication design. |

## Network and references

Inventory HTTPS calls run directly from Java to management.azure.com and, for enabled app registration collection, graph.microsoft.com, whichever authentication method is selected. Direct device authentication additionally calls login.microsoftonline.com. Java validates TLS using its JVM trust configuration, with API redirects disabled. Configure corporate proxy/trust settings for both Java and Azure CLI if needed; neither script disables certificate validation.

Sources: [CLI installation](https://learn.microsoft.com/en-us/cli/azure/install-azure-cli), [interactive CLI sign-in and token expiry fields](https://learn.microsoft.com/en-us/cli/azure/authenticate-azure-cli-interactively), [CLI token command](https://learn.microsoft.com/en-us/cli/azure/account#az-account-get-access-token), [device authorization](https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-device-code), [public-client configuration](https://learn.microsoft.com/en-us/entra/identity-platform/msal-client-applications), [password-flow limitations](https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth-ropc), [Reader role](https://learn.microsoft.com/en-us/azure/role-based-access-control/built-in-roles/general#reader).
