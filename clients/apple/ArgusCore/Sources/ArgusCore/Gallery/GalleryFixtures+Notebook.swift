import CoreGraphics
import Foundation
import ImageIO
import UniformTypeIdentifiers

/// A notebook exploring build times: Markdown, code, a table, a chart and a failed cell.
extension GalleryFixtures {
  public static var previewNotebook: String {
    func code(_ count: Int?, _ source: String, _ outputs: [[String: Any]]) -> [String: Any] {
      ["cell_type": "code", "execution_count": count as Any? ?? NSNull(), "source": source, "outputs": outputs, "metadata": [:]]
    }
    let table = """
             branch  builds  median_s
      0        main     412      38.2
      1  quick-open      57      41.9
      2     release      23      36.4
      """
    let cells: [[String: Any]] = [
      [
        "cell_type": "markdown", "metadata": [:],
        "source": "# Build times\n\nHow long CI takes per branch over the **last 30 days**, from `builds.csv`.",
      ],
      code(
        1, "import pandas as pd\n\nbuilds = pd.read_csv(\"builds.csv\")\nprint(f\"{len(builds)} builds loaded\")",
        [["output_type": "stream", "name": "stdout", "text": "492 builds loaded\n"]]),
      code(
        2, "builds.groupby(\"branch\").duration.agg([\"count\", \"median\"])",
        [
          [
            "output_type": "execute_result", "execution_count": 2, "metadata": [:],
            "data": ["text/plain": table, "text/html": "<table><tr><th>branch</th></tr></table>"],
          ]
        ]),
      code(
        3, "builds.plot.bar(x=\"branch\", y=\"median_s\")",
        [["output_type": "display_data", "metadata": [:], "data": ["image/png": previewChartPNG().base64EncodedString(), "text/plain": "<Axes>"]]]),
      ["cell_type": "markdown", "metadata": [:], "source": "## Outliers\n\nBuilds over ten minutes, which should be rare."],
      code(
        4, "builds[builds.duration > 600].sort_values(\"duraton\")",
        [
          [
            "output_type": "error", "ename": "KeyError", "evalue": "'duraton'",
            "traceback": [
              "\u{1B}[0;31mKeyError\u{1B}[0m                                  Traceback (most recent call last)",
              "Cell \u{1B}[0;32mIn[4], line 1\u{1B}[0m\n----> 1 builds[builds.duration > 600].sort_values(\"duraton\")",
              "\u{1B}[0;31mKeyError\u{1B}[0m: 'duraton'",
            ],
          ]
        ]),
    ]
    let root: [String: Any] = [
      "cells": cells, "nbformat": 4, "nbformat_minor": 5,
      "metadata": ["kernelspec": ["language": "python", "name": "python3"], "language_info": ["name": "python"]],
    ]
    let data = (try? JSONSerialization.data(withJSONObject: root, options: [.prettyPrinted, .sortedKeys])) ?? Data()
    return String(decoding: data, as: UTF8.self)
  }

  /// Three bars, drawn here so no binary fixture is checked in.
  static func previewChartPNG() -> Data {
    let width = 480, height = 260
    guard
      let context = CGContext(
        data: nil, width: width, height: height, bitsPerComponent: 8, bytesPerRow: 0,
        space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)
    else { return Data() }
    context.setFillColor(CGColor(red: 1, green: 1, blue: 1, alpha: 1))
    context.fill(CGRect(x: 0, y: 0, width: width, height: height))
    context.setFillColor(CGColor(red: 0.12, green: 0.44, blue: 0.92, alpha: 1))
    for (index, value) in [38.2, 41.9, 36.4].enumerated() {
      context.fill(CGRect(x: 60 + index * 130, y: 30, width: 90, height: Int(value * 4.6)))
    }
    context.setFillColor(CGColor(gray: 0.3, alpha: 1))
    context.fill(CGRect(x: 40, y: 28, width: 410, height: 2))
    guard let image = context.makeImage() else { return Data() }
    let out = NSMutableData()
    guard let destination = CGImageDestinationCreateWithData(out, UTType.png.identifier as CFString, 1, nil) else {
      return Data()
    }
    CGImageDestinationAddImage(destination, image, nil)
    CGImageDestinationFinalize(destination)
    return out as Data
  }
}
