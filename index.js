// Default settings for this extension
const defaultSettings = {
    selectedLorebook: '',
    selectedProfile: '',
    contextMessages: 5,
    includeCharCard: true,
    includeAuthorNote: false,
    includeLorebook: false,
    customSystemPrompt: '',
    contentLength: 'standard',
    customTokenCount: 150,
};

// Stores the active selection so mobile taps don't lose it
let savedSelection = null;

import { extension_settings } from '../../../extensions.js';
import { eventSource, event_types, saveSettingsDebounced } from '../../../../script.js';
import {
    world_names,
    loadWorldInfo,
    createWorldInfoEntry,
    saveWorldInfo,
    reloadEditor,
    world_info
} from '../../../world-info.js';

function onTextSelected() {
    const selection = window.getSelection();
    const selectionText = selection?.toString().trim();

    if (selectionText && selection.rangeCount > 0) {
        const range = selection.getRangeAt(0);
        const container = range.commonAncestorContainer;
        const mesTextElement = container.nodeType === Node.TEXT_NODE
            ? container.parentElement?.closest('.mes_text')
            : container.closest?.('.mes_text');

        if (mesTextElement) {
            // Save selection now before any tap can collapse it
            savedSelection = {
                text: selectionText,
                range: range.cloneRange(),
                mesText: mesTextElement.textContent,
            };

            const rect = range.getBoundingClientRect();
            const btn = document.getElementById('le-extract-btn');

            if (btn) {
                // Position above the selection (44px covers button height + gap)
                const top  = rect.top  + window.scrollY - 44;
                // Center horizontally on the selection
                const left = rect.left + window.scrollX + (rect.width / 2) - 60;

                btn.style.left    = `${Math.max(8, left)}px`;
                btn.style.top     = `${Math.max(8, top)}px`;
                btn.style.display = 'block';

                // Show Update button stacked 32px below Extract
                const updateBtnEl = document.getElementById('le-update-btn');
                if (updateBtnEl) {
                    updateBtnEl.style.left    = `${Math.max(8, left)}px`;
                    updateBtnEl.style.top     = `${Math.max(8, top + 32)}px`;
                    updateBtnEl.style.display = 'block';
                }
            }
            return;
        }
    }

    // No valid selection — hide button and clear saved selection
    const btn = document.getElementById('le-extract-btn');
    if (btn) btn.style.display = 'none';
    const updateBtnEl2 = document.getElementById('le-update-btn');
    if (updateBtnEl2) updateBtnEl2.style.display = 'none';
    savedSelection = null;
}

/**
 * Sends a request using the selected connection profile
 * @param {string} profileId - The profile ID to use
 * @param {string} prompt - The prompt to send
 * @returns {Promise<string|null>} - The response or null if failed
 */
async function sendWithProfile(profileId, prompt) {
    if (!profileId) return null;

    try {
        const { ConnectionManagerRequestService } = SillyTavern.getContext();
        const result = await ConnectionManagerRequestService.sendRequest(
            profileId,
            prompt,
            1024
        );

        const text = (result?.response || result?.content || '').trim();
        if (text) return text;
        console.warn('SillyTavern-Scribe!: Empty response from profile request');
        return null;
    } catch (e) {
        console.error('SillyTavern-Scribe!: Profile request failed:', e);
        return null;
    }
}

/**
 * Assembles additional context from ST based on saved settings
 * @returns {Promise<string>} - Formatted context string
 */
async function buildContextSections() {
    const ctx = SillyTavern.getContext();
    const settings = extension_settings['SillyTavern-Scribe'] ?? {};
    const sections = [];

    // Recent chat messages
    const messageCount = settings.contextMessages ?? 5;
    if (messageCount > 0 && ctx.chat?.length > 0) {
        const recent = ctx.chat
            .filter(m => !m.is_system)
            .slice(-messageCount)
            .map(m => `${m.name}: ${m.mes}`)
            .join('\n');
        if (recent) {
            sections.push(`--- Recent Chat (last ${messageCount} messages) ---\n${recent}`);
        }
    }

    // Character card
    if (settings.includeCharCard) {
        const char = ctx.characters?.[ctx.characterId];
        if (char) {
            const parts = [];
            if (char.name)        parts.push(`Name: ${char.name}`);
            if (char.description) parts.push(`Description: ${char.description}`);
            if (char.personality) parts.push(`Personality: ${char.personality}`);
            if (char.scenario)    parts.push(`Scenario: ${char.scenario}`);
            if (parts.length) {
                sections.push(`--- Character Card ---\n${parts.join('\n')}`);
            }
        }
    }

    // Author's note
    if (settings.includeAuthorNote) {
        const note = ctx.chatMetadata?.note_prompt?.trim();
        if (note) {
            sections.push(`--- Author's Note ---\n${note}`);
        }
    }

    // Active lorebook
    if (settings.includeLorebook) {
        const char = ctx.characters?.[ctx.characterId];
        const worldName = char?.extensions?.world;
        if (worldName) {
            try {
                const book = await loadWorldInfo(worldName);
                if (book?.entries) {
                    const entries = Object.values(book.entries)
                        .filter(e => !e.disable && e.content)
                        .map(e => `[${e.comment || 'Entry'}]: ${e.content}`)
                        .join('\n');
                    if (entries) {
                        sections.push(`--- Active Lorebook (${worldName}) ---\n${entries}`);
                    }
                }
            } catch (e) {
                console.warn('SillyTavern-Scribe!: Failed to load lorebook for context:', e);
            }
        }
    }

    return sections.join('\n\n');
}

function getSystemPrompt() {
    const custom = extension_settings['SillyTavern-Scribe']?.customSystemPrompt?.trim();
    if (custom) {
        console.log('[Scribe] Using custom system prompt');
        return custom;
    }
    console.log('[Scribe] Using default system prompt');
    return `You are a lore assistant. Your only job is to write lorebook entries.
Output ONLY a raw JSON object. No preamble, no explanation, no markdown fences.
The JSON must have exactly these three fields:
  "title": a short name for the entry subject
  "keywords": an array of 2-5 lowercase trigger words
  "content": a third-person lore description`;
}

function getLengthInstruction() {
    const settings = extension_settings['SillyTavern-Scribe'] ?? {};
    const length = settings.contentLength || 'standard';

    const map = {
        brief:     'Write the content field in no more than 50 tokens.',
        standard:  'Write the content field in no more than 150 tokens.',
        detailed:  'Write the content field in no more than 300 tokens.',
        extensive: 'Write the content field in no more than 500 tokens.',
        custom:    `Write the content field in no more than ${settings.customTokenCount || 150} tokens.`,
    };

    const instruction = map[length] || map.standard;
    console.log('[Scribe] Length instruction:', instruction);
    return instruction;
}

/**
 * Generates a lorebook entry using the LLM
 * @param {string} selectedText - The text selected by the user
 * @param {string} messageContext - The surrounding message context
 * @param {string} revisionInstructions - Optional revision instructions
 * @returns {Promise<string>} - The LLM response
 */
async function generateLoreEntry(selectedText, messageContext, revisionInstructions = '') {
    const selectedProfile = extension_settings['SillyTavern-Scribe']?.selectedProfile;
    console.log('[Scribe] Sending request to LLM');
    console.log('[Scribe] Selected text:', selectedText);
    console.log('[Scribe] Message context:', messageContext);
    console.log('[Scribe] Using profile:', selectedProfile || 'Default (Chat)');

    const systemPrompt   = getSystemPrompt();
    const lengthInstr    = getLengthInstruction();
    const additionalContext = await buildContextSections();

    const prompt = `${systemPrompt}

LENGTH CONSTRAINT: ${lengthInstr}

OUTPUT FORMAT — return exactly this structure, no other text:
{"title": "...", "keywords": ["...", "..."], "content": "..."}
${additionalContext ? `\nCONTEXT:\n${additionalContext}\n` : ''}
SUBJECT (the text the user highlighted): ${selectedText}
SURROUNDING CONTEXT: ${messageContext}${revisionInstructions ? `\nREVISION INSTRUCTIONS: ${revisionInstructions}` : ''}`;

    console.log('[Scribe] Assembled prompt length (chars):', prompt.length);
    console.log('[Scribe] Estimated tokens:', Math.ceil(prompt.length / 4));
    console.log('[Scribe] Full prompt:\n', prompt);

    // Try to use a connection profile if one is selected
    if (selectedProfile) {
        const profileResponse = await sendWithProfile(selectedProfile, prompt);
        if (profileResponse) {
            console.log('SillyTavern-Scribe!: LLM response received (via profile):', profileResponse);
            return profileResponse;
        }
    }
    
    // Fall back to default context
    const context = SillyTavern.getContext();
    const response = await context.generateQuietPrompt({ quietPrompt: prompt });
    const trimmed = (response || '').trim();

    if (!trimmed) {
        console.warn('SillyTavern-Scribe!: Empty response from generateQuietPrompt');
        throw new Error('The model returned an empty response. Try again or check your connection profile settings.');
    }

    console.log('SillyTavern-Scribe!: LLM response received:', trimmed);
    return trimmed;
}

