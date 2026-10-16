# Identity and media service configuration

The review remediation requires migration `0049_identity_assurance` before the updated web application starts. Existing administrator sessions lack second-factor assurance and must sign in again. No credential is provisioned or rotated by this change.

## Administrator authentication

The deployment owner provisions each administrator's authenticator through their approved secure enrollment process. Configure `ADMIN_TOTP_SECRETS` as a private JSON object mapping the existing administrator UUID to that administrator's Base32 secret (at least 128 bits). Each administrator must have a different secret. Store this configuration in the deployment secret store; never put values in source control, browser bundles, audit events, screenshots, or logs.

`POST /api/auth/login` accepts `identifier`, `password`, and optional six-digit `totpCode`. A correct administrator password without a code returns `{ "mfaRequired": true, "method": "totp" }` without issuing a session. Submit the password and code together to finish. Missing configuration returns `503 MFA_NOT_CONFIGURED`. The server accepts a 30-second time step with one-step clock tolerance, records the accepted step transactionally, rejects reuse, and counts wrong passwords and wrong TOTP codes towards the same account lock. Synchronize deployment clocks. Application code does not expose enrollment or recovery secrets.

Each failed authentication is recorded independently of a client idempotency key. Accounts are keyed by stable user ID and serialized. For per-address throttling, enable `TRUST_PROXY_IP=true` only when the reverse proxy replaces `X-Forwarded-For` with a single validated address and blocks direct access to the origin. The application then limits each address to 100 attempts per 15 minutes. Configure an additional request/body/concurrency limit at that proxy; never enable trust for arbitrary caller headers.

Session renewal after an authorization-epoch change carries forward the original `mfaVerifiedAt`; the previous session is invalidated. Self-service password changes support student, parent and administrator accounts; the replacement session inherits the existing MFA assurance. Administrator resets do not change authenticator secrets. Playwright uses a separate fixed test administrator and publicly known test secret, injected only after checking that `DATABASE_URL` names an isolated/test/e2e database. These fixtures never provision a production administrator. Repeated browser logins wait for a fresh TOTP time step instead of disabling replay protection. The functional Playwright runner uses a development server after checking the isolated database name, with explicit development OTP and test scanner fixtures. It does not certify production integrations. Production-mode browser tests require real delivery/scanning relays; testing flags do not bypass production controls. A CI build remains a separate preceding check.

## Verification delivery relay

Configure an HTTPS `VERIFICATION_DELIVERY_URL` and private `VERIFICATION_DELIVERY_TOKEN`. The server sends a POST with a Bearer token, an `Idempotency-Key` equal to the verification UUID, and JSON fields `verificationId`, `contactType` (`email` or `phone`), `contactValue`, `code`, and ISO `expiresAt`. The trusted relay must deliver to the requested contact, deduplicate by verification ID, return a successful HTTP status only after accepting delivery, and omit sensitive payloads from logs. Redirects are forbidden and requests time out after eight seconds.

Production never returns the code in its API response, including when `EXPOSE_DEV_OTP=true`. Missing configuration or delivery failure produces `503 DELIVERY_UNAVAILABLE`. A failed or pending delivery cannot verify a contact. Retry with a new issuance key after correcting the service. Nonproduction environments may use an explicitly returned development code. Issuance is limited to three codes per user per minute; each delivered code permits at most five verification guesses. Delivery performs no network call while holding a database transaction.

## Media scanning relay

Set `BRAIN_DANCE_MEDIA_SCANNER=https-relay`, `BRAIN_DANCE_MEDIA_SCANNER_URL` (HTTPS), and `BRAIN_DANCE_MEDIA_SCANNER_TOKEN`. The application POSTs raw bytes using the declared MIME type and Bearer authentication. The relay must return JSON `{ "outcome": "clean" }` or `{ "outcome": "rejected" }`; any other response, timeout, redirect, or non-success status fails closed. The timeout is ten seconds. The relay must enforce its own byte/type limits and must not retain private content beyond its documented scanning lifecycle.

Production rejects both `test-clean` and `local-no-scan`; `BRAIN_DANCE_ALLOW_TEST_MEDIA_SCANNER` cannot override this restriction. Actual relay delivery/scanning and secure operator enrollment require deployment configuration and are separate from local automated evidence.

## Administrator account recovery

An authenticated active administrator with MFA opens `/admin/accounts` to search by account/name and filter by role. The administrator can reset students, parents and other administrators; the current account uses **change own password** instead. A target-specific confirmation generates one random policy-compliant temporary password, shown only in the first successful response. Copy it before closing. It is never stored in audit/outbox or offered for recovery. If the first response is lost, retry the same command to check the result; a replay does not disclose plaintext. Start a fresh confirmed reset if a new temporary password is needed.

Reset revokes the target's sessions and advances its authorization epoch. All roles using the temporary password must first complete `/change-password`; admins still need their own TOTP. A disabled, locked or deletion-frozen account remains restricted. Unverified parents set their new password before the existing contact-verification step. The new password follows the existing 6–12 character uppercase/lowercase/digit policy and must differ from the current password. No existing local account is reset automatically by installing this feature.
