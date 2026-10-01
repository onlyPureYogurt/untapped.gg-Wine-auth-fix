# Untapped.gg Wine Authentication Fix

A small, unofficial workaround for an Untapped.gg Companion authentication problem observed when running the Windows app through Whisky/Wine on macOS.

## What happens

Untapped.gg Companion opens and the browser login completes successfully, but the app then reports an authentication error and behaves as if no authenticated account exists.

In the tested environment, the Untapped log showed this sequence:

```text
[AuthorizationWorkflow] Completed token exchange
[AuthenticationManager] Received account details
[LocalCredentialsManager.save] Saving <account>...
[LocalCredentialsManager.save] Successfully saved <account>

[LocalCredentialsManager.loadLocalAuthDetails] Loading local authentication details...
[AuthenticationManager.claimAnonymousAccount] No authenticated credentials found
[AuthManager.authSuccessCallback] Error: No authenticated credentials found
```

The account was then removed again.

## Tested environment

- macOS
- Whisky / Wine
- Untapped.gg Companion `3.10.5-latest`
- Game tested: Yu-Gi-Oh! Master Duel
- Untapped's bundled `keytar` module:
  `resources/app.asar.unpacked/node_modules/keytar`

This workaround may also help other Wine/Proton setups with the same symptom, but it has only been verified in the environment above.

## Root cause found

Using Untapped.gg Companion's own Electron runtime and bundled `keytar`, the following test was run:

```bat
set ELECTRON_RUN_AS_NODE=1

"Untapped.gg Companion.exe" -e "(async()=>{const k=require('./resources/app.asar.unpacked/node_modules/keytar');const s='UntappedWineTest';const a='testuser';await k.deletePassword(s,a);console.log('1 setPassword');await k.setPassword(s,a,'testpass');console.log('2 getPassword =',await k.getPassword(s,a));console.log('3 findCredentials =',await k.findCredentials(s));console.log('4 deletePassword =',await k.deletePassword(s,a));})().catch(e=>{console.error(e);process.exit(1)})"
```

Observed result:

```text
1 setPassword
2 getPassword = testpass
3 findCredentials = []
4 deletePassword = true
```

So in this Wine build:

- `keytar.setPassword()` works
- `keytar.getPassword()` works
- `keytar.deletePassword()` works
- `keytar.findCredentials()` returns an empty array

The credential is still actually present in Wine's registry:

```text
HKCU\Software\Wine\Credential Manager\Generic: UntappedWineTest/testuser
```

This points to a credential-enumeration compatibility problem in this Wine/Whisky environment: writing and direct lookup work, while enumeration through `keytar.findCredentials()` does not.

## Workaround

The bundled wrapper is located at:

```text
resources\app.asar.unpacked\node_modules\keytar\lib\keytar.js
```

The workaround is to keep the normal `keytar.findCredentials(service)` call, but when it unexpectedly returns an empty array, fall back to Wine's registry:

1. Query `HKCU\Software\Wine\Credential Manager`
2. Find keys matching `Generic: <service>/<account>`
3. Extract each account name
4. Retrieve its password with the already-working `keytar.getPassword(service, account)`
5. Return the normal keytar shape: `{ account, password }`

The replacement functions are in [patch-snippet.js](./patch-snippet.js).

## Apply the patch

### 1. Fully exit Untapped.gg Companion

Make sure no Companion process is still running.

### 2. Back up the original file

From the Untapped installation directory:

```bat
copy "resources\app.asar.unpacked\node_modules\keytar\lib\keytar.js" "resources\app.asar.unpacked\node_modules\keytar\lib\keytar.js.bak"
```

### 3. Edit `keytar.js`

Open:

```text
resources\app.asar.unpacked\node_modules\keytar\lib\keytar.js
```

Replace the existing `findPassword` and `findCredentials` functions with the versions in [patch-snippet.js](./patch-snippet.js).

Keep the rest of the file unchanged.

### 4. Test before logging in

Set Electron to run as Node:

```bat
set ELECTRON_RUN_AS_NODE=1
```

Create a temporary test credential:

```bat
"Untapped.gg Companion.exe" -e "(async()=>{const k=require('./resources/app.asar.unpacked/node_modules/keytar');await k.setPassword('UntappedWineTest','testuser','testpass');console.log('saved')})().catch(console.error)"
```

Then test enumeration:

```bat
"Untapped.gg Companion.exe" -e "(async()=>{const k=require('./resources/app.asar.unpacked/node_modules/keytar');console.log(await k.findCredentials('UntappedWineTest'))})().catch(console.error)"
```

Before the patch, the result was:

```text
[]
```

After the patch, it should return something like:

```text
[ { account: 'testuser', password: 'testpass' } ]
```

Delete the test credential:

```bat
"Untapped.gg Companion.exe" -e "(async()=>{const k=require('./resources/app.asar.unpacked/node_modules/keytar');console.log(await k.deletePassword('UntappedWineTest','testuser'))})()"
```

Finally, clear the Electron environment variable before launching Untapped normally:

```bat
set ELECTRON_RUN_AS_NODE=
```

## Restore the original file

If anything goes wrong:

```bat
copy /y "resources\app.asar.unpacked\node_modules\keytar\lib\keytar.js.bak" "resources\app.asar.unpacked\node_modules\keytar\lib\keytar.js"
```

## Important notes

- Untapped.gg updates may overwrite the patched `keytar.js`.
- This workaround reads only the account names from Wine's Credential Manager registry. Password/token data is still retrieved through `keytar.getPassword()`; the patch does not decode Wine's registry `Password` binary itself.
- The fallback runs only when the normal `keytar.findCredentials()` call returns no credentials.
- Back up the original file before making changes.
- Do not publish logs containing your email address, tokens, or other account data.

## Why this is different from the usual "Credential Manager is full" fix

Untapped's official authentication troubleshooting may recommend clearing Windows credentials. In this case, deleting credentials did not solve the problem.

The browser OAuth flow completed, the credential was successfully written, and direct credential reads worked. The failure happened when the app tried to enumerate saved credentials.

## Disclaimer

This is an unofficial community workaround and is not affiliated with or endorsed by Untapped.gg, HearthSim, Whisky, Wine, or CodeWeavers.
