# Authentication

## One-time Entra setup

1. Create an app registration for this desktop script. For one organization, choose accounts in your directory only.
2. Record **Directory (tenant) ID** and **Application (client) ID**. The app's directory Object ID is not its Client ID.
3. In Authentication / advanced settings, enable **Allow public client flows**. Device authorization uses a public client and needs no client secret or redirect URI.
4. Add **Azure Service Management → Delegated permissions → user_impersonation**. Obtain consent according to your organization's policy.
5. Assign the **signed-in user** Reader or equivalent full read permissions at each subscription scope. API consent and Azure RBAC are separate.
6. Run the script with those IDs and your intended subscription IDs.

The script requests https://management.azure.com/user_impersonation from the tenant-specific OAuth v2 device endpoint. It displays a Microsoft URL/code in an Archi dialog. Authenticate and complete MFA on Microsoft's website, then return to Archi.

The dialog supports Cancel before polling. While synchronous requests or polling run, Archi may temporarily be unresponsive. Requests have timeouts and device authorization expires. Each Azure operation asks for sign-in; no refresh token is requested. An inventory that outlasts its access token aborts before application.

Conditional Access may prohibit device-code sign-in. If so, use an authentication design approved by your identity administrators. Changing to username/password would not solve that policy restriction. No policy is bypassed.

## Credentials

The selected workflow is interactive sign-in with MFA. It does not collect a password in JavaScript. A public desktop application needs no client secret.

Access tokens remain in memory for the run and are never put in model properties, exports, log messages, configuration files or process arguments. Keep one stable account/read scope for successive inventories. One tenant is supported per run; cross-tenant Azure Lighthouse enumeration is not implemented.

## Network

Endpoints are fixed to login.microsoftonline.com and management.azure.com. Java HTTPS validates TLS using the JVM trust configuration. API redirects are disabled. Configure any corporate proxy/trust store at the JVM/environment level; the script never disables certificate validation.

HTTP errors expose only status and a validated error code. Raw response bodies and token request bodies are not logged.

Sources: [device authorization protocol](https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-device-code), [public-client flow configuration](https://learn.microsoft.com/en-us/entra/identity-platform/msal-client-applications), [Microsoft Azure Identity registration example](https://github.com/Azure/azure-sdk-for-js/blob/main/sdk/identity/identity/samples/AzureIdentityExamples.md), [Reader role](https://learn.microsoft.com/en-us/azure/role-based-access-control/built-in-roles/general#reader).
