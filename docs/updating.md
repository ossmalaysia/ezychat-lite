# App updates

The computer hosting EzyChat Lite checks published GitHub releases at startup and every
12 hours while the desktop app is running. **About EzyChat Lite** and the tray menu also
offer **Check for updates**. Phones, browsers and desktop clients attached to an independently
managed server have no update checks, workflow or alerts.

When a newer release exists, the host shows a suggestion with the version, release notes and
a download for its operating system and architecture. Review the update, then download when
ready. A suggestion never installs software, quits the inbox or interrupts a conversation.
The current unsigned releases use a guided installer download rather than automatic installation.

## Install a suggested update

1. Download the installer from the update panel. It opens the project's GitHub download.
2. Choose a quiet time: updating the host briefly disconnects the team's browsers and phones.
3. If using the background service, stop it from **Status & Service** first.
4. Quit the desktop app from its tray menu. Closing a standalone window only hides it.
5. On Windows, run the new installer using the existing installation location. On Mac, open
   the DMG and replace the application in Applications.
6. Open EzyChat Lite again. Restart the background service if you stopped it.

Accounts, conversations, settings and WhatsApp credentials remain in the app's data directory;
updating does not reset it. Phone and browser clients receive the new interface from the host.
Check the app and server version in **Status & Service** after updating a background service.

## Release detection and publishing contract

- Source: public `ossmalaysia/ezychat-lite` GitHub Releases API, without credentials.
- Compare strict semantic versions, not publication order or text ordering. Never offer a downgrade.
- Ignore draft releases and tags without a published release.
- During the 0.x preview stage, include published preview releases and label them. Stable 1.x
  builds accept full releases; builds with a prerelease version also accept preview releases.
- Select the exact asset `EzyChat-Lite-<version>-win-x64.exe` or
  `EzyChat-Lite-<version>-mac-<x64|arm64>.dmg`; accept historical `WA-Team-Inbox-…` assets
  from this renamed repository for earlier releases. If it is missing, offer release details and
  explain that a compatible installer is unavailable.
- Release notes are plain text. Download and release URLs must exactly match this repository
  and the selected release; renderer code cannot provide arbitrary URLs.
- Checks have a 15-second timeout, bounded responses/pagination and a 60-second minimum retry
  interval. Respect GitHub rate limits, retain useful previous release details on failure and
  never report an unavailable check as up to date.
- The release workflow packages each native architecture and creates a draft. Publish only after
  all intended installers and package smoke checks are ready. A local build or pushed tag alone
  does not trigger an update suggestion.

Existing app data, service identifiers and the Windows executable name retain their legacy
identity during the EzyChat Lite rename. No database reset or WhatsApp relink is required for
the rebrand. Versions that predate the repository rename may fail their old GitHub update check;
download the first EzyChat Lite upgrade directly from the new Releases page in that case.

The first implementation covers release detection, suggestions and guided downloads. A later
automatic installer should use signed update artifacts and coordinated service shutdown; it must
preserve the explicit decision about when to interrupt team access.

References: [GitHub Releases API](https://docs.github.com/en/rest/releases/releases) and
[Electron updater requirements](https://www.electronjs.org/docs/latest/api/auto-updater).