/**
 * Parses the JSON response from the LLM
 * @param {string} response - The raw response from the LLM
 * @returns {{title: string, keywords: string[], content: string} | null}
 */
function parseLoreResponse(response) {
    if (!response || typeof response !== 'string' || !response.trim()) {
        console.error('[SillyTavern-Scribe] Empty or invalid response passed to parser');
        return null;
    }

    try {
        let cleaned = response.trim();

        // Step 1: Strip reasoning blocks (DeepSeek, QwQ, and other reasoning models)
        // Used by DeepSeek, QwQ, and other reasoning models
        cleaned = cleaned.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
        cleaned = cleaned.replace(/<thinking>[\s\S]*?<\/thinking>/gi, '').trim();
        cleaned = cleaned.replace(/<reasoning>[\s\S]*?<\/reasoning>/gi, '').trim();

        // Step 2: Strip markdown code fences
        // Handles ```json, ```JSON, ``` with or without language tag
        cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();

        // Step 3: Extract the first complete {...} block
        // This handles any preamble text like "Here is your entry:"
        // Uses greedy match to get the outermost complete JSON object
        const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
            console.error('[SillyTavern-Scribe] No JSON object found in response.\nRaw:', response);
            return null;
        }
        cleaned = jsonMatch[0];  // jsonMatch is an array — take index 0

        // Step 4: Fix trailing commas before } or ] which are invalid JSON
        // e.g. {"title": "x", "keywords": ["a", "b",], "content": "y",}
        cleaned = cleaned.replace(/,\s*([}\]])/g, '$1');

        // Step 5: Parse
        const parsed = JSON.parse(cleaned);

        // Step 6: Validate and normalize fields
        if (!parsed || typeof parsed !== 'object') {
            console.error('[SillyTavern-Scribe] Parsed value is not an object.\nRaw:', response);
            return null;
        }

        const title = parsed.title || parsed.name || parsed.Title || parsed.Name || '';
        if (!title) {
            console.error('[SillyTavern-Scribe] No title field found.\nRaw:', response);
            return null;
        }

        // Normalize keywords — handle string, array, or comma-separated string
        let keywords = parsed.keywords || parsed.keys || parsed.tags || parsed.Keywords || [];
        if (typeof keywords === 'string') {
            keywords = keywords.split(',').map(k => k.trim()).filter(Boolean);
        } else if (!Array.isArray(keywords)) {
            keywords = [];
        }
        // Each keyword element might itself be non-string, normalize
        keywords = keywords
            .map(k => String(k).trim())
            .filter(Boolean);

        const content = parsed.content || parsed.description || parsed.text
            || parsed.Content || parsed.Description || '';
        if (!content) {
            console.error('[SillyTavern-Scribe] No content field found.\nRaw:', response);
            return null;
        }

        return { title, keywords, content };

    } catch (e) {
        console.error('[SillyTavern-Scribe] Failed to parse LLM response:', e, '\nRaw response:', response);
        return null;
    }
}

function fuzzyScore(a, b) {
    a = a.toLowerCase().trim();
    b = b.toLowerCase().trim();
    if (!a || !b) return 0;
    if (a === b) return 1;

    // Word-level overlap: what fraction of words in the shorter
    // title appear in the longer title
    const wordsA = a.split(/\s+/).filter(Boolean);
    const wordsB = b.split(/\s+/).filter(Boolean);
    const shorter = wordsA.length <= wordsB.length ? wordsA : wordsB;
    const longer  = wordsA.length <= wordsB.length ? wordsB : wordsA;

    const matches = shorter.filter(w => longer.includes(w)).length;
    if (shorter.length === 0) return 0;
    return matches / shorter.length;
}

async function findSimilarEntry(lorebookName, draft) {
    if (!lorebookName) return null;
    try {
        const book = await loadWorldInfo(lorebookName);
        if (!book?.entries) return null;

        const draftTitle    = (draft.title || '').toLowerCase().trim();
        const draftKeywords = (draft.keywords || []).map(k => k.toLowerCase().trim());

        let bestEntry = null;
        let bestScore = 0;  // combined score: keyword overlaps * 10 + fuzzy title

        for (const entry of Object.values(book.entries)) {
            if (entry.disable) continue;

            const entryTitle    = (entry.comment || '').toLowerCase().trim();
            const entryKeywords = (entry.key || []).map(k => k.toLowerCase().trim());

            // Keyword overlap count
            const overlap = draftKeywords.filter(k => entryKeywords.includes(k)).length;

            // Fuzzy title score (0–1)
            const titleScore = fuzzyScore(draftTitle, entryTitle);

            // Must meet minimum threshold: 1+ keyword match AND title score >= 0.6
            if (overlap === 0 || titleScore < 0.6) continue;

            const combinedScore = overlap * 10 + titleScore;
            if (combinedScore > bestScore) {
                bestScore = combinedScore;
                bestEntry = entry;
            }
        }

        return bestEntry;
    } catch (e) {
        console.warn('SillyTavern-Scribe!: findSimilarEntry failed:', e);
        return null;
    }
}

async function generateMergedEntry(existingEntry, newDraft) {
    const existingText = JSON.stringify({
        title:    existingEntry.comment || '',
        keywords: existingEntry.key     || [],
        content:  existingEntry.content || '',
    });
    const newText = JSON.stringify({
        title:    newDraft.title    || '',
        keywords: newDraft.keywords || [],
        content:  newDraft.content  || '',
    });

    const mergePrompt = `You are a lore editor. You have two lorebook entries about the same subject.
Merge them into a single entry that preserves ALL unique information from both without repetition.
Combine keyword lists (deduplicate). Choose the most descriptive title.
Return ONLY valid JSON in this exact format, no other text:
{
  "title": "Entry name",
  "keywords": ["keyword1", "keyword2"],
  "content": "Merged lore description."
}

Existing entry: ${existingText}
New entry: ${newText}`;

    const selectedProfile = extension_settings['SillyTavern-Scribe']?.selectedProfile;

    try {
        let response;
        if (selectedProfile) {
            const { ConnectionManagerRequestService } = SillyTavern.getContext();
            const result = await ConnectionManagerRequestService.sendRequest(
                selectedProfile, mergePrompt, 1024
            );
            response = result?.response || result?.content || null;
        }
        if (!response) {
            const ctx = SillyTavern.getContext();
            response = await ctx.generateQuietPrompt({ quietPrompt: mergePrompt });
        }
        return parseLoreResponse(response);
    } catch (e) {
        console.error('SillyTavern-Scribe!: generateMergedEntry failed:', e);
        return null;
    }
}

/**
 * Escapes HTML special characters
 * @param {string} text - The text to escape
 * @returns {string} - Escaped text
 */
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

async function generateSingleField(field, selectedText, messageContext, currentDraft) {
    console.log('[Scribe] Regenerating single field:', field);

    const systemPrompt  = getSystemPrompt();
    const lengthInstr   = getLengthInstruction();

    const fieldInstructions = {
        title:    `Based on the context below, generate ONLY a new "title" value for this lorebook entry.
Output ONLY a raw JSON object with a single field: {"title": "..."}`,
        keywords: `Based on the context below, generate ONLY a new "keywords" array for this lorebook entry.
Output ONLY a raw JSON object with a single field: {"keywords": ["...", "..."]}
Use 2-5 lowercase trigger words.`,
        content:  `Based on the context below, generate ONLY a new "content" value for this lorebook entry.
Output ONLY a raw JSON object with a single field: {"content": "..."}
${lengthInstr}`,
    };

    const prompt = `${systemPrompt}

${fieldInstructions[field]}

CURRENT ENTRY STATE:
Title: ${currentDraft.title}
Keywords: ${currentDraft.keywords.join(', ')}
Content: ${currentDraft.content}

SUBJECT: ${selectedText}
SURROUNDING CONTEXT: ${messageContext}`;

    console.log('[Scribe] Single field prompt assembled for:', field);
    console.log('[Scribe] Single field prompt:\n', prompt);

    const selectedProfile = extension_settings['SillyTavern-Scribe']?.selectedProfile;
    let response = null;

    if (selectedProfile) {
        response = await sendWithProfile(selectedProfile, prompt);
    }
    if (!response) {
        const ctx = SillyTavern.getContext();
        response = await ctx.generateQuietPrompt({ quietPrompt: prompt });
    }

    const trimmed = (response || '').trim();
    if (!trimmed) {
        console.warn('[Scribe] Empty response for single field:', field);
        return null;
    }

    console.log('[Scribe] Single field raw response:', trimmed);

    // Parse permissively — only need one field
    try {
        let cleaned = trimmed;
        cleaned = cleaned.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
        cleaned = cleaned.replace(/<thinking>[\s\S]*?<\/thinking>/gi, '').trim();
        cleaned = cleaned.replace(/<reasoning>[\s\S]*?<\/reasoning>/gi, '').trim();
        cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
        const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
            console.warn('[Scribe] No JSON found in single field response');
            return null;
        }
        cleaned = jsonMatch[0].replace(/,\s*([}\]])/g, '$1');
        const parsed = JSON.parse(cleaned);
        console.log('[Scribe] Single field parsed result:', parsed);
        return parsed;
    } catch (e) {
        console.error('[Scribe] Failed to parse single field response:', e);
        return null;
    }
}

