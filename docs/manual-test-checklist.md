# Manual test checklist

Run before every release, on a **packaged build** (`npm run dist -w @wa-team-inbox/desktop`), with a
real WhatsApp number you can afford to lose. Automated tests use the fake adapter; this checklist covers
what only a real number, real phones and a real OS can prove.

Per-feature checks in a Dev Build (fake WhatsApp, demo data, real AI model) are logged in
[dev-build-checks.md](dev-build-checks.md).

Record: version, OS + version, phone models, date, tester. Attach `logs/` (Admin → Settings → Download
logs) to any failure report.

You need: the host computer (Windows 10/11 or macOS), a phone with the test WhatsApp number, a second
WhatsApp account to act as the "customer", an iPhone and an Android phone for the PWA, and a WhatsApp
group containing the test number and the customer account.

## 1. Real QR link

- [ ] Install the build on a clean machine (or delete the data folder first). Accept the
      SmartScreen / Gatekeeper warning as described in the README; the app starts.
- [ ] The first-run wizard appears in the desktop window; create the admin account.
- [ ] Open `http://<LAN-IP>:7420/setup` from another device: setup is refused (setup only from the host).
- [ ] Admin → WhatsApp shows a QR code. On the phone: WhatsApp → Settings → Linked devices → Link a device → scan.
- [ ] Status becomes **Connected** within ~30 s and shows the linked number; the phone lists the linked device.
- [ ] Quit the app completely (tray → Quit) and reopen: it reconnects without a new QR.

## 2. Send and receive: text and media

- [ ] From the customer account, send a text. It appears in the inbox within ~5 s, chat moves to the top, unread badge shows.
- [ ] Reply from the inbox. The customer receives it; ticks go pending → sent → delivered → read
      (read only if the customer has read receipts on).
- [ ] Reply with a quote (reply to a specific message); the customer sees the quoted message.
- [ ] Customer sends an image, a video, a voice note, and a PDF. Each previews/plays in the inbox; the PDF downloads.
- [ ] Send an image with a caption, a video, and a document from the inbox (desktop: file picker; phone: camera/gallery).
      The customer receives each with the correct type and file name.
- [ ] Customer sends an `.svg` or `.html` file: it downloads instead of rendering in the browser.
- [ ] Type in the composer: the customer sees "typing…". Use `/` to insert a quick reply.
- [ ] Turn off the host's network for ~1 min, send a message from the inbox (stays pending), turn the network back
      on: the message is delivered without a manual retry.
- [ ] Two team members open the same chat: assignment, internal note and resolve/reopen appear live for both;
      the note never reaches the customer.

## 3. Groups

- [ ] A message in the test group appears as a group chat with the sender's name on each message.
- [ ] Reply from the inbox; all group members receive it from the test number.
- [ ] Media in and out of the group works (one image each way).

## 4. History import

- [ ] Set Admin → Settings → history days to 7. Log out WhatsApp (section 5) and relink.
- [ ] Chats from the last 7 days appear with older messages; nothing older than ~7 days is imported.
- [ ] No push notifications fire for imported history.

## 5. Logout and relink

- [ ] Admin → WhatsApp → **Log out** (confirm). Status shows logged out; the phone no longer lists the device.
- [ ] Existing chats and messages remain readable.
- [ ] A new QR appears; scan it and confirm sending/receiving works again.
- [ ] Remove the linked device **from the phone** instead: the app detects the logout and shows a new QR.
- [ ] Open WhatsApp Web in a browser with the same number to cause a conflict; the app reports it and
      **Take over** reconnects it.

## 6. Tunnel from a phone on mobile data

Turn off Wi-Fi on the phone for this section.

