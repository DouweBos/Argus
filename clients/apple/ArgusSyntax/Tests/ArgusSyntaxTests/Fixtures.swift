import ArgusSyntax

/// One small, representative snippet per language for the golden tests.
enum Fixtures {
  static func source(for language: SyntaxLanguage) -> String {
    switch language {
    case .swift:
      """
      import Foundation

      /// A greeting.
      struct Greeter: Sendable {
        let name: String
        func greet(times: Int = 3) -> String {
          let text = "Hello, \\(name)!\\n"
          return String(repeating: text, count: times) // repeat
        }
      }
      """
    case .typescript:
      """
      import { readFile } from "node:fs/promises";

      interface Options { retries: number }
      // Load the config.
      export async function load(path: string, opts: Options): Promise<string> {
        const MAX = 42;
        return readFile(path, "utf8").then((s) => s.trim() + MAX);
      }
      """
    case .tsx:
      """
      type Props = { title: string };
      export function Card({ title }: Props) {
        return <div className="card">{title}</div>;
      }
      """
    case .javascript:
      """
      // Sum values.
      const total = [1, 2, 3].reduce((a, b) => a + b, 0);
      function greet(name) {
        return `Hello ${name}`;
      }
      const re = /ab+c/g;
      """
    case .json:
      """
      { "name": "argus", "version": 3, "private": true, "tags": null }
      """
    case .markdown:
      """
      # Title

      Some *emphasis* and **strong** text with a [link](https://example.com) and `code`.

      ```swift
      let x = 1
      ```
      """
    case .kotlin:
      """
      package app

      // Entry point.
      fun main(args: Array<String>) {
          val count = 42
          println("Hello $count")
      }
      """
    case .java:
      """
      package app;

      public class Main {
          // Entry point.
          public static void main(String[] args) {
              int count = 42;
              System.out.println("Hello");
          }
      }
      """
    case .objc:
      """
      #import <Foundation/Foundation.h>

      // A greeter.
      @interface Greeter : NSObject
      - (NSString *)greet:(int)times;
      @end

      @implementation Greeter
      - (NSString *)greet:(int)times {
        return @"Hello";
      }
      @end
      """
    case .yaml:
      """
      # Config
      name: argus
      version: 3
      enabled: true
      """
    case .bash:
      """
      #!/bin/bash
      # Build it.
      if [ -n "$HOME" ]; then
        echo "hello" | grep h
      fi
      """
    case .css:
      """
      /* Card */
      .card > a:hover {
        color: #ff0000;
        margin: 4px;
      }
      """
    case .html:
      """
      <!DOCTYPE html>
      <!-- page -->
      <div class="main">Hi</div>
      <script>const answer = 42;</script>
      <style>body { margin: 0; }</style>
      """
    case .python:
      """
      import os

      # Entry point.
      def main(count: int = 3) -> str:
          return "hello" * count

      class Greeter:
          pass
      """
    case .ruby:
      """
      # A greeter.
      class Greeter
        def greet(name)
          puts "Hello #{name}"
          :done
        end
      end
      """
    case .go:
      """
      package main

      import "fmt"

      // Entry point.
      func main() {
      	count := 42
      	fmt.Println("hello", count)
      }
      """
    case .rust:
      """
      use std::fmt;

      // Entry point.
      fn main() {
          let count: u32 = 42;
          println!("hello {}", count);
      }
      """
    }
  }
}
