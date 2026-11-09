// The demo project's app as its simulator would show it: Aurora's Downloads
// screen in airplane mode. Streamed as the reserved device's picture in shots.
// Regenerate: swift scripts/shots/fixture/screens/AuroraDownloads.swift scripts/shots/fixture/screens

import AppKit
import SwiftUI

let accent = Color(red: 1.0, green: 0.42, blue: 0.33)

struct Episode {
  let show: String
  let title: String
  let meta: String
  let symbol: String
  let colors: [Color]
  var progress: Double? = nil
}

let episodes: [Episode] = [
  Episode(
    show: "THE LONG FIELD", title: "Ep. 112 — Salt roads and slow trains", meta: "48 min · 62 MB",
    symbol: "leaf.fill", colors: [Color(red: 0.16, green: 0.55, blue: 0.42), Color(red: 0.05, green: 0.25, blue: 0.3)],
    progress: 0.42),
  Episode(
    show: "SMALL MACHINES", title: "Clockwork, springs and the first pocket watch", meta: "36 min · 44 MB",
    symbol: "gearshape.2.fill", colors: [Color(red: 0.95, green: 0.6, blue: 0.2), Color(red: 0.75, green: 0.25, blue: 0.2)]),
  Episode(
    show: "NIGHT SHIFT NOTES", title: "The 3 a.m. bakery", meta: "52 min · 71 MB",
    symbol: "moon.stars.fill", colors: [Color(red: 0.3, green: 0.3, blue: 0.75), Color(red: 0.1, green: 0.1, blue: 0.3)]),
  Episode(
    show: "TIDEWATER", title: "What the harbour pilots know", meta: "41 min · 55 MB",
    symbol: "water.waves", colors: [Color(red: 0.2, green: 0.6, blue: 0.9), Color(red: 0.1, green: 0.3, blue: 0.6)]),
  Episode(
    show: "PAPER LANTERNS", title: "Letters nobody sent", meta: "29 min · 38 MB",
    symbol: "envelope.open.fill", colors: [Color(red: 0.9, green: 0.4, blue: 0.55), Color(red: 0.55, green: 0.15, blue: 0.4)]),
  Episode(
    show: "SLOW RADIO HOUR", title: "Rain on a tin roof, Hebrides", meta: "60 min · 82 MB",
    symbol: "cloud.rain.fill", colors: [Color(red: 0.45, green: 0.5, blue: 0.6), Color(red: 0.2, green: 0.22, blue: 0.3)]),
]

struct Artwork: View {
  let episode: Episode
  var size: CGFloat = 58
  var body: some View {
    RoundedRectangle(cornerRadius: size * 0.2)
      .fill(LinearGradient(colors: episode.colors, startPoint: .topLeading, endPoint: .bottomTrailing))
      .frame(width: size, height: size)
      .overlay(Image(systemName: episode.symbol).font(.system(size: size * 0.4)).foregroundStyle(.white.opacity(0.9)))
  }
}

struct Row: View {
  let episode: Episode
  var body: some View {
    HStack(spacing: 13) {
      Artwork(episode: episode)
      VStack(alignment: .leading, spacing: 3) {
        Text(episode.show).font(.system(size: 11, weight: .semibold)).foregroundStyle(.secondary)
        Text(episode.title).font(.system(size: 15, weight: .semibold)).lineLimit(2)
        HStack(spacing: 6) {
          Image(systemName: "arrow.down.circle.fill").foregroundStyle(accent)
          Text(episode.meta).foregroundStyle(.secondary)
          if let progress = episode.progress {
            Capsule().fill(.secondary.opacity(0.3)).frame(width: 44, height: 4)
              .overlay(alignment: .leading) { Capsule().fill(accent).frame(width: 44 * progress, height: 4) }
          }
        }
        .font(.system(size: 12))
      }
      Spacer(minLength: 0)
      Image(systemName: "play.circle.fill").font(.system(size: 28)).foregroundStyle(accent)
    }
    .padding(.vertical, 9)
  }
}

