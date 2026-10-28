# Argus accounts

Sign in once and your computers find each other. An Argus account lists the
computers you have linked to it with the addresses they are currently reachable
on, so the iPhone app, the Mac app and the desktop app can connect to every one
of them without scanning a pairing code per computer — and keep connecting when
a quick tunnel comes back on a new URL.

Accounts are optional. QR pairing keeps working exactly as before and stays the
way to connect without one.

## Signing in

| Where              | How                                                                                                                     |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| iPhone             | Settings → Account. Sign in with Apple, GitHub or an email code. The first device you sign in with sets up the account. |
| Mac app            | Settings → Account. Sign in with Apple, GitHub or an email code; this also puts this Mac's own host on the account.     |
| Desktop (Electron) | Settings → Account → **Link this computer**. Your browser opens on a code; approve it from your phone (see below).      |
| Headless host      | Type `login` in the `argus-host` terminal (or start it as `argus-host login`). It prints a code.                        |

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

## What the account service can and can't see

The service at `houwert.dev` is a directory and an introducer. It is
deliberately not trusted with anything that would let it into your computers.

It **can** see:

- that your account exists (by an opaque id from the sign-in provider — no email
  is stored),
- the names you gave your computers and devices, and how many there are,
- the addresses each computer publishes (LAN IP, Tailscale or Cloudflare URL)
  and when it last checked in.

It **cannot**:

- add a device or a computer to your account. Every change is a signed entry in
  your account's log, and every device and computer checks every signature
  itself. An entry the service made up is refused.
- swap a computer's key. Apps connect with the end-to-end encrypted Noise
  handshake to the key in the signed log, so a forged key or address only
  fails to connect.
- read anything you do with Argus. Traffic goes from your device to your
  computer directly over its own tunnel or your LAN; it never passes through
  the service.

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

- **Remove** a device from your phone, the Mac app or the desktop app. Every
  computer it is connected to drops it straight away; it has to be approved
  again to come back.
- **Sign out** on a device removes that device from the account. Computers it
  was QR-paired with are unaffected.
- **Unlink this computer** (desktop Settings → Account, or `logout` in
  `argus-host`) removes the computer: it stops publishing its address, and
  devices on the account can no longer connect to it through the account.
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
| iPhone access                                  | control  | What account iPhones may do on this computer (`monitor`, `control`)               |
| Mac and desktop access                         | admin    | What account Macs and desktop apps may do (`monitor`, `control`, `admin`)         |
| Publish LAN / Tailscale / Cloudflare addresses | on       | Which addresses go into the directory. LAN IPs are visible to the service         |
| Approve from this computer                     | on       | Whether this computer's console may approve other computers joining               |

Change them in desktop Settings → Account, or with the `account` commands in
`argus-host`.