async function generateUpdateEntry(existingEntry, selectedText, messageContext, instructions) {
    console.log('[Scribe] Building update prompt for:', existingEntry.comment);

    const systemPrompt = `You are a lore editor. Your only job is to revise existing lorebook entries.
Output ONLY a raw JSON object. No preamble, no explanation, no markdown fences.
The JSON must have exactly these three fields:
  "title": keep the existing title or improve it if clearly more accurate
  "keywords": keep existing keywords or add new relevant ones if warranted
  "content": revised content that preserves what is accurate and incorporates new details`;
    const lengthInstr   = getLengthInstruction();
    const additionalContext = await buildContextSections();

    const existingJson = JSON.stringify({
        title:    existingEntry.comment || '',
        keywords: existingEntry.key     || [],
        content:  existingEntry.content || '',
    });

    const prompt = `${systemPrompt}

LENGTH CONSTRAINT: ${lengthInstr}

OUTPUT FORMAT — return exactly this structure, no other text:
{"title": "...", "keywords": ["...", "..."], "content": "..."}

Your task is to UPDATE an existing lorebook entry using new information from the story.
Preserve everything in the existing entry that is still accurate.
Incorporate any new details revealed by the selected text.
Do not remove information unless the instructions explicitly say to.
${additionalContext ? `\nCONTEXT:\n${additionalContext}\n` : ''}
EXISTING ENTRY: ${existingJson}

NEW INFORMATION (selected text): ${selectedText}
SURROUNDING CONTEXT: ${messageContext}${instructions ? `\nUPDATE INSTRUCTIONS: ${instructions}` : ''}`;

    console.log('[Scribe] Update prompt length (chars):', prompt.length);
    console.log('[Scribe] Update prompt estimated tokens:', Math.ceil(prompt.length / 4));
    console.log('[Scribe] Full update prompt:\n', prompt);

    const selectedProfile = extension_settings['SillyTavern-Scribe']?.selectedProfile;

    if (selectedProfile) {
        const profileResponse = await sendWithProfile(selectedProfile, prompt);
        if (profileResponse) {
            console.log('[Scribe] Update response received via profile');
            return profileResponse;
        }
    }

    const ctx = SillyTavern.getContext();
    const response = await ctx.generateQuietPrompt({ quietPrompt: prompt });
    const trimmed = (response || '').trim();

    if (!trimmed) {
        throw new Error('The model returned an empty response. Try again.');
    }

    console.log('[Scribe] Update response received via default connection');
    return trimmed;
}

async function showUpdateModal(selectedText, messageContext) {
    console.log('[Scribe] Opening Update Lore modal');

    const currentLorebook = extension_settings['SillyTavern-Scribe']?.selectedLorebook || '';

    // Guard: lorebook must be selected
    if (!currentLorebook) {
        toastr.warning('Please select a lorebook in Scribe settings first.');
        console.warn('[Scribe] Update Lore blocked: no lorebook selected');
        return;
    }

    // Load lorebook entries
    let book = null;
    try {
        book = await loadWorldInfo(currentLorebook);
    } catch (e) {
        console.error('[Scribe] Failed to load lorebook for update:', e);
        toastr.error('Failed to load lorebook.');
        return;
    }

    if (!book?.entries) {
        toastr.error('No entries found in lorebook: ' + currentLorebook);
        return;
    }

    const entries = Object.values(book.entries).filter(e => !e.disable);
    if (entries.length === 0) {
        toastr.error('No active entries found in lorebook: ' + currentLorebook);
        return;
    }

    console.log('[Scribe] Loaded', entries.length, 'entries from', currentLorebook);

    // Remove any existing update dialog
    document.getElementById('le-scribe-update-dialog')?.remove();

    const dialog = document.createElement('dialog');
    dialog.id = 'le-scribe-update-dialog';

    const content = document.createElement('div');
    content.className = 'le-modal';

    function closeUpdateModal() {
        dialog.close();
        dialog.remove();
        console.log('[Scribe] Update modal closed');
    }

    dialog.addEventListener('click', (e) => {
        if (e.target === dialog) closeUpdateModal();
    });

    // --- Sticky close button ---
    const closeBtn = document.createElement('button');
    closeBtn.className = 'le-modal-close';
    closeBtn.textContent = '✕';
    closeBtn.title = 'Close';
    closeBtn.addEventListener('click', () => closeUpdateModal());
    content.appendChild(closeBtn);

    // --- Header ---
    const header = document.createElement('div');
    header.style.cssText = 'font-size:15px; font-weight:600; margin-bottom:4px;';
    header.textContent = '⭐ Update Lore Entry';
    content.appendChild(header);

    const subheader = document.createElement('div');
    subheader.style.cssText = 'font-size:12px; opacity:0.6; margin-bottom:8px;';
    subheader.textContent = `Lorebook: ${currentLorebook}`;
    content.appendChild(subheader);

    // --- Search input ---
    const searchGroup = document.createElement('div');
    searchGroup.innerHTML = `
        <label style="font-size:13px; display:block; margin-bottom:4px;">
            Search Entries
        </label>
        <input type="text" id="le-update-search" class="text_pole"
            placeholder="Type to filter entries...">
    `;
    content.appendChild(searchGroup);

    // --- Entry list ---
    const entryList = document.createElement('div');
    entryList.style.cssText = `
        max-height: 180px;
        overflow-y: auto;
        border: 1px solid rgba(255,255,255,0.1);
        border-radius: 6px;
        margin-top: 6px;
    `;

    let selectedEntry = null;

    function renderEntryList(filter) {
        const { Fuse } = SillyTavern.libs;
        let filtered = entries;

        if (filter && filter.trim()) {
            const fuse = new Fuse(entries, {
                keys: ['comment', 'key'],
                threshold: 0.4,
            });
            filtered = fuse.search(filter.trim()).map(r => r.item);
        }

        console.log('[Scribe] Entry list filtered to', filtered.length, 'results');

        entryList.innerHTML = '';

        if (filtered.length === 0) {
            const empty = document.createElement('div');
            empty.style.cssText = 'padding:10px 12px; font-size:12px; opacity:0.5;';
            empty.textContent = 'No entries found.';
            entryList.appendChild(empty);
            return;
        }

        for (const entry of filtered) {
            const row = document.createElement('div');
            row.style.cssText = `
                padding: 8px 12px;
                font-size: 13px;
                cursor: pointer;
                border-bottom: 1px solid rgba(255,255,255,0.06);
                transition: background 0.1s;
            `;
            row.textContent = entry.comment || '(Untitled)';

            row.addEventListener('mouseenter', () => {
                row.style.background = 'rgba(255,255,255,0.07)';
            });
            row.addEventListener('mouseleave', () => {
                row.style.background = selectedEntry?.uid === entry.uid
                    ? 'rgba(74,158,255,0.15)'
                    : '';
            });

            row.addEventListener('click', () => {
                selectedEntry = entry;
                // Highlight selected row
                entryList.querySelectorAll('div').forEach(r => {
                    r.style.background = '';
                });
                row.style.background = 'rgba(74,158,255,0.15)';
                renderEntryPreview(entry);
                console.log('[Scribe] Entry selected for update:', entry.comment);
            });

            entryList.appendChild(row);
        }
    }

    renderEntryList('');
    content.appendChild(entryList);

    // --- Entry preview ---
    const previewContainer = document.createElement('div');
    previewContainer.style.cssText = 'margin-top:8px;';

    const previewLabel = document.createElement('div');
    previewLabel.style.cssText = 'font-size:11px; opacity:0.5; margin-bottom:4px; text-transform:uppercase; letter-spacing:0.05em;';
    previewLabel.textContent = 'Current Entry';

    const previewBox = document.createElement('div');
    previewBox.className = 'le-update-modal-entry-preview';
    previewBox.style.display = 'none';

    function renderEntryPreview(entry) {
        previewBox.style.display = 'flex';
        previewBox.innerHTML = `
            <div class="le-preview-field">
                <span class="le-preview-label">Title</span>
                <span class="le-preview-value">${escapeHtml(entry.comment || '(Untitled)')}</span>
            </div>
            <div class="le-preview-field">
                <span class="le-preview-label">Keywords</span>
                <span class="le-preview-value">${escapeHtml((entry.key || []).join(', '))}</span>
            </div>
            <div class="le-preview-field">
                <span class="le-preview-label">Content</span>
                <span class="le-preview-value">${escapeHtml(entry.content || '')}</span>
            </div>
        `;
    }

    previewContainer.appendChild(previewLabel);
    previewContainer.appendChild(previewBox);
    content.appendChild(previewContainer);

    // --- Update instructions ---
    const instructionsGroup = document.createElement('div');
    instructionsGroup.style.cssText = 'margin-top:8px;';
    instructionsGroup.innerHTML = `
        <label for="le-update-instructions" style="font-size:13px; display:block; margin-bottom:4px;">
            Update Instructions (optional)
        </label>
        <textarea id="le-update-instructions" class="text_pole" rows="2"
            placeholder="e.g. Add that she can also heal animals. Remove the part about the sword."></textarea>
    `;
    content.appendChild(instructionsGroup);

    // --- Wire search input ---
    const searchInput = content.querySelector('#le-update-search');
    searchInput.addEventListener('input', () => {
        renderEntryList(searchInput.value);
    });

    // --- Buttons ---
    const buttonsDiv = document.createElement('div');
    buttonsDiv.style.cssText = 'display:flex; gap:8px; justify-content:flex-end; flex-wrap:wrap; margin-top:4px;';

    const cancelBtn = document.createElement('button');
    cancelBtn.textContent = 'Cancel';
    cancelBtn.classList.add('menu_button');
    cancelBtn.addEventListener('click', () => closeUpdateModal());

    const generateBtn = document.createElement('button');
    generateBtn.textContent = '⭐ Generate Update';
    generateBtn.classList.add('menu_button');
    generateBtn.addEventListener('click', async () => {
        if (!selectedEntry) {
            toastr.warning('Please select an entry to update.');
            return;
        }

        const instructions = content.querySelector('#le-update-instructions')?.value.trim() || '';
        console.log('[Scribe] Generating update for entry:', selectedEntry.comment);
        console.log('[Scribe] Update instructions:', instructions || '(none)');

        closeUpdateModal();

        toastr.info('Generating updated entry...', '', { timeOut: 0, extendedTimeOut: 0 });

        try {
            const response = await generateUpdateEntry(
                selectedEntry, selectedText, messageContext, instructions);
            toastr.clear();

            const parsed = parseLoreResponse(response);
            if (parsed) {
                await showReviewModal(
                    parsed, selectedText, messageContext, selectedEntry);
            } else {
                toastr.error('Failed to parse updated entry. Please try again.');
            }
        } catch (err) {
            toastr.clear();
            console.error('[Scribe] Update generation failed:', err);
            toastr.error('Failed to generate update. Please try again.');
        }
    });

    buttonsDiv.appendChild(cancelBtn);
    buttonsDiv.appendChild(generateBtn);
    content.appendChild(buttonsDiv);

    dialog.appendChild(content);
    document.body.appendChild(dialog);
    dialog.showModal();
}