struct Screen: View {
  let dark: Bool
  var body: some View {
    let bg = dark ? Color(white: 0.0) : Color(white: 0.97)
    let card = dark ? Color(white: 0.11) : Color.white
    VStack(spacing: 0) {
      HStack {
        Text("9:41").font(.system(size: 17, weight: .semibold))
        Spacer()
        HStack(spacing: 6) {
          Image(systemName: "airplane")
          Image(systemName: "battery.75percent")
        }
        .font(.system(size: 15, weight: .semibold))
      }
      .padding(.horizontal, 30).padding(.top, 18).frame(height: 54)

      VStack(alignment: .leading, spacing: 14) {
        HStack {
          Text("Downloads").font(.system(size: 34, weight: .bold))
          Spacer()
          Image(systemName: "ellipsis.circle").font(.system(size: 22)).foregroundStyle(accent)
        }
        HStack(spacing: 10) {
          Image(systemName: "airplane.circle.fill").font(.system(size: 26)).foregroundStyle(accent)
          VStack(alignment: .leading, spacing: 1) {
            Text("You're offline").font(.system(size: 14, weight: .semibold))
            Text("6 episodes ready to play from this iPhone").font(.system(size: 12)).foregroundStyle(.secondary)
          }
          Spacer()
        }
        .padding(12)
        .background(accent.opacity(dark ? 0.18 : 0.12), in: RoundedRectangle(cornerRadius: 14))

        VStack(spacing: 0) {
          ForEach(Array(episodes.enumerated()), id: \.offset) { index, episode in
            Row(episode: episode)
            if index < episodes.count - 1 { Divider().padding(.leading, 71) }
          }
        }
        .padding(.horizontal, 14).padding(.vertical, 4)
        .background(card, in: RoundedRectangle(cornerRadius: 16))
      }
      .padding(.horizontal, 18).padding(.top, 6)

      Spacer(minLength: 0)

      HStack(spacing: 12) {
        Artwork(episode: episodes[0], size: 42)
        VStack(alignment: .leading, spacing: 2) {
          Text("Salt roads and slow trains").font(.system(size: 14, weight: .semibold))
          Text("The Long Field · 27 min left").font(.system(size: 12)).foregroundStyle(.secondary)
        }
        Spacer()
        Image(systemName: "pause.fill").font(.system(size: 20))
        Image(systemName: "goforward.30").font(.system(size: 20))
      }
      .padding(10)
      .background(card, in: RoundedRectangle(cornerRadius: 16))
      .shadow(color: .black.opacity(0.15), radius: 8, y: 2)
      .padding(.horizontal, 12)

      HStack {
        tab("play.circle.fill", "Listen Now", false)
        tab("square.stack.fill", "Library", false)
        tab("arrow.down.circle.fill", "Downloads", true)
        tab("magnifyingglass", "Search", false)
      }
      .padding(.top, 10).padding(.bottom, 30)
    }
    .frame(width: 402, height: 874)
    .background(bg)
    .foregroundStyle(dark ? Color.white : Color.black)
    .environment(\.colorScheme, dark ? .dark : .light)
  }

  func tab(_ symbol: String, _ title: String, _ on: Bool) -> some View {
    VStack(spacing: 3) {
      Image(systemName: symbol).font(.system(size: 22))
      Text(title).font(.system(size: 10, weight: .medium))
    }
    .foregroundStyle(on ? accent : Color.gray)
    .frame(maxWidth: .infinity)
  }
}

@MainActor
func render(dark: Bool, to url: URL) {
  let renderer = ImageRenderer(content: Screen(dark: dark))
  renderer.scale = 2
  guard let image = renderer.nsImage, let tiff = image.tiffRepresentation,
    let rep = NSBitmapImageRep(data: tiff), let png = rep.representation(using: .png, properties: [:])
  else { fatalError("render failed") }
  try! png.write(to: url)
}

let out = URL(fileURLWithPath: CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : ".")
MainActor.assumeIsolated {
  render(dark: true, to: out.appendingPathComponent("aurora-downloads@dark.png"))
  render(dark: false, to: out.appendingPathComponent("aurora-downloads@light.png"))
}
