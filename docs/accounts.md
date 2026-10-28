# Argus accounts

Sign in once and your computers find each other. An Argus account lists the
computers you have linked to it with the addresses they are currently reachable
on, so the iPhone app, the Mac app and the desktop app can connect to every one
of them without scanning a pairing code per computer. Every linked computer also
gets a tunnel of its own, so you reach it from anywhere with nothing to set up.

Accounts are optional. QR pairing keeps working exactly as before and stays the
way to connect without one.

## Signing in

| Where              | How                                                                                                                        |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| iPhone             | Settings → Account. Sign in with Apple, GitHub or an email code. The first device you sign in with sets up the account.    |
| Mac app            | Settings → Account. Sign in with Apple, GitHub or an email code; this also puts this Mac's own host on the account.        |
| Desktop (Electron) | Settings → Account → **Link this computer**. Your browser opens on a code; approve it from your phone (see below).         |
| Headless host      | Type `login` in the `argus-host` terminal (or start it as `argus-host login`). It prints a code.                           |
| Any browser        | Open `houwert.dev/argus/app` and sign in; a device already on the account approves it (see [In a browser](#in-a-browser)). |

### Linking a computer with a code

A computer that has no sign-in of its own — the desktop app, `argus-host`, a
Mac mini in a cupboard — shows a code like `WDJB-MJHT`. Then either:

- type the code into the Argus app on your phone or Mac (Settings → Account →
  **Add a computer**), or
- open `houwert.dev/argus/link`, sign in, and enter it there; then approve it
  from your phone.

Both screens then show the same six-digit number. **Check that they match** on
both before you confirm. That comparison is what stops anyone — including the
account service — from slipping a different computer, or a different key, into
your account.

If your account is still empty, the first computer you link this way becomes
its first member instead, after you confirm on that computer.

### Adding a phone or a Mac

The first device you sign in with sets up the account. Every device after it
asks to join, and one that is already on the account approves it:

1. Sign in on the new iPhone or Mac app. It shows _Approve this phone_ (or Mac).
2. On a device already on the account — your iPhone, the Mac app, or the
   desktop app — a prompt says the new one wants to join. Choose **Review**
   (or find it under Settings → Account → **Waiting to join**).
3. Both screens show the same six-digit code. Check it, then confirm on both.

The new device then lists every computer on the account and connects to them
without a pairing code. A computer that hasn't heard of it yet looks it up the
first time it knocks.

If you've lost every device, a linked computer can approve instead: type
`approve` in its `argus-host` terminal, or use the prompt in the desktop app on
that computer. (Turn this off per computer with _Approve from this computer_.)

Deny anything you didn't just sign in on: a request only gets in if someone
confirms the code on a device that's already trusted.

## In a browser

`houwert.dev/argus/app` is Argus in any current browser — Chrome, Edge,
Firefox or Safari — with nothing to install. It is the same client the
desktop serves on your network, signed in with your account instead of paired
with one computer.

1. Open `houwert.dev/argus/app` and sign in with the account you use in the
   Argus apps.
2. On your iPhone, the Mac app or the desktop app, approve the browser and
   check that both screens show the same six-digit code — exactly as for a
   new phone. A browser can't start an account: if yours has no devices yet,
   sign in on the iPhone or Mac app first.
3. Pick a computer. The browser connects to it through the computer's managed
   tunnel and shows its projects, agents and devices.

A browser only reaches a computer through its tunnel: a page loaded over
https may not open plain `ws://` connections to your local network or
tailnet. A computer with remote access off, or without a tunnel, shows as
having no secure route. It gets the same access as an iPhone (_iPhone and
browser access_ in that computer's account settings).

The browser keeps its keys in its own storage, created so that page scripts
can use them but not read them out. Clearing the site's data, or **Sign out**
(Account, top right), takes the browser off the account. You can rename it
there too, or from any other device.

One thing is different from the apps: in a browser, the code comes from the
site. The account service can't add a device or read your traffic, but
`houwert.dev` serves the page that holds the browser's key, so whoever
controls that site could change what the page does. The page loads scripts
only from `houwert.dev` and the sign-in provider, pinned with integrity
hashes where it can, and keeps no third-party scripts. Prefer the apps on a
device you can install them on, and remove a browser you no longer use.

Background push isn't available in the browser yet; alerts show while the tab
is open.

## Reaching your computers from anywhere

A linked computer with remote access on gets its own **managed tunnel**: a
stable address like `argus-1a2b3c4d5e6f7a8b.houwert.dev`, set up for it by the
account service. Argus downloads Cloudflare's `cloudflared` the first time it's
needed, checks it against a pinned checksum, and runs it in the background. The
tunnel forwards to Argus's remote gateway on that computer and to nothing else.

Your devices try every way in at once and keep the fastest that works:

1. **The local network**, when you're on the same Wi-Fi.
2. **Tailscale**, when both are on your tailnet. Argus uses the computer's
   tailnet address directly; there's nothing to configure.
3. **The managed tunnel**, from anywhere else.

When your network changes — leaving the house, joining the office Wi-Fi — the
phone and the Mac app check again and move to a faster way in as soon as one
works.

Everything inside the tunnel is end-to-end encrypted between your device and
your computer, exactly as on your own network. Cloudflare and the account
service see encrypted bytes and timing, never what you do.

A computer the service can't give a tunnel to (or one where you turned the
tunnel off) keeps working over the local network and Tailscale. A tunnel that
stays unused for two weeks — a computer that's been off that long — is
reclaimed, and set up again the next time that computer comes online, at the
same address.

### Tunnels from earlier versions

Earlier versions let you set up a Cloudflare quick tunnel, a named Cloudflare
tunnel or Tailscale Funnel yourself. Those settings are gone. A tunnel you had
set up keeps running until the computer's managed tunnel is up, so nothing you
rely on stops working; then Argus stops it and forgets its settings. You can
also stop it yourself from Settings → Remote access.

A computer that isn't linked to an account keeps the local network and
Tailscale, and an old tunnel keeps running there. Sharing an agent with a guest
(a huddle) still raises a temporary quick tunnel when nothing else reaches the
computer.

## Notifications

Once a phone is on the account, every computer on it can send that phone
notifications — even a computer you linked a minute ago and never opened on the
phone. Turn them off with **Background push** in the phone's Settings.

- The computer encrypts each notification for your phone before it leaves the
  computer, so neither the account service nor Apple can read it.
- The computer signs every notification it sends. The service only passes it on
  while that computer and your phone are both on your account: a removed
  computer, or one on someone else's account, can't reach your phone.
- When a device asks to join, your phone gets a quiet nudge and shows
  _Approve a new device?_ — then open Argus and compare the codes. When a
  device or computer is removed, your phone picks that up the same way, without
  being opened. These nudges carry nothing but "look again"; the phone reads
  and checks the account itself. iOS may hold them back for an app you swiped
  away; Argus catches up the next time it opens.

Every host list — on the phone, in the Mac app and in the desktop app — also
shows whether each computer on the account is online, or when it was last
seen.

## What the account service can and can't see

The service at `houwert.dev` is a directory and an introducer. It is
deliberately not trusted with anything that would let it into your computers.

It **can** see:

- that your account exists (by an opaque id from the sign-in provider — no email
  is stored),
- the names you gave your computers and devices, and how many there are,
- the addresses each computer publishes (LAN IP, tailnet IP and tunnel
  address) and when it last checked in,
- which computers have a managed tunnel, and when each last asked for it,
- your phone's push token, and when a computer sends it a notification (never
  what the notification says).

It **cannot**:

- add a device or a computer to your account. Every change is a signed entry in
  your account's log, and every device and computer checks every signature
  itself. An entry the service made up is refused.
- swap a computer's key. Apps connect with the end-to-end encrypted Noise
  handshake to the key in the signed log, so a forged key or address only
  fails to connect.
- read anything you do with Argus. Traffic goes from your device to your
  computer over your LAN, your tailnet or the computer's tunnel; it never
  passes through the service itself. The tunnel runs on Cloudflare, which only
  ever carries end-to-end encrypted bytes.
- hand one computer's tunnel to another. A computer asks for its tunnel by
  signing the request with its own key, and only ever gets its own.

What a compromised service could still do is refuse to answer, hide changes
for a while, or show stale addresses. Your devices keep the last good state they
verified and keep trying the last addresses that worked.

Each device shows an **account safety code** (`XXXX-XXXX-XXXX`) in its account
settings. It is derived from the very first entry in your log, so it is the same
everywhere for the same account; comparing it across two devices is a quick
by-eye check that they are on the same account.

## Devices, unlinking and removing

Settings → Account lists the devices on your account — name, kind, when it was
added, and which one you're on — next to its computers. Rename any of them from
there.

### Naming this device or computer

Each device and computer has a name setting. It starts as the system's name
(your iPhone's name, the Mac's computer name), and it is what the device joins
or the computer links as.

| Where              | Setting                                                                                |
| ------------------ | -------------------------------------------------------------------------------------- |
| iPhone             | Settings → **This iPhone's name**                                                      |
| Mac app            | Settings → General → This Mac → **Name** — one name for this Mac and its own host      |
| Desktop (Electron) | Settings → Account → **This computer's name** — names the computer and its window      |
| Headless host      | `account set name <name>` in the `argus-host` terminal (`default` for the system name) |

Changing it while you're on the account renames that device (and computer) on
the account straight away. Offline, the rename waits and goes through once the
account service is reachable. Renaming this device or computer from the
Devices/Computers list edits the same setting, and a rename made from another
of your devices shows up in the setting too.

- **Remove** a device from your phone, the Mac app or the desktop app. Every
  computer it is connected to drops it straight away; it has to be approved
  again to come back.
- **Sign out** on a device removes that device from the account. Computers it
  was QR-paired with are unaffected.
- **Unlink this computer** (desktop Settings → Account, or `logout` in
  `argus-host`) removes the computer: it stops publishing its address, gives
  back its tunnel, and devices on the account can no longer connect to it
  through the account.
- Removing a computer from your phone does the same from the other side.

A device that removes another hands the removal straight to every computer it's
connected to, so it can't be held back by the account service. Other computers
pick it up within five minutes.

## Computer settings

Each computer keeps its account settings locally (they are not synced through
the account):

| Setting                                        | Default  | What it does                                                                      |
| ---------------------------------------------- | -------- | --------------------------------------------------------------------------------- |
| Use the account                                | on       | Off: stop publishing the address and refuse account devices, while staying linked |
| Account service                                | built-in | Point at another account service (self-hosting, staging)                          |
| iPhone and browser access                      | control  | What account iPhones and browsers may do on this computer (`monitor`, `control`)  |
| Mac and desktop access                         | admin    | What account Macs and desktop apps may do (`monitor`, `control`, `admin`)         |
| Publish LAN / Tailscale / Cloudflare addresses | on       | Which addresses go into the directory. LAN IPs are visible to the service         |
| Managed tunnel                                 | on       | Run this computer's tunnel while remote access is on. Off: LAN and Tailscale only |
| Approve from this computer                     | on       | Whether this computer's console may approve other computers joining               |
| Name                                           | system   | The name this computer links as and keeps on the account (see above)              |

Change them in desktop Settings → Account, or with the `account` commands in
`argus-host`.
