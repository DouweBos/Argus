# Argus accounts

Sign in once and your computers find each other. An Argus account lists the
computers you have linked to it with the addresses they are currently reachable
on, so the iPhone app and the Mac app can connect to every one
of them without scanning a pairing code per computer. Every linked computer also
gets a tunnel of its own, so you reach it from anywhere with nothing to set up.

Accounts are optional. QR pairing keeps working exactly as before and stays the
way to connect without one.

## Signing in

| Where         | How                                                                                                                        |
| ------------- | -------------------------------------------------------------------------------------------------------------------------- |
| iPhone        | Settings → Account. Sign in with Apple, GitHub or an email code. The first device you sign in with sets up the account.    |
| Mac app       | Settings → Account. Sign in with Apple, GitHub or an email code; this also puts this Mac's own host on the account.        |
| Argus Server  | **Link to Argus Account…** in its menu bar item. It shows a code.                                                          |
| Headless host | Type `login` in the `argus-host` terminal (or start it as `argus-host login`). It prints a code.                           |
| Any browser   | Open `houwert.dev/argus/app` and sign in; a device already on the account approves it (see [In a browser](#in-a-browser)). |

### Linking a computer with a code

A computer that has no sign-in of its own — Argus Server,
`argus-host` on a Mac mini in a cupboard — shows a code like `WDJB-MJHT`. Then either:

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
2. On a device already on the account — your iPhone or the Mac
   app — a prompt says the new one wants to join. Choose **Review**
   (or find it under Settings → Account → **Waiting to join**).
3. Both screens show the same six-digit code. Check it, then confirm on both.

The new device then lists every computer on the account and connects to them
without a pairing code. A computer that hasn't heard of it yet looks it up the
first time it knocks.

Deny anything you didn't just sign in on: a request only gets in if someone
confirms the code on a device that's already trusted.

## If you lose your devices

| You still have                    | Do                                                                                                                                                                                                                                                   |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Any device on the account         | Approve the new one from it, as above.                                                                                                                                                                                                               |
| No device, but a linked computer  | Approve from that computer instead: type `approve` in its `argus-host` terminal, pick **Waiting to join** in Argus Server's menu, or use the prompt in the Mac app on that computer. (Turn this off per computer with _Approve from this computer_.) |
| Nothing at all that could approve | Reset your account from the iPhone or Mac app (see below).                                                                                                                                                                                           |

### Resetting your account

Sign in on the iPhone or Mac app. While it waits for approval, choose **Reset
account…** under _Nobody left to approve?_ (it is also at the bottom of
Settings → Account). Argus emails you a code to confirm it's you, then starts
your account over with this device as its only member. Resetting is only
possible from the iPhone and Mac apps, never from a browser.

What happens next:

- **Every device and computer leaves the account.** Your other phones and
  Macs say _Your account was reset_ and ask to join again; approve them from
  the device you reset on.
- **Each computer has to be linked again from its own keyboard.** It stops
  publishing its address, gives back its tunnel, lets no account device in,
  and shows _This account was reset — link this computer again_ in
  Argus Server's menu, the Mac app and the `argus-host`
  terminal. Link it the usual way (**Link to Argus Account…** or `login`). The Mac you reset on links its own host again by
  itself.
- **Computers you paired with a QR code keep working.** Pairings don't go
  through the account.

A computer never follows a reset on its own, because the account service
can't prove one happened — only that someone signed in to your account
recently. Linking it again from its keyboard is what puts it on the new
account. Your account's safety code changes with the reset.

If a device or computer says your account was reset and you didn't do it,
someone has your sign-in: change it with your sign-in provider, then reset
again from a device of yours and link your computers again.

## In a browser

`houwert.dev/argus/app` is Argus in any current browser — Chrome, Edge,
Firefox or Safari — with nothing to install. It is the same client the
host serves on your network, signed in with your account instead of paired
with one computer.

1. Open `houwert.dev/argus/app` and sign in with the account you use in the
   Argus apps.
2. On your iPhone or the Mac app, approve the browser and
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
(Account, top right), takes the browser off the account.

The Account screen also lists every device and computer on the account. From
there you can rename any of them, remove any of them, or delete the whole
account (see [Deleting your account](#deleting-your-account)). Adding
anything — approving a device, linking a computer — stays with the apps.

One thing is different from the apps: in a browser, the code comes from the
site. `houwert.dev` serves the page that holds the browser's key, so whoever
controls that site could change what the page does. That's why a browser can
only take trust away: it can rename and remove devices and computers, but it
can never approve a new device or computer, or start an account. Every
computer and device checks this itself and refuses an approval signed by a
browser, so even a tampered page can't let anyone into your account. The page loads scripts
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

Every host list — on the phone and in the Mac app — also
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

| Where         | Setting                                                                                |
| ------------- | -------------------------------------------------------------------------------------- |
| iPhone        | Settings → **This iPhone's name**                                                      |
| Mac app       | Settings → General → This Mac → **Name** — one name for this Mac and its own host      |
| Argus Server  | Menu → Argus Account → **This Computer's Name…**, or its Settings → Account & Remote   |
| Headless host | `account set name <name>` in the `argus-host` terminal (`default` for the system name) |

Changing it while you're on the account renames that device (and computer) on
the account straight away. Offline, the rename waits and goes through once the
account service is reachable. Renaming this device or computer from the
Devices/Computers list edits the same setting, and a rename made from another
of your devices shows up in the setting too.

- **Remove** a device from your phone, the Mac app or a
  browser at `houwert.dev/argus/app`. Every computer it is connected to drops
  it straight away; it has to be approved again to come back.
- **Sign out** on a device removes that device from the account. Computers it
  was QR-paired with are unaffected.
- **Unlink this computer** (Argus Server's menu →
  Argus Account → **Unlink…**, or `logout` in `argus-host`) removes the computer: it stops publishing its address, gives
  back its tunnel, and devices on the account can no longer connect to it
  through the account.
- Removing a computer from your phone, the Mac app or a browser does the same
  from the other side.

A device that removes another hands the removal straight to every computer it's
connected to, so it can't be held back by the account service. A browser
briefly connects to each computer that's online to do the same. Other
computers pick it up within five minutes.

### Deleting your account

**Delete account** in the browser (`houwert.dev/argus/app` → Account) removes
the account from the service in one go. You're asked to verify it's you first.

- Every device and computer loses the account at once, the browser included.
  The service forgets their addresses and closes their tunnels.
- Pairings made with a QR code keep working.
- To start over, sign in on the Argus app on your iPhone or Mac — that device
  sets up a fresh account — then link each computer again from its own console,
  and approve your other devices as they sign in.

## Computer settings

Each computer keeps its account settings locally (they are not synced through
the account):

| Setting                                        | Default  | What it does                                                                      |
| ---------------------------------------------- | -------- | --------------------------------------------------------------------------------- |
| Use the account                                | on       | Off: stop publishing the address and refuse account devices, while staying linked |
| Account service                                | built-in | Point at another account service (self-hosting, staging)                          |
| iPhone and browser access                      | control  | What account iPhones and browsers may do on this computer (`monitor`, `control`)  |
| Mac and desktop access                         | admin    | What account Macs may do (`monitor`, `control`, `admin`)                          |
| Publish LAN / Tailscale / Cloudflare addresses | on       | Which addresses go into the directory. LAN IPs are visible to the service         |
| Managed tunnel                                 | on       | Run this computer's tunnel while remote access is on. Off: LAN and Tailscale only |
| Approve from this computer                     | on       | Whether this computer's console may approve other computers joining               |
| Name                                           | system   | The name this computer links as and keeps on the account (see above)              |

Change them in Argus Server's Settings → Account & Remote, or with the
`account` commands in `argus-host`. Argus for Mac has the managed tunnel switch
under Settings → Remote.