/**
 * Shows the review modal for editing the generated lore entry
 * @param {{title: string, keywords: string[], content: string}} draft - The generated draft
 * @param {string} selectedText - The original selected text
 * @param {string} messageContext - The original message context
 */
async function showReviewModal(draft, selectedText, messageContext, existingEntry = null) {
    console.log('SillyTavern-Scribe!: Showing review modal with draft:', draft);

    // Remove any existing dialog
    document.getElementById('le-scribe-dialog')?.remove();

    // Check for duplicates
    const currentLorebook = extension_settings['SillyTavern-Scribe']?.selectedLorebook || '';
    // Skip duplicate check in update mode — user already knows the entry exists
    const similarEntry = (currentLorebook && !existingEntry)
        ? await findSimilarEntry(currentLorebook, draft)
        : null;

    // Create native dialog + inner modal container
    const dialog = document.createElement('dialog');
    dialog.id = 'le-scribe-dialog';

    const content = document.createElement('div');
    content.className = 'le-modal';

    function closeModal() {
        dialog.close();
        dialog.remove();
    }

    // Sticky close button — always visible at top right on mobile
    const closeBtn = document.createElement('button');
    closeBtn.className = 'le-modal-close';
    closeBtn.textContent = '✕';
    closeBtn.title = 'Close';
    closeBtn.addEventListener('click', () => {
        console.log('[Scribe] Modal closed via ✕ button');
        closeModal();
    });
    content.appendChild(closeBtn);

    // Show a header banner when in update mode
    if (existingEntry) {
        const updateBanner = document.createElement('div');
        updateBanner.style.cssText = `
            background: rgba(74,158,255,0.15);
            border: 1px solid rgba(74,158,255,0.3);
            border-radius: 6px;
            padding: 8px 12px;
            font-size: 12px;
            color: var(--SmartThemeBodyColor);
        `;
        updateBanner.innerHTML = `
            ⭐ <strong>Update mode</strong> — reviewing changes to
            "<em>${escapeHtml(existingEntry.comment || 'Untitled')}</em>"
        `;
        content.appendChild(updateBanner);
        console.log('[Scribe] Modal opened in update mode for:',
            existingEntry.comment);
    }

    function makeFieldRow(labelText, inputHtml, fieldId, onRegen) {
        const wrap = document.createElement('div');

        const labelRow = document.createElement('div');
        labelRow.style.cssText = 'display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;';

        const label = document.createElement('label');
        label.setAttribute('for', fieldId);
        label.textContent = labelText;
        label.style.cssText = 'font-size:13px;';

        const regenFieldBtn = document.createElement('button');
        regenFieldBtn.textContent = '↺';
        regenFieldBtn.title = `Regenerate ${labelText} only`;
        regenFieldBtn.style.cssText = `
            background: rgba(255,255,255,0.1);
            border: 1px solid rgba(255,255,255,0.2);
            border-radius: 4px;
            color: var(--SmartThemeBodyColor);
            cursor: pointer;
            font-size: 12px;
            padding: 1px 7px;
            line-height: 1.6;
        `;

        regenFieldBtn.addEventListener('click', async () => {
            regenFieldBtn.disabled = true;
            regenFieldBtn.textContent = '⏳';
            console.log('[Scribe] Per-field regen clicked:', fieldId);
            try {
                await onRegen();
            } finally {
                regenFieldBtn.disabled = false;
                regenFieldBtn.textContent = '↺';
            }
        });

        labelRow.appendChild(label);
        labelRow.appendChild(regenFieldBtn);

        const fieldContainer = document.createElement('div');
        fieldContainer.innerHTML = inputHtml;

        wrap.appendChild(labelRow);
        wrap.appendChild(fieldContainer);
        return wrap;
    }

    // Close when clicking the backdrop (dialog element itself)
    dialog.addEventListener('click', (e) => {
        if (e.target === dialog) closeModal();
    });

    // --- Duplicate warning banner ---
    if (similarEntry) {
        const banner = document.createElement('div');
        banner.style.cssText = `
            background: rgba(200,40,40,0.85);
            border: 1px solid rgba(255,80,80,0.6);
            border-radius: 6px;
            padding: 10px 14px;
            color: #fff;
            font-size: 13px;
            font-family: 'Inter', system-ui, sans-serif;
        `;

        const bannerTitle = document.createElement('div');
        bannerTitle.style.cssText = 'font-weight:600; margin-bottom:6px;';
        bannerTitle.textContent = `⚠️ Similar entry found: "${similarEntry.comment || 'Untitled'}"`;

        const toggleBtn = document.createElement('button');
        toggleBtn.textContent = 'Show Comparison ▼';
        toggleBtn.style.cssText = `
            background:rgba(255,255,255,0.2); border:1px solid rgba(255,255,255,0.4);
            border-radius:4px; color:#fff; cursor:pointer; font-size:12px; padding:3px 8px;
        `;

        const comparisonPanel = document.createElement('div');
        comparisonPanel.style.cssText = 'display:none; margin-top:10px;';

        function makeCompareRow(label, existingVal, newFieldId) {
            const row = document.createElement('div');
            row.style.cssText = 'display:grid; grid-template-columns:1fr 1fr; gap:8px; margin-bottom:10px;';
            row.innerHTML = `
                <div>
                    <div style="font-size:11px;opacity:0.7;margin-bottom:3px;">EXISTING — ${label}</div>
                    <div style="background:rgba(0,0,0,0.3);border-radius:4px;padding:6px 8px;
                        font-size:12px;white-space:pre-wrap;word-break:break-word;
                        max-height:120px;overflow-y:auto;">${escapeHtml(existingVal)}</div>
                </div>
                <div>
                    <div style="font-size:11px;opacity:0.7;margin-bottom:3px;">NEW — ${label}</div>
                    <div style="background:rgba(0,0,0,0.2);border-radius:4px;padding:6px 8px;
                        font-size:12px;white-space:pre-wrap;word-break:break-word;
                        max-height:120px;overflow-y:auto;">${escapeHtml(document.getElementById(newFieldId)?.value ?? '')}</div>
                </div>
            `;
            return row;
        }

        const mergeBtn = document.createElement('button');
        mergeBtn.textContent = '🤖 Merge';
        mergeBtn.style.cssText = `
            background:rgba(255,255,255,0.2); border:1px solid rgba(255,255,255,0.4);
            border-radius:4px; color:#fff; cursor:pointer; font-size:12px;
            padding:4px 10px; margin-top:8px;
        `;

        const proposedArea = document.createElement('div');
        proposedArea.id = 'le-proposed-merge';
        proposedArea.style.cssText = 'display:none; margin-top:10px;';
        proposedArea.innerHTML = `
            <div style="font-size:11px;opacity:0.7;margin-bottom:4px;">
                PROPOSED MERGE — review before accepting
            </div>
            <div style="margin-bottom:6px;">
                <label style="font-size:11px;">Title</label>
                <input type="text" id="le-merge-title" class="text_pole"
                    style="width:100%;box-sizing:border-box;">
            </div>
            <div style="margin-bottom:6px;">
                <label style="font-size:11px;">Keywords</label>
                <input type="text" id="le-merge-keywords" class="text_pole"
                    style="width:100%;box-sizing:border-box;">
            </div>
            <div style="margin-bottom:6px;">
                <label style="font-size:11px;">Content</label>
                <textarea id="le-merge-content" class="text_pole" rows="5"
                    style="width:100%;box-sizing:border-box;resize:vertical;"></textarea>
            </div>
            <button id="le-accept-merge" class="menu_button">✅ Accept Merge & Save</button>
        `;

        mergeBtn.onclick = async () => {
            mergeBtn.disabled = true;
            mergeBtn.textContent = '⏳ Merging...';
            try {
                const currentDraft = {
                    title:    document.getElementById('le-title')?.value    || '',
                    keywords: (document.getElementById('le-keywords')?.value || '')
                                  .split(',').map(k => k.trim()).filter(Boolean),
                    content:  document.getElementById('le-content')?.value  || '',
                };
                const merged = await generateMergedEntry(similarEntry, currentDraft);
                if (merged) {
                    document.getElementById('le-merge-title').value    = merged.title;
                    document.getElementById('le-merge-keywords').value = merged.keywords.join(', ');
                    document.getElementById('le-merge-content').value  = merged.content;
                    proposedArea.style.display = 'block';
                } else {
                    toastr.error('LLM merge failed. Try again.');
                }
            } catch (e) {
                toastr.error('Merge error. Please try again.');
            } finally {
                mergeBtn.disabled = false;
                mergeBtn.textContent = '🤖 LLM Merge';
            }
        };

        toggleBtn.onclick = () => {
            const isHidden = comparisonPanel.style.display === 'none';
            comparisonPanel.style.display = isHidden ? 'block' : 'none';
            toggleBtn.textContent = isHidden ? 'Hide Comparison ▲' : 'Show Comparison ▼';
            if (isHidden) {
                comparisonPanel.innerHTML = '';
                comparisonPanel.appendChild(makeCompareRow('Title',
                    similarEntry.comment || '', 'le-title'));
                comparisonPanel.appendChild(makeCompareRow('Keywords',
                    (similarEntry.key || []).join(', '), 'le-keywords'));
                comparisonPanel.appendChild(makeCompareRow('Content',
                    similarEntry.content || '', 'le-content'));
                comparisonPanel.appendChild(mergeBtn);
                comparisonPanel.appendChild(proposedArea);

                const closePanelBtn = document.createElement('button');
                closePanelBtn.textContent = 'Hide Comparison ▲';
                closePanelBtn.style.cssText = `
                    background:rgba(255,255,255,0.2); border:1px solid rgba(255,255,255,0.4);
                    border-radius:4px; color:#fff; cursor:pointer; font-size:12px;
                    padding:3px 8px; margin-top:10px; display:block; width:100%;
                `;
                closePanelBtn.onclick = () => {
                    comparisonPanel.style.display = 'none';
                    toggleBtn.textContent = 'Show Comparison ▼';
                };
                comparisonPanel.appendChild(closePanelBtn);
            }
        };

        banner.appendChild(bannerTitle);
        banner.appendChild(toggleBtn);
        banner.appendChild(comparisonPanel);
        content.appendChild(banner);
    }

    // --- Title field ---
    const titleGroup = makeFieldRow(
        'Title',
        `<input type="text" id="le-title" class="text_pole" value="${escapeHtml(draft.title)}">`,
        'le-title',
        async () => {
            const currentDraft = {
                title:    content.querySelector('#le-title')?.value    || '',
                keywords: (content.querySelector('#le-keywords')?.value || '')
                              .split(',').map(k => k.trim()).filter(Boolean),
                content:  content.querySelector('#le-content')?.value  || '',
            };
            const result = await generateSingleField(
                'title', selectedText, messageContext, currentDraft);
            if (result?.title) {
                content.querySelector('#le-title').value = result.title;
                console.log('[Scribe] Title updated:', result.title);
            } else {
                toastr.error('Could not regenerate title. Try again.');
            }
        }
    );
    content.appendChild(titleGroup);

    // --- Keywords field ---
    const keywordsGroup = makeFieldRow(
        'Keywords (comma-separated)',
        `<input type="text" id="le-keywords" class="text_pole" value="${escapeHtml(draft.keywords.join(', '))}">`,
        'le-keywords',
        async () => {
            const currentDraft = {
                title:    content.querySelector('#le-title')?.value    || '',
                keywords: (content.querySelector('#le-keywords')?.value || '')
                              .split(',').map(k => k.trim()).filter(Boolean),
                content:  content.querySelector('#le-content')?.value  || '',
            };
            const result = await generateSingleField(
                'keywords', selectedText, messageContext, currentDraft);
            if (result?.keywords) {
                const kwString = Array.isArray(result.keywords)
                    ? result.keywords.join(', ')
                    : String(result.keywords);
                content.querySelector('#le-keywords').value = kwString;
                console.log('[Scribe] Keywords updated:', kwString);
            } else {
                toastr.error('Could not regenerate keywords. Try again.');
            }
        }
    );
    content.appendChild(keywordsGroup);

    // --- Content field ---
    const contentGroup = makeFieldRow(
        'Lore Content',
        `<textarea id="le-content" class="text_pole" rows="6">${escapeHtml(draft.content)}</textarea>`,
        'le-content',
        async () => {
            const currentDraft = {
                title:    content.querySelector('#le-title')?.value    || '',
                keywords: (content.querySelector('#le-keywords')?.value || '')
                              .split(',').map(k => k.trim()).filter(Boolean),
                content:  content.querySelector('#le-content')?.value  || '',
            };
            const result = await generateSingleField(
                'content', selectedText, messageContext, currentDraft);
            if (result?.content) {
                content.querySelector('#le-content').value = result.content;
                updateTokenCount();
                console.log('[Scribe] Content updated, length:', result.content.length);
            } else {
                toastr.error('Could not regenerate content. Try again.');
            }
        }
    );
    content.appendChild(contentGroup);

    // --- Token counter ---
    const tokenCounter = document.createElement('div');
    tokenCounter.id = 'le-token-counter';
    tokenCounter.style.cssText = `
        font-size: 11px;
        opacity: 0.6;
        text-align: right;
        margin-top: -4px;
    `;

    function updateTokenCount() {
        const text = content.querySelector('#le-content')?.value || '';
        const estimated = Math.ceil(text.length / 4);
        tokenCounter.textContent = `~${estimated} tokens`;
    }

    // Initial count on modal open
    updateTokenCount();

    // Update live as user types in content field
    content.addEventListener('input', (e) => {
        if (e.target.id === 'le-content') updateTokenCount();
    });

    content.appendChild(tokenCounter);
    console.log('[Scribe] Token counter initialized');

    // --- Prompt preview ---
    const previewGroup = document.createElement('div');

    const previewToggle = document.createElement('button');
    previewToggle.textContent = '🔍 Preview Full Prompt Being Sent ▼';
    previewToggle.style.cssText = `
        background: rgba(255,255,255,0.05);
        border: 1px solid rgba(255,255,255,0.15);
        border-radius: 4px;
        color: var(--SmartThemeBodyColor);
        cursor: pointer;
        font-size: 11px;
        padding: 3px 8px;
        width: 100%;
        text-align: left;
        opacity: 0.7;
    `;

    const previewPanel = document.createElement('div');
    previewPanel.style.cssText = 'display:none; margin-top:6px;';

    const previewText = document.createElement('textarea');
    previewText.readOnly = true;
    previewText.rows = 8;
    previewText.style.cssText = `
        width: 100%;
        box-sizing: border-box;
        font-size: 11px;
        opacity: 0.7;
        resize: vertical;
        background: rgba(0,0,0,0.2);
        border: 1px solid rgba(255,255,255,0.1);
        border-radius: 4px;
        color: var(--SmartThemeBodyColor);
        padding: 6px 8px;
        font-family: monospace;
    `;

    const previewTokenCount = document.createElement('div');
    previewTokenCount.style.cssText = `
        font-size: 11px;
        opacity: 0.5;
        text-align: right;
        margin-top: 3px;
    `;

    previewToggle.addEventListener('click', async () => {
        const isHidden = previewPanel.style.display === 'none';
        previewPanel.style.display = isHidden ? 'block' : 'none';
        previewToggle.textContent = isHidden
            ? '🔍 Preview Full Prompt ▲'
            : '🔍 Preview Full Prompt ▼';

        if (isHidden) {
            console.log('[Scribe] Building prompt preview...');
            const additionalCtx = await buildContextSections();
            const sysPrompt     = getSystemPrompt();
            const lengthInstr   = getLengthInstruction();

            const previewPrompt = `${sysPrompt}

LENGTH CONSTRAINT: ${lengthInstr}

OUTPUT FORMAT — return exactly this structure, no other text:
{"title": "...", "keywords": ["...", "..."], "content": "..."}
${additionalCtx ? `\nCONTEXT:\n${additionalCtx}\n` : ''}
SUBJECT: ${selectedText}
SURROUNDING CONTEXT: ${messageContext}`;

            previewText.value = previewPrompt;
            const estimated = Math.ceil(previewPrompt.length / 4);
            previewTokenCount.textContent = `~${estimated} tokens`;
            console.log('[Scribe] Prompt preview ready, estimated tokens:', estimated);
        }
    });

    previewPanel.appendChild(previewText);
    previewPanel.appendChild(previewTokenCount);
    previewGroup.appendChild(previewToggle);
    previewGroup.appendChild(previewPanel);
    content.appendChild(previewGroup);

    // --- Lorebook selector ---
    const savedLorebook = extension_settings['SillyTavern-Scribe']?.selectedLorebook || '';

    const lorebookGroup = document.createElement('div');

    const lorebookLabel = document.createElement('label');
    lorebookLabel.setAttribute('for', 'le-lorebook');
    lorebookLabel.textContent = 'Lorebook';
    lorebookLabel.style.cssText = 'font-size:13px; display:block; margin-bottom:4px;';

    const lorebookRow = document.createElement('div');
    lorebookRow.className = 'le-lorebook-row';

    const lorebookSelect = document.createElement('select');
    lorebookSelect.id = 'le-lorebook';
    lorebookSelect.className = 'text_pole';
    lorebookSelect.innerHTML = buildLorebookOptions(savedLorebook);

    const lorebookRefreshBtn = document.createElement('button');
    lorebookRefreshBtn.className = 'le-refresh-btn';
    lorebookRefreshBtn.title = 'Refresh lorebook list';
    lorebookRefreshBtn.textContent = '🔄';

    lorebookRefreshBtn.addEventListener('click', () => {
        const currentVal = lorebookSelect.value;
        lorebookSelect.innerHTML = buildLorebookOptions(savedLorebook);
        // Restore selection if it still exists
        if (currentVal && world_names?.includes(currentVal)) {
            lorebookSelect.value = currentVal;
        }
        console.log('[Scribe] Modal lorebook list refreshed,',
            world_names?.length ?? 0, 'lorebooks found');
        toastr.success('Lorebook list refreshed');
    });

    lorebookRow.appendChild(lorebookSelect);
    lorebookRow.appendChild(lorebookRefreshBtn);
    lorebookGroup.appendChild(lorebookLabel);
    lorebookGroup.appendChild(lorebookRow);
    content.appendChild(lorebookGroup);

    // --- Length control ---
    const savedLength      = extension_settings['SillyTavern-Scribe']?.contentLength || 'standard';
    const savedCustomCount = extension_settings['SillyTavern-Scribe']?.customTokenCount || 150;

    const lengthGroup = document.createElement('div');
    lengthGroup.innerHTML = `
        <label for="le-length-select">Entry Length</label>
        <select id="le-length-select" class="text_pole">
            <option value="brief"    ${savedLength === 'brief'     ? 'selected' : ''}>Brief (~50 tokens)</option>
            <option value="standard" ${savedLength === 'standard'  ? 'selected' : ''}>Standard (~150 tokens)</option>
            <option value="detailed" ${savedLength === 'detailed'  ? 'selected' : ''}>Detailed (~300 tokens)</option>
            <option value="extensive"${savedLength === 'extensive' ? 'selected' : ''}>Extensive (~500 tokens)</option>
            <option value="custom"   ${savedLength === 'custom'    ? 'selected' : ''}>Custom</option>
        </select>
        <div id="le-custom-token-wrap" style="margin-top:6px; display:${savedLength === 'custom' ? 'flex' : 'none'}; align-items:center; gap:8px;">
            <input type="number" id="le-custom-token-count" class="text_pole"
                min="10" max="2000" step="10"
                value="${savedCustomCount}"
                style="width:90px;">
            <span style="font-size:13px; opacity:0.8;">tokens</span>
        </div>
    `;
    content.appendChild(lengthGroup);

    // Wire length dropdown
    const lengthSelect = lengthGroup.querySelector('#le-length-select');
    const customWrap   = lengthGroup.querySelector('#le-custom-token-wrap');
    const customInput  = lengthGroup.querySelector('#le-custom-token-count');

    console.log('[Scribe] Length controls found:',
        !!lengthSelect, !!customWrap, !!customInput);

    lengthSelect.addEventListener('change', () => {
        const val = lengthSelect.value;
        customWrap.style.display = val === 'custom' ? 'flex' : 'none';
        if (!extension_settings['SillyTavern-Scribe']) {
            extension_settings['SillyTavern-Scribe'] = {};
        }
        extension_settings['SillyTavern-Scribe'].contentLength = val;
        saveSettingsDebounced();
        console.log('[Scribe] Length setting changed to:', val);
    });

    customInput.addEventListener('input', () => {
        const val = parseInt(customInput.value) || 150;
        if (!extension_settings['SillyTavern-Scribe']) {
            extension_settings['SillyTavern-Scribe'] = {};
        }
        extension_settings['SillyTavern-Scribe'].customTokenCount = val;
        saveSettingsDebounced();
        console.log('[Scribe] Custom token count changed to:', val);
    });

    // --- Revision instructions ---
    const revisionGroup = document.createElement('div');
    revisionGroup.innerHTML = `
        <label for="le-revision">Revision Instructions (optional)</label>
        <textarea id="le-revision" class="text_pole" rows="2"
            placeholder="e.g. Make it shorter, add more mystery..."></textarea>
    `;
    content.appendChild(revisionGroup);

    // --- Buttons row ---
    const buttonsDiv = document.createElement('div');
    buttonsDiv.style.cssText = 'display:flex; gap:8px; justify-content:flex-end; flex-wrap:wrap;';

    const cancelBtn = document.createElement('button');
    cancelBtn.textContent = 'Cancel';
    cancelBtn.classList.add('menu_button');
    cancelBtn.onclick = () => closeModal();

    const regenBtn = document.createElement('button');
    regenBtn.textContent = '🔄 Regenerate';
    regenBtn.classList.add('menu_button');
    regenBtn.onclick = async () => {
        const revisionInstructions = document.getElementById('le-revision').value.trim();
        regenBtn.disabled = true;
        regenBtn.textContent = '⏳ Regenerating...';
        try {
            const response = await generateLoreEntry(
                selectedText, messageContext, revisionInstructions);
            const parsed = parseLoreResponse(response);
            if (parsed) {
                document.getElementById('le-title').value    = parsed.title;
                document.getElementById('le-keywords').value = parsed.keywords.join(', ');
                document.getElementById('le-content').value  = parsed.content;
                updateTokenCount();
            } else {
                toastr.error('Failed to parse regenerated entry. Try again.');
            }
        } catch (e) {
            console.error('SillyTavern-Scribe!: Regenerate failed:', e);
            toastr.error('Regeneration failed. Please try again.');
        } finally {
            regenBtn.disabled = false;
            regenBtn.textContent = '🔄 Regenerate';
        }
    };

    const saveBtn = document.createElement('button');
    saveBtn.textContent = existingEntry ? '⭐ Save Update' : 'Save';
    saveBtn.classList.add('menu_button');
    saveBtn.onclick = async () => {
        const title        = content.querySelector('#le-title')?.value.trim()    || '';
        const keywordsStr  = content.querySelector('#le-keywords')?.value.trim() || '';
        const content_val  = content.querySelector('#le-content')?.value.trim()  || '';
        const lorebookName = content.querySelector('#le-lorebook')?.value         || '';

        if (!title || !content_val) {
            toastr.error('Title and content are required');
            return;
        }
        if (!lorebookName) {
            toastr.error('Please select a lorebook');
            return;
        }

        const keywords = keywordsStr
            ? keywordsStr.split(',').map(k => k.trim()).filter(k => k)
            : [];

        if (existingEntry) {
            // Update mode — overwrite the existing entry
            const confirmed = confirm(
                `Overwrite "${existingEntry.comment || 'Untitled'}" with the updated version?`
            );
            if (!confirmed) return;

            try {
                const book = await loadWorldInfo(lorebookName);
                if (!book?.entries) {
                    toastr.error('Could not load lorebook.');
                    return;
                }

                const target = Object.values(book.entries)
                    .find(e => e.uid === existingEntry.uid);
                if (!target) {
                    toastr.error('Original entry no longer exists in lorebook.');
                    return;
                }

                target.comment      = title;
                target.key          = keywords;
                target.keysecondary = target.keysecondary || [];
                target.content      = content_val;

                await saveWorldInfo(lorebookName, book, true);
                await reloadEditor(lorebookName);

                if (!extension_settings['SillyTavern-Scribe']) {
                    extension_settings['SillyTavern-Scribe'] = {};
                }
                extension_settings['SillyTavern-Scribe'].selectedLorebook = lorebookName;
                saveSettingsDebounced();

                toastr.success(`Entry updated in ${lorebookName}`);
                console.log('[Scribe] Entry overwritten:', title);
                closeModal();
            } catch (err) {
                console.error('[Scribe] Failed to overwrite entry:', err);
                toastr.error('Failed to save updated entry.');
            }

        } else {
            // Create mode — normal new entry behavior
            await saveLoreEntry(lorebookName, title, keywords, content_val);

            if (!extension_settings['SillyTavern-Scribe']) {
                extension_settings['SillyTavern-Scribe'] = {};
            }
            extension_settings['SillyTavern-Scribe'].selectedLorebook = lorebookName;
            saveSettingsDebounced();
            closeModal();
        }
    };

    buttonsDiv.appendChild(cancelBtn);
    buttonsDiv.appendChild(regenBtn);
    buttonsDiv.appendChild(saveBtn);
    content.appendChild(buttonsDiv);

    // --- Accept Merge handler ---
    content.addEventListener('click', async (e) => {
        if (e.target.id !== 'le-accept-merge') return;

        const confirmed = confirm(
            `Overwrite "${similarEntry.comment || 'Untitled'}" with the merged version?`
        );
        if (!confirmed) return;

        const mergedTitle    = document.getElementById('le-merge-title')?.value.trim()    || '';
        const mergedKeywords = (document.getElementById('le-merge-keywords')?.value || '')
                                   .split(',').map(k => k.trim()).filter(Boolean);
        const mergedContent  = document.getElementById('le-merge-content')?.value.trim()  || '';
        const lorebookName   = document.getElementById('le-lorebook')?.value               || '';

        if (!mergedTitle || !mergedContent || !lorebookName) {
            toastr.error('Merged entry is incomplete.');
            return;
        }

        try {
            const book = await loadWorldInfo(lorebookName);
            if (!book?.entries) { toastr.error('Could not load lorebook.'); return; }

            const target = Object.values(book.entries)
                .find(e => e.uid === similarEntry.uid);
            if (!target) { toastr.error('Original entry no longer exists.'); return; }

            target.comment      = mergedTitle;
            target.key          = mergedKeywords;
            target.keysecondary = target.keysecondary || [];
            target.content      = mergedContent;

            await saveWorldInfo(lorebookName, book, true);
            await reloadEditor(lorebookName);
            toastr.success(`Merged entry saved to ${lorebookName}`);
            closeModal();
        } catch (err) {
            console.error('SillyTavern-Scribe!: Accept merge failed:', err);
            toastr.error('Failed to save merged entry.');
        }
    });

    // Mount and open via top-layer showModal()
    dialog.appendChild(content);
    document.body.appendChild(dialog);
    dialog.showModal();
}

