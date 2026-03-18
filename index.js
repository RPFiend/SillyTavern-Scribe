// Default settings for this extension
const defaultSettings = {
    selectedLorebook: ''
};

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

/**
 * Shows the floating extract button near the text selection
 */
function onTextSelected() {
    const selection = window.getSelection();
    const selectionText = selection.toString().trim();
    
    console.log('SillyTavern-Scribe!: Text selection detected');
    
    if (selectionText && selection.rangeCount > 0) {
        const range = selection.getRangeAt(0);
        const container = range.commonAncestorContainer;
        const mesTextElement = container.nodeType === Node.TEXT_NODE 
            ? container.parentElement?.closest('.mes_text')
            : container.closest('.mes_text');
        
        if (mesTextElement) {
            const rect = range.getBoundingClientRect();
            const btn = document.getElementById('le-extract-btn');
            
            if (btn) {
                btn.style.left = `${rect.left + window.scrollX}px`;
                btn.style.top = `${rect.bottom + window.scrollY + 5}px`;
                btn.style.display = 'block';
            }
            return;
        }
    }
    
    // Hide button if no valid selection
    const btn = document.getElementById('le-extract-btn');
    if (btn) {
        btn.style.display = 'none';
    }
}

/**
 * Generates a lorebook entry using the LLM
 * @param {string} selectedText - The text selected by the user
 * @param {string} messageContext - The surrounding message context
 * @returns {Promise<string>} - The LLM response
 */
async function generateLoreEntry(selectedText, messageContext) {
    console.log('SillyTavern-Scribe!: Sending request to LLM');
    console.log('SillyTavern-Scribe!: Selected text:', selectedText);
    console.log('SillyTavern-Scribe!: Message context:', messageContext);
    
    const context = SillyTavern.getContext();
    const response = await context.generateQuietPrompt({
        quietPrompt: `You are a lore assistant. Based on the text below, write a lorebook entry for the entity or concept described.
Return ONLY valid JSON in this exact format, no other text:
{
  "title": "Entity name",
  "keywords": ["keyword1", "keyword2", "keyword3"],
  "content": "Third-person lore description of the entity."
}

Selected text: ${selectedText}
Message context: ${messageContext}`
    });
    
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
        console.error('[Scribe] Failed to parse LLM response:', e, '\nRaw response:', response);
        return null;
    }
}

/**
 * Shows the review modal for editing the generated lore entry
 * @param {{title: string, keywords: string[], content: string}} draft - The generated draft
 * @param {string} messageContext - The original message context
 */
