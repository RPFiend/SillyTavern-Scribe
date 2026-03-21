# SillyTavern - Scribe!

You're deep in a story. A name drops, a place gets mentioned, a concept surfaces that you know you'll want to remember later. Normally, you'd stop, open the lorebook editor, and manually write an entry. Scribe skips all of that. Highlight the text, tap a button, and your LLM drafts the entry for you. Review it, tweak it, save it. Done.

---

## Features

- Highlight any text in the chat to trigger the Extract Lore button
- LLM drafts a lorebook entry with title, keywords, and content
- Review and edit the draft before saving
- Regenerate the full entry or individual fields (title, keywords, content separately)
- Revision instructions let you guide the next generation without starting over
- Duplicate detection checks your lorebook for similar entries before you save
- LLM-assisted merge combines an existing entry with a new one when duplicates are found
- Configurable context: choose how many recent messages, whether to include the character card, author's note, and active lorebook
- Connection profile support so you can use a cheaper or faster model for lore generation
- Custom system prompt for those who want full control over what gets sent
- Token length control: Brief, Standard, Detailed, Extensive, or a custom token count
- Prompt preview so you can see exactly what's going to the model before it sends
- Works on desktop and mobile

---

## Installation

1. In SillyTavern, go to **Extensions > Install Extension**
2. Paste this URL:

```
https://github.com/RPFiend/SillyTavern-Scribe
```

3. Reload SillyTavern

---

## Usage

1. Open a chat with any character
2. Highlight any word, name, or phrase in a message
3. Tap **📖 Extract Lore** when it appears above your selection
4. Wait for the LLM to generate a draft
5. Edit the fields if needed, pick a lorebook, and hit **Save**

---

## Duplicate Detection and Merging
 
When you extract lore, Scribe automatically checks your selected lorebook for similar entries. It looks for matching keywords and similar titles. If something close enough already exists, a red banner appears at the top of the modal.
 
From there you have two options:
 
**Ignore it** — just hit Save as normal. A new separate entry gets created. The warning is advisory, not a blocker.
 
**Merge it** — click Show Comparison to see the existing entry side by side with the new one. When you're ready, click **Merge**. The model combines both entries into a single draft that you can review before accepting. Once you're happy with it, click **✅ Accept Merge & Save** and it overwrites the existing entry. The new draft gets discarded.
 
> The merge uses the same connection profile you have selected in Scribe's settings. If no profile is selected it falls back to your active connection.
 
---

## Settings

In the Extensions panel under **SillyTavern - Scribe!**

| Setting | What it does |
|---|---|
| Connection Profile | Uses a specific API profile for lore generation instead of your active one |
| Active Lorebook | The default lorebook entries get saved to |
| Recent Chat Messages | How many messages to send as context (0 to disable) |
| Include Character Card | Sends the character's name, description, personality, and scenario |
| Include Author's Note | Sends the current author's note |
| Include Active Lorebook | Sends existing lorebook entries as context |
| Custom System Prompt | Override the default system instruction entirely |

---

## Tips

- If generations keep getting cut off, bump up the token length in the modal
- If the model ignores the JSON format, try a custom system prompt and be more explicit
- The **↺** buttons next to each field let you regenerate just that field without redoing the whole entry
- The **🔍 Preview Full Prompt** button shows exactly what's being sent to the model, useful for debugging
- On mobile, tap the **✕** button at the top right to close the modal

---

## Requirements

- SillyTavern (latest release branch recommended)
- Any connected LLM API

---

## Notes

> Models that follow instructions well produce better results.
> If you're using a Text Completion profile, make sure it has an API, preset, model, instruct template, and context template configured.

---

## License

[MIT](LICENSE)