/**
 * Saves the lore entry to the selected lorebook
 * @param {string} lorebookName - The name of the lorebook
 * @param {string} title - The entry title
 * @param {string[]} keywords - The entry keywords
 * @param {string} content - The entry content
 */
async function saveLoreEntry(lorebookName, title, keywords, content) {
    try {
        // Load the lorebook first
        const lorebookData = await loadWorldInfo(lorebookName);
        if (!lorebookData) {
            toastr.error('Failed to load lorebook: ' + lorebookName);
            return;
        }
        
        // Create a new entry
        const entry = createWorldInfoEntry(lorebookName, lorebookData);
        
        // Populate entry fields
        entry.comment = title;
        entry.key = keywords;
        entry.keysecondary = [];
        entry.content = content;
        entry.selective = true;
        entry.probability = 100;
        entry.useProbability = true;
        entry.disable = false;
        
        // Save the lorebook
        await saveWorldInfo(lorebookName, lorebookData, true);
        
        // Reload the editor
        await reloadEditor(lorebookName);
        
        toastr.success('Lore entry saved to ' + lorebookName);
    } catch (error) {
        console.error('SillyTavern-Scribe!: Failed to save entry', error);
        toastr.error('Failed to save lore entry');
    }
}

function buildLorebookOptions(savedValue) {
    if (!world_names || world_names.length === 0) {
        return '<option value="">(No lorebooks found)</option>';
    }
    return world_names.map(name => {
        const selected = name === savedValue ? ' selected' : '';
        return `<option value="${escapeHtml(name)}"${selected}>${escapeHtml(name)}</option>`;
    }).join('');
}

