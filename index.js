// Default settings for this extension
const defaultSettings = {
    selectedLorebook: '',
    selectedProfile: ''
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
 * Gets the list of available connection profiles
 * @returns {Promise<Array>} - Array of profile objects with id and name
 */
async function getAvailableProfiles() {
    console.log('SillyTavern-Scribe!: Getting available profiles...');
    
    // Try multiple approaches to get connection profiles
    
    // Approach 1: Check for connection_profiles in window
    if (window.connection_profiles && Array.isArray(window.connection_profiles)) {
        console.log('SillyTavern-Scribe!: Found profiles via window.connection_profiles');
        return window.connection_profiles.map(p => ({ id: p.id || p.name, name: p.name }));
    }
    
    // Approach 2: Try to get from SillyTavern global
    if (window.SillyTavern?.libs?.connection_profiles) {
        console.log('SillyTavern-Scribe!: Found profiles via SillyTavern.libs');
        return window.SillyTavern.libs.connection_profiles.map(p => ({ id: p.id || p.name, name: p.name }));
    }
    
    // Approach 3: Check for getConnectionProfiles in various places
    const context = SillyTavern.getContext?.();
    if (context?.getConnectionProfiles) {
        try {
            const profiles = await context.getConnectionProfiles();
            console.log('SillyTavern-Scribe!: Found profiles via context.getConnectionProfiles');
            return profiles.map(p => ({ id: p.id || p.name, name: p.name }));
        } catch (e) {
            console.warn('SillyTavern-Scribe!: context.getConnectionProfiles failed:', e);
        }
    }
    
    // Approach 4: Check for profiles in extension_settings or similar
    if (window.extension_settings?.connection_profiles) {
        console.log('SillyTavern-Scribe!: Found profiles via extension_settings');
        return window.extension_settings.connection_profiles.map(p => ({ id: p.id || p.name, name: p.name }));
    }
    
    // Approach 5: Try direct import from connection-manager
    try {
        // Check if there's a global getProfiles function
        if (typeof window.getProfiles === 'function') {
            const profiles = await window.getProfiles();
            console.log('SillyTavern-Scribe!: Found profiles via window.getProfiles');
            return profiles.map(p => ({ id: p.id || p.name, name: p.name }));
        }
    } catch (e) {
        console.warn('SillyTavern-Scribe!: window.getProfiles not available:', e);
    }
    
    console.log('SillyTavern-Scribe!: No profiles found via any approach');
    return [];
}

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
 * Sends a request using the selected connection profile
 * @param {string} profileId - The profile ID to use
 * @param {string} prompt - The prompt to send
 * @returns {Promise<string|null>} - The response or null if failed
 */
async function sendWithProfile(profileId, prompt) {
    console.log('SillyTavern-Scribe!: Attempting to send with profile:', profileId);
    
    // Try different approaches to use connection profiles
    
    // Approach 1: Try ConnectionManagerRequestService from window
    try {
        if (window.ConnectionManagerRequestService) {
            const result = await window.ConnectionManagerRequestService.sendRequest(profileId, prompt, false);
            if (result?.response) {
                console.log('SillyTavern-Scribe!: Success via window.ConnectionManagerRequestService');
                return result.response;
            }
        }
    } catch (e) {
        console.warn('SillyTavern-Scribe!: window.ConnectionManagerRequestService failed:', e);
    }
    
    // Approach 2: Try from SillyTavern global
    try {
        if (window.SillyTavern?.ConnectionManagerRequestService) {
            const result = await window.SillyTavern.ConnectionManagerRequestService.sendRequest(profileId, prompt, false);
            if (result?.response) {
                console.log('SillyTavern-Scribe!: Success via SillyTavern.ConnectionManagerRequestService');
                return result.response;
            }
        }
    } catch (e) {
        console.warn('SillyTavern-Scribe!: SillyTavern.ConnectionManagerRequestService failed:', e);
    }
    
    // Approach 3: Try sendCustomGenerationRequest or similar
    try {
        if (window.sendCustomGenerationRequest) {
            const result = await window.sendCustomGenerationRequest(profileId, prompt);
            if (result?.response) {
                console.log('SillyTavern-Scribe!: Success via sendCustomGenerationRequest');
                return result.response;
            }
        }
    } catch (e) {
        console.warn('SillyTavern-Scribe!: sendCustomGenerationRequest failed:', e);
    }
    
    return null;
}

/**
 * Generates a lorebook entry using the LLM
 * @param {string} selectedText - The text selected by the user
 * @param {string} messageContext - The surrounding message context
 * @returns {Promise<string>} - The LLM response
 */
async function generateLoreEntry(selectedText, messageContext) {
    const selectedProfile = extension_settings['SillyTavern-Scribe']?.selectedProfile;
    console.log('SillyTavern-Scribe!: Sending request to LLM');
    console.log('SillyTavern-Scribe!: Selected text:', selectedText);
    console.log('SillyTavern-Scribe!: Message context:', messageContext);
    console.log('SillyTavern-Scribe!: Using profile:', selectedProfile || 'Default (Chat)');
    
    const prompt = `You are a lore assistant. Based on the text below, write a lorebook entry for the entity or concept described.
Return ONLY valid JSON in this exact format, no other text:
{
  "title": "Entity name",
  "keywords": ["keyword1", "keyword2", "keyword3"],
  "content": "Third-person lore description of the entity."
}

Selected text: ${selectedText}
Message context: ${messageContext}`;

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
async function injectSettingsPanel() {
    const lorebookOptions = world_names && world_names.length > 0
        ? world_names.map(name => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`).join('')
        : '';

    // Get available connection profiles
    const profiles = await getAvailableProfiles();
    const savedProfile = extension_settings['SillyTavern-Scribe']?.selectedProfile || '';
    const profileOptions = profiles.length > 0
        ? profiles.map(p => `<option value="${escapeHtml(p.id)}"${p.id === savedProfile ? ' selected' : ''}>${escapeHtml(p.name)}</option>`).join('')
        : '<option value="">(No profiles available)</option>';

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
            <select id="scribe-profile-select" class="text_pole">
              <option value="">Use Default (Chat)</option>
              ${profileOptions}
            </select>
            <small style="opacity:0.6; font-size:11px; margin-top:4px;">
              Select a profile for cheaper/faster lore generation.
            </small>
            
            <label for="scribe-lorebook-select" style="margin-top:12px;">Default Lorebook</label>
            <select id="scribe-lorebook-select" class="text_pole">
              <option value="">(Select a lorebook)</option>
              ${lorebookOptions}
            </select>
            <small style="opacity:0.6; font-size:11px; margin-top:4px;">
              Highlight text in any chat message, then click "📖 Extract Lore".
            </small>
          </div>
        </div>
      </div>
    </div>`;

    $('#extensions_settings').append(html);

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

    // Save profile on change
    $('#scribe-profile-select').on('change', function() {
        if (!extension_settings['SillyTavern-Scribe']) {
            extension_settings['SillyTavern-Scribe'] = {};
        }
        extension_settings['SillyTavern-Scribe'].selectedProfile = $(this).val();
        saveSettingsDebounced();
        console.log('SillyTavern-Scribe!: Profile selected:', $(this).val());
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
