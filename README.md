# SillyTavern-Scribe

## The Curse of Lorekeeping

You're deep in a story. A new character just walked in with a name, a history,
and a reason to matter. You know you should add them to your lorebook. You also
know you won't. Not right now. You're in the moment, the scene is good, and
stopping to open the lorebook editor, manually type out an entry, fill in the
keys, pick the right book.. That's boring. That's a momentum killer. So you don't. And three
sessions from now, your model hath forgotten everything. 

*That's the Curse Lorekeeping.* You had every intention. You just never
did it. I'm so terribly guilty of that.

**Scribe** fixes that. Highlight any name, place, or concept directly in the
chat. A small floating button appears. Click it. Scribe reads the surrounding
story, drafts a full lore entry using your LLM, and hands it back to you for
review before saving it straight to your lorebook. Best part? It's mobile friendly.
Why is that the best part? Because I'm always on mobile.

---

## Features

- **Highlight-to-draft** — select any text in a chat message and two options
  appear: **Extract Lore** to draft a brand-new entry, or **Update Lore** to
  revise one that already exists in your lorebook
- **LLM-generated entries** — sends your selection and story context to your
  model, which drafts a structured lore entry (keys, content, the works)
- **Review modal** — see exactly what Scribe wants to save before it touches
  your lorebook. Edit it, toss it, or approve it
- **Saves to World Info** — writes directly to your lorebook, no manual steps
- **Connection profile support** — choose a dedicated API profile for Scribe
  to use, completely separate from your main chat connection
- **Story summary context** — optionally feeds your current story summary
  (from [qvink's MessageSummarize](https://github.com/qvink/SillyTavern-MessageSummarize)
  or ST's built-in Summarize) into the generation so the entry actually
  reflects where the story is, not just what it *was*

---

## Requirements

- SillyTavern (Release branch recommended, latest)
- A configured API connection
- A lorebook to save entries into
- *(Optional but recommended)*
  [qvink's MessageSummarize](https://github.com/qvink/SillyTavern-MessageSummarize)
  for richer story context on generated entries

---

## Installation

1. In SillyTavern, open the **Extensions** panel
2. Go to **Install Extension**
3. Paste this URL and hit install: https://github.com/RPFiend/SillyTavern-Scribe
4. Reload SillyTavern

---

## Setup

Once installed, open the **Extensions** panel and find **Scribe** in the list.

- **Connection Profile** — pick the API profile you want Scribe to use for
generation. If you leave it blank, it falls back to whatever your current
chat connection is. Any profile without a configured API will be filtered
out automatically.
- **Include story summary** — when enabled, Scribe pulls your most recent
story summary and includes it as context. Keeps your lore entries grounded
in what's actually happening in the story rather than generating something
generic. Defaults to on.

---

## How To Use It

### Extracting a new entry

1. Highlight any text in a chat message — a character name, a location, a
   concept, anything worth logging
2. The **✍ Extract Lore** button appears near your selection. Click it
3. Scribe sends the selection and story context to your LLM and drafts a
   new lore entry
4. A review modal opens. Read it over, make any edits you want
5. Hit **Save** and it's in your lorebook

### Updating an existing entry

1. Highlight the name or concept that already has a lorebook entry
2. Click **✍ Update Lore** from the options that appear
3. Scribe finds the existing entry, sends it along with the current story
   context, and drafts a revised version reflecting what's changed
4. Review the diff, make any tweaks, and hit **Save**

---

## Notes & Tips

- Scribe works best on **specific, named things** — characters, factions,
locations, items. Highlighting a vague adjective will get you a vague entry
- If you're using a dedicated connection profile for Scribe, a lightweight
model works perfectly fine here. You don't need your main RP model for
drafting lore
- If you use
[qvink's MessageSummarize](https://github.com/qvink/SillyTavern-MessageSummarize)
(and honestly, you should — see my write-up on it
[here](https://rpfiend.com)), the story summary toggle becomes noticeably
more useful the deeper you are into a long story

---

## Related

- [LoreProfiles](https://github.com/RPFiend/SillyTavern-LoreProfiles) —
if Scribe is filling your lorebook, LoreProfiles keeps it organized
- [Choices!](https://github.com/RPFiend/SillyTavern-Choices) — CYOA story
suggestions for when you're tapped out on ideas
- [RPFiend.com](https://rpfiend.com) — guides, extension write-ups, and
the occasional SillyTavern rabbit hole

---

*Consume. Create. Obsess.*
