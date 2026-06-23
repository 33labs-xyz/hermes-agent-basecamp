# Basecamp - Tester Guide

Thanks for testing Basecamp. This is an early build, so a couple of manual
steps are needed to get past macOS security. Takes about two minutes.

## What you need

- A Mac with **Apple Silicon** (M1/M2/M3/M4). This build is arm64-only.
  - On Intel Macs it will not run. If you're on Intel, tell me and I'll send a
    separate build.
- macOS 12 (Monterey) or newer.

## Install

1. Download **Basecamp-0.15.1-mac-arm64.dmg** from the link I sent you.
2. Open the `.dmg` and drag **Basecamp** into your **Applications** folder.
3. Open **Terminal** (Cmd+Space, type "Terminal", Enter) and paste this line,
   then press Enter:
   ```
   xattr -dr com.apple.quarantine /Applications/Basecamp.app
   ```
4. Now open **Basecamp** from Applications normally. Done.

If you double-click before doing step 3 and macOS says **"Basecamp is damaged and
can't be opened"** - that is expected, it is NOT actually damaged. Click
**Cancel** (do not move it to Trash), then do step 3 and open it. That "damaged"
message is just macOS blocking an app that hasn't been notarized by Apple yet.

That's the only security hurdle. Nothing here is sketchy - notarizing with Apple
is a paid step I'll do before the real release, and the Terminal line just
removes the "downloaded from the internet" quarantine flag.

## Install (Windows 10 / 11, 64-bit)

The Windows download is a setup tool. It downloads and builds Basecamp on your
PC the first time, so it needs an internet connection and a few minutes.

1. Download **Basecamp-Setup.exe** from the link I sent you.
2. Run it. Because it isn't signed yet, Windows SmartScreen shows a blue
   "Windows protected your PC" box. Click **More info**, then **Run anyway**.
   (Expected for a test build - signing is a paid step before release.)
3. Click **Install Basecamp**. The setup window downloads the app and sets it
   up. First time takes a few minutes.
4. When it finishes, click **Launch Basecamp**.

The Windows build is brand new and has had less real-world testing than the Mac
one. If the setup step stalls or errors, grab a screenshot of the setup window
and send it over. Your data lives locally at `%LOCALAPPDATA%\hermes`.

## First run - you need a model API key

On first launch Basecamp starts its local backend automatically and shows a
setup screen. To actually chat you need a model API key.

**Just use OpenRouter** - it's the easiest. One key reaches almost every model
(Claude, GPT, Gemini, Grok, etc.), so you don't have to sign up anywhere else.
Make a key here: https://openrouter.ai/keys - paste it when Basecamp prompts you,
pick a model, done.

If you already have a key from somewhere else, those work too: OpenAI
(https://platform.openai.com/api-keys), Google Gemini
(https://aistudio.google.com/app/apikey), xAI / Grok (https://console.x.ai/),
or a local / custom endpoint if you run your own.

All your data (chats, projects, project memory) is stored locally on your Mac at
`~/.hermes`. Nothing is shared between testers.

## What to test (the new stuff)

This round is focused on **Projects**. In a project you get:

- **Custom instructions** - steer how the agent behaves for everything in that
  project.
- **Project knowledge** - drop in reference files the agent can read.
- **Project memory (new)** - short facts the agent remembers across every chat
  in the project. You can add notes yourself, and the agent can save things it
  learns (those get an "agent" badge). Try adding a few, start a new chat in the
  same project, and confirm the agent already knows them.

Things worth poking at:
- Add/remove memory notes and knowledge files; confirm they stick after a
  restart.
- Delete a whole project and confirm its chats/knowledge/memory go with it.
- Anything that feels broken, slow, or confusing.

## Reporting bugs

Reply to whoever sent you this link with anything you hit.

Helpful to include:
- What you did, what you expected, what actually happened.
- Build version: **0.15.1** (also shown in the app's About screen).
- A screenshot if it's visual.

## Known limitations in this build

- Not signed/notarized yet (hence the install steps above).
- No auto-update - I'll send a new link when there's a new build.
- Apple Silicon only.
- Japanese / Traditional Chinese UI: the new Memory section shows in English
  until those translations land.
