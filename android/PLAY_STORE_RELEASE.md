# Google Play release

Peeranki's Android application ID is `com.peeranki.kerala`. It targets API 36,
the current minimum for new Google Play apps. Keep this application ID stable
after creating the app in Play Console.

## Upload signing key

Google Play App Signing is recommended: Google keeps the app signing key and
Peeranki uses a separate upload key for submitted bundles. The upload keystore
and `keystore.properties` are local-only files and must never be committed or
shared publicly. Keep a secure backup of the keystore and its passwords.

Copy `keystore.properties.example` to `keystore.properties` and set the local
keystore path, store password, alias, and key password. With the properties in
place, Gradle signs the release bundle using that upload key.

## Build the bundle

From the repository root on Windows:

```powershell
npm.cmd run build
npx.cmd cap sync android
android\gradlew.bat -p android bundleRelease
```

The Android App Bundle is written to
`android/app/build/outputs/bundle/release/app-release.aab`. Increase
`versionCode` in `android/app/build.gradle` for every Play Store update.

If you have a new personal Play Console developer account created after
November 13, 2023, Google currently requires a closed test with at least 12
testers opted in continuously for 14 days before you can request production
access. Check the Play Console requirements for your account before planning
the launch.