function showReviewModal(draft, messageContext) {
    console.log('SillyTavern-Scribe!: Showing review modal with draft:', draft);
    
    // Remove existing modal if any
    const existingModal = document.querySelector('.le-modal-overlay');
    if (existingModal) {
        existingModal.remove();
    }
    
    // Create modal overlay
    const overlay = document.createElement('div');
    overlay.className = 'le-modal-overlay';
    
    // Create modal
    const modal = document.createElement('div');
    modal.className = 'le-modal';
    
    // Title field
    const titleGroup = document.createElement('div');
    titleGroup.innerHTML = `
        <label for="le-title">Title</label>
        <input type="text" id="le-title" value="${escapeHtml(draft.title)}">
    `;
    
    // Keywords field
    const keywordsGroup = document.createElement('div');
    keywordsGroup.innerHTML = `
        <label for="le-keywords">Keywords (comma-separated)</label>
        <input type="text" id="le-keywords" value="${escapeHtml(draft.keywords.join(', '))}">
    `;
    
    // Content field
    const contentGroup = document.createElement('div');
    contentGroup.innerHTML = `
        <label for="le-content">Lore Content</label>
        <textarea id="le-content">${escapeHtml(draft.content)}</textarea>
    `;
    
    // Lorebook selector
    const lorebookGroup = document.createElement('div');
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
    lorebookGroup.innerHTML = `
        <label for="le-lorebook">Lorebook</label>
        <select id="le-lorebook">${lorebookOptions}</select>
    `;
    
    // Buttons
    const buttonsDiv = document.createElement('div');
    buttonsDiv.className = 'le-modal-buttons';
    
    const cancelBtn = document.createElement('button');
    cancelBtn.textContent = 'Cancel';
    cancelBtn.style.cssText = `
        padding: 8px 16px;
        background: rgba(255,255,255,0.1);
        border: 1px solid rgba(255,255,255,0.2);
        border-radius: 6px;
        color: var(--SmartThemeBodyColor);
        cursor: pointer;
        font-family: 'Inter', system-ui, sans-serif;
    `;
    cancelBtn.onclick = () => overlay.remove();
    
    const saveBtn = document.createElement('button');
    saveBtn.textContent = 'Save';
    saveBtn.style.cssText = `
        padding: 8px 16px;
        background: #4a9eff;
        border: none;
        border-radius: 6px;
        color: white;
        cursor: pointer;
        font-family: 'Inter', system-ui, sans-serif;
    `;
    saveBtn.onclick = () => {
        const title = document.getElementById('le-title').value.trim();
        const keywordsStr = document.getElementById('le-keywords').value.trim();
        const content = document.getElementById('le-content').value.trim();
        const lorebookName = document.getElementById('le-lorebook').value;
        
        if (!title || !content) {
            toastr.error('Title and content are required');
            return;
        }
        
        if (!lorebookName) {
            toastr.error('Please select a lorebook');
            return;
        }
        
        const keywords = keywordsStr ? keywordsStr.split(',').map(k => k.trim()).filter(k => k) : [];
        
        saveLoreEntry(lorebookName, title, keywords, content);
        
        // Persist the chosen lorebook back to settings
        if (!extension_settings['SillyTavern-Scribe']) {
            extension_settings['SillyTavern-Scribe'] = {};
        }
        extension_settings['SillyTavern-Scribe'].selectedLorebook = lorebookName;
        saveSettingsDebounced();
        
        overlay.remove();
    };
    
    buttonsDiv.appendChild(cancelBtn);
    buttonsDiv.appendChild(saveBtn);
    
    // Assemble modal
    modal.appendChild(titleGroup);
    modal.appendChild(keywordsGroup);
    modal.appendChild(contentGroup);
    modal.appendChild(lorebookGroup);
    modal.appendChild(buttonsDiv);
    overlay.appendChild(modal);
    
    // Add to DOM
    document.body.appendChild(overlay);
    
    // Close on overlay click
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) {
            overlay.remove();
        }
    });
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
function injectSettingsPanel() {
    const settingsHtml = `
        <div class="inline-drawer">
            <div class="inline-drawer-toggle notalone">
                <span>Scribe</span>
            </div>
            <div class="inline-drawer-content">
                <div class="flex-container">
                    <select id="scribe-lorebook-select" class="text_pole">
                        ${world_names && world_names.length > 0 
                            ? world_names.map(name => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`).join('')
                            : '<option value="">(No lorebooks found)</option>'
                        }
                    </select>
                </div>
            </div>
        </div>
    `;
    
    $('#extensions_settings').append(settingsHtml);
    
    // Set the saved lorebook as selected
    const savedLorebook = extension_settings['SillyTavern-Scribe']?.selectedLorebook;
    if (savedLorebook) {
        $('#scribe-lorebook-select').val(savedLorebook);
    }
    
    // Save on change
    $('#scribe-lorebook-select').on('change', function() {
        if (!extension_settings['SillyTavern-Scribe']) {
            extension_settings['SillyTavern-Scribe'] = {};
        }
        extension_settings['SillyTavern-Scribe'].selectedLorebook = $(this).val();
        saveSettingsDebounced();
    });
}

// Initialize extension
jQuery(async () => {
    // Inject settings panel
    injectSettingsPanel();
    
console.log('SillyTavern-Scribe!: Extension loaded');
    
    // Register mouseup listener on #chat for text selection
    $('#chat').on('mouseup', onTextSelected);
    
    // Create the floating extract button
    const extractBtn = document.createElement('button');
    extractBtn.id = 'le-extract-btn';
    extractBtn.textContent = '📖 Extract Lore';
    extractBtn.style.display = 'none';
    document.body.appendChild(extractBtn);
    
    // Handle button click
    extractBtn.addEventListener('click', async () => {
        console.log('SillyTavern-Scribe!: Extract button clicked');
        
        const selection = window.getSelection();
        const selectedText = selection.toString().trim();
        
        if (!selectedText) {
            return;
        }
        
        // Get the parent mes_text element
        const range = selection.getRangeAt(0);
        const container = range.commonAncestorContainer;
        const mesTextElement = container.nodeType === Node.TEXT_NODE 
            ? container.parentElement?.closest('.mes_text')
            : container.closest('.mes_text');
        
        const messageContext = mesTextElement ? mesTextElement.textContent : '';
        
        // Hide the button
        extractBtn.style.display = 'none';
        
        // Clear the selection
        selection.removeAllRanges();
        
        // Show loading indicator
        toastr.info('Generating lore entry...', '', { timeOut: 0, extendedTimeOut: 0 });
        
        try {
            const response = await generateLoreEntry(selectedText, messageContext);
            toastr.clear();
            
            const parsed = parseLoreResponse(response);
            
            if (parsed) {
                showReviewModal(parsed, messageContext);
            } else {
                toastr.error('Failed to parse the generated lore entry. Please try again.');
            }
        } catch (error) {
            toastr.clear();
            console.error('SillyTavern-Scribe!: Error generating lore entry', error);
            toastr.error('Failed to generate lore entry. Please try again.');
        }
    });
});