- [ ] Admin → Tunnel → start a **quick tunnel**. A `https://….trycloudflare.com` URL appears within ~30 s.
- [ ] On the phone (mobile data), open the URL, sign in, send and receive a message.
- [ ] Restart the app: the tunnel comes back (new quick URL), and the old URL stops working.
- [ ] Create a named tunnel in the Cloudflare dashboard with a public hostname pointing to
      `http://localhost:7420`; paste its token and hostname in Admin → Tunnel and start it.
- [ ] On the phone, open `https://<your-hostname>`, sign in, send and receive a message.
- [ ] Wrong passwords 5× from the phone lock that account temporarily; the admin can still sign in from the host.
- [ ] Stop the tunnel: the public URL stops answering.

## 7. PWA install and push

- [ ] **iPhone (iOS 16.4+), Safari:** open the tunnel URL → Share → **Add to Home Screen**. Open the Home Screen app,
      sign in, enable notifications when prompted (or in the profile menu) and allow.
- [ ] **Android, Chrome:** open the tunnel URL → menu → **Install app** / Add to Home Screen. Open it, sign in, enable notifications.
- [ ] Both apps launch full-screen with the EzyChat Lite icon and name; layout fits at the phone width without horizontal scroll.
- [ ] Close the PWA on both phones (and lock the screens). Customer sends a message to an **unassigned** chat:
      both phones get a notification; tapping it opens that chat.
- [ ] Assign the chat to the Android user only; next customer message notifies only Android.
- [ ] With the PWA open and in the foreground on a phone, no duplicate system notification is shown.

## 8. LAN mode

- [ ] Admin → Settings → enable LAN access; restart if prompted. A banner warns that LAN is plain HTTP.
- [ ] From a laptop on the same network, open `http://<host-LAN-IP>:7420` and sign in; messages work.
- [ ] Open `http://<host-name>.local:7420` (macOS host) or `http://<host-name>:7420` (Windows host): works.
- [ ] Disable LAN access: the LAN URL no longer connects; `http://127.0.0.1:7420` on the host still works.

## 9. Background service and reboot (Windows **and** macOS)

Repeat this section on both operating systems.

- [ ] Tray → **Status & Service…** → enable the service; approve the admin (UAC / password) prompt.
- [ ] The window reconnects as a client; chats, users and the WhatsApp link are unchanged (data moved to
      `C:\ProgramData\wa-team-inbox` or `/Library/Application Support/wa-team-inbox`).
- [ ] Windows: `services.msc` shows the EzyChat Lite service as Running / Automatic.
      macOS: `sudo launchctl print system/org.ossmalaysia.wateaminbox.server` shows it running.
- [ ] Start a tunnel. **Reboot and do not sign in.** From a phone on mobile data, after ~2 min the tunnel URL
      (named tunnel; a quick tunnel gets a new URL) works and a customer message arrives and triggers push.
- [ ] Sign in, open the app: it connects to the running service, does not start a second server.
- [ ] Quit the desktop app: the service keeps running (phone still works).
- [ ] Disable the service from Status & Service: data moves back to the user profile, standalone server
      starts, everything still works.

## 10. Reset admin from the tray

- [ ] Standalone: tray → **Reset admin password…** → confirm. A dialog shows a new password; copy it.
- [ ] Old admin sessions (other browsers/phones) are signed out. Sign in with the new password; you are
      asked to change it.
- [ ] Repeat with the service enabled (client mode); approve the OS admin prompt; same result.
- [ ] Confirm there is no way to reset the admin password from the web UI without being signed in.

## 11. Backups

- [ ] After the app has run for a few minutes, `<data>/backups/` contains `app-YYYYMMDD.db` and
      `wa-auth-YYYYMMDD/` for today.
- [ ] Open the `.db` backup with any SQLite viewer: it contains your chats and messages.
- [ ] Restore test: quit the app, copy `app.db` aside, replace it with the backup (renamed to `app.db`), start the
      app: data matches the backup date and WhatsApp still connects.
- [ ] After 8+ days of running (or with the system clock moved forward), only the newest 7 of each backup kind remain.