/**
 * Injects the extension settings panel into SillyTavern's settings UI
 */
async function injectSettingsPanel() {
    const lorebookOptions = world_names && world_names.length > 0
        ? world_names.map(name => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`).join('')
        : '';

    const html = `
    <div id="scribe_settings" class="extension_settings">
      <div class="inline-drawer">
        <div class="inline-drawer-toggle inline-drawer-header">
          <b>SillyTavern - Scribe!</b>
          <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
        </div>
        <div class="inline-drawer-content" style="display:none;">
          <div class="flex-container flexFlowColumn">
            <label for="scribe-profile-select">Connection Profile</label>
            <select id="scribe-profile-select" class="text_pole"></select>
            <small style="opacity:0.6; font-size:11px; margin-top:4px;">
              Select a profile for cheaper/faster lore generation.
            </small>
            
            <label for="scribe-lorebook-select" style="margin-top:12px;">Active Lorebook</label>
            <div class="le-lorebook-row">
              <select id="scribe-lorebook-select" class="text_pole">
                <option value="">(Select a lorebook)</option>
                ${lorebookOptions}
              </select>
              <button id="scribe-lorebook-refresh" class="le-refresh-btn" title="Refresh lorebook list">🔄</button>
            </div>
            <small style="opacity:0.6; font-size:11px; margin-top:4px;">
              Highlight text in any chat message, then click "📖 Extract Lore".
            </small>

            <hr style="opacity:0.2; margin:12px 0;">

            <label for="scribe-context-messages">Recent Chat Messages: <span id="scribe-context-messages-value">5</span></label>
            <input type="range" id="scribe-context-messages" class="text_pole"
                min="0" max="20" step="1" value="5"
                style="width:100%; margin-top:4px;">
            <small style="opacity:0.6; font-size:11px;">
              How many recent chat messages to include as context (0 = none).
            </small>

            <div style="margin-top:10px; display:flex; flex-direction:column; gap:6px;">
              <label style="display:flex; align-items:center; gap:8px; cursor:pointer;">
                <input type="checkbox" id="scribe-include-charcard">
                Include Character Card
              </label>
              <label style="display:flex; align-items:center; gap:8px; cursor:pointer;">
                <input type="checkbox" id="scribe-include-authornote">
                Include Author's Note
              </label>
              <label style="display:flex; align-items:center; gap:8px; cursor:pointer;">
                <input type="checkbox" id="scribe-include-lorebook">
                Include Active Lorebook
              </label>
            </div>

            <hr style="opacity:0.2; margin:12px 0;">

            <label for="scribe-system-prompt">Custom System Prompt</label>
            <textarea id="scribe-system-prompt" class="text_pole" rows="5"
                placeholder="Leave blank to use the default prompt. The default instructs the model to output only a JSON object with title, keywords, and content fields."></textarea>
            <div style="display:flex; gap:8px; margin-top:6px;">
                <button id="scribe-reset-prompt" class="menu_button" style="font-size:11px; padding:4px 10px;">
                    ↺ Reset to Default
                </button>
            </div>
            <small style="opacity:0.6; font-size:11px; margin-top:4px;">
              Override the system instruction sent to the LLM. Leave blank for default.
            </small>
          </div>
        </div>
      </div>
    </div>`;

    $('#extensions_settings').append(html);

    const { ConnectionManagerRequestService } = SillyTavern.getContext();
    const profileSelect = document.getElementById('scribe-profile-select');
    const savedProfile = extension_settings['SillyTavern-Scribe']?.selectedProfile || '';

    ConnectionManagerRequestService.handleDropdown(profileSelect, (selectedId) => {
        if (!extension_settings['SillyTavern-Scribe']) {
            extension_settings['SillyTavern-Scribe'] = {};
        }
        extension_settings['SillyTavern-Scribe'].selectedProfile = selectedId;
        saveSettingsDebounced();
        console.log('SillyTavern-Scribe!: Profile selected:', selectedId);
    });

    if (savedProfile) profileSelect.value = savedProfile;

    // Set the saved lorebook as selected
    const savedLorebook = extension_settings['SillyTavern-Scribe']?.selectedLorebook;
    if (savedLorebook) {
        $('#scribe-lorebook-select').val(savedLorebook);
    }

    // Save lorebook on change
    $('#scribe-lorebook-select').on('change', function() {
        if (!extension_settings['SillyTavern-Scribe']) {
            extension_settings['SillyTavern-Scribe'] = {};
        }
        extension_settings['SillyTavern-Scribe'].selectedLorebook = $(this).val();
        saveSettingsDebounced();
    });

    // Lorebook refresh button
    $('#scribe-lorebook-refresh').on('click', function() {
        const currentVal = $('#scribe-lorebook-select').val();
        const savedVal   = extension_settings['SillyTavern-Scribe']?.selectedLorebook || '';
        const newOptions = '<option value="">(Select a lorebook)</option>'
            + buildLorebookOptions(savedVal);
        $('#scribe-lorebook-select').html(newOptions);
        // Restore selection if it still exists
        if (currentVal && world_names?.includes(currentVal)) {
            $('#scribe-lorebook-select').val(currentVal);
        }
        console.log('[Scribe] Settings lorebook list refreshed,',
            world_names?.length ?? 0, 'lorebooks found');
        toastr.success('Lorebook list refreshed');
    });

    // Restore saved values for new controls
    const savedMsgCount = extension_settings['SillyTavern-Scribe']?.contextMessages ?? 5;
    $('#scribe-context-messages').val(savedMsgCount);
    $('#scribe-context-messages-value').text(savedMsgCount);
    $('#scribe-include-charcard').prop('checked',
        extension_settings['SillyTavern-Scribe']?.includeCharCard ?? true);
    $('#scribe-include-authornote').prop('checked',
        extension_settings['SillyTavern-Scribe']?.includeAuthorNote ?? false);
    $('#scribe-include-lorebook').prop('checked',
        extension_settings['SillyTavern-Scribe']?.includeLorebook ?? false);

    // Save on change — messages slider
    $('#scribe-context-messages').on('input', function() {
        const val = parseInt($(this).val());
        $('#scribe-context-messages-value').text(val);
        if (!extension_settings['SillyTavern-Scribe']) {
            extension_settings['SillyTavern-Scribe'] = {};
        }
        extension_settings['SillyTavern-Scribe'].contextMessages = val;
        saveSettingsDebounced();
    });

    // Save on change — checkboxes
    $('#scribe-include-charcard').on('change', function() {
        if (!extension_settings['SillyTavern-Scribe']) {
            extension_settings['SillyTavern-Scribe'] = {};
        }
        extension_settings['SillyTavern-Scribe'].includeCharCard = $(this).prop('checked');
        saveSettingsDebounced();
    });

    $('#scribe-include-authornote').on('change', function() {
        if (!extension_settings['SillyTavern-Scribe']) {
            extension_settings['SillyTavern-Scribe'] = {};
        }
        extension_settings['SillyTavern-Scribe'].includeAuthorNote = $(this).prop('checked');
        saveSettingsDebounced();
    });

    $('#scribe-include-lorebook').on('change', function() {
        if (!extension_settings['SillyTavern-Scribe']) {
            extension_settings['SillyTavern-Scribe'] = {};
        }
        extension_settings['SillyTavern-Scribe'].includeLorebook = $(this).prop('checked');
        saveSettingsDebounced();
    });

    // Restore saved custom system prompt
    const savedCustomPrompt = extension_settings['SillyTavern-Scribe']?.customSystemPrompt || '';
    $('#scribe-system-prompt').val(savedCustomPrompt);

    // Save on change — debounced to avoid saving every keystroke
    $('#scribe-system-prompt').on('input', function() {
        if (!extension_settings['SillyTavern-Scribe']) {
            extension_settings['SillyTavern-Scribe'] = {};
        }
        extension_settings['SillyTavern-Scribe'].customSystemPrompt = $(this).val().trim();
        saveSettingsDebounced();
        console.log('[Scribe] Custom system prompt updated, length:',
            $(this).val().trim().length, 'chars');
    });

    // Reset to default button
    $('#scribe-reset-prompt').on('click', function() {
        $('#scribe-system-prompt').val('');
        if (!extension_settings['SillyTavern-Scribe']) {
            extension_settings['SillyTavern-Scribe'] = {};
        }
        extension_settings['SillyTavern-Scribe'].customSystemPrompt = '';
        saveSettingsDebounced();
        console.log('[Scribe] System prompt reset to default');
        toastr.success('System prompt reset to default');
    });
}

// Initialize extension
jQuery(async () => {
    // Inject settings panel
    injectSettingsPanel();
    
console.log('SillyTavern-Scribe!: Extension loaded');
    
    // Desktop
    $('#chat').on('mouseup', onTextSelected);

    // Mobile — touchend fires after finger lifts
    $('#chat').on('touchend', () => {
        // Small delay lets the browser finalize the selection after touchend
        setTimeout(onTextSelected, 50);
    });

    // Universal fallback — selectionchange works on iOS and Android
    document.addEventListener('selectionchange', () => {
        // Only act if the selection is inside #chat
        const selection = window.getSelection();
        if (!selection || selection.rangeCount === 0) {
            const btn = document.getElementById('le-extract-btn');
            if (btn) btn.style.display = 'none';
            savedSelection = null;
            return;
        }
        const container = selection.getRangeAt(0).commonAncestorContainer;
        const inChat = document.getElementById('chat')
            ?.contains(container);
        if (inChat) onTextSelected();
    });

    // Create the floating extract button
    const extractBtn = document.createElement('button');
    extractBtn.id = 'le-extract-btn';
    extractBtn.textContent = '📖 Extract Lore';
    extractBtn.style.display = 'none';
    document.body.appendChild(extractBtn);

    // Create Update Lore button (stacked below Extract)
    const updateBtn = document.createElement('button');
    updateBtn.id = 'le-update-btn';
    updateBtn.textContent = '⭐ Update Lore';
    updateBtn.style.display = 'none';
    document.body.appendChild(updateBtn);

    // Handle button click
    extractBtn.addEventListener('click', async () => {
        console.log('SillyTavern-Scribe!: Extract button clicked');

        // Use savedSelection so mobile taps don't lose the selection
        const selectedText = savedSelection?.text
            || window.getSelection()?.toString().trim()
            || '';

        if (!selectedText) {
            return;
        }

        const messageContext = savedSelection?.mesText
            || '';

        // Hide the button
        extractBtn.style.display = 'none';
        document.getElementById('le-update-btn').style.display = 'none';

        // Clear the selection
        window.getSelection()?.removeAllRanges();
        savedSelection = null;
        
        // Show loading indicator
        toastr.info('Generating lore entry...', '', { timeOut: 0, extendedTimeOut: 0 });
        
        try {
            const response = await generateLoreEntry(selectedText, messageContext);
            toastr.clear();
            
            const parsed = parseLoreResponse(response);
            
            if (parsed) {
                await showReviewModal(parsed, selectedText, messageContext);
            } else {
                toastr.error('Failed to parse the generated lore entry. Please try again.');
            }
        } catch (error) {
            toastr.clear();
            console.error('SillyTavern-Scribe!: Error generating lore entry', error);
            toastr.error('Failed to generate lore entry. Please try again.');
        }
    });

    extractBtn.addEventListener('touchend', (e) => {
        e.preventDefault();
        if (savedSelection?.text) {
            extractBtn.click();
        }
    });

    // Update Lore button handlers
    updateBtn.addEventListener('click', async () => {
        console.log('[Scribe] Update Lore button clicked');

        const selectedText   = savedSelection?.text || window.getSelection()?.toString().trim() || '';
        const messageContext = savedSelection?.mesText || '';

        if (!selectedText) return;

        updateBtn.style.display  = 'none';
        extractBtn.style.display = 'none';
        window.getSelection()?.removeAllRanges();
        savedSelection = null;

        await showUpdateModal(selectedText, messageContext);
    });

    updateBtn.addEventListener('touchend', (e) => {
        e.preventDefault();
        if (savedSelection?.text) {
            updateBtn.click();
        }
    });
});
