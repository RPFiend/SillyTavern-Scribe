// Default settings for this extension
const defaultSettings = {
    selectedLorebook: '',
    selectedProfile: '',
    contextMessages: 5,
    includeCharCard: true,
    includeAuthorNote: false,
    includeLorebook: false,
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
            }
            return;
        }
    }

    // No valid selection — hide button and clear saved selection
    const btn = document.getElementById('le-extract-btn');
    if (btn) btn.style.display = 'none';
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

        if (result?.response) return result.response;
        if (result?.content) return result.content;
        console.warn('SillyTavern-Scribe!: No response content from profile request');
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

/**
 * Generates a lorebook entry using the LLM
 * @param {string} selectedText - The text selected by the user
 * @param {string} messageContext - The surrounding message context
 * @param {string} revisionInstructions - Optional revision instructions
 * @returns {Promise<string>} - The LLM response
 */
async function generateLoreEntry(selectedText, messageContext, revisionInstructions = '') {
    const selectedProfile = extension_settings['SillyTavern-Scribe']?.selectedProfile;
    console.log('SillyTavern-Scribe!: Sending request to LLM');
    console.log('SillyTavern-Scribe!: Selected text:', selectedText);
    console.log('SillyTavern-Scribe!: Message context:', messageContext);
    console.log('SillyTavern-Scribe!: Using profile:', selectedProfile || 'Default (Chat)');

    const additionalContext = await buildContextSections();

    const prompt = `You are a lore assistant. Based on the text below, write a lorebook entry for the entity or concept described.
Return ONLY valid JSON in this exact format, no other text:
{
  "title": "Entity name",
  "keywords": ["keyword1", "keyword2", "keyword3"],
  "content": "Third-person lore description of the entity."
}
${additionalContext ? `\n${additionalContext}\n` : ''}
Selected text: ${selectedText}
Message context: ${messageContext}${revisionInstructions ? `\nRevision instructions: ${revisionInstructions}` : ''}`;

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
    
    console.log('SillyTavern-Scribe!: LLM response received:', response);
    return response;
}

/**
 * Parses the JSON response from the LLM
 * @param {string} response - The raw response from the LLM
 * @returns {{title: string, keywords: string[], content: string} | null}
 */
function parseLoreResponse(response) {
    try {
        // Strip markdown code fences if present
        let cleaned = response.trim();
        if (cleaned.startsWith('```')) {
            cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
        }
        // Defensive fallback: extract the first {...} block in case of extra text
        const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
        if (jsonMatch) cleaned = jsonMatch;
        
        const parsed = JSON.parse(cleaned);
        
        if (parsed.title && Array.isArray(parsed.keywords) && parsed.content) {
            return {
                title: parsed.title,
                keywords: parsed.keywords,
                content: parsed.content
            };
        }
        
        return null;
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

/**
 * Shows the review modal for editing the generated lore entry
 * @param {{title: string, keywords: string[], content: string}} draft - The generated draft
 * @param {string} selectedText - The original selected text
 * @param {string} messageContext - The original message context
 */
async function showReviewModal(draft, selectedText, messageContext) {
    console.log('SillyTavern-Scribe!: Showing review modal with draft:', draft);

    // Remove any existing dialog
    document.getElementById('le-scribe-dialog')?.remove();

    // Check for duplicates
    const currentLorebook = extension_settings['SillyTavern-Scribe']?.selectedLorebook || '';
    const similarEntry = currentLorebook
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
        mergeBtn.textContent = '🤖 LLM Merge';
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
    const titleGroup = document.createElement('div');
    titleGroup.innerHTML = `
        <label for="le-title">Title</label>
        <input type="text" id="le-title" class="text_pole"
            value="${escapeHtml(draft.title)}">
    `;
    content.appendChild(titleGroup);

    // --- Keywords field ---
    const keywordsGroup = document.createElement('div');
    keywordsGroup.innerHTML = `
        <label for="le-keywords">Keywords (comma-separated)</label>
        <input type="text" id="le-keywords" class="text_pole"
            value="${escapeHtml(draft.keywords.join(', '))}">
    `;
    content.appendChild(keywordsGroup);

    // --- Content field ---
    const contentGroup = document.createElement('div');
    contentGroup.innerHTML = `
        <label for="le-content">Lore Content</label>
        <textarea id="le-content" class="text_pole"
            rows="6">${escapeHtml(draft.content)}</textarea>
    `;
    content.appendChild(contentGroup);

    // --- Lorebook selector ---
    const savedLorebook = extension_settings['SillyTavern-Scribe']?.selectedLorebook || '';
    let lorebookOptions = '';
    if (world_names && world_names.length > 0) {
        lorebookOptions = world_names.map(name => {
            const selected = name === savedLorebook ? ' selected' : '';
            return `<option value="${escapeHtml(name)}"${selected}>${escapeHtml(name)}</option>`;
        }).join('');
    } else {
        lorebookOptions = '<option value="">(No lorebooks found)</option>';
    }
    const lorebookGroup = document.createElement('div');
    lorebookGroup.innerHTML = `
        <label for="le-lorebook">Lorebook</label>
        <select id="le-lorebook" class="text_pole">${lorebookOptions}</select>
    `;
    content.appendChild(lorebookGroup);

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
    saveBtn.textContent = 'Save';
    saveBtn.classList.add('menu_button');
    saveBtn.onclick = async () => {
        const title        = document.getElementById('le-title').value.trim();
        const keywordsStr  = document.getElementById('le-keywords').value.trim();
        const content_val  = document.getElementById('le-content').value.trim();
        const lorebookName = document.getElementById('le-lorebook').value;

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

        await saveLoreEntry(lorebookName, title, keywords, content_val);

        if (!extension_settings['SillyTavern-Scribe']) {
            extension_settings['SillyTavern-Scribe'] = {};
        }
        extension_settings['SillyTavern-Scribe'].selectedLorebook = lorebookName;
        saveSettingsDebounced();
        closeModal();
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
            <select id="scribe-lorebook-select" class="text_pole">
              <option value="">(Select a lorebook)</option>
              ${lorebookOptions}
            </select>
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
});
