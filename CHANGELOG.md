# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

### Added

- slskd device, read-only: download and upload speed, downloads in progress, waiting, completed
  and failed, uploads in progress, status (including "Soulseek disconnected"), last download.
- Scene triggers: download completed, download failed, all downloads finished, Soulseek network
  lost, Soulseek network back.
- Scene actions: read the slskd summary (a sentence and the figures), clear the completed
  downloads (off until allowed in the configuration; the files stay).
- Dashboard widget "slskd downloads": speed, downloads, time left, the files in progress,
  failures, uploads, last download, and a "Clear completed" button when allowed.
- "Test the connection" button; texts and documentation in English, French, German and Spanish.
